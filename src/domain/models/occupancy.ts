import type { Network, SegmentId } from './types'
import type { TrackPosition, WalkTrace } from './locomotive'
import { walkBackward, walkForward } from './locomotive'
import { bogieDistance, endOverhang, jointSpacing, type StockVehicle } from './rollingStock'

// Kept apart from `train.ts` so that what the physics reads from the track under a rake
// (`trackSpeed.ts`, `trainDynamics.ts`) does not have to import the train model itself.

/** A vehicle as it stands on the track (a `Vehicle` satisfies it) */
export interface PlacedVehicle extends StockVehicle {
  front: TrackPosition
  rear: TrackPosition
}

/**
 * Track covered by a rake, from the front end of its lead vehicle to the rear end of its last one
 * (bogies, couplings and both overhangs): the stretches of segments and the nodes it stands over.
 */
export function rakeOccupancy(net: Network, vehicles: readonly PlacedVehicle[]): WalkTrace {
  const trace: WalkTrace = { spans: [], nodes: [] }
  if (vehicles.length === 0) return trace
  const stayOn = new Set<SegmentId>(vehicles.flatMap((veh) => [veh.front.segId, veh.rear.segId]))
  const options = { trace, stayOn }

  const lead = vehicles[0]
  walkForward(net, lead.front.segId, lead.front.t, lead.front.forward, endOverhang(vehicles, 0, 'front'), options)

  let prev: PlacedVehicle | null = null
  for (const veh of vehicles) {
    if (prev) {
      // Nothing to cover on an articulated joint: both vehicles stand on the same bogie
      walkBackward(net, prev.rear.segId, prev.rear.t, prev.rear.forward, jointSpacing(prev, veh), options)
    }
    walkBackward(net, veh.front.segId, veh.front.t, veh.front.forward, bogieDistance(veh), options)
    // The stored bogie positions always count, even where the track can no longer be walked
    trace.spans.push({ segId: veh.front.segId, t0: veh.front.t, t1: veh.front.t })
    trace.spans.push({ segId: veh.rear.segId, t0: veh.rear.t, t1: veh.rear.t })
    prev = veh
  }

  const lastIdx = vehicles.length - 1
  const last = vehicles[lastIdx]
  walkBackward(net, last.rear.segId, last.rear.t, last.rear.forward, endOverhang(vehicles, lastIdx, 'rear'), options)
  return trace
}
