import { generateId } from './ids'
import { segmentShapeLength } from '../geometry/segmentGeometry'
import { consistLength, consistOf, rakeChoice, type RakeChoice, type RollingStockModel } from './rollingStock'
import { advanceTrainSet, createVehicle, makeTrainSet, switchDrivingCab, trackLeftAhead, type TrainSet, type Vehicle } from './train'
import type { Network, SegmentId, Station, StationStop } from './types'

// ─────────────────── A complete rake set down at once ───────────────────
//
// The train tool lays vehicles one at a time. A game that starts at a station needs the whole
// rake standing at a platform: the lead bogie at the stop, the rest behind it along the track.

/** How far ahead of a rake the track is looked at to tell which way out of a station is open */
const DEPARTURE_REACH = 2000
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

export interface RakeAtStation {
  train: TrainSet
  /** The stop of the station its lead bogie stands at */
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

/**
 * A complete rake of `model` at a platform of `station`, facing the way out: of every stop and
 * both headings where the whole rake fits clear of `others`, driven from either cab, the one
 * with most track ahead (a terminus has its buffers behind the train), the first in the order of
 * the stops when they are equal. Null when the rake fits at none.
 */
export function createRakeAtStation(net: Network, station: Station, rake: RollingStockModel | RakeChoice, others: readonly TrainSet[] = []): RakeAtStation | null {
  const length = rakeLength(rake)
  let best: RakeAtStation | null = null
  let bestFits = false
  let bestAhead = -Infinity
  for (const stop of station.stops) {
    const here = bestRakeAt(net, stop.segId, stop.t, rake, others)
    if (!here) continue
    // A platform track that holds the whole rake before one it would stick out of
    const fits = platformTrackLength(net, stop) >= length
    if (!best || (fits && !bestFits) || (fits === bestFits && here.ahead > bestAhead)) {
      best = { train: here.train, stop }
      bestFits = fits
      bestAhead = here.ahead
    }
  }
  return best
}

/**
 * Length (m) of the track a stop is on, from points to points (or to an end of track): the rails
 * walked both ways from the stop through the plain joints. What a platform track can hold — the
 * data has no length for the platform itself.
 */
export function platformTrackLength(net: Network, stop: Pick<StationStop, 'segId'>): number {
  const start = net.segments.get(stop.segId)
  if (!start) return 0
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

export function stationFit(net: Network, station: Station, rake: RollingStockModel | RakeChoice, others: readonly TrainSet[] = []): StationFit {
  const length = rakeLength(rake)
  const lengths = station.stops.filter((stop) => net.segments.has(stop.segId)).map((stop) => platformTrackLength(net, stop))
  return {
    rakeLength: length,
    tracks: lengths.length,
    fitting: lengths.filter((l) => l >= length).length,
    longest: lengths.length > 0 ? Math.max(...lengths) : 0,
    placeable: createRakeAtStation(net, station, rake, others) !== null,
  }
}

/** The rake that fits at a place of the track with most track ahead, of both headings and both cabs, clear of `others` */
function bestRakeAt(net: Network, segId: SegmentId, t: number, rake: RollingStockModel | RakeChoice, others: readonly TrainSet[]): { train: TrainSet; ahead: number } | null {
  if (!net.segments.has(segId)) return null
  const taken = new Set<SegmentId>()
  for (const other of others) for (const veh of other.vehicles) taken.add(veh.front.segId).add(veh.rear.segId)
  let best: { train: TrainSet; ahead: number } | null = null
  for (const direction of [1, -1] as const) {
    const arrived = createRake(net, segId, t, direction, rake)
    if (!arrived) continue
    if (arrived.vehicles.some((veh) => taken.has(veh.front.segId) || taken.has(veh.rear.segId))) continue
    for (const train of [arrived, turnedToLeave(net, arrived)]) {
      if (!train) continue
      const ahead = trackLeftAhead(net, train, DEPARTURE_REACH) ?? DEPARTURE_REACH
      if (!best || ahead > best.ahead) best = { train, ahead }
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
