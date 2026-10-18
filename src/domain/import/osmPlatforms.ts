import type { Network, PlatformEdge, Point, Segment, SegmentId, Station, StationId, StopMarker } from '../models/types'
import type { OsmImportIssue, OsmPlatformReport, OsmPlatformSkip } from './osmTypes'
import type { OsmNode } from './osmRead'
import type { TrackPlacer } from './osmPlace'
import { positionOnSegment, projectOnSegment, segmentPartialLength, tangentOnSegment } from '../models/locomotive'
import { railsInBox, railsWithin } from '../geometry/networkFollower'
import { addPlatform, defaultMarkers, PLATFORM_WIDTH, platformDimensions, pointOnEdge, settlePlatforms, sideNormal } from '../models/platforms'
import { findTrackPathToAny } from '../services/trackPath'
import { projectOnRails, railsAlong, STATION_REACH } from '../services/platformLayout'

// The platforms of an imported network. OpenStreetMap draws a platform as a way (`railway=platform`,
// or `public_transport=platform` with `train=yes`): a line along it, or a closed outline; a large
// one is sometimes a multipolygon relation. Nothing in the data says which track it serves: that
// is read from the geometry. The outline is sampled every few metres and each sample is brought
// onto the nearest heavy-rail track within reach, and onto the nearest one on the other side of it
// when there is one (an island). The samples that reach a track give its edge: from the first to
// the last of them along the track (the overlap of the platform with the track), on the side the
// samples lie. A platform is given to the station whose stop positions are on its track, else to
// the nearest station within reach; none is made for it. A station whose stops the platforms do
// not all cover keeps its stops and gets no platform: its stops would otherwise be lost (with
// platforms, the stops of a station are drawn from their markers, see `settlePlatforms`).

type Tags = Record<string, string>

/** Modes of a platform that are not the heavy rail the editor lays */
const OTHER_MODES = ['subway', 'light_rail', 'tram', 'funicular', 'monorail', 'bus', 'ferry', 'trolleybus', 'aerialway']

/** A platform as the data draws it, before anything is laid */
export interface OsmPlatformOutline {
  /** OSM id of the way or the relation */
  osmId: number
  element: 'way' | 'relation'
  /** Runs of node ids: one for a way, one per outer way of a relation */
  parts: number[][]
  /** A closed outline (an area), not a line drawn along the platform */
  area: boolean
  /** `ref` and `local_ref` as written (« 1;2 », « A/B ») */
  ref?: string
  localRef?: string
  name?: string
}

/** Distance between two samples of an outline, m */
export const PLATFORM_SAMPLE_STEP = 2
/** A sample of a closed outline reaches the track within this distance, m: its edge is ~1.7 m from the axis */
export const PLATFORM_AREA_REACH = 4.5
/** A sample of a line drawn along a platform (often its middle) reaches the track within this distance, m */
export const PLATFORM_LINE_REACH = 8
/** A line between two tracks is an island when they are nearly as far from it, within this, m */
const ISLAND_BALANCE = 3
/** Shortest edge laid, m */
export const MIN_OSM_PLATFORM_EDGE = 10
/** The second edge of an island is at least this share of the first: else a corner, not a track */
const MIN_ISLAND_SHARE = 0.3
/** A stop of the station this far beyond the end of an edge is still on it, m */
export const PLATFORM_STOP_SLACK = 30
/** A stop on the track of a platform is one of its station within this distance of it, m */
const STOP_STATION_REACH = 500
/** A platform that covers this share of the edge of one already laid (same rails, same side) is the same one */
const DUPLICATE_SHARE = 0.5
/** A sample this close to the axis is drawn over the track: it says no side */
const ON_TRACK = 0.3

/** True for the tags of a platform of the heavy rail */
export function isPlatformTags(tags: Tags | undefined): boolean {
  if (!tags) return false
  if (tags.railway !== 'platform' && !(tags.public_transport === 'platform' && tags.train === 'yes')) return false
  if (tags.train === 'yes') return true
  return !OTHER_MODES.some((mode) => tags[mode] === 'yes')
}

interface RawElement {
  type?: unknown
  id?: unknown
  nodes?: unknown
  members?: unknown
  tags?: unknown
}

function stringTags(raw: unknown): Tags | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const tags: Tags = {}
  for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') tags[key] = value
  return tags
}

/**
 * The platforms of an answer: the ways and the multipolygon relations tagged as platforms of the
 * heavy rail, each with the runs of its nodes the answer holds. Tolerant: what is malformed is skipped.
 */
export function readPlatformOutlines(elements: readonly unknown[], nodes: ReadonlyMap<number, OsmNode>): OsmPlatformOutline[] {
  const ways = new Map<number, number[]>()
  for (const raw of elements as RawElement[]) {
    if (raw && raw.type === 'way' && typeof raw.id === 'number' && Array.isArray(raw.nodes)) {
      ways.set(raw.id, raw.nodes.filter((id): id is number => typeof id === 'number'))
    }
  }
  const runsOf = (ids: readonly number[]): number[][] => {
    const runs: number[][] = []
    let run: number[] = []
    for (const id of ids) {
      if (!nodes.has(id)) {
        if (run.length >= 2) runs.push(run)
        run = []
      } else if (run[run.length - 1] !== id) run.push(id)
    }
    if (run.length >= 2) runs.push(run)
    return runs
  }
  const outlines: OsmPlatformOutline[] = []
  const describe = (outline: OsmPlatformOutline, tags: Tags): OsmPlatformOutline => {
    const ref = tags.ref?.trim()
    const localRef = tags.local_ref?.trim()
    if (ref) outline.ref = ref
    if (localRef) outline.localRef = localRef
    if (tags.name) outline.name = tags.name
    return outline
  }
  for (const raw of elements as RawElement[]) {
    if (!raw || typeof raw.id !== 'number') continue
    const tags = stringTags(raw.tags)
    if (!isPlatformTags(tags)) continue
    if (raw.type === 'way') {
      const ids = ways.get(raw.id) ?? []
      const closed = ids.length >= 4 && ids[0] === ids[ids.length - 1]
      const parts = runsOf(ids)
      if (parts.length === 0) continue
      outlines.push(describe({ osmId: raw.id, element: 'way', parts, area: closed || tags!.area === 'yes' }, tags!))
    } else if (raw.type === 'relation' && tags!.type === 'multipolygon' && Array.isArray(raw.members)) {
      const parts: number[][] = []
      for (const member of raw.members as { type?: unknown; ref?: unknown; role?: unknown }[]) {
        if (member?.type !== 'way' || typeof member.ref !== 'number' || (member.role !== 'outer' && member.role !== '' && member.role !== undefined)) continue
        parts.push(...runsOf(ways.get(member.ref) ?? []))
      }
      if (parts.length === 0) continue
      outlines.push(describe({ osmId: raw.id, element: 'relation', parts, area: true }, tags!))
    }
  }
  return outlines
}

/** The track numbers a `ref` or `local_ref` lists (« 1;2 », « A/B », « 3, 4 ») */
export function splitPlatformRef(ref: string | undefined): string[] {
  if (!ref) return []
  return ref
    .split(/[;,/]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

export interface PlatformLayInput {
  net: Network
  outlines: readonly OsmPlatformOutline[]
  nodes: ReadonlyMap<number, OsmNode>
  project: (lat: number, lon: number) => Point
  placer: TrackPlacer
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Places every `step` metres along a run of points, both ends included */
function sampleRun(points: readonly Point[], step: number): Point[] {
  const samples: Point[] = points.length > 0 ? [points[0]] : []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const count = Math.max(1, Math.ceil(dist(a, b) / step))
    for (let k = 1; k <= count; k++) samples.push({ x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count })
  }
  return samples
}

/** The main direction of a cloud of points (unit vector) */
function mainDirection(points: readonly Point[]): Point {
  let mx = 0
  let my = 0
  for (const p of points) {
    mx += p.x
    my += p.y
  }
  mx /= points.length
  my /= points.length
  let xx = 0
  let xy = 0
  let yy = 0
  for (const p of points) {
    const dx = p.x - mx
    const dy = p.y - my
    xx += dx * dx
    xy += dx * dy
    yy += dy * dy
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

/** A sample of the outline brought onto a track */
interface Hit {
  segId: SegmentId
  t: number
  foot: Point
  sample: Point
  /** Where the track lies from the sample, seen along the main direction of the platform: one side or the other */
  key: 1 | -1
}

interface Candidate {
  segId: SegmentId
  t: number
  foot: Point
  d: number
  n: Point
}

/** One edge as found, before it is laid */
interface FoundEdge {
  edge: PlatformEdge
  length: number
  hits: Hit[]
}

/**
 * The edge the hits of one side make: the track most of them are on, from the first hit along the
 * platform to the last; its side is the one the samples lie on. Null when it is too short.
 */
function edgeOfHits(net: Network, hits: readonly Hit[], u: Point, extent: number): FoundEdge | null {
  if (hits.length < 2) return null
  const count = new Map<SegmentId, number>()
  for (const hit of hits) count.set(hit.segId, (count.get(hit.segId) ?? 0) + 1)
  let anchor = hits[0]
  for (const hit of hits) if (count.get(hit.segId)! > count.get(anchor.segId)!) anchor = hit
  const rails = railsAlong(net, anchor, extent + 50)
  const kept = hits.filter((hit) => rails.has(hit.segId))
  if (kept.length < 2) return null
  let first = kept[0]
  let last = kept[0]
  for (const hit of kept) {
    if (dot(hit.foot, u) < dot(first.foot, u)) first = hit
    if (dot(hit.foot, u) > dot(last.foot, u)) last = hit
  }
  const path = findTrackPathToAny(net, first, [last], { blocked: (sid) => !rails.has(sid) })
  if (!path || path.length < MIN_OSM_PLATFORM_EDGE) return null
  const forward = new Map<SegmentId, boolean>()
  for (const span of path.spans) forward.set(span.segId, span.t1 >= span.t0)
  let vote = 0
  const used: Hit[] = []
  for (const hit of kept) {
    const way = forward.get(hit.segId)
    const tangent = way === undefined ? null : tangentOnSegment(net, hit.segId, hit.t)
    if (!tangent) continue
    const heading = way ? tangent : { x: -tangent.x, y: -tangent.y }
    vote += Math.sign(dot(sub(hit.sample, hit.foot), sideNormal(heading, 'left')))
    used.push(hit)
  }
  return { edge: { track: path.spans, side: vote >= 0 ? 'left' : 'right' }, length: path.length, hits: used }
}

/** The side of the track an edge is on, seen along the rail itself (from its `from` node), rail by rail */
function railSides(edge: PlatformEdge): Map<SegmentId, { lo: number; hi: number; side: 'left' | 'right' }> {
  const sides = new Map<SegmentId, { lo: number; hi: number; side: 'left' | 'right' }>()
  for (const span of edge.track) {
    const forward = span.t1 >= span.t0
    const side = forward ? edge.side : edge.side === 'left' ? 'right' : 'left'
    sides.set(span.segId, { lo: Math.min(span.t0, span.t1), hi: Math.max(span.t0, span.t1), side })
  }
  return sides
}

/** Length of track two edges run along together, on the same side, m */
function sharedLength(net: Network, a: PlatformEdge, b: PlatformEdge): number {
  const mine = railSides(a)
  let shared = 0
  for (const [segId, other] of railSides(b)) {
    const own = mine.get(segId)
    if (!own || own.side !== other.side) continue
    const lo = Math.max(own.lo, other.lo)
    const hi = Math.min(own.hi, other.hi)
    if (hi > lo) shared += segmentPartialLength(net, segId, lo, hi)
  }
  return shared
}

/** A platform found in the data, before its station is settled */
interface Found {
  outline: OsmPlatformOutline
  edges: FoundEdge[]
  width: number
  middle: Point
  rails: Set<SegmentId>
}

/** Where a stop of a station falls on an edge: the distance along it from its start, held to its ends; null when it is not on it */
function stopOnEdge(net: Network, edge: PlatformEdge, length: number, stop: { segId: SegmentId; t: number; point: Point }): number | null {
  let before = 0
  for (const span of edge.track) {
    const spanLength = segmentPartialLength(net, span.segId, span.t0, span.t1)
    if (span.segId === stop.segId) {
      const lo = Math.min(span.t0, span.t1)
      const hi = Math.max(span.t0, span.t1)
      const t = Math.max(lo, Math.min(hi, stop.t))
      const beyond = segmentPartialLength(net, span.segId, t, stop.t)
      if (beyond <= PLATFORM_STOP_SLACK) return Math.max(0, Math.min(length, before + segmentPartialLength(net, span.segId, span.t0, t)))
    }
    before += spanLength
  }
  // Just beyond an end, on the rail that goes on from it
  for (const at of [0, length]) {
    const end = pointOnEdge(net, edge, at)
    if (!end || dist(end.point, stop.point) > PLATFORM_STOP_SLACK) continue
    if (railsAlong(net, end, PLATFORM_STOP_SLACK).has(stop.segId)) return at
  }
  return null
}

/**
 * Lay the platforms the data draws onto the network as it is handed over (rails and nodes are not
 * changed): each attached to the track it runs along and to the station it serves. Then the stops
 * of the stations that got platforms are drawn from their markers.
 */
export function layOsmPlatforms(input: PlatformLayInput): { report: OsmPlatformReport; issues: OsmImportIssue[] } {
  const { net, outlines, nodes, project, placer } = input
  const report: OsmPlatformReport = { found: outlines.length, placed: 0, islands: 0, skipped: {} }
  const issues: OsmImportIssue[] = []
  const skip = (why: OsmPlatformSkip, count = 1): void => {
    report.skipped[why] = (report.skipped[why] ?? 0) + count
  }
  const dims = platformDimensions()
  const heavy = (seg: Segment): boolean => {
    const chain = placer.chainOfRail(seg)
    return !chain || chain.edges[0].track.kind === 'rail'
  }

  // The areas first, more precise than a line drawn along the platform
  const ordered = [...outlines].sort((a, b) => Number(b.area) - Number(a.area))
  const found: Found[] = []
  for (const outline of ordered) {
    const runs = outline.parts.map((part) => part.map((id) => {
      const node = nodes.get(id)!
      return project(node.lat, node.lon)
    }))
    const points = runs.flat()
    const samples = runs.flatMap((run) => sampleRun(run, PLATFORM_SAMPLE_STEP))
    if (points.length < 2 || samples.length === 0) {
      skip('no-track')
      continue
    }
    // Most platforms of an answer are nowhere near a track the import kept: one look at their box
    const reach = outline.area ? PLATFORM_AREA_REACH : PLATFORM_LINE_REACH
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const box = { minX: Math.min(...xs) - reach, minY: Math.min(...ys) - reach, maxX: Math.max(...xs) + reach, maxY: Math.max(...ys) + reach }
    if (!railsInBox(net, box).some(heavy)) {
      skip('no-track')
      continue
    }
    const u = mainDirection(points)
    const along = points.map((p) => dot(p, u))
    const extent = Math.max(...along) - Math.min(...along)
    const hits: Hit[] = []
    for (const sample of samples) {
      const candidates: Candidate[] = []
      for (const seg of railsWithin(net, sample, reach)) {
        if (!heavy(seg)) continue
        const proj = projectOnSegment(net, seg, sample)
        if (!proj) continue
        const d = dist(proj.point, sample)
        if (d > reach || d < ON_TRACK) continue
        // A foot held to the end of a rail, off to the side of the sample: the rail beyond answers
        const tangent = tangentOnSegment(net, seg.id, proj.t)
        if (!tangent || Math.abs(dot(sub(sample, proj.point), tangent)) > 0.5 * d + 0.5) continue
        candidates.push({ segId: seg.id, t: proj.t, foot: proj.point, d, n: { x: (proj.point.x - sample.x) / d, y: (proj.point.y - sample.y) / d } })
      }
      if (candidates.length === 0) continue
      candidates.sort((a, b) => a.d - b.d)
      const near = candidates[0]
      const across = candidates.find((c) => dot(c.n, near.n) < 0 && (outline.area || Math.abs(c.d - near.d) <= ISLAND_BALANCE))
      for (const c of across ? [near, across] : [near]) {
        hits.push({ segId: c.segId, t: c.t, foot: c.foot, sample, key: cross(u, c.n) >= 0 ? 1 : -1 })
      }
    }
    const sides = ([1, -1] as const)
      .map((key) => edgeOfHits(net, hits.filter((hit) => hit.key === key), u, extent))
      .filter((edge): edge is FoundEdge => edge !== null)
      .sort((a, b) => b.length - a.length)
    let edges = sides.slice(0, 1)
    if (sides.length === 2) {
      const [one, two] = sides
      const apart = ![...two.edge.track].some((span) => one.edge.track.some((s) => s.segId === span.segId))
      if (apart && two.length >= MIN_ISLAND_SHARE * one.length) edges = [one, two]
    }
    if (edges.length === 0) {
      skip('no-track')
      continue
    }
    // The same platform drawn twice (an area and a line, or two tags on two ways)
    const duplicate = found.some((other) =>
      other.edges.some((mine) => edges.some((edge) => sharedLength(net, mine.edge, edge.edge) >= DUPLICATE_SHARE * Math.min(mine.length, edge.length))),
    )
    if (duplicate) {
      skip('duplicate')
      continue
    }
    const rails = new Set(edges.flatMap((edge) => edge.edge.track.map((span) => span.segId)))
    // A platform beside one track: as wide as its outline reaches away from it
    let width = PLATFORM_WIDTH
    if (edges.length === 1 && outline.area) {
      let far = 0
      for (const sample of samples) {
        const onTrack = projectOnRails(net, rails, sample)
        if (onTrack) far = Math.max(far, dist(onTrack.at, sample))
      }
      width = Math.round(Math.max(1.5, Math.min(20, far - dims.edgeOffset)) * 10) / 10
    }
    const mid = pointOnEdge(net, edges[0].edge, edges[0].length / 2)
    found.push({ outline, edges, width, middle: mid ? mid.point : samples[0], rails })
  }

  // The station of each platform: the one with a stop on its track, else the nearest within reach
  const stopsOf = new Map<StationId, { segId: SegmentId; t: number; point: Point; ref?: string }[]>()
  for (const station of net.stations.values()) {
    stopsOf.set(
      station.id,
      station.stops.flatMap((stop) => {
        const point = positionOnSegment(net, stop.segId, stop.t)
        return point ? [{ segId: stop.segId, t: stop.t, point, ...(stop.ref !== undefined ? { ref: stop.ref } : {}) }] : []
      }),
    )
  }
  const byStation = new Map<StationId, Found[]>()
  for (const platform of found) {
    const station = stationOf(net, platform, stopsOf)
    if (!station) {
      skip('no-station')
      const name = platform.outline.name ? ` « ${platform.outline.name} »` : ''
      issues.push({
        kind: 'platform-not-placed',
        x: platform.middle.x,
        y: platform.middle.y,
        osmIds: [platform.outline.osmId],
        detail: `Quai${name} sans gare à moins de ${STATION_REACH} m : non posé.`,
      })
      continue
    }
    const list = byStation.get(station.id)
    if (list) list.push(platform)
    else byStation.set(station.id, [platform])
  }

  for (const [stationId, platforms] of byStation) {
    const stops = stopsOf.get(stationId) ?? []
    // Where each stop falls, on which edge of which platform
    const placed = stops.map((stop) => {
      const on: { platform: number; edge: number; at: number }[] = []
      platforms.forEach((platform, p) => {
        platform.edges.forEach((edge, e) => {
          const at = stopOnEdge(net, edge.edge, edge.length, stop)
          if (at !== null) on.push({ platform: p, edge: e, at })
        })
      })
      return on
    })
    if (placed.some((on) => on.length === 0)) {
      // A stop no platform covers would be lost: the station keeps its stops, without platforms
      skip('uncovered-stops', platforms.length)
      continue
    }
    platforms.forEach((platform, p) => {
      const edges: PlatformEdge[] = platform.edges.map((found) => ({ track: found.edge.track, side: found.edge.side }))
      const markers: StopMarker[] = []
      const refs = splitPlatformRef(platform.outline.localRef ?? platform.outline.ref)
      edges.forEach((edge, e) => {
        const here: number[] = []
        const stopRefs = new Set<string>()
        placed.forEach((on, s) => {
          for (const place of on) {
            if (place.platform !== p || place.edge !== e) continue
            if (!here.some((at) => Math.abs(at - place.at) < 1)) here.push(place.at)
            if (stops[s].ref !== undefined) stopRefs.add(stops[s].ref!)
          }
        })
        if (stopRefs.size === 1) edge.ref = [...stopRefs][0]
        const index = e as 0 | 1
        if (here.length === 0) {
          for (const marker of defaultMarkers(net, [edge], dims.markerMargin)) markers.push({ ...marker, edge: index })
        } else {
          for (const at of here.sort((a, b) => a - b)) markers.push({ edge: index, at, heading: 'forward' }, { edge: index, at, heading: 'backward' })
        }
      })
      assignRefs(edges, refs)
      addPlatform(net, { stationId, edges: edges as [PlatformEdge] | [PlatformEdge, PlatformEdge], width: platform.width, markers })
      report.placed++
      if (edges.length === 2) report.islands++
    })
  }
  settlePlatforms(net)
  return { report, issues }
}

/** The refs of the data given to the edges that have none from their stops: one per edge when it lists one per edge */
function assignRefs(edges: PlatformEdge[], refs: readonly string[]): void {
  if (refs.length === 0) return
  if (edges.length === 1) {
    edges[0].ref ??= refs.join(';')
    return
  }
  if (refs.length !== 2) return
  const taken = edges.map((edge) => edge.ref)
  const left = refs.filter((ref) => !taken.includes(ref))
  for (const edge of edges) if (edge.ref === undefined && left.length > 0) edge.ref = left.shift()
}

/** The station a platform found in the data belongs to, or null */
function stationOf(
  net: Network,
  platform: Found,
  stopsOf: ReadonlyMap<StationId, readonly { segId: SegmentId; point: Point }[]>,
): Station | null {
  let best: { station: Station; d: number } | null = null
  for (const station of net.stations.values()) {
    for (const stop of stopsOf.get(station.id) ?? []) {
      if (!platform.rails.has(stop.segId)) continue
      const d = dist(stop.point, platform.middle)
      if (d <= STOP_STATION_REACH && (!best || d < best.d)) best = { station, d }
    }
  }
  if (best) return best.station
  for (const station of net.stations.values()) {
    const places = [station.pos, ...(stopsOf.get(station.id) ?? []).map((stop) => stop.point)]
    for (const place of places) {
      const d = dist(place, platform.middle)
      if (d <= STATION_REACH && (!best || d < best.d)) best = { station, d }
    }
  }
  return best?.station ?? null
}
