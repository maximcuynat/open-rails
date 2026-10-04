/**
 * Train coupling domain model.
 *
 * A TrainSet is an ordered list of Vehicles (loco or wagon) coupled together.
 * Vehicles can be coupled and decoupled at runtime.
 * The first vehicle (index 0) is the lead — advanceTrainSet moves it forward
 * and recalculates all followers via walkBackward.
 */

import type { Junction, Network, Point, SegmentId } from './types'
import type {
  Locomotive,
  TrackPosition,
  WalkTrace,
  BogieFrame,
  TGVDetails,
  TGVAccordion,
} from './locomotive'
import {
  steerJunction,
  findUpcomingJunction,
  segmentPartialLength,
  walkBackward,
  walkForward,
  positionOnSegment,
  advanceLocomotive,
  createLocomotive,
  snapToNearestTrack,
  computeBogieFrame,
  getTGVDetails,
  isPointNearPolygon,
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

/**
 * Reach (meters) of the free ends of the train being built: a click this close to one of them
 * appends the vehicle to that train instead of starting a new one (about a vehicle and a half).
 */
export const TRAIN_CHAIN_SNAP_DISTANCE = 30

/** A single vehicle (loco or wagon) placed on the track */
export interface Vehicle {
  id: VehicleId
  kind: VehicleKind
  /** Front bogie track position */
  front: TrackPosition
  /** Rear bogie track position */
  rear: TrackPosition
  /**
   * Body turned around within the rake: its nose is on the `rear` bogie side.
   * `front` / `rear` always follow the order of the train, whatever the body faces.
   */
  flipped?: boolean
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
  /** Acceleration m/s² at full traction (notch = MAX_NOTCH) */
  acceleration: number
  /** Braking deceleration m/s² at full service brake (notch = -MAX_NOTCH) */
  braking: number
  /** Emergency braking deceleration m/s² */
  emergencyBraking: number
  /** Coasting friction deceleration m/s² */
  coastingDecel: number
  /** Reverser position; can only be moved at standstill with traction off */
  reverser: Reverser
  /** Combined power/brake handle: 1..MAX_NOTCH traction, 0 neutral, -1..-MAX_NOTCH service brake */
  notch: number
  /** Emergency brake latched until the train has stopped */
  emergencyBrake: boolean
}

export type Reverser = 'forward' | 'neutral' | 'reverse'

/** Number of traction notches and of service brake notches on the combined handle */
export const MAX_NOTCH = 5

/** Below this speed (m/s) the train counts as stopped */
const STANDSTILL_SPEED = 0.001

/** Build a stationary TrainSet with default dynamics and controls at rest */
export function makeTrainSet(id: TrainSetId, vehicles: Vehicle[]): TrainSet {
  return {
    id,
    vehicles,
    direction: 1,
    currentSpeed: 0,
    maxSpeed: 500 / 3.6,
    acceleration: 5.5,
    braking: 10.0,
    emergencyBraking: 20.0,
    coastingDecel: 0.5,
    reverser: 'neutral',
    notch: 0,
    emergencyBrake: false,
  }
}

// ─── Vehicle creation ──────────────────────────────────────────────────────────

/** Create a single vehicle placed at (segId, t) on the network */
export function createVehicle(
  net: Network,
  segId: SegmentId,
  t: number,
  kind: VehicleKind,
  direction: 1 | -1 = 1
): Vehicle | null {
  const bogieDistance = VEHICLE_BOGIE_DISTANCE[kind]
  const loco = createLocomotive(net, segId, t, bogieDistance + 2 * VEHICLE_OVERHANG[kind], bogieDistance, 0, direction)
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
  kind: VehicleKind,
  maxDist: number = Infinity,
  direction: 1 | -1 = 1
): TrainSet | null {
  const snap = snapToNearestTrack(net, worldPos, maxDist)
  if (!snap) return null
  const vehicle = createVehicle(net, snap.segId, snap.t, kind, direction)
  if (!vehicle) return null
  return makeTrainSet(generateId('train'), [vehicle])
}

// ─── Driving controls ─────────────────────────────────────────────────────────

export function isTrainStopped(train: TrainSet): boolean {
  return train.currentSpeed < STANDSTILL_SPEED
}

/**
 * Move the reverser. Refused while the train is moving or the handle is in traction.
 * A non-neutral position also sets the travel direction.
 */
export function setReverser(train: TrainSet, reverser: Reverser): boolean {
  if (train.reverser === reverser) return true
  if (!isTrainStopped(train) || train.notch > 0) return false
  train.reverser = reverser
  if (reverser !== 'neutral') train.direction = reverser === 'forward' ? 1 : -1
  return true
}

/** Move the reverser one position towards forward (step = 1) or reverse (step = -1) */
export function shiftReverser(train: TrainSet, step: 1 | -1): boolean {
  const order: Reverser[] = ['reverse', 'neutral', 'forward']
  const next = order[order.indexOf(train.reverser) + step]
  return next !== undefined && setReverser(train, next)
}

/**
 * Put the combined handle on a notch (clamped to ±MAX_NOTCH).
 * While the emergency brake is latched the handle is locked until the train has stopped;
 * moving it at standstill releases the emergency brake.
 */
export function setNotch(train: TrainSet, notch: number): boolean {
  if (train.emergencyBrake) {
    if (!isTrainStopped(train)) return false
    train.emergencyBrake = false
  }
  train.notch = Math.max(-MAX_NOTCH, Math.min(MAX_NOTCH, Math.round(notch)))
  return true
}

/** Latch the emergency brake: traction is cut and the handle drops to full service brake */
export function triggerEmergencyBrake(train: TrainSet): void {
  train.emergencyBrake = true
  train.notch = -MAX_NOTCH
}

/** Release the emergency brake; only possible once the train has stopped */
export function releaseEmergencyBrake(train: TrainSet): boolean {
  if (!isTrainStopped(train)) return false
  train.emergencyBrake = false
  return true
}

/** Distance (m) needed to stop from the current speed at full service brake */
export function stoppingDistance(train: TrainSet): number {
  return (train.currentSpeed * train.currentSpeed) / (2 * train.braking)
}

/** Commanded state in the shape the debug overlay expects: sign of the command and its magnitudes */
export function trainDriveTelemetry(train: TrainSet): { throttle: 1 | 0 | -1; acceleration: number; braking: number } {
  const accel = commandedAcceleration(train)
  return {
    throttle: accel > 0 ? 1 : accel < 0 ? -1 : 0,
    acceleration: Math.max(accel, 0),
    braking: Math.max(-accel, 0),
  }
}

/** Stop the train and put every control back at rest (neutral reverser, handle on N) */
export function resetTrainControls(train: TrainSet): void {
  train.currentSpeed = 0
  train.notch = 0
  train.reverser = 'neutral'
  train.emergencyBrake = false
}

/**
 * Acceleration commanded by the controls, in m/s² along the travel direction:
 * positive = traction, negative = braking, 0 = coasting.
 */
export function commandedAcceleration(train: TrainSet): number {
  if (train.emergencyBrake) return -train.emergencyBraking
  if (train.notch < 0) return (train.notch / MAX_NOTCH) * train.braking
  if (train.notch > 0 && train.reverser !== 'neutral') return (train.notch / MAX_NOTCH) * train.acceleration
  return 0
}

// ─── Simulation ───────────────────────────────────────────────────────────────

/**
 * Track covered by a train, from the front end of its lead vehicle to the rear end of its last one
 * (bogies, couplings and both overhangs): the stretches of segments and the nodes it stands over.
 */
export function trainOccupancy(net: Network, train: TrainSet): WalkTrace {
  const trace: WalkTrace = { spans: [], nodes: [] }
  if (train.vehicles.length === 0) return trace
  const options = { trace, stayOn: bogieSegments(train) }

  const lead = train.vehicles[0]
  walkForward(net, lead.front.segId, lead.front.t, lead.front.forward, VEHICLE_OVERHANG[lead.kind], options)

  let prev: Vehicle | null = null
  for (const veh of train.vehicles) {
    if (prev) {
      const gap = VEHICLE_OVERHANG[prev.kind] + COUPLING_GAP + VEHICLE_OVERHANG[veh.kind]
      walkBackward(net, prev.rear.segId, prev.rear.t, prev.rear.forward, gap, options)
    }
    walkBackward(net, veh.front.segId, veh.front.t, veh.front.forward, VEHICLE_BOGIE_DISTANCE[veh.kind], options)
    // The stored bogie positions always count, even where the track can no longer be walked
    trace.spans.push({ segId: veh.front.segId, t0: veh.front.t, t1: veh.front.t })
    trace.spans.push({ segId: veh.rear.segId, t0: veh.rear.t, t1: veh.rear.t })
    prev = veh
  }

  const last = train.vehicles[train.vehicles.length - 1]
  walkBackward(net, last.rear.segId, last.rear.t, last.rear.forward, VEHICLE_OVERHANG[last.kind], options)
  return trace
}

/** Segments the bogies of a train stand on */
function bogieSegments(train: TrainSet): Set<SegmentId> {
  return new Set(train.vehicles.flatMap((veh) => [veh.front.segId, veh.rear.segId]))
}

/**
 * True when a vehicle of any of the trains stands over the points of the junction (its apex node).
 * Such a junction must not be thrown: the followers of a train are laid out through the active
 * branch, so the vehicles still on the other branch would jump across.
 */
export function isJunctionOccupied(net: Network, junction: Junction, trains: TrainSet[]): boolean {
  return trains.some((train) => trainOccupancy(net, train).nodes.includes(junction.nodeId))
}

/** True when a vehicle of any of the trains stands, even partly, on one of the given segments */
export function isTrackOccupied(net: Network, segIds: Iterable<SegmentId>, trains: TrainSet[]): boolean {
  const wanted = new Set(segIds)
  return wanted.size > 0 && trains.some((train) => trainOccupancy(net, train).spans.some((span) => wanted.has(span.segId)))
}

/**
 * Occupancy of each train, kept by the caller for the duration of one simulation tick so that it
 * is computed once per train instead of once per pair. An entry is dropped when its train moves.
 */
export type TrainOccupancyCache = Map<TrainSetId, WalkTrace>

/**
 * Distance (meters) the train can still run in its travel direction before the end of its leading
 * vehicle meets the track occupied by one of `obstacles`, looking `reach` meters ahead along the
 * route it would take. Returns null when nothing stands within reach; 0 or less means contact/overlap.
 */
function freeDistanceAhead(
  net: Network,
  train: TrainSet,
  reach: number,
  obstacles: TrainSet[],
  occupancy?: TrainOccupancyCache,
): number | null {
  // The end of the train that leads the move: nose of the lead vehicle, or tail of the last one in reverse
  const reversing = train.direction === -1
  const veh = reversing ? train.vehicles[train.vehicles.length - 1] : train.vehicles[0]
  const overhang = VEHICLE_OVERHANG[veh.kind]
  const ahead: WalkTrace = { spans: [], nodes: [] }
  if (reversing) walkBackward(net, veh.rear.segId, veh.rear.t, veh.rear.forward, overhang + reach, { trace: ahead })
  else walkForward(net, veh.front.segId, veh.front.t, veh.front.forward, overhang + reach, { trace: ahead })

  const occupied = obstacles.flatMap((other) => {
    let trace = occupancy?.get(other.id)
    if (!trace) {
      trace = trainOccupancy(net, other)
      occupancy?.set(other.id, trace)
    }
    return trace.spans
  })
  let travelled = 0
  for (const span of ahead.spans) {
    let nearest: number | null = null
    for (const occ of occupied) {
      if (occ.segId !== span.segId) continue
      const occLo = Math.min(occ.t0, occ.t1)
      const occHi = Math.max(occ.t0, occ.t1)
      if (occHi < Math.min(span.t0, span.t1) || occLo > Math.max(span.t0, span.t1)) continue
      // First occupied point met when running from span.t0 towards span.t1
      const hit = span.t1 >= span.t0 ? Math.max(occLo, span.t0) : Math.min(occHi, span.t0)
      const d = segmentPartialLength(net, span.segId, span.t0, hit)
      if (nearest === null || d < nearest) nearest = d
    }
    if (nearest !== null) return travelled + nearest - overhang
    travelled += segmentPartialLength(net, span.segId, span.t0, span.t1)
  }
  return null
}

/**
 * Advance a TrainSet by deltaMeters * direction.
 * The lead vehicle moves first; all followers are recalculated via walkBackward.
 * All-or-nothing: when any vehicle cannot follow (dead end, switch set against the train), nothing
 * moves and false is returned. Followers still on a turnout branch stay on it whatever the switch
 * says, so points thrown under the train cannot make them jump to the other branch.
 *
 * `others` are the trains to collide with (the train itself is ignored): the move is shortened so
 * that the train stops a coupling gap short of the nearest one ahead, and false is returned as for
 * an end of track. Moving away from a train that is in contact is not restricted.
 * `occupancy` is an optional per-tick cache shared by the calls for all trains.
 */
export function advanceTrainSet(
  net: Network,
  train: TrainSet,
  deltaMeters: number,
  others: TrainSet[] = [],
  occupancy?: TrainOccupancyCache,
): boolean {
  if (train.vehicles.length === 0) return false

  let blocked = false
  const obstacles = others.filter((other) => other !== train && other.id !== train.id && other.vehicles.length > 0)
  if (obstacles.length > 0 && deltaMeters > 0) {
    const free = freeDistanceAhead(net, train, deltaMeters + COUPLING_GAP, obstacles, occupancy)
    if (free !== null && free - COUPLING_GAP < deltaMeters) {
      deltaMeters = free - COUPLING_GAP
      blocked = true
      if (deltaMeters < 1e-6) return false
    }
  }

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

  const stayOn = bogieSegments(train)
  const moved = advanceLocomotive(net, tempLoco, deltaMeters, stayOn)
  if (!moved) return false

  // Recompute follower positions using walkBackward from the lead rear, then each vehicle rear.
  // Nothing is written to the train until every vehicle has found its place.
  const placed: { front: TrackPosition; rear: TrackPosition }[] = [{ front: tempLoco.front, rear: tempLoco.rear }]
  let referencePos: TrackPosition = tempLoco.rear
  let prevKind = lead.kind

  for (let i = 1; i < train.vehicles.length; i++) {
    const veh = train.vehicles[i]
    const prevOverhang = VEHICLE_OVERHANG[prevKind]
    const vehOverhang = VEHICLE_OVERHANG[veh.kind]
    const bogieDistance = VEHICLE_BOGIE_DISTANCE[veh.kind]

    // Front bogie of this vehicle = gap behind previous vehicle rear bogie
    const newFront = walkBackward(
      net,
      referencePos.segId,
      referencePos.t,
      referencePos.forward,
      prevOverhang + COUPLING_GAP + vehOverhang,
      { stayOn }
    )
    if (!newFront) return false

    const newRear = walkBackward(net, newFront.segId, newFront.t, newFront.forward, bogieDistance, { stayOn })
    if (!newRear) return false

    placed.push({ front: newFront, rear: newRear })
    referencePos = newRear
    prevKind = veh.kind
  }

  train.vehicles.forEach((veh, i) => {
    veh.front = placed[i].front
    veh.rear = placed[i].rear
  })
  occupancy?.delete(train.id)

  return !blocked
}

/**
 * Run one physics tick (dt seconds) on a TrainSet.
 * Updates currentSpeed from the driving controls, then calls advanceTrainSet.
 * Returns false when the train is stopped by an end of track or by one of `others`.
 */
export function tickTrainSet(
  net: Network,
  train: TrainSet,
  dt: number,
  others: TrainSet[] = [],
  occupancy?: TrainOccupancyCache,
): boolean {
  const accel = commandedAcceleration(train)

  let speed = train.currentSpeed

  if (accel !== 0) {
    speed = Math.max(0, Math.min(speed + accel * dt, train.maxSpeed))
  } else {
    // coasting
    speed = Math.max(speed - train.coastingDecel * dt, 0)
  }

  train.currentSpeed = speed

  if (isTrainStopped(train)) return true // stopped, no movement needed

  const dist = speed * dt
  return advanceTrainSet(net, train, dist, others, occupancy)
}

// ─── Coupling ─────────────────────────────────────────────────────────────────

/** World position of the rear end (rear bogie + overhang) of a vehicle */
export function vehicleRearEndPos(net: Network, veh: Vehicle): Point | null {
  const pF = positionOnSegment(net, veh.front.segId, veh.front.t)
  const pR = positionOnSegment(net, veh.rear.segId, veh.rear.t)
  if (!pR) return null
  if (!pF) return pR
  const dx = pF.x - pR.x
  const dy = pF.y - pR.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return pR
  const overhang = VEHICLE_OVERHANG[veh.kind]
  return { x: pR.x - (dx / len) * overhang, y: pR.y - (dy / len) * overhang }
}

/** World position of the front end (front bogie + overhang) of a vehicle */
export function vehicleFrontEndPos(net: Network, veh: Vehicle): Point | null {
  const pF = positionOnSegment(net, veh.front.segId, veh.front.t)
  const pR = positionOnSegment(net, veh.rear.segId, veh.rear.t)
  if (!pF) return null
  if (!pR) return pF
  const dx = pF.x - pR.x
  const dy = pF.y - pR.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return pF
  const overhang = VEHICLE_OVERHANG[veh.kind]
  return { x: pF.x + (dx / len) * overhang, y: pF.y + (dy / len) * overhang }
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
 * The same train seen from its other end: vehicle order reversed, bogies swapped and every body
 * marked as turned around. Nothing moves on the track; only what counts as "forward" changes.
 */
export function reverseTrainSet(train: TrainSet): TrainSet {
  const vehicles = [...train.vehicles].reverse().map((veh) => {
    const { flipped, ...rest } = veh
    const reversed: Vehicle = {
      ...rest,
      front: { ...veh.rear, forward: !veh.rear.forward },
      rear: { ...veh.front, forward: !veh.front.forward },
    }
    if (!flipped) reversed.flipped = true
    return reversed
  })
  return { ...train, vehicles }
}

/**
 * A stopped train whose locomotives are all turned around is reversed, so that "forward" drives it
 * nose first (a tail locomotive uncoupled from its rake becomes an ordinary train).
 */
function orientTrainByLocos(train: TrainSet): TrainSet {
  const locos = train.vehicles.filter((veh) => veh.kind === 'loco')
  if (locos.length === 0 || !isTrainStopped(train) || locos.some((veh) => !veh.flipped)) return train
  return reverseTrainSet(train)
}

export interface CouplerSnapTarget {
  train: TrainSet
  end: 'front' | 'rear'
  couplerPos: Point
  snappedVehicle: Vehicle
}

/**
 * Check if worldPos is within maxDist of any free coupler endpoint in any train,
 * and if so compute the snapped Vehicle placed flush against that coupler (gap = COUPLING_GAP).
 * With `flipped` the vehicle is coupled turned around, its nose away from the head of the train.
 */
export function findCouplerSnap(
  net: Network,
  trains: TrainSet[],
  worldPos: Point,
  kind: VehicleKind,
  maxDist: number = 5.0,
  flipped: boolean = false
): CouplerSnapTarget | null {
  let bestTarget: CouplerSnapTarget | null = null
  let bestDist = maxDist
  const orientation = flipped ? { flipped: true } : {}

  for (const train of trains) {
    if (train.vehicles.length === 0) continue

    // 1. Check rear coupler (last vehicle)
    const lastVeh = train.vehicles[train.vehicles.length - 1]
    const rearPos = vehicleRearEndPos(net, lastVeh)
    if (rearPos) {
      const d = Math.hypot(rearPos.x - worldPos.x, rearPos.y - worldPos.y)
      if (d < bestDist) {
        // Compute position for new vehicle behind lastVeh
        const distToNewFront = VEHICLE_OVERHANG[lastVeh.kind] + COUPLING_GAP + VEHICLE_OVERHANG[kind]
        const newFront = walkBackward(net, lastVeh.rear.segId, lastVeh.rear.t, lastVeh.rear.forward, distToNewFront)
        if (newFront) {
          const newRear = walkBackward(net, newFront.segId, newFront.t, newFront.forward, VEHICLE_BOGIE_DISTANCE[kind])
          if (newRear) {
            bestDist = d
            bestTarget = {
              train,
              end: 'rear',
              couplerPos: rearPos,
              snappedVehicle: { id: generateId('veh_preview'), kind, front: newFront, rear: newRear, ...orientation },
            }
          }
        }
      }
    }

    // 2. Check front coupler (first vehicle)
    const firstVeh = train.vehicles[0]
    const frontPos = vehicleFrontEndPos(net, firstVeh)
    if (frontPos) {
      const d = Math.hypot(frontPos.x - worldPos.x, frontPos.y - worldPos.y)
      if (d < bestDist) {
        // Compute position for new vehicle in front of firstVeh
        const distToNewRear = VEHICLE_OVERHANG[firstVeh.kind] + COUPLING_GAP + VEHICLE_OVERHANG[kind]
        const newRear = walkForward(net, firstVeh.front.segId, firstVeh.front.t, firstVeh.front.forward, distToNewRear)
        if (newRear) {
          const newFront = walkForward(net, newRear.segId, newRear.t, newRear.forward, VEHICLE_BOGIE_DISTANCE[kind])
          if (newFront) {
            bestDist = d
            bestTarget = {
              train,
              end: 'front',
              couplerPos: frontPos,
              snappedVehicle: { id: generateId('veh_preview'), kind, front: newFront, rear: newRear, ...orientation },
            }
          }
        }
      }
    }
  }

  return bestTarget
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

  // Align merged followers
  advanceTrainSet(net, merged, 0)

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
  }
  resetTrainControls(rear) // rear half stops, controls at rest
  return [front, orientTrainByLocos(rear)]
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

  // Two ends of the same type (rear to rear, nose to nose): the partner is taken from its other
  // end, so its vehicles join turned around and the clicked train keeps its orientation
  const partnerId = partner.trainId
  const pool = nearest.end === partner.end
    ? trains.map((t) => (t.id === partnerId ? reverseTrainSet(t) : t))
    : trains

  // Rule: couple nearest.rear → partner.front, or partner.rear → nearest.front
  const merged = nearest.end === 'rear'
    ? coupleTrains(net, pool, nearest.trainId, partnerId)
    : coupleTrains(net, pool, partnerId, nearest.trainId)
  return merged === pool ? trains : merged
}

// ─── Rendering & Hit-testing helpers ──────────────────────────────────────────

export interface TrainVehicleVisual {
  id: string
  kind: 'loco' | 'wagon'
  polygon: Point[]
  windowsLeft?: { p1: Point; p2: Point }[]
  windowsRight?: { p1: Point; p2: Point }[]
  windshield?: Point[]
  headlights?: { left: Point; right: Point }
  tgvDetails?: TGVDetails
}

export interface TrainSetVisuals {
  trainId: string
  vehicles: TrainVehicleVisual[]
  accordions: TGVAccordion[]
  bogies: BogieFrame[]
}

/**
 * Compute the complete visual geometry for a TrainSet:
 * individual car bodies, TGV aerodynamic noses, bogies with axles, and connecting accordions.
 */
export function getTrainSetVisuals(net: Network, train: TrainSet): TrainSetVisuals | null {
  if (train.vehicles.length === 0) return null

  const visuals: TrainVehicleVisual[] = []
  const bogies: BogieFrame[] = []
  const accordions: TGVAccordion[] = []

  // Store rear and front connection frames for each vehicle to generate accordions
  const vehicleFrames: { rear: [Point, Point]; front: [Point, Point] }[] = []

  for (let i = 0; i < train.vehicles.length; i++) {
    const veh = train.vehicles[i]

    // Bogies for this vehicle
    const bFront = computeBogieFrame(net, veh.front)
    const bRear = computeBogieFrame(net, veh.rear)
    if (bFront) bogies.push(bFront)
    if (bRear) bogies.push(bRear)

    if (veh.kind === 'loco') {
      const tempLoco = {
        id: veh.id,
        length: VEHICLE_BOGIE_DISTANCE.loco + 2 * VEHICLE_OVERHANG.loco,
        bogieDistance: VEHICLE_BOGIE_DISTANCE.loco,
        front: veh.front,
        rear: veh.rear,
        // The body is drawn from its bogies and its own orientation, never from the travel
        // direction: reversing pushes the train back (refoulement), it does not turn it around.
        direction: veh.flipped ? (-1 as const) : (1 as const),
      }
      const tgv = getTGVDetails(net, tempLoco)
      if (tgv) {
        visuals.push({
          id: veh.id,
          kind: 'loco',
          polygon: tgv.polygon,
          windshield: tgv.windshield,
          headlights: tgv.headlights,
          tgvDetails: tgv,
        })

        // Frame: front is nose base; rear is flat back
        // tgv.polygon: 2=bodyFrontL, 7=bodyFrontR, 4=backL, 5=backR
        const backL = tgv.polygon[4]
        const backR = tgv.polygon[5]
        const frontL = tgv.polygon[2]
        const frontR = tgv.polygon[7]
        // Turned around, the flat back faces the head of the train and left/right swap sides
        vehicleFrames.push(veh.flipped
          ? { front: [backR, backL], rear: [frontR, frontL] }
          : { front: [frontL, frontR], rear: [backL, backR] })
      }
    } else {
      // Wagon
      const pF = positionOnSegment(net, veh.front.segId, veh.front.t)
      const pR = positionOnSegment(net, veh.rear.segId, veh.rear.t)
      if (pF && pR) {
        const dx = pF.x - pR.x
        const dy = pF.y - pR.y
        const len = Math.hypot(dx, dy)
        if (len > 0) {
          const ux = dx / len
          const uy = dy / len
          const nx = -uy
          const ny = ux
          const overhang = VEHICLE_OVERHANG.wagon
          const w = 1.15 // demi-largeur caisse TGV affinée (2.30m)

          const cFrontCenter = { x: pF.x + ux * overhang, y: pF.y + uy * overhang }
          const cRearCenter = { x: pR.x - ux * overhang, y: pR.y - uy * overhang }

          const c1 = { x: cFrontCenter.x + nx * w, y: cFrontCenter.y + ny * w }
          const c2 = { x: cFrontCenter.x - nx * w, y: cFrontCenter.y - ny * w }
          const c3 = { x: cRearCenter.x - nx * w, y: cRearCenter.y - ny * w }
          const c4 = { x: cRearCenter.x + nx * w, y: cRearCenter.y + ny * w }

          const numWindows = 6
          const totalLen = len + 2 * overhang
          const winSpan = Math.max(2, totalLen - 3.0)
          const winStep = winSpan / numWindows
          const winLen = winStep * 0.7
          const windowsLeft: { p1: Point; p2: Point }[] = []
          const windowsRight: { p1: Point; p2: Point }[] = []

          for (let wi = 0; wi < numWindows; wi++) {
            const d = 1.5 + wi * winStep
            const pStart = { x: cRearCenter.x + ux * d, y: cRearCenter.y + uy * d }
            const pEnd = { x: cRearCenter.x + ux * (d + winLen), y: cRearCenter.y + uy * (d + winLen) }
            windowsLeft.push({
              p1: { x: pStart.x + nx * (w - 0.08), y: pStart.y + ny * (w - 0.08) },
              p2: { x: pEnd.x + nx * (w - 0.08), y: pEnd.y + ny * (w - 0.08) },
            })
            windowsRight.push({
              p1: { x: pStart.x - nx * (w - 0.08), y: pStart.y - ny * (w - 0.08) },
              p2: { x: pEnd.x - nx * (w - 0.08), y: pEnd.y - ny * (w - 0.08) },
            })
          }

          visuals.push({
            id: veh.id,
            kind: 'wagon',
            polygon: [c1, c2, c3, c4],
            windowsLeft,
            windowsRight,
          })

          vehicleFrames.push({
            front: [c1, c2],
            rear: [c4, c3],
          })
        }
      }
    }
  }

  // Build accordions between consecutive vehicles
  for (let i = 0; i < vehicleFrames.length - 1; i++) {
    const fA = vehicleFrames[i]
    const fB = vehicleFrames[i + 1]
    const rL = fA.rear[0]
    const rR = fA.rear[1]
    const fL = fB.front[0]
    const fR = fB.front[1]

    const numFolds = 3
    const folds: { left: Point; right: Point }[] = []
    for (let fi = 1; fi <= numFolds; fi++) {
      const s = fi / (numFolds + 1)
      folds.push({
        left: { x: rL.x * (1 - s) + fL.x * s, y: rL.y * (1 - s) + fL.y * s },
        right: { x: rR.x * (1 - s) + fR.x * s, y: rR.y * (1 - s) + fR.y * s },
      })
    }

    accordions.push({
      frontFrame: [rL, rR],
      rearFrame: [fL, fR],
      folds,
    })
  }

  return {
    trainId: train.id,
    vehicles: visuals,
    accordions,
    bogies,
  }
}

/** Hit-test a world point against any vehicle polygon in a TrainSet */
export function hitTestTrainSet(
  net: Network,
  train: TrainSet,
  worldPt: Point,
  tolerance = 2.5
): boolean {
  const visuals = getTrainSetVisuals(net, train)
  if (!visuals) return false
  for (const v of visuals.vehicles) {
    if (isPointNearPolygon(worldPt, v.polygon, tolerance)) return true
  }
  return false
}

/** Hit-test a world point against vehicles in a TrainSet and return the specific vehicle hit */
export function hitTestTrainVehicle(
  net: Network,
  train: TrainSet,
  worldPt: Point,
  tolerance = 2.5
): { trainId: string; vehicleId: string; kind: VehicleKind } | null {
  const visuals = getTrainSetVisuals(net, train)
  if (!visuals) return null
  for (const v of visuals.vehicles) {
    if (isPointNearPolygon(worldPt, v.polygon, tolerance)) {
      return { trainId: train.id, vehicleId: v.id, kind: v.kind }
    }
  }
  return null
}

/** Remove a specific vehicle from a TrainSet and realign remaining vehicles */
export function removeVehicleFromTrainSet(
  net: Network,
  train: TrainSet,
  vehicleId: string
): TrainSet | null {
  const nextVehicles = train.vehicles.filter(v => v.id !== vehicleId)
  if (nextVehicles.length === 0) return null

  const newTrain: TrainSet = {
    ...train,
    vehicles: nextVehicles,
  }
  advanceTrainSet(net, newTrain, 0)
  return orientTrainByLocos(newTrain)
}

// ─── Junction steering ────────────────────────────────────────────────────────

/**
 * Track position of the end of the train that leads the move (lead bogie running forward, last
 * bogie in reverse), oriented along the travel direction: the route ahead is walked from it with
 * a travel direction of 1.
 */
export function trainRouteStart(train: TrainSet): TrackPosition | null {
  if (train.vehicles.length === 0) return null
  if (train.direction === 1) return train.vehicles[0].front
  const rear = train.vehicles[train.vehicles.length - 1].rear
  return { ...rear, forward: !rear.forward }
}

/**
 * Throw the next facing turnout ahead of the train to the left or right of its travel direction.
 * Running forward the junction is looked up ahead of the lead vehicle; in reverse, behind the last one.
 * Returns false when there is no facing turnout ahead, or when a vehicle of one of `trains`
 * (the train itself by default) stands over its points.
 */
export function steerTrainSetJunction(
  net: Network,
  train: TrainSet,
  steerDirection: 'left' | 'right',
  trains: TrainSet[] = [train],
): boolean {
  if (train.vehicles.length === 0) return false
  const reversing = train.direction === -1
  const veh = reversing ? train.vehicles[train.vehicles.length - 1] : train.vehicles[0]
  // Probe locomotive whose nose is the end of the train that enters the junction first
  const probe: Locomotive = {
    id: veh.id,
    length: VEHICLE_BOGIE_DISTANCE[veh.kind] + 2 * VEHICLE_OVERHANG[veh.kind],
    bogieDistance: VEHICLE_BOGIE_DISTANCE[veh.kind],
    front: trainRouteStart(train) ?? veh.front,
    rear: reversing ? veh.front : veh.rear,
    direction: 1,
  }
  const upcoming = findUpcomingJunction(net, probe)
  if (!upcoming || isJunctionOccupied(net, upcoming.junction, trains)) return false
  return steerJunction(net, probe, steerDirection)
}

// ─── Persistence & network consistency ────────────────────────────────────────

/** Saved form of a train: where each vehicle stands. Driving state (speed, handle, reverser) is not kept. */
export interface SerializedTrain {
  id: TrainSetId
  direction: 1 | -1
  vehicles: Vehicle[]
}

export function serializeTrains(trains: TrainSet[]): SerializedTrain[] {
  return trains.map((train) => ({
    id: train.id,
    direction: train.direction,
    vehicles: train.vehicles.map(copyVehicle),
  }))
}

/** Plain copy of a vehicle with only its saved fields; `flipped` is written only when set */
function copyVehicle(v: Vehicle): Vehicle {
  const copy: Vehicle = { id: v.id, kind: v.kind, front: { ...v.front }, rear: { ...v.rear } }
  if (v.flipped === true) copy.flipped = true
  return copy
}

function isTrackPositionOnNetwork(net: Network, pos: unknown): pos is TrackPosition {
  if (!pos || typeof pos !== 'object') return false
  const p = pos as Partial<TrackPosition>
  return (
    typeof p.segId === 'string' &&
    net.segments.has(p.segId) &&
    typeof p.t === 'number' &&
    p.t >= 0 &&
    p.t <= 1 &&
    typeof p.forward === 'boolean'
  )
}

function isVehicleOnNetwork(net: Network, veh: unknown): veh is Vehicle {
  if (!veh || typeof veh !== 'object') return false
  const v = veh as Partial<Vehicle>
  return (
    typeof v.id === 'string' &&
    (v.kind === 'loco' || v.kind === 'wagon') &&
    isTrackPositionOnNetwork(net, v.front) &&
    isTrackPositionOnNetwork(net, v.rear)
  )
}

/**
 * Drop the vehicles standing on segments that no longer exist. A train cut in the middle is split
 * into the rakes that remain, each one stopped; a train left without vehicles disappears.
 * Returns the same array when every train is intact.
 */
export function pruneTrainsToNetwork(net: Network, trains: TrainSet[]): TrainSet[] {
  if (trains.every((train) => train.vehicles.length > 0 && train.vehicles.every((v) => isVehicleOnNetwork(net, v)))) {
    return trains
  }
  const result: TrainSet[] = []
  for (const train of trains) {
    const rakes: Vehicle[][] = []
    let rake: Vehicle[] = []
    for (const veh of train.vehicles) {
      if (isVehicleOnNetwork(net, veh)) {
        rake.push(veh)
      } else if (rake.length > 0) {
        rakes.push(rake)
        rake = []
      }
    }
    if (rake.length > 0) rakes.push(rake)

    if (rakes.length === 1 && rakes[0].length === train.vehicles.length) {
      result.push(train)
      continue
    }
    rakes.forEach((vehicles, i) => {
      const piece: TrainSet = { ...train, id: i === 0 ? train.id : generateId('train'), vehicles }
      resetTrainControls(piece)
      result.push(piece)
    })
  }
  return result
}

/**
 * Rebuild trains from saved data on a network: every train comes back stopped with its controls at rest,
 * and anything malformed or standing on a missing segment is dropped.
 */
export function deserializeTrains(net: Network, data: unknown): TrainSet[] {
  if (!Array.isArray(data)) return []
  const trains: TrainSet[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !Array.isArray(raw.vehicles)) continue
    const vehicles: Vehicle[] = raw.vehicles.map((v: unknown) =>
      isVehicleOnNetwork(net, v) ? copyVehicle(v) : v,
    )
    const train = makeTrainSet(raw.id, vehicles)
    if (raw.direction === -1) train.direction = -1
    trains.push(train)
  }
  return pruneTrainsToNetwork(net, trains)
}
