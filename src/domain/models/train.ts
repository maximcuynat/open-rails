/**
 * Train coupling domain model.
 *
 * A TrainSet is an ordered list of Vehicles (loco or wagon) coupled together.
 * Vehicles can be coupled and decoupled at runtime.
 * The first vehicle (index 0) is the lead — advanceTrainSet moves it forward
 * and recalculates all followers via walkBackward.
 */

import type { Junction, Network, Point, SegmentId } from './types'
import type { Derailment } from './speedLimits'
import type { CabOverspeed, SignalPassedAtDanger } from './trainSignalling'
import { DEFAULT_LINE_SETTINGS } from './speedLimits'
import { consistOverturningDeficiency } from './cant'
import { cantDeficiencyIn, rakeSpeedLimitIn, trackProfile, type TrackProfile } from './trackSpeed'
import {
  BRAKE_PIPE_FULL_SERVICE,
  DEFAULT_DRIVING_ENVIRONMENT,
  applyParkedBrake,
  ELECTRIC_BRAKE_NOTCHES,
  PHYSICS_STEP,
  TRACTION_NOTCHES,
  stepTrainDynamics,
  type BrakeCommand,
  type DrivingEnvironment,
} from './trainDynamics'
import type {
  JunctionAhead,
  Locomotive,
  TrackPosition,
  WalkTrace,
  BogieFrame,
  TGVDetails,
  TGVAccordion,
  WalkOptions,
} from './locomotive'
import {
  steerJunction,
  findJunctionAhead,
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
  projectOnSegment,
} from './locomotive'
import { generateId } from './network'
import { rakeOccupancy } from './occupancy'
import type { RollingStockModel, StockVehicle } from './rollingStock'
import {
  UNIT_COUPLING_GAP,
  bodyWidth,
  bogieDistance,
  consistMaxSpeed,
  endOverhang,
  isRollingStockModel,
  jointKind,
  jointSpacing,
  stockSpec,
  vehicleEndOverhang,
} from './rollingStock'

// ─── Types ────────────────────────────────────────────────────────────────────

export type VehicleId = string
export type TrainSetId = string

export type VehicleKind = 'loco' | 'wagon'

/**
 * Gap (meters) between the power cars of two coupled trainsets; also the distance a train stops
 * short of another one. Vehicle dimensions and joint spacings come from `rollingStock.ts`.
 */
export const COUPLING_GAP = UNIT_COUPLING_GAP

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
  /** Rolling stock the vehicle belongs to; absent = TGV Duplex */
  model?: RollingStockModel
}

/** An ordered set of coupled vehicles forming a train */
export interface TrainSet {
  id: TrainSetId
  /** Ordered front-to-rear: vehicles[0] is the lead */
  vehicles: Vehicle[]
  /** 1 = forward (lead advances nose-first), -1 = reverse */
  direction: 1 | -1
  /** Current speed in m/s, always ≥ 0: `direction` says which way */
  currentSpeed: number
  /** Maximum speed m/s of the rolling stock: no tractive effort above it */
  maxSpeed: number
  /**
   * Reverser position; can only be moved at standstill with traction off. It sets the way the
   * tractive effort pushes: the train itself may roll the other way (see `direction`).
   */
  reverser: Reverser
  /**
   * Combined handle: 1 … MAX_NOTCH traction, 0 neutral (N), -1 … MIN_NOTCH electric brake, each
   * notch an equal share of the available effort
   */
  notch: number
  /** Emergency brake latched until the train has stopped */
  emergencyBrake: boolean
  /** Brake pipe pressure in bar: BRAKE_PIPE_RELEASED … BRAKE_PIPE_FULL_SERVICE, 0 in emergency */
  brakePipe: number
  /** Filling of the brake cylinders, 0 (released) … 1 (full): follows the brake pipe with a delay */
  brakeCylinder: number
  /** Seconds empty brake cylinders have been waiting to fill since the brake was applied (dead time) */
  brakeLag: number
  /** Position of the brake handle (impulse valve), see `BrakeCommand` */
  brakeCommand: BrakeCommand
  /** Share of the available tractive effort applied, 0…1: follows the notch with a ramp */
  tractionEffort: number
  /** Share of the available electric brake effort applied, 0…1: follows the notch with a ramp */
  electricBrakeEffort: number
  /** Speed (m/s) at which the last tick ran the train into a buffer stop or another train, else 0 */
  impactSpeed: number
  /** Set when the train has left the rails in a curve: it cannot move until `rerailTrain` */
  derailed: Derailment | null
  /**
   * Set when the train has passed a closed signal against the rules (see `tickSignalling`), until
   * it passes another signal properly or its controls are reset. Absent or null otherwise.
   */
  signalPassed?: SignalPassedAtDanger | null
  /**
   * Set when the train was caught over the speed its cab checks it against on a cab-signalled line
   * (see `tickSignalling`), until it is back under it or its controls are reset. Absent or null otherwise.
   */
  overspeed?: CabOverspeed | null
}

export type Reverser = 'forward' | 'neutral' | 'reverse'

/** Number of traction notches on the handle */
export const MAX_NOTCH = TRACTION_NOTCHES
/** Lowest notch of the handle: the strongest electric brake notch */
export const MIN_NOTCH = -ELECTRIC_BRAKE_NOTCHES

/** Below this speed (m/s) the train counts as stopped */
const STANDSTILL_SPEED = 0.001

/** Build a stationary TrainSet: brakes applied, handle on N, reverser in neutral */
export function makeTrainSet(id: TrainSetId, vehicles: Vehicle[]): TrainSet {
  return {
    id,
    vehicles,
    direction: 1,
    currentSpeed: 0,
    maxSpeed: consistMaxSpeed(vehicles),
    reverser: 'neutral',
    notch: 0,
    emergencyBrake: false,
    brakePipe: BRAKE_PIPE_FULL_SERVICE,
    brakeCylinder: 1,
    brakeLag: 0,
    brakeCommand: 'hold',
    tractionEffort: 0,
    electricBrakeEffort: 0,
    impactSpeed: 0,
    derailed: null,
  }
}

// ─── Vehicle creation ──────────────────────────────────────────────────────────

/** Create a single vehicle placed at (segId, t) on the network */
export function createVehicle(
  net: Network,
  segId: SegmentId,
  t: number,
  kind: VehicleKind,
  direction: 1 | -1 = 1,
  model?: RollingStockModel
): Vehicle | null {
  const stock = model ? { kind, model } : { kind }
  const pivots = bogieDistance(stock)
  const loco = createLocomotive(net, segId, t, pivots, pivots, 0, direction)
  if (!loco) return null
  return {
    id: generateId('veh'),
    ...stock,
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
  direction: 1 | -1 = 1,
  model?: RollingStockModel
): TrainSet | null {
  const snap = snapToNearestTrack(net, worldPos, maxDist)
  if (!snap) return null
  const vehicle = createVehicle(net, snap.segId, snap.t, kind, direction, model)
  if (!vehicle) return null
  return makeTrainSet(generateId('train'), [vehicle])
}

// ─── Driving controls ─────────────────────────────────────────────────────────

export function isTrainStopped(train: TrainSet): boolean {
  return train.currentSpeed < STANDSTILL_SPEED
}

/**
 * Move the reverser. Refused while the train is moving, derailed, or the handle is off N.
 * A non-neutral position also sets the travel direction.
 */
export function setReverser(train: TrainSet, reverser: Reverser): boolean {
  if (train.reverser === reverser) return true
  if (train.derailed || !isTrainStopped(train) || train.notch !== 0) return false
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
 * Put the handle on a notch (clamped to MIN_NOTCH…MAX_NOTCH).
 * While the emergency brake is latched the handle is locked until the train has stopped;
 * moving it at standstill releases the emergency brake. Refused on a derailed train.
 */
export function setNotch(train: TrainSet, notch: number): boolean {
  if (train.derailed) return false
  if (train.emergencyBrake && !releaseEmergencyBrake(train)) return false
  train.notch = Math.max(MIN_NOTCH, Math.min(MAX_NOTCH, Math.round(notch)))
  return true
}

/**
 * Latch the emergency brake: the brake pipe is vented, the traction and the electric brake are
 * cut and the handle comes back to N. Nothing can be released before the train has stopped.
 */
export function triggerEmergencyBrake(train: TrainSet): void {
  train.emergencyBrake = true
  train.notch = 0
  train.tractionEffort = 0
  train.electricBrakeEffort = 0
  train.brakeCommand = 'hold'
}

/**
 * Release the emergency brake; only possible once the train has stopped, and never on a derailed
 * train (see `rerailTrain`). The brake stays applied at full service pressure: the driver releases
 * it like any other application.
 */
export function releaseEmergencyBrake(train: TrainSet): boolean {
  if (train.derailed || !isTrainStopped(train)) return false
  if (train.emergencyBrake) applyParkedBrake(train)
  return true
}

/**
 * Stop the train and put every control back at rest: brakes applied, handle on N, reverser in
 * neutral. A derailment is not undone here: the train stays derailed, its emergency brake latched,
 * until `rerailTrain` — entering or leaving the driving mode does not put it back on the track.
 */
export function resetTrainControls(train: TrainSet): void {
  train.currentSpeed = 0
  train.notch = 0
  train.reverser = 'neutral'
  train.tractionEffort = 0
  train.electricBrakeEffort = 0
  train.impactSpeed = 0
  if (train.signalPassed) train.signalPassed = null
  if (train.overspeed) train.overspeed = null
  applyParkedBrake(train)
  if (train.derailed) {
    train.emergencyBrake = true
    train.brakePipe = 0
  }
}

/**
 * Derail the train when the cant deficiency under one of its vehicles has reached what overturns
 * its rolling stock: `train.derailed` records the speed and the limit that applied, and the
 * emergency brake is latched for good (see `rerailTrain`). Full size only: nothing derails on a
 * model railway scale. Returns true when the train has just derailed.
 */
export function checkDerailment(
  net: Network,
  train: TrainSet,
  env: DrivingEnvironment = DEFAULT_DRIVING_ENVIRONMENT,
  profile: TrackProfile = trackProfile(net, env.line ?? DEFAULT_LINE_SETTINGS),
): boolean {
  if (train.derailed || train.vehicles.length === 0 || !(train.currentSpeed > 0)) return false
  const speed = train.currentSpeed * 3.6
  if (cantDeficiencyIn(profile, train.vehicles, speed) < consistOverturningDeficiency(train.vehicles)) return false
  train.derailed = { speed, limit: rakeSpeedLimitIn(net, profile, train) }
  triggerEmergencyBrake(train)
  return true
}

// ─── Simulation ───────────────────────────────────────────────────────────────

/**
 * Track covered by a train, from the front end of its lead vehicle to the rear end of its last one
 * (bogies, couplings and both overhangs): the stretches of segments and the nodes it stands over.
 */
export function trainOccupancy(net: Network, train: TrainSet): WalkTrace {
  return rakeOccupancy(net, train.vehicles)
}

/** Body length of the i-th vehicle of a rake, over both ends */
function vehicleLength(vehicles: readonly Vehicle[], i: number): number {
  return endOverhang(vehicles, i, 'front') + bogieDistance(vehicles[i]) + endOverhang(vehicles, i, 'rear')
}

/**
 * Front bogie of `next` placed behind the rear bogie of `prev`. On an articulated joint it is the
 * same bogie: the position is copied, nothing is walked.
 */
function followerFront(
  net: Network,
  prev: StockVehicle,
  prevRear: TrackPosition,
  next: StockVehicle,
  options?: WalkOptions,
): TrackPosition | null {
  const spacing = jointSpacing(prev, next)
  if (spacing === 0) return { ...prevRear }
  return walkBackward(net, prevRear.segId, prevRear.t, prevRear.forward, spacing, options)
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
  const { ahead, overhang } = traceAhead(net, train, reach)

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
 * Walk the route ahead of the end of the train that leads the move — nose of the lead vehicle, or
 * tail of the last one in reverse — up to `reach` meters past that end. The trace starts at the
 * bogie under that end, `overhang` meters behind it.
 */
function traceAhead(net: Network, train: TrainSet, reach: number): { ahead: WalkTrace; overhang: number } {
  const reversing = train.direction === -1
  const lastIdx = train.vehicles.length - 1
  const veh = reversing ? train.vehicles[lastIdx] : train.vehicles[0]
  const overhang = reversing ? endOverhang(train.vehicles, lastIdx, 'rear') : endOverhang(train.vehicles, 0, 'front')
  const ahead: WalkTrace = { spans: [], nodes: [] }
  if (reversing) walkBackward(net, veh.rear.segId, veh.rear.t, veh.rear.forward, overhang + reach, { trace: ahead })
  else walkForward(net, veh.front.segId, veh.front.t, veh.front.forward, overhang + reach, { trace: ahead })
  return { ahead, overhang }
}

/**
 * Track left (meters) ahead of the leading end of the train before the track ends for it — a
 * buffer stop, or points set against it — looking `reach` meters ahead. Returns null when the
 * track goes on further than that; 0 or less means the end of the train is at the end or past it.
 */
export function trackLeftAhead(net: Network, train: TrainSet, reach: number): number | null {
  if (train.vehicles.length === 0) return null
  const { ahead, overhang } = traceAhead(net, train, reach)
  const walked = ahead.spans.reduce((sum, span) => sum + segmentPartialLength(net, span.segId, span.t0, span.t1), 0)
  return walked >= overhang + reach - 1e-6 ? null : walked - overhang
}

/**
 * Advance a TrainSet by deltaMeters * direction.
 * The lead vehicle moves first; all followers are recalculated via walkBackward.
 * All-or-nothing: when any vehicle cannot follow (dead end, switch set against the train), nothing
 * moves and false is returned. Followers still on a turnout branch stay on it whatever the switch
 * says, so points thrown under the train cannot make them jump to the other branch.
 *
 * The move is shortened so that the leading end of the train — not the bogie under it — stops at
 * the end of the track (a buffer stop, points set against the train); false is then returned.
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
  if (deltaMeters > 0) {
    const left = trackLeftAhead(net, train, deltaMeters)
    if (left !== null) {
      deltaMeters = left
      blocked = true
      if (deltaMeters < 1e-6) return false
    }
  }
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
    length: vehicleLength(train.vehicles, 0),
    bogieDistance: bogieDistance(lead),
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

  for (let i = 1; i < train.vehicles.length; i++) {
    const veh = train.vehicles[i]

    // Front bogie of this vehicle: the joint spacing behind the previous rear bogie (the same
    // bogie when the two are articulated)
    const newFront = followerFront(net, train.vehicles[i - 1], referencePos, veh, { stayOn })
    if (!newFront) return false

    const newRear = walkBackward(net, newFront.segId, newFront.t, newFront.forward, bogieDistance(veh), { stayOn })
    if (!newRear) return false

    placed.push({ front: newFront, rear: newRear })
    referencePos = newRear
  }

  train.vehicles.forEach((veh, i) => {
    veh.front = placed[i].front
    veh.rear = placed[i].rear
  })
  occupancy?.delete(train.id)

  return !blocked
}

/**
 * True when the leading end of the train, running in its `direction`, stands right against the
 * end of the track or a coupling gap away from one of `others`: it cannot move that way at all.
 */
function isBlockedAhead(net: Network, train: TrainSet, others: TrainSet[], occupancy?: TrainOccupancyCache): boolean {
  const reach = 0.01
  const left = trackLeftAhead(net, train, reach)
  if (left !== null && left < 1e-6) return true
  const obstacles = others.filter((other) => other !== train && other.id !== train.id && other.vehicles.length > 0)
  if (obstacles.length === 0) return false
  const free = freeDistanceAhead(net, train, reach + COUPLING_GAP, obstacles, occupancy)
  return free !== null && free - COUPLING_GAP < 1e-6
}

/**
 * Run one physics tick (dt seconds) on a TrainSet: the controls, the air brake and the speed are
 * integrated with a fixed step of at most `PHYSICS_STEP` (a long `dt` is cut into equal steps, so
 * the result does not depend on the frame rate), and the train is moved along the track. `env`
 * turns the track levels into slopes.
 *
 * Returns false when the train is stopped by an end of track or by one of `others`: either it ran
 * into it during this tick — `train.impactSpeed` then holds the speed of the impact — or it stands
 * against it and is pushed onto it (by gravity or by its own traction; `impactSpeed` is 0).
 */
export function tickTrainSet(
  net: Network,
  train: TrainSet,
  dt: number,
  others: TrainSet[] = [],
  occupancy?: TrainOccupancyCache,
  env: DrivingEnvironment = DEFAULT_DRIVING_ENVIRONMENT,
): boolean {
  train.impactSpeed = 0
  if (train.vehicles.length === 0 || !(dt > 0)) return true

  // The obstacle check reads `train.direction`, which the physics only flips once it lets go
  const isBlocked = (direction: 1 | -1): boolean => {
    const previous = train.direction
    train.direction = direction
    const blocked = isBlockedAhead(net, train, others, occupancy)
    train.direction = previous
    return blocked
  }

  const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP - 1e-9))
  const h = dt / steps
  // Only a moving train at full size can derail; the profile is then read once for the whole tick
  // (the track does not change while the train is stepped)
  const line = env.line ?? DEFAULT_LINE_SETTINGS
  let profile: TrackProfile | undefined
  let free = true
  for (let i = 0; i < steps; i++) {
    const step = stepTrainDynamics(net, train, h, env, isBlocked)
    if (step.blocked) {
      free = false
    } else if (step.distance > 0 && !advanceTrainSet(net, train, step.distance, others, occupancy)) {
      // Ran into the end of the track or another train: the train stops dead against it
      train.impactSpeed = Math.max(train.impactSpeed, train.currentSpeed)
      train.currentSpeed = 0
      free = false
    }
    if (train.currentSpeed > 0 && !train.derailed && line.realScale !== false) {
      profile ??= trackProfile(net, line)
      checkDerailment(net, train, env, profile)
    }
  }
  return free
}

// ─── Coupling ─────────────────────────────────────────────────────────────────

/**
 * World position of the rear end (rear bogie + overhang) of a vehicle. The overhang of a trailer
 * depends on the vehicle it faces there: `neighbour` is the next one in the rake, null at a free end.
 */
export function vehicleRearEndPos(net: Network, veh: Vehicle, neighbour: Vehicle | null = null): Point | null {
  const pF = positionOnSegment(net, veh.front.segId, veh.front.t)
  const pR = positionOnSegment(net, veh.rear.segId, veh.rear.t)
  if (!pR) return null
  if (!pF) return pR
  const dx = pF.x - pR.x
  const dy = pF.y - pR.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return pR
  const overhang = vehicleEndOverhang(veh, 'rear', neighbour)
  return { x: pR.x - (dx / len) * overhang, y: pR.y - (dy / len) * overhang }
}

/** World position of the front end (front bogie + overhang) of a vehicle; `neighbour` as for the rear end */
export function vehicleFrontEndPos(net: Network, veh: Vehicle, neighbour: Vehicle | null = null): Point | null {
  const pF = positionOnSegment(net, veh.front.segId, veh.front.t)
  const pR = positionOnSegment(net, veh.rear.segId, veh.rear.t)
  if (!pF) return null
  if (!pR) return pF
  const dx = pF.x - pR.x
  const dy = pF.y - pR.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return pF
  const overhang = vehicleEndOverhang(veh, 'front', neighbour)
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
  /** Is this the joint between two coupled trainsets, where the train can be split? */
  coupled: boolean
}

/**
 * Compute all coupler points across all trains.
 * A "free" coupler is the front end of the lead vehicle OR the rear end of the last vehicle.
 * Inside a train only the joint between two power cars (two trainsets coupled together) is a
 * coupler, shown as "coupled=true": a trainset itself cannot be split.
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

    // Joints between two trainsets: halfway between the facing ends of the two power cars
    for (let i = 0; i < train.vehicles.length - 1; i++) {
      const veh = train.vehicles[i]
      const next = train.vehicles[i + 1]
      if (jointKind(veh, next) !== 'unit') continue
      const rearPos = vehicleRearEndPos(net, veh, next)
      const frontPos = vehicleFrontEndPos(net, next, veh)
      if (rearPos && frontPos) {
        const pos = { x: (rearPos.x + frontPos.x) / 2, y: (rearPos.y + frontPos.y) / 2 }
        points.push({ trainId: train.id, vehicleIndex: i, end: 'rear', pos, coupled: true })
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

/** True when `switchDrivingCab` would hand the controls over: a stopped rake with a power car at its tail */
export function canSwitchDrivingCab(train: TrainSet): boolean {
  const tail = train.vehicles[train.vehicles.length - 1]
  return train.vehicles.length >= 2 && tail.kind === 'loco' && isTrainStopped(train) && !train.derailed
}

/**
 * Hand the controls over to the cab at the other end of the rake: the tail power car becomes
 * the lead. Nothing moves and no body turns around, only the driving end changes, so
 * "forward" now heads the other way. Refused while moving, or when the tail is not a power car.
 */
export function switchDrivingCab(train: TrainSet): TrainSet | null {
  if (!canSwitchDrivingCab(train)) return null
  const switched = reverseTrainSet(train)
  resetTrainControls(switched)
  switched.direction = 1
  return switched
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
 * and if so compute the snapped Vehicle laid out against that end as `advanceTrainSet` will lay it:
 * a trailer next to a trailer stands on the bogie that is already there.
 * With `flipped` the vehicle is coupled turned around, its nose away from the head of the train.
 */
export function findCouplerSnap(
  net: Network,
  trains: TrainSet[],
  worldPos: Point,
  kind: VehicleKind,
  maxDist: number = 5.0,
  flipped: boolean = false,
  model?: RollingStockModel
): CouplerSnapTarget | null {
  let bestTarget: CouplerSnapTarget | null = null
  let bestDist = maxDist
  // The vehicle to place, without its bogies yet
  const ghost = { kind, ...(flipped ? { flipped: true } : {}), ...(model ? { model } : {}) }
  const makeSnapped = (front: TrackPosition, rear: TrackPosition): Vehicle => (
    { id: generateId('veh_preview'), ...ghost, front, rear }
  )

  for (const train of trains) {
    if (train.vehicles.length === 0) continue

    // 1. Check rear coupler (last vehicle)
    const lastVeh = train.vehicles[train.vehicles.length - 1]
    const rearPos = vehicleRearEndPos(net, lastVeh)
    if (rearPos) {
      const d = Math.hypot(rearPos.x - worldPos.x, rearPos.y - worldPos.y)
      if (d < bestDist) {
        // Compute position for new vehicle behind lastVeh
        const newFront = followerFront(net, lastVeh, lastVeh.rear, ghost)
        if (newFront) {
          const newRear = walkBackward(net, newFront.segId, newFront.t, newFront.forward, bogieDistance(ghost))
          if (newRear) {
            bestDist = d
            bestTarget = {
              train,
              end: 'rear',
              couplerPos: rearPos,
              snappedVehicle: makeSnapped(newFront, newRear),
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
        const spacing = jointSpacing(ghost, firstVeh)
        const newRear = spacing === 0
          ? { ...firstVeh.front }
          : walkForward(net, firstVeh.front.segId, firstVeh.front.t, firstVeh.front.forward, spacing)
        if (newRear) {
          const newFront = walkForward(net, newRear.segId, newRear.t, newRear.forward, bogieDistance(ghost))
          if (newFront) {
            bestDist = d
            bestTarget = {
              train,
              end: 'front',
              couplerPos: frontPos,
              snappedVehicle: makeSnapped(newFront, newRear),
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

  // The merged train keeps the controls of `a`; its brake pipe now runs through both rakes, so the
  // brake is as applied as the more applied of the two
  const merged: TrainSet = {
    ...a,
    id: generateId('train'),
    vehicles: [...a.vehicles, ...b.vehicles],
    brakePipe: Math.min(a.brakePipe, b.brakePipe),
    brakeCylinder: Math.max(a.brakeCylinder, b.brakeCylinder),
    derailed: a.derailed ?? b.derailed,
  }

  // Lay the merged rake out again so the new joint gets its spacing (a shared bogie between two
  // trailers); nothing is coupled when the rake does not fit on the track that way
  if (!advanceTrainSet(net, merged, 0)) return trains

  return trains
    .filter((_, i) => i !== aIdx && i !== bIdx)
    .concat(merged)
}

/**
 * Decouple a TrainSet at position `vehicleIndex` (between vehicle[vehicleIndex] and vehicle[vehicleIndex+1]).
 * Returns two new TrainSets: [front half, rear half], or null when the joint is not the coupling
 * of two trainsets (power car to power car): an articulated or permanently coupled joint cannot be split.
 */
export function decoupleAt(
  train: TrainSet,
  vehicleIndex: number
): [TrainSet, TrainSet] | null {
  if (vehicleIndex < 0 || vehicleIndex >= train.vehicles.length - 1) return null
  if (jointKind(train.vehicles[vehicleIndex], train.vehicles[vehicleIndex + 1]) !== 'unit') return null

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
 * - If clicking the joint between two coupled trainsets → decouple at that joint
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

/** Trailer body pulled back from the pivot at an articulated or free end, so the gangway shows over the bogie */
const TRAILER_END_MARGIN = 0.35

/**
 * Compute the complete visual geometry for a TrainSet: body outlines, bogies with axles (a bogie
 * shared by two trailers appears once) and one gangway per joint.
 */
export function getTrainSetVisuals(net: Network, train: TrainSet): TrainSetVisuals | null {
  if (train.vehicles.length === 0) return null

  const visuals: TrainVehicleVisual[] = []
  const bogies: BogieFrame[] = []
  const accordions: TGVAccordion[] = []

  // Left/right corners of both body ends of each vehicle, to hang the gangways on
  const vehicleFrames: ({ rear: [Point, Point]; front: [Point, Point] } | null)[] = []

  for (let i = 0; i < train.vehicles.length; i++) {
    const veh = train.vehicles[i]
    vehicleFrames.push(null)

    // Bogies for this vehicle; on an articulated joint the front one is the previous vehicle's rear one
    const sharedFront = i > 0 && jointKind(train.vehicles[i - 1], veh) === 'articulated'
    const bFront = sharedFront ? null : computeBogieFrame(net, veh.front)
    const bRear = computeBogieFrame(net, veh.rear)
    if (bFront) bogies.push(bFront)
    if (bRear) bogies.push(bRear)

    if (veh.kind === 'loco') {
      const spec = stockSpec(veh).powerCar
      const tempLoco = {
        id: veh.id,
        length: spec.length,
        bogieDistance: spec.bogieDistance,
        front: veh.front,
        rear: veh.rear,
        // The body is drawn from its bogies and its own orientation, never from the travel
        // direction: reversing pushes the train back (refoulement), it does not turn it around.
        direction: veh.flipped ? (-1 as const) : (1 as const),
      }
      const tgv = getTGVDetails(net, tempLoco, {
        noseOverhang: spec.noseOverhang,
        rearOverhang: spec.rearOverhang,
        halfWidth: spec.width / 2,
      })
      if (tgv) {
        visuals.push({
          id: veh.id,
          kind: 'loco',
          polygon: tgv.polygon,
          windshield: tgv.windshield,
          headlights: tgv.headlights,
          tgvDetails: tgv,
        })

        // Body ends: the tip of the nose and the flat back
        // tgv.polygon: 0=noseTipL, 9=noseTipR, 4=backL, 5=backR
        const tipL = tgv.polygon[0]
        const tipR = tgv.polygon[9]
        const backL = tgv.polygon[4]
        const backR = tgv.polygon[5]
        // Turned around, the flat back faces the head of the train and left/right swap sides
        vehicleFrames[i] = veh.flipped
          ? { front: [backR, backL], rear: [tipR, tipL] }
          : { front: [tipL, tipR], rear: [backL, backR] }
      }
    } else {
      // Trailer: a rectangle along the chord between its two pivots
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
          const w = bodyWidth(veh) / 2
          // Beyond the pivot towards a power car, short of it over a shared bogie or at a free end
          const frontOverhang = endOverhang(train.vehicles, i, 'front')
          const rearOverhang = endOverhang(train.vehicles, i, 'rear')
          const frontReach = frontOverhang > 0 ? frontOverhang : -TRAILER_END_MARGIN
          const rearReach = rearOverhang > 0 ? rearOverhang : -TRAILER_END_MARGIN

          const cFrontCenter = { x: pF.x + ux * frontReach, y: pF.y + uy * frontReach }
          const cRearCenter = { x: pR.x - ux * rearReach, y: pR.y - uy * rearReach }

          const c1 = { x: cFrontCenter.x + nx * w, y: cFrontCenter.y + ny * w }
          const c2 = { x: cFrontCenter.x - nx * w, y: cFrontCenter.y - ny * w }
          const c3 = { x: cRearCenter.x - nx * w, y: cRearCenter.y - ny * w }
          const c4 = { x: cRearCenter.x + nx * w, y: cRearCenter.y + ny * w }

          visuals.push({
            id: veh.id,
            kind: 'wagon',
            polygon: [c1, c2, c3, c4],
          })

          vehicleFrames[i] = {
            front: [c1, c2],
            rear: [c4, c3],
          }
        }
      }
    }
  }

  // One gangway per joint, between the facing body ends of the two neighbours
  for (let i = 0; i < vehicleFrames.length - 1; i++) {
    const fA = vehicleFrames[i]
    const fB = vehicleFrames[i + 1]
    if (!fA || !fB) continue
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

/** World position of the lead bogie of every train: where each train stands, whatever its rails become. */
export function trainAnchors(net: Network, trains: TrainSet[]): Map<TrainSetId, Point> {
  const anchors = new Map<TrainSetId, Point>()
  for (const train of trains) {
    const lead = train.vehicles[0]
    const pos = lead && positionOnSegment(net, lead.front.segId, lead.front.t)
    if (pos) anchors.set(train.id, pos)
  }
  return anchors
}

/**
 * Re-lay the trains after the rails under them were reshaped (node moved, curve refitted).
 * Positions are stored as a fraction of their segment, so a segment that changes length would
 * otherwise carry, stretch or squeeze the train standing on it. With `anchors` (taken before the
 * reshape) the lead bogie is put back on the rail at the spot where it stood: the train stays
 * where it is and only the rail changes. A train that no longer fits is left untouched.
 */
export function realignTrains(net: Network, trains: TrainSet[], anchors?: Map<TrainSetId, Point>): void {
  for (const train of trains) {
    const lead = train.vehicles[0]
    if (!lead) continue
    const previousT = lead.front.t
    const anchor = anchors?.get(train.id)
    const seg = net.segments.get(lead.front.segId)
    if (anchor && seg) {
      const proj = projectOnSegment(net, seg, anchor)
      if (proj) lead.front.t = proj.t
    }
    if (!advanceTrainSet(net, train, 0)) lead.front.t = previousT
  }
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
 * Returns false when there is no facing turnout ahead, when a vehicle of one of `trains`
 * (the train itself by default) stands over its points, or when `isLocked` says the turnout is
 * held for another train (see `isNodeReserved` in `signalling.ts`).
 */
export function steerTrainSetJunction(
  net: Network,
  train: TrainSet,
  steerDirection: 'left' | 'right',
  trains: TrainSet[] = [train],
  isLocked?: (junction: Junction) => boolean,
): boolean {
  if (train.vehicles.length === 0) return false
  const reversing = train.direction === -1
  const vehIdx = reversing ? train.vehicles.length - 1 : 0
  const veh = train.vehicles[vehIdx]
  // Probe locomotive whose nose is the end of the train that enters the junction first
  const probe: Locomotive = {
    id: veh.id,
    length: vehicleLength(train.vehicles, vehIdx),
    bogieDistance: bogieDistance(veh),
    front: trainRouteStart(train) ?? veh.front,
    rear: reversing ? veh.front : veh.rear,
    direction: 1,
  }
  const upcoming = findUpcomingJunction(net, probe)
  if (!upcoming || isJunctionOccupied(net, upcoming.junction, trains) || isLocked?.(upcoming.junction)) return false
  return steerJunction(net, probe, steerDirection)
}

/**
 * Side the open route leaves on at a turnout met by its points, seen in the travel direction:
 * `left` when the points are set to the leftmost branch, `right` to the rightmost. `null` when
 * neither applies: the middle route of a three-way turnout, or a turnout met by one of its
 * branches (the route does not fork there, it only is open or closed).
 */
export function openRouteSide(ahead: JunctionAhead): 'left' | 'right' | null {
  if (!ahead.facing) return null
  const index = ahead.branches.indexOf(ahead.activeBranch)
  if (index === 0) return 'left'
  if (index === ahead.branches.length - 1) return 'right'
  return null
}

/** The turnout the steering commands act on, as a driver needs to know it */
export interface TurnoutAhead {
  /** Track distance from the start of the route to the points, m */
  distance: number
  side: 'left' | 'right' | null
  /** A vehicle stands over the points, or they are held for another train: the turnout cannot be thrown */
  locked: boolean
}

/**
 * The turnout `steerJunction` would throw for a route starting at `start`: the first one on the
 * route, met by its points or by a branch. `null` when the route reaches none. `isLocked` tells
 * whether a turnout is held for another train.
 */
export function turnoutAhead(
  net: Network,
  start: TrackPosition,
  travelDirection: 1 | -1,
  trains: TrainSet[],
  isLocked?: (junction: Junction) => boolean,
): TurnoutAhead | null {
  const ahead = findJunctionAhead(net, start, travelDirection)
  if (!ahead) return null
  return {
    distance: Math.max(0, ahead.distance),
    side: openRouteSide(ahead),
    locked: isJunctionOccupied(net, ahead.junction, trains) || !!isLocked?.(ahead.junction),
  }
}

/** The turnout `steerTrainSetJunction` would throw for this train, measured from its leading bogie */
export function trainTurnoutAhead(
  net: Network,
  train: TrainSet,
  trains: TrainSet[] = [train],
  isLocked?: (junction: Junction) => boolean,
): TurnoutAhead | null {
  const start = trainRouteStart(train)
  return start ? turnoutAhead(net, start, 1, trains, isLocked) : null
}

// ─── Persistence & network consistency ────────────────────────────────────────

/** Saved form of a train: where each vehicle stands. Driving state (speed, handle, reverser, brake) is not kept. */
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

/**
 * Plain copy of a vehicle with only its saved fields; `flipped` and `model` are written only when
 * set (a model that is not in the table is dropped: the vehicle falls back to the default one)
 */
function copyVehicle(v: Vehicle): Vehicle {
  const copy: Vehicle = { id: v.id, kind: v.kind, front: { ...v.front }, rear: { ...v.rear } }
  if (v.flipped === true) copy.flipped = true
  if (isRollingStockModel(v.model)) copy.model = v.model
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
 * into the rakes that remain, each one stopped and laid out again from its lead; a train left
 * without vehicles disappears. Returns the same array when every train is intact.
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
      advanceTrainSet(net, piece, 0)
      result.push(piece)
    })
  }
  return result
}

/**
 * Rebuild trains from saved data on a network: every train comes back stopped, brakes applied and controls at rest,
 * and anything malformed or standing on a missing segment is dropped. Each rake is laid out again
 * from its lead, so a save made with another vehicle geometry is realigned on the current one.
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
  const loaded = pruneTrainsToNetwork(net, trains)
  // All-or-nothing: a rake that no longer fits behind its lead keeps its stored positions
  for (const train of loaded) advanceTrainSet(net, train, 0)
  return loaded
}
