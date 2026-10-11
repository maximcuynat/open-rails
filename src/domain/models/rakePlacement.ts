import { generateId } from './ids'
import { consistLength, referenceConsist, type RollingStockModel } from './rollingStock'
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
export function createRake(net: Network, segId: SegmentId, t: number, direction: 1 | -1, model: RollingStockModel): TrainSet | null {
  const consist = referenceConsist(model)
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
export function createRakeAtStation(net: Network, station: Station, model: RollingStockModel, others: readonly TrainSet[] = []): RakeAtStation | null {
  let best: RakeAtStation | null = null
  let bestAhead = -Infinity
  for (const stop of station.stops) {
    const here = bestRakeAt(net, stop.segId, stop.t, model, others)
    if (here && here.ahead > bestAhead) {
      best = { train: here.train, stop }
      bestAhead = here.ahead
    }
  }
  return best
}

/** The rake that fits at a place of the track with most track ahead, of both headings and both cabs, clear of `others` */
function bestRakeAt(net: Network, segId: SegmentId, t: number, model: RollingStockModel, others: readonly TrainSet[]): { train: TrainSet; ahead: number } | null {
  if (!net.segments.has(segId)) return null
  const taken = new Set<SegmentId>()
  for (const other of others) for (const veh of other.vehicles) taken.add(veh.front.segId).add(veh.rear.segId)
  let best: { train: TrainSet; ahead: number } | null = null
  for (const direction of [1, -1] as const) {
    const arrived = createRake(net, segId, t, direction, model)
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
export function createRakeAtTrack(net: Network, segId: SegmentId, t: number, model: RollingStockModel, others: readonly TrainSet[] = []): TrainSet | null {
  return bestRakeAt(net, segId, t, model, others)?.train ?? null
}

/** Length of the complete rake of a model, m: what a platform track must hold */
export function rakeLength(model: RollingStockModel): number {
  return consistLength(referenceConsist(model))
}
