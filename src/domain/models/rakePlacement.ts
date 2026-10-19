import { generateId } from './ids'
import { segmentShapeLength } from '../geometry/segmentGeometry'
import { stationStopTargets } from '../services/stopMarkers'
import { walkBackward } from './locomotive'
import { runsAgainst } from './running'
import { edgeLength, platformsOf } from './platforms'
import { consistLength, consistOf, endOverhang, rakeChoice, type RakeChoice, type RollingStockModel } from './rollingStock'
import { advanceTrainSet, createVehicle, makeTrainSet, switchDrivingCab, trackLeftAhead, type TrainSet, type Vehicle } from './train'
import type { Network, Platform, PlatformEdge, SegmentId, Station, StationStop } from './types'

// ─────────────────── A complete rake set down at once ───────────────────
//
// The train tool lays vehicles one at a time. A game that starts at a station needs the whole
// rake standing at a platform: its nose at the stop — the stop marker of a platform edge that
// speaks to its length (`stopMarkers.ts`), or a stop of a station without platforms — the rest
// behind it along the track.

/** How far ahead of a rake the track is looked at to tell which way out of a station is open */
const DEPARTURE_REACH = 2000
/** A rake with this much track ahead (m) faces a way out, not the buffers */
const WAY_OUT = 300
/** Room left between the buffers and the tail of a rake turned to leave a terminus, m */
const BUFFER_CLEARANCE = 1

/**
 * The complete trainset of `model` with its lead bogie at (segId, t), nose towards the end of the
 * rail (`direction` 1) or its start (-1). Null when the track behind is too short for all of it.
 */
export function createRake(net: Network, segId: SegmentId, t: number, direction: 1 | -1, rake: RollingStockModel | RakeChoice): TrainSet | null {
  const { model } = rakeChoice(rake)
  const consist = consistOf(rake)
  const lead = createVehicle(net, segId, t, consist[0].kind, direction, model)
  if (!lead) return null
  // The followers start on the lead: `advanceTrainSet` sets each one behind the one before it
  const vehicles: Vehicle[] = consist.map((stock, i) => {
    if (i === 0) return lead
    const vehicle: Vehicle = { id: generateId('veh'), kind: stock.kind, model, front: { ...lead.front }, rear: { ...lead.rear } }
    if (stock.flipped) vehicle.flipped = true
    return vehicle
  })
  const train = makeTrainSet(generateId('train'), vehicles)
  return advanceTrainSet(net, train, 0) ? train : null
}

/**
 * The complete trainset of `model` with its nose (the front end of its lead vehicle) at
 * (segId, t), towards the end of the rail (`direction` 1) or its start (-1). Null when the track
 * behind is too short for all of it.
 */
export function createRakeWithNoseAt(net: Network, segId: SegmentId, t: number, direction: 1 | -1, rake: RollingStockModel | RakeChoice): TrainSet | null {
  const bogie = walkBackward(net, segId, t, direction === 1, endOverhang(consistOf(rake), 0, 'front'))
  return bogie ? createRake(net, bogie.segId, bogie.t, bogie.forward ? 1 : -1, rake) : null
}

export interface RakeAtStation {
  train: TrainSet
  /** The stop of the station the nose of the rake that arrived there stands at */
  stop: StationStop
}

/**
 * The rake driven from its other cab, ready to leave the way it came. A stop of a terminus is at
 * the buffers, where the nose of an arriving train comes to rest: the rake set down there may
 * overhang the end of the track, so the one that leaves is drawn clear of it.
 */
function turnedToLeave(net: Network, arrived: TrainSet): TrainSet | null {
  const turned = switchDrivingCab(arrived)
  if (!turned) return null
  const left = trackLeftAhead(net, arrived, BUFFER_CLEARANCE)
  if (left !== null && !advanceTrainSet(net, turned, BUFFER_CLEARANCE - left)) return null
  return turned
}

/** A place a rake may be set down at a station: its stop, the ways its nose may face, the length of its platform track */
interface StationPlace {
  stop: StationStop
  directions: readonly (1 | -1)[]
  trackLength: number
}

/**
 * Where a rake of `length` metres may stand at a station: at a station with platforms, the stop
 * marker each platform edge has for it in each direction, the nose facing that way, the edge for
 * its length; at one without, each stop facing either way, the track from points to points.
 */
function stationPlaces(net: Network, station: Station, length: number): StationPlace[] {
  const platforms = platformsOf(net, station.id)
  if (platforms.length === 0) return station.stops.map((stop) => ({ stop, directions: [1, -1] as const, trackLength: platformTrackLength(net, stop) }))
  return stationStopTargets(net, station, length).map((target) => {
    const platform = net.platforms.get(target.platformId)!
    const stop: StationStop = target.ref !== undefined ? { segId: target.segId, t: target.t, ref: target.ref } : { segId: target.segId, t: target.t }
    const edge = platform.edges[target.edge]
    return { stop, directions: [target.forward ? 1 : -1] as const, trackLength: edge ? edgeLength(net, edge) : 0 }
  })
}

/**
 * A complete rake of `model` at a platform of `station`, facing the way out: of every place it
 * may stand at (`stationPlaces`: the nose on a stop marker, or on a stop) where the whole rake
 * fits clear of `others`, driven from either cab, the one best placed to leave (`placeRank`: a
 * way out — a terminus has its buffers behind the train —, then the platform track run in
 * its normal direction, then most track ahead), the first in the order of the places when they are equal — a
 * platform track that holds the whole rake before one it would stick out of. Null when the rake
 * fits at none.
 */
export function createRakeAtStation(net: Network, station: Station, rake: RollingStockModel | RakeChoice, others: readonly TrainSet[] = []): RakeAtStation | null {
  const length = rakeLength(rake)
  let best: RakeAtStation | null = null
  let bestRank: number[] = []
  for (const { stop, directions, trackLength } of stationPlaces(net, station, length)) {
    const here = bestRakeAt(net, stop.segId, stop.t, rake, others, directions, true)
    if (!here) continue
    // A platform track that holds the whole rake before one it would stick out of, then as `placeRank`
    const rank = [trackLength >= length ? 1 : 0, ...placeRank(net, here)]
    if (!best || isBetter(rank, bestRank)) {
      best = { train: here.train, stop }
      bestRank = rank
    }
  }
  return best
}

/**
 * How good a place to leave from is, best first: a way out (`WAY_OUT` of track ahead, not the
 * buffers; the look ahead stops at the first points, often within a few hundred metres), then the platform track run in its normal direction (on a double line,
 * the train leaves on its own track: `Segment.running`), then the most track ahead.
 */
function placeRank(net: Network, place: { train: TrainSet; ahead: number }): number[] {
  const lead = place.train.vehicles[0]?.front
  const seg = lead && net.segments.get(lead.segId)
  const wayOut = place.ahead >= WAY_OUT
  // Facing the buffers, the track ahead alone tells
  const withRunning = wayOut && !(seg && runsAgainst(seg, lead.forward)) ? 1 : 0
  return [wayOut ? 1 : 0, withRunning, place.ahead]
}

/** True when `a` comes before `b`, compared term by term */
function isBetter(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/**
 * Length (m) of the platform track a stop is on: the longest platform edge along its rail when
 * there is one (« le quai fait 220 m »), else the track from points to points (or to an end of
 * track) — the rails walked both ways from the stop through the plain joints.
 */
export function platformTrackLength(net: Network, stop: Pick<StationStop, 'segId'>): number {
  const start = net.segments.get(stop.segId)
  if (!start) return 0
  let edge = -1
  for (const platform of net.platforms.values()) {
    for (const e of platform.edges) if (e.track.some((span) => span.segId === stop.segId)) edge = Math.max(edge, edgeLength(net, e))
  }
  if (edge >= 0) return edge
  let length = segmentShapeLength(net, start)
  const seen = new Set<SegmentId>([start.id])
  for (const end of [start.from, start.to]) {
    let node = end
    let rail = start
    for (;;) {
      const joined = net.adjacency.get(node) ?? []
      if (joined.length !== 2) break
      const nextId = joined[0] === rail.id ? joined[1] : joined[0]
      const next = net.segments.get(nextId)
      if (!next || seen.has(next.id)) break
      seen.add(next.id)
      length += segmentShapeLength(net, next)
      node = next.from === node ? next.to : next.from
      rail = next
    }
  }
  return length
}

/** What a station can do for a rake: how its platform tracks compare with its length */
export interface StationFit {
  /** Length of the rake, m */
  rakeLength: number
  /** Platform tracks of the station (its stops on the track) */
  tracks: number
  /** Those long enough for the whole rake */
  fitting: number
  /** Length of the longest, m */
  longest: number
  /** A rake can be set down there at all (it may stick out of its platform track) */
  placeable: boolean
}

/**
 * The platform tracks of a station with platforms, by their length: one per track its platforms
 * run along — the edges that share a rail are one track (a platform on either side of it), as
 * long as the longest of them.
 */
function platformTracks(net: Network, platforms: readonly Platform[]): number[] {
  const tracks: { rails: Set<SegmentId>; length: number }[] = []
  for (const edge of platforms.flatMap((platform): PlatformEdge[] => platform.edges)) {
    const rails = edge.track.map((span) => span.segId).filter((segId) => net.segments.has(segId))
    if (rails.length === 0) continue
    const length = edgeLength(net, edge)
    const same = tracks.find((track) => rails.some((segId) => track.rails.has(segId)))
    if (!same) {
      tracks.push({ rails: new Set(rails), length })
      continue
    }
    for (const segId of rails) same.rails.add(segId)
    same.length = Math.max(same.length, length)
  }
  return tracks.map((track) => track.length)
}

/**
 * How a rake compares with the platform tracks of a station: at a station with platforms, the
 * tracks they run along and the length of their platforms; at one without, its stops and their
 * tracks from points to points.
 */
export function stationFit(net: Network, station: Station, rake: RollingStockModel | RakeChoice, others: readonly TrainSet[] = []): StationFit {
  const length = rakeLength(rake)
  const platforms = platformsOf(net, station.id)
  const lengths = platforms.length > 0 ? platformTracks(net, platforms) : station.stops.filter((stop) => net.segments.has(stop.segId)).map((stop) => platformTrackLength(net, stop))
  return {
    rakeLength: length,
    tracks: lengths.length,
    fitting: lengths.filter((l) => l >= length).length,
    longest: lengths.length > 0 ? Math.max(...lengths) : 0,
    placeable: createRakeAtStation(net, station, rake, others) !== null,
  }
}

/**
 * The rake that fits at a place of the track best placed to leave (`placeRank`: a way out,
 * on its own track, most track ahead), of the headings given and both cabs, clear of `others`. The place is that of the lead bogie, or of the nose (`nose`) of
 * the rake as it arrived there, before it is driven from its other cab.
 */
function bestRakeAt(
  net: Network,
  segId: SegmentId,
  t: number,
  rake: RollingStockModel | RakeChoice,
  others: readonly TrainSet[],
  directions: readonly (1 | -1)[] = [1, -1],
  nose = false,
): { train: TrainSet; ahead: number } | null {
  if (!net.segments.has(segId)) return null
  const taken = new Set<SegmentId>()
  for (const other of others) for (const veh of other.vehicles) taken.add(veh.front.segId).add(veh.rear.segId)
  let best: { train: TrainSet; ahead: number } | null = null
  let bestRank: number[] = []
  for (const direction of directions) {
    const arrived = nose ? createRakeWithNoseAt(net, segId, t, direction, rake) : createRake(net, segId, t, direction, rake)
    if (!arrived) continue
    if (arrived.vehicles.some((veh) => taken.has(veh.front.segId) || taken.has(veh.rear.segId))) continue
    for (const train of [arrived, turnedToLeave(net, arrived)]) {
      if (!train) continue
      const ahead = trackLeftAhead(net, train, DEPARTURE_REACH) ?? DEPARTURE_REACH
      const rank = placeRank(net, { train, ahead })
      if (!best || isBetter(rank, bestRank)) {
        best = { train, ahead }
        bestRank = rank
      }
    }
  }
  return best
}

/**
 * A complete rake of `model` at a place of the track — anywhere, not only at a platform — facing
 * the way with most track ahead, clear of `others`. Null when the whole rake does not fit there.
 */
export function createRakeAtTrack(net: Network, segId: SegmentId, t: number, rake: RollingStockModel | RakeChoice, others: readonly TrainSet[] = []): TrainSet | null {
  return bestRakeAt(net, segId, t, rake, others)?.train ?? null
}

/** Length of a rake over both ends, m: what a platform track must hold */
export function rakeLength(rake: RollingStockModel | RakeChoice): number {
  return consistLength(consistOf(rake))
}
