import type { Network, Point, StationStop } from '../models/types'
import type { OsmImportIssue, OsmStationReport, OsmStationSkip } from './osmTypes'
import type { OsmNode, OsmRead } from './osmRead'
import type { TrackGraph } from './osmGraph'
import { addStation } from '../models/stations'
import { projectOnSegment } from '../models/locomotive'
import { railsWithin } from '../geometry/networkFollower'
import type { TrackPlace, TrackPlacer } from './osmPlace'
import { normalizedName, uicKey } from '../models/stationRegistry'

export { normalizedName, uicKey }

// The stations of an imported network. In OpenStreetMap a station of any size is a polygon or a
// relation, which the import does not fetch; what stands on the track is reliable: the stop
// positions (`railway=stop`, `public_transport=stop_position`), one per platform track, each
// naming its station by `name` and `uic_ref`. They are grouped into stations, by UIC code first,
// then by name within a walk of each other. A `railway=station` node, when there is one, refines
// the name and, when it is on no track at all (a building), takes the rails within reach of it as
// platform tracks. A node on a way the options leave out (a metro station under the railway one)
// is left to its way: never attached to a track by distance.

type Tags = Record<string, string>

/** Modes of a stop or a station that are not the heavy rail the editor lays */
const OTHER_MODES = ['subway', 'light_rail', 'tram', 'funicular', 'monorail', 'bus', 'ferry', 'trolleybus', 'aerialway']

/** A station node that is on no track (a building) takes the rails within this distance (m) as its platform tracks */
export const STATION_BUILDING_REACH = 80
/** A stop or a node joins a station of the same name within this distance (m) */
const SAME_NAME_REACH = 1500
/** Two stops closer than this (m) along one rail are one stop (a station node on a stop position) */
const SAME_STOP = 1

/** True for a `railway=station` or `railway=halt` node of the heavy rail */
export function isStationNode(tags: Tags | undefined): boolean {
  if (!tags) return false
  if (tags.railway !== 'station' && tags.railway !== 'halt') return false
  return !isOtherMode(tags)
}

/** True for a stop position of a train on the track */
export function isStopNode(tags: Tags | undefined): boolean {
  if (!tags) return false
  if (isOtherMode(tags)) return false
  if (tags.railway === 'stop') return true
  return tags.public_transport === 'stop_position' && tags.train === 'yes'
}

function isOtherMode(tags: Tags): boolean {
  if (tags.station !== undefined && OTHER_MODES.includes(tags.station)) return true
  if (tags.train === 'yes') return false
  return OTHER_MODES.some((mode) => tags[mode] === 'yes')
}

/** The stations an answer names, by UIC code or name, before anything is built (stops and station nodes alike) */
export function countStations(read: OsmRead): number {
  const keys = new Set<string>()
  for (const node of read.nodes.values()) {
    if (!isStopNode(node.tags) && !isStationNode(node.tags)) continue
    const key = keyOf(node.tags!)
    if (key) keys.add(key)
  }
  return keys.size
}

function keyOf(tags: Tags): string | undefined {
  const uic = uicKey(tags.uic_ref)
  if (uic) return `uic:${uic}`
  return tags.name ? `name:${normalizedName(tags.name)}` : undefined
}

interface Stop extends TrackPlace {
  point: Point
  ref?: string
}

/** The stops and nodes gathered for one station */
interface Group {
  uic?: string
  name?: string
  nameKey?: string
  /** Three-letter code of the station (`railway:ref`), when a node carries one */
  code?: string
  stops: Stop[]
  /** A station node on no track: where the building is */
  building?: Point
  /** Where the group gathers: the mean of its stops, else its building */
  centroid: Point
  sum: Point
  members: number
}

export interface StationLayInput {
  net: Network
  read: OsmRead
  graph: TrackGraph
  /** World position of a place, for the nodes that are on no imported track */
  project: (lat: number, lon: number) => Point
  placer: TrackPlacer
}

/**
 * Lay the stations the data names, and say what was done. The network keeps its nodes and rails:
 * only `net.stations` changes.
 */
export function layStations(input: StationLayInput): { report: OsmStationReport; issues: OsmImportIssue[] } {
  const { net, read, graph, placer, project } = input
  const report: OsmStationReport = { found: 0, placed: 0, stops: 0, skipped: {} }
  const issues: OsmImportIssue[] = []
  const skip = (why: OsmStationSkip): void => {
    report.skipped[why] = (report.skipped[why] ?? 0) + 1
  }

  // The nodes that belong to a way of the answer, imported or not
  const onWay = new Set<number>()
  for (const track of read.allTracks) for (const id of track.nodes) onWay.add(id)

  const groups: Group[] = []
  const byUic = new Map<string, Group>()
  const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
  const gather = (group: Group, at: Point): void => {
    group.sum = { x: group.sum.x + at.x, y: group.sum.y + at.y }
    group.members++
    group.centroid = { x: group.sum.x / group.members, y: group.sum.y / group.members }
  }
  /** The group a stop or a node belongs to: by code, else by name within a walk, else a new one */
  const groupFor = (uic: string | undefined, name: string | undefined, at: Point): Group => {
    const known = uic ? byUic.get(uic) : undefined
    if (known) {
      if (name && !known.name) {
        known.name = name
        known.nameKey = normalizedName(name)
      }
      return known
    }
    const nameKey = name ? normalizedName(name) : undefined
    if (nameKey) {
      let nearest: Group | undefined
      for (const group of groups) {
        if (group.nameKey !== nameKey || distance(group.centroid, at) > SAME_NAME_REACH) continue
        if (!nearest || distance(group.centroid, at) < distance(nearest.centroid, at)) nearest = group
      }
      if (nearest) {
        if (uic && !nearest.uic) {
          nearest.uic = uic
          byUic.set(uic, nearest)
        }
        return nearest
      }
    }
    const group: Group = { stops: [], centroid: at, sum: { x: 0, y: 0 }, members: 0 }
    if (uic) {
      group.uic = uic
      byUic.set(uic, group)
    }
    if (name) {
      group.name = name
      group.nameKey = nameKey
    }
    groups.push(group)
    return group
  }
  const addStop = (group: Group, place: TrackPlace, at: Point, ref: string | undefined): void => {
    const same = group.stops.find((stop) => stop.segId === place.segId && distance(stop.point, at) < SAME_STOP)
    if (same) {
      if (ref && !same.ref) same.ref = ref
      return
    }
    const stop: Stop = { segId: place.segId, t: place.t, point: at }
    if (ref) stop.ref = ref
    group.stops.push(stop)
    gather(group, at)
  }

  // 1. The stop positions: what stands on the track
  for (const node of read.nodes.values()) {
    if (!isStopNode(node.tags)) continue
    const tags = node.tags!
    const uic = uicKey(tags.uic_ref)
    const name = tags.name
    if (!uic && !name) {
      skip('unnamed')
      continue
    }
    const at = graph.at.has(node.id) ? graph.pos.get(node.id) : undefined
    if (!at) {
      skip(onWay.has(node.id) ? 'track-not-imported' : 'off-track')
      continue
    }
    const place = placer.placeOf(node.id, at)
    if (!place) {
      skip('off-track')
      continue
    }
    addStop(groupFor(uic, name, at), place, at, platformRef(tags))
  }

  // 2. The station nodes: a name, and a place when they stand on the track or beside it
  const buildings: { group: Group; node: OsmNode }[] = []
  for (const node of read.nodes.values()) {
    if (!isStationNode(node.tags)) continue
    const tags = node.tags!
    const uic = uicKey(tags.uic_ref)
    const name = tags.name
    if (!uic && !name) {
      skip('unnamed')
      continue
    }
    if (onWay.has(node.id)) {
      // On a way: the station is where its way is, imported or not
      const at = graph.at.has(node.id) ? graph.pos.get(node.id) : undefined
      if (!at) {
        skip('track-not-imported')
        continue
      }
      const group = groupFor(uic, name, at)
      group.code ??= stationCode(tags)
      const place = placer.placeOf(node.id, at)
      if (place) addStop(group, place, at, platformRef(tags))
      continue
    }
    const at = project(node.lat, node.lon)
    const group = groupFor(uic, name, at)
    group.code ??= stationCode(tags)
    if (group.stops.length === 0 && !group.building) {
      group.building = at
      group.centroid = at
      buildings.push({ group, node })
    }
  }

  // 3. A building with no stop takes the rails within reach of it, one per track laid
  for (const { group } of buildings) {
    if (group.stops.length > 0 || !group.building) continue
    const nearest = new Map<string, { place: TrackPlace; point: Point; dist: number }>()
    for (const seg of railsWithin(net, group.building, STATION_BUILDING_REACH)) {
      const found = projectOnSegment(net, seg, group.building)
      if (!found) continue
      const dist = distance(found.point, group.building)
      if (dist > STATION_BUILDING_REACH) continue
      const chain = placer.chainOfRail(seg)
      // Only the heavy rail: a tram line along the station square is not a platform track
      if (chain && chain.edges[0].track.kind !== 'rail') continue
      const key = chain ? `chain ${chain.index}` : seg.id
      const best = nearest.get(key)
      if (!best || dist < best.dist) nearest.set(key, { place: { segId: seg.id, t: found.t }, point: found.point, dist })
    }
    for (const { place, point } of nearest.values()) addStop(group, place, point, undefined)
  }

  // 4. One station per group that stands on some track
  report.found = groups.length
  for (const group of groups) {
    if (group.stops.length === 0) {
      skip('no-track-nearby')
      const at = group.building ?? group.centroid
      const name = group.name ?? (group.uic ? `UIC ${group.uic}` : 'gare')
      issues.push({ kind: 'station-not-placed', x: at.x, y: at.y, osmIds: [], detail: `« ${name} » : aucune voie à moins de ${STATION_BUILDING_REACH} m, gare non posée.` })
      continue
    }
    const stops: StationStop[] = sortedStops(group.stops).map((stop) => (stop.ref !== undefined ? { segId: stop.segId, t: stop.t, ref: stop.ref } : { segId: stop.segId, t: stop.t }))
    addStation(net, {
      name: group.name ?? (group.uic ? `Gare ${group.uic}` : 'Gare'),
      pos: group.centroid,
      stops,
      ...(group.uic ? { uic: group.uic } : {}),
      ...(group.code ? { code: group.code } : {}),
    })
    report.placed++
    report.stops += stops.length
  }
  return { report, issues }
}

/** The three-letter code of a station (`railway:ref`, the SNCF trigram), when the node carries one */
function stationCode(tags: Tags): string | undefined {
  const code = tags['railway:ref']?.trim().toUpperCase()
  return code && /^[A-Z]{3}$/.test(code) ? code : undefined
}

/** The platform or track number a stop position carries, when it does */
function platformRef(tags: Tags): string | undefined {
  const ref = tags.local_ref?.trim()
  return ref ? ref : undefined
}

/** Stops in the order of their platform numbers when every one has one, else as found */
function sortedStops(stops: Stop[]): Stop[] {
  if (!stops.every((stop) => stop.ref !== undefined)) return stops
  return [...stops].sort((a, b) => a.ref!.localeCompare(b.ref!, 'fr', { numeric: true }))
}
