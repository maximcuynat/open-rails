/**
 * Train coupling domain model.
 *
 * A TrainSet is an ordered list of Vehicles (loco or wagon) coupled together.
 * Vehicles can be coupled and decoupled at runtime.
 * The first vehicle (index 0) is the lead — advanceTrainSet moves it forward
 * and recalculates all followers via walkBackward.
 */

import type { Network, Point, SegmentId } from './types'
import type { TrackPosition } from './locomotive'
import {
  walkBackward,
  positionOnSegment,
  advanceLocomotive,
  createLocomotive,
  snapToNearestTrack,
} from './locomotive'
import { generateId } from './network'

// ─── Types ────────────────────────────────────────────────────────────────────

export type VehicleId = string
export type TrainSetId = string

export type VehicleKind = 'loco' | 'wagon'

/** Physical lengths (meters) for each vehicle kind */
export const VEHICLE_BOGIE_DISTANCE: Record<VehicleKind, number> = {
  loco: 14,   // entraxe bogies motrice TGV
  wagon: 11.92, // entraxe bogies wagon (CAR_BOGIE_DIST)
}

export const VEHICLE_OVERHANG: Record<VehicleKind, number> = {
  loco: 3.04,
  wagon: 3.04,
}

/** Spacing between two consecutive vehicles (accordion gap, meters) */
export const COUPLING_GAP = 0.80

/** Maximum distance (meters) between two vehicle ends to allow coupling */
export const MAX_COUPLE_DISTANCE = 3.5

/** A single vehicle (loco or wagon) placed on the track */
export interface Vehicle {
  id: VehicleId
  kind: VehicleKind
  /** Front bogie track position */
  front: TrackPosition
  /** Rear bogie track position */
  rear: TrackPosition
}

/** An ordered set of coupled vehicles forming a train */
export interface TrainSet {
  id: TrainSetId
  /** Ordered front-to-rear: vehicles[0] is the lead */
  vehicles: Vehicle[]
  /** 1 = forward (lead advances nose-first), -1 = reverse */
  direction: 1 | -1
  /** Current speed in m/s */
  currentSpeed: number
  /** Max speed m/s */
  maxSpeed: number
  /** Acceleration m/s² when throttle=1 */
  acceleration: number
  /** Braking deceleration m/s² when throttle=-1 */
  braking: number
  /** Coasting friction deceleration m/s² */
  coastingDecel: number
  /** Throttle state: 1 accelerate, -1 brake, 0 coast */
  throttle: 1 | 0 | -1
}

// ─── Vehicle creation ──────────────────────────────────────────────────────────

/** Create a single vehicle placed at (segId, t) on the network */
export function createVehicle(
  net: Network,
  segId: SegmentId,
  t: number,
  kind: VehicleKind
): Vehicle | null {
  const bogieDistance = VEHICLE_BOGIE_DISTANCE[kind]
  const loco = createLocomotive(net, segId, t, bogieDistance + 2 * VEHICLE_OVERHANG[kind], bogieDistance)
  if (!loco) return null
  return {
    id: generateId('veh'),
    kind,
    front: loco.front,
    rear: loco.rear,
  }
}

/** Create a TrainSet with a single vehicle dropped at worldPos */
export function createTrainSet(
  net: Network,
  worldPos: Point,
  kind: VehicleKind
): TrainSet | null {
  const snap = snapToNearestTrack(net, worldPos)
  if (!snap) return null
  const vehicle = createVehicle(net, snap.segId, snap.t, kind)
  if (!vehicle) return null
  return {
    id: generateId('train'),
    vehicles: [vehicle],
    direction: 1,
    currentSpeed: 0,
    maxSpeed: 500 / 3.6,
    acceleration: 5.5,
    braking: 10.0,
    coastingDecel: 0.5,
    throttle: 0,
  }
}

// ─── Simulation ───────────────────────────────────────────────────────────────

/**
 * Advance a TrainSet by deltaMeters * direction.
 * The lead vehicle moves first; all followers are recalculated via walkBackward.
 * Returns false if blocked (dead-end).
 */
export function advanceTrainSet(net: Network, train: TrainSet, deltaMeters: number): boolean {
  if (train.vehicles.length === 0) return false

  const lead = train.vehicles[0]

  // Build a temporary Locomotive for the lead vehicle to reuse advanceLocomotive
  const tempLoco = {
    id: lead.id,
    length: VEHICLE_BOGIE_DISTANCE[lead.kind] + 2 * VEHICLE_OVERHANG[lead.kind],
    bogieDistance: VEHICLE_BOGIE_DISTANCE[lead.kind],
    front: lead.front,
    rear: lead.rear,
    direction: train.direction,
  }

  const moved = advanceLocomotive(net, tempLoco, deltaMeters)
  if (!moved) return false

  // Update lead from tempLoco result
  lead.front = tempLoco.front
  lead.rear = tempLoco.rear

  // Recompute follower positions using walkBackward from the lead rear, then each vehicle rear
  let referencePos: TrackPosition = lead.rear

  for (let i = 1; i < train.vehicles.length; i++) {
    const veh = train.vehicles[i]
    const overhang = VEHICLE_OVERHANG[veh.kind]
    const bogieDistance = VEHICLE_BOGIE_DISTANCE[veh.kind]

    // Front of this vehicle = gap behind previous vehicle rear
    const newFront = walkBackward(
      net,
      referencePos.segId,
      referencePos.t,
      referencePos.forward,
      COUPLING_GAP + overhang
    )
    if (!newFront) return false

    const newRear = walkBackward(net, newFront.segId, newFront.t, newFront.forward, bogieDistance)
    if (!newRear) return false

    veh.front = newFront
    veh.rear = newRear
    referencePos = newRear
  }

  return true
}

/**
 * Run one physics tick (dt seconds) on a TrainSet.
 * Updates currentSpeed based on throttle, then calls advanceTrainSet.
 */
export function tickTrainSet(net: Network, train: TrainSet, dt: number): boolean {
  const { throttle, acceleration, braking, coastingDecel, maxSpeed } = train

  let speed = train.currentSpeed

  if (throttle === 1) {
    speed = Math.min(speed + acceleration * dt, maxSpeed)
  } else if (throttle === -1) {
    speed = Math.max(speed - braking * dt, 0)
  } else {
    // coasting
    speed = Math.max(speed - coastingDecel * dt, 0)
  }

  train.currentSpeed = speed

  if (speed < 0.001) return true // stopped, no movement needed

  const dist = speed * dt
  return advanceTrainSet(net, train, dist)
}

// ─── Coupling ─────────────────────────────────────────────────────────────────

/** World position of the rear end (rear bogie + overhang) of a vehicle */
export function vehicleRearEndPos(net: Network, veh: Vehicle): Point | null {
  return positionOnSegment(net, veh.rear.segId, veh.rear.t)
}

/** World position of the front end (front bogie + overhang) of a vehicle */
export function vehicleFrontEndPos(net: Network, veh: Vehicle): Point | null {
  return positionOnSegment(net, veh.front.segId, veh.front.t)
}

function dist2(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export interface CouplerPoint {
  trainId: TrainSetId
  vehicleIndex: number
  /** 'front' = front end of vehicle[0], 'rear' = rear end of vehicle[last] */
  end: 'front' | 'rear'
  pos: Point
  /** Is this end already coupled to another vehicle within this trainset? */
  coupled: boolean
}

/**
 * Compute all free coupler endpoints across all trains.
 * A "free" coupler is the front end of the lead vehicle OR the rear end of the last vehicle.
 * Internal couplers (between vehicles inside a trainset) are shown as "coupled=true".
 */
export function getAllCouplerPoints(net: Network, trains: TrainSet[]): CouplerPoint[] {
  const points: CouplerPoint[] = []

  for (const train of trains) {
    if (train.vehicles.length === 0) continue

    // Front end of lead vehicle — always free (external)
    const leadFront = vehicleFrontEndPos(net, train.vehicles[0])
    if (leadFront) {
      points.push({ trainId: train.id, vehicleIndex: 0, end: 'front', pos: leadFront, coupled: false })
    }

    // Internal rear ends (coupled to next vehicle)
    for (let i = 0; i < train.vehicles.length - 1; i++) {
      const rearPos = vehicleRearEndPos(net, train.vehicles[i])
      if (rearPos) {
        points.push({ trainId: train.id, vehicleIndex: i, end: 'rear', pos: rearPos, coupled: true })
      }
    }

    // Rear end of last vehicle — always free (external)
    const lastIdx = train.vehicles.length - 1
    const lastRear = vehicleRearEndPos(net, train.vehicles[lastIdx])
    if (lastRear) {
      points.push({ trainId: train.id, vehicleIndex: lastIdx, end: 'rear', pos: lastRear, coupled: false })
    }
  }

  return points
}

/**
 * Find the coupler point closest to worldPos within MAX_COUPLE_DISTANCE.
 */
export function findNearestCoupler(
  net: Network,
  trains: TrainSet[],
  worldPos: Point
): CouplerPoint | null {
  const all = getAllCouplerPoints(net, trains)
  let best: CouplerPoint | null = null
  let bestDist = MAX_COUPLE_DISTANCE

  for (const cp of all) {
    const d = dist2(cp.pos, worldPos)
    if (d < bestDist) {
      bestDist = d
      best = cp
    }
  }
  return best
}

/**
 * Attempt to couple two TrainSets: the rear of `a` couples to the front of `b`.
 * Returns the merged TrainSet, or null if not possible.
 * `a` and `b` must be different trains.
 */
export function coupleTrains(
  net: Network,
  trains: TrainSet[],
  aId: TrainSetId,
  bId: TrainSetId
): TrainSet[] {
  if (aId === bId) return trains

  const aIdx = trains.findIndex(t => t.id === aId)
  const bIdx = trains.findIndex(t => t.id === bId)
  if (aIdx === -1 || bIdx === -1) return trains

  const a = trains[aIdx]
  const b = trains[bIdx]

  // Check proximity: rear of last vehicle of a vs front of first vehicle of b
  const aRearPos = vehicleRearEndPos(net, a.vehicles[a.vehicles.length - 1])
  const bFrontPos = vehicleFrontEndPos(net, b.vehicles[0])

  if (!aRearPos || !bFrontPos) return trains
  if (dist2(aRearPos, bFrontPos) > MAX_COUPLE_DISTANCE) return trains

  const merged: TrainSet = {
    ...a,
    id: generateId('train'),
    vehicles: [...a.vehicles, ...b.vehicles],
  }

  return trains
    .filter((_, i) => i !== aIdx && i !== bIdx)
    .concat(merged)
}

/**
 * Decouple a TrainSet at position `vehicleIndex` (between vehicle[vehicleIndex] and vehicle[vehicleIndex+1]).
 * Returns two new TrainSets: [front half, rear half].
 */
export function decoupleAt(
  train: TrainSet,
  vehicleIndex: number
): [TrainSet, TrainSet] | null {
  if (vehicleIndex < 0 || vehicleIndex >= train.vehicles.length - 1) return null

  const front: TrainSet = {
    ...train,
    id: generateId('train'),
    vehicles: train.vehicles.slice(0, vehicleIndex + 1),
    currentSpeed: train.currentSpeed,
  }
  const rear: TrainSet = {
    ...train,
    id: generateId('train'),
    vehicles: train.vehicles.slice(vehicleIndex + 1),
    currentSpeed: 0, // rear half stops
  }
  return [front, rear]
}

/**
 * Handle a click in coupling mode on worldPos.
 * - If clicking a free coupler near another free coupler → couple the two trains
 * - If clicking a coupled joint → decouple at that joint
 * Returns the updated trains array.
 */
export function handleCouplingClick(
  net: Network,
  trains: TrainSet[],
  worldPos: Point
): TrainSet[] {
  const nearest = findNearestCoupler(net, trains, worldPos)
  if (!nearest) return trains

  // If clicking a coupled internal joint → decouple
  if (nearest.coupled) {
    const trainIdx = trains.findIndex(t => t.id === nearest.trainId)
    if (trainIdx === -1) return trains
    const train = trains[trainIdx]
    const result = decoupleAt(train, nearest.vehicleIndex)
    if (!result) return trains
    const [front, rear] = result
    return [
      ...trains.slice(0, trainIdx),
      front,
      rear,
      ...trains.slice(trainIdx + 1),
    ]
  }

  // If clicking a free coupler → look for the nearest OTHER free coupler to couple to
  const all = getAllCouplerPoints(net, trains)
  let partner: CouplerPoint | null = null
  let bestDist = MAX_COUPLE_DISTANCE

  for (const cp of all) {
    if (cp.coupled) continue
    if (cp.trainId === nearest.trainId) continue
    const d = dist2(cp.pos, nearest.pos)
    if (d < bestDist) {
      bestDist = d
      partner = cp
    }
  }

  if (!partner) return trains

  // Determine which is "front" and which is "rear" for coupling
  // Rule: couple nearest.rear → partner.front, or partner.rear → nearest.front
  let aId: TrainSetId
  let bId: TrainSetId

  if (nearest.end === 'rear' && partner.end === 'front') {
    aId = nearest.trainId
    bId = partner.trainId
  } else if (nearest.end === 'front' && partner.end === 'rear') {
    aId = partner.trainId
    bId = nearest.trainId
  } else {
    // Same end type: need to reverse one — for now just couple front-to-front (rear of a = flipped b)
    aId = nearest.trainId
    bId = partner.trainId
  }

  return coupleTrains(net, trains, aId, bId)
}
