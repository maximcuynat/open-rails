/**
 * Longitudinal dynamics of a TrainSet: the forces acting on it and the state of its air brake.
 *
 * Shared contract of the realistic driving physics (see `tasks/todo.md`): the store, the HUD and
 * the debug drawing read everything they show from `trainDynamics`, never from the controls.
 *
 * Equation of motion, along the train:
 * `k · m · dv/dt = traction − brake − electric brake − R(v) − grade − curve`.
 * Figures and formulas come from `tasks/recherche-traction.md` and `tasks/recherche-freinage.md`.
 *
 * This module only imports types from `train.ts` (which imports this one for real).
 */

import type { Network } from './types'
import type { CurveState, LineSettings, UpcomingSpeedLimit } from './speedLimits'
import { DEFAULT_LINE_SETTINGS } from './speedLimits'
import { consistAdmittedDeficiency, curveStateFor } from './cant'
import { rakeSpeedState } from './trackSpeed'
import type { TrainSet } from './train'
import type { TrackPosition } from './locomotive'
import { getTrackCurvatureAt } from './locomotive'
import { segmentHeightAt } from './network'
import {
  adhesiveMass,
  bogieDistance,
  consistElectricBrakeEffort,
  consistMass,
  consistMaxEffort,
  consistPower,
  consistResistanceCoefficients,
  jointSpacing,
  vehicleMass,
} from './rollingStock'

/** What the track gives the physics beyond its plan geometry */
export interface DrivingEnvironment {
  /** Height of one track level in world metres (`store.levelHeight`): turns levels into slopes */
  levelHeight: number
  /** Line speed and line type of the project (`store.lineSettings`); the defaults when absent */
  line?: LineSettings
}

export const DEFAULT_DRIVING_ENVIRONMENT: DrivingEnvironment = { levelHeight: 6 }

/** Brake pipe pressure (bar) with the brake released */
export const BRAKE_PIPE_RELEASED = 5.0
/** Brake pipe pressure (bar) after the first reduction: the lightest brake application */
export const BRAKE_PIPE_FIRST_REDUCTION = 4.5
/** Brake pipe pressure (bar) at full service braking */
export const BRAKE_PIPE_FULL_SERVICE = 3.5
/** Brake cylinder pressure (bar) when the cylinders are full (shown on the gauge) */
export const BRAKE_CYLINDER_MAX_BAR = 3.8

/** Number of traction notches: each one is an equal share of the available effort */
export const TRACTION_NOTCHES = 5
/** Number of electric brake notches under N: each one is an equal share of the available effort */
export const ELECTRIC_BRAKE_NOTCHES = 5

/** Longest step (s) the motion is integrated with: a longer tick is cut into equal steps */
export const PHYSICS_STEP = 1 / 30

export const GRAVITY = 9.81
/** Inertia of the rotating masses (wheels, motors), as a factor on the mass of a TGV trainset */
export const ROTATING_MASS_FACTOR = 1.04

/** Seconds for the tractive effort to rise from nothing to full */
const TRACTION_RISE_TIME = 5
/** Seconds for the tractive effort to fall from full to nothing when the handle is brought back */
const TRACTION_FALL_TIME = 1
/** Lowest speed (m/s) used in P/v */
const MIN_POWER_SPEED = 0.5
/** Speed range (m/s) above the maximum speed over which the tractive effort fades to nothing */
const OVERSPEED_FADE = 0.25

/** Seconds for the electric brake effort to rise from nothing to full (about 30 kN/s on a trainset) */
const ELECTRIC_BRAKE_RISE_TIME = 4
/** Seconds for the electric brake effort to fall from full to nothing */
const ELECTRIC_BRAKE_FALL_TIME = 1
/** Speeds (m/s) between which the electric brake fades out, from full to nothing (estimated) */
const ELECTRIC_BRAKE_FADE_FROM = 30 / 3.6
const ELECTRIC_BRAKE_FADE_TO = 10 / 3.6

/** Curve resistance as an equivalent slope: 0.8 / R (800/R in ‰, Rochard & Schmid) */
const CURVE_RESISTANCE_METRES = 0.8

/** Seconds for a full service application: brake pipe from the first reduction to full service */
const BRAKE_APPLY_TIME = 3.5
/** Seconds for a full release: brake pipe from full service back to released */
const BRAKE_RELEASE_TIME = 4
/** Seconds for the brake pipe to empty in an emergency application */
const BRAKE_EMERGENCY_VENT_TIME = 1
/** Share of the full service effort given by the first reduction */
const FIRST_REDUCTION_EFFORT = 0.2
/** Seconds before empty cylinders start to fill: service / emergency (equivalent time of 2 s both) */
const CYLINDER_DEAD_TIME = 0.5
const CYLINDER_DEAD_TIME_EMERGENCY = 1
/** Seconds for the cylinders to fill completely: service / emergency */
const CYLINDER_FILL_TIME = 3
const CYLINDER_FILL_TIME_EMERGENCY = 2
/** Seconds for full cylinders to empty */
const CYLINDER_RELEASE_TIME = 4.5

/**
 * Total deceleration (m/s², brakes + running resistance, dry level track) at the middle of each
 * speed band of the regulation tables (< 170, 170–230, 230–300, > 300 km/h), interpolated in
 * between. Emergency: case A of the high-speed TSI × 1.086, which gives the 3 300 m of a real TGV
 * from 300 km/h. Full service: between the French minimum on TVM lines and the emergency curve.
 */
const BRAKE_CURVE_SPEEDS = [85, 200, 265, 310].map((kmh) => kmh / 3.6)
const FULL_SERVICE_DECELERATION = [1.1, 1.0, 0.85, 0.75]
const EMERGENCY_DECELERATION = [1.3, 1.14, 0.98, 0.81]

/**
 * The brake handle is an impulse valve: while `apply` is held the brake pipe empties, while
 * `release` is held it fills again, and on `hold` the pressure stays where it is.
 */
export type BrakeCommand = 'apply' | 'hold' | 'release'

/** Forces (N) are counted positive when they push the train the way it is moving. */
export interface TrainDynamics {
  /** Mass of the whole train, kg */
  mass: number
  /** Tractive effort at the wheels, N (≥ 0, along the reverser) */
  tractionForce: number
  /** Braking effort of the air brake, N (≥ 0, against the motion) */
  brakeForce: number
  /** Braking effort of the electric brake, N (≥ 0, against the motion) */
  electricBrakeForce: number
  /** Running resistance A + B·v + C·v², N (≥ 0, against the motion) */
  resistanceForce: number
  /** Gravity along the track, N: negative uphill, positive downhill, in the direction of motion */
  gradeForce: number
  /** Curve resistance, N (≥ 0, against the motion) */
  curveForce: number
  /** Resulting acceleration, m/s²: positive when the train gains speed, 0 when it is held at rest */
  acceleration: number
  /** Slope under the train in ‰, averaged over its length: positive uphill in the direction of motion */
  gradientPermille: number
  /** Share of the available tractive effort actually applied, 0…1 (follows the notch with a ramp) */
  tractionEffort: number
  /** Share of the available electric brake effort actually applied, 0…1 (follows the notch with a ramp) */
  electricBrakeEffort: number
  /** Brake pipe pressure, bar (5 released, 3.5 full service, 0 emergency) */
  brakePipeBar: number
  /** Brake cylinder pressure, bar (0 released … BRAKE_CYLINDER_MAX_BAR) */
  brakeCylinderBar: number
  /** Distance (m) to stop from the current speed with a full service application, on the current slope */
  stoppingDistance: number
  /** Largest lateral acceleration v²/R under a vehicle, m/s² (hook for cant and curve speed limits) */
  lateralAcceleration: number
  /** Speed limit the train runs under, m/s: the lowest of its own maximum, the line, the zones and the curves under it */
  speedLimit: number
  /** Next lower speed limit along the route ahead, null when there is none within reach */
  nextSpeedLimit: UpcomingSpeedLimit | null
  /** Largest cant deficiency under a vehicle, mm (0 on straight track) */
  cantDeficiency: number
  /** How the train takes the curve it is in */
  curveState: CurveState
}

// ─── Rake data ────────────────────────────────────────────────────────────────

/** Physical data of a rake, computed from its vehicles each time it is needed (nothing is cached) */
interface RakePhysics {
  mass: number
  power: number
  maxEffort: number
  electricBrakeEffort: number
  adhesiveMass: number
  /** Running resistance coefficients */
  a: number
  b: number
  c: number
  maxSpeed: number
}

function rakePhysics(train: TrainSet): RakePhysics {
  return {
    mass: consistMass(train.vehicles),
    power: consistPower(train.vehicles),
    maxEffort: consistMaxEffort(train.vehicles),
    electricBrakeEffort: consistElectricBrakeEffort(train.vehicles),
    adhesiveMass: adhesiveMass(train.vehicles),
    ...consistResistanceCoefficients(train.vehicles),
    maxSpeed: train.maxSpeed,
  }
}

function runningResistance(rake: RakePhysics, speed: number): number {
  return rake.a + rake.b * speed + rake.c * speed * speed
}

// ─── Traction ─────────────────────────────────────────────────────────────────

/** Wheel–rail adhesion available for traction on dry rail (Curtius-Kniffler), capped at 0.30 */
export function tractionAdhesion(speed: number): number {
  return Math.min(0.3, 7.5 / (speed * 3.6 + 44) + 0.161)
}

/**
 * Tractive effort (N) available at full handle: the lowest of the starting effort, the power
 * hyperbola P/v and the adhesion limit. Nothing without a power car, nothing above the maximum
 * speed (the effort fades over a narrow band so that the train settles on it instead of hunting).
 */
function availableTraction(rake: RakePhysics, speed: number): number {
  if (rake.maxEffort <= 0) return 0
  const effort = Math.min(
    rake.maxEffort,
    rake.power / Math.max(speed, MIN_POWER_SPEED),
    tractionAdhesion(speed) * rake.adhesiveMass * GRAVITY,
  )
  const fade = 1 - (speed - rake.maxSpeed) / OVERSPEED_FADE
  return effort * Math.max(0, Math.min(1, fade))
}

/** True when the brake handle has been moved off the released position */
function isBrakeApplied(train: TrainSet): boolean {
  return train.emergencyBrake || train.brakePipe < BRAKE_PIPE_RELEASED
}

/**
 * Let the applied effort follow the notch: a ramp up, a quicker one down. Braking cuts the
 * traction at once, and there is none without a direction on the reverser, without a power car or
 * on a derailed train.
 */
function stepTraction(train: TrainSet, rake: RakePhysics, h: number): void {
  if (train.derailed || isBrakeApplied(train) || train.reverser === 'neutral' || rake.maxEffort <= 0) {
    train.tractionEffort = 0
    return
  }
  const demand = Math.max(0, Math.min(1, train.notch / TRACTION_NOTCHES))
  train.tractionEffort = demand > train.tractionEffort
    ? Math.min(demand, train.tractionEffort + h / TRACTION_RISE_TIME)
    : Math.max(demand, train.tractionEffort - h / TRACTION_FALL_TIME)
}

// ─── Electric brake ───────────────────────────────────────────────────────────

/**
 * Electric (rheostatic) brake effort (N) available at full handle: the lowest of its largest
 * effort, the power hyperbola P/v and the adhesion of the driven axles. It fades out at low
 * speed, so it slows the train down but neither stops it nor holds it. The power is taken equal
 * to the traction power: nothing is published for it (estimated).
 */
function availableElectricBrake(rake: RakePhysics, speed: number): number {
  if (rake.electricBrakeEffort <= 0) return 0
  const effort = Math.min(
    rake.electricBrakeEffort,
    rake.power / Math.max(speed, MIN_POWER_SPEED),
    brakeAdhesion(speed) * rake.adhesiveMass * GRAVITY,
  )
  const fade = (speed - ELECTRIC_BRAKE_FADE_TO) / (ELECTRIC_BRAKE_FADE_FROM - ELECTRIC_BRAKE_FADE_TO)
  return effort * Math.max(0, Math.min(1, fade))
}

/**
 * Let the applied electric brake effort follow the notches under N: a ramp up, a quicker one
 * down. The motors cannot pull and brake at once, so it waits for the traction to be gone. It
 * works whatever the reverser says, and the emergency brake takes it off with the handle.
 */
function stepElectricBrake(train: TrainSet, rake: RakePhysics, h: number): void {
  const available = !train.emergencyBrake && rake.electricBrakeEffort > 0 && train.tractionEffort <= 0
  const demand = available ? Math.max(0, Math.min(1, -train.notch / ELECTRIC_BRAKE_NOTCHES)) : 0
  train.electricBrakeEffort = demand > train.electricBrakeEffort
    ? Math.min(demand, train.electricBrakeEffort + h / ELECTRIC_BRAKE_RISE_TIME)
    : Math.max(demand, train.electricBrakeEffort - h / ELECTRIC_BRAKE_FALL_TIME)
}

// ─── Air brake ────────────────────────────────────────────────────────────────

/** The part of a train the air brake works on (a TrainSet satisfies it) */
interface BrakeState {
  brakePipe: number
  brakeCylinder: number
  brakeLag: number
  brakeCommand: BrakeCommand
  emergencyBrake: boolean
}

/** Filling the cylinders settle at for a brake pipe pressure: 0 released … 1 at full service and below */
function cylinderTarget(brakePipe: number): number {
  const reduction = BRAKE_PIPE_RELEASED - brakePipe
  const first = BRAKE_PIPE_RELEASED - BRAKE_PIPE_FIRST_REDUCTION
  const full = BRAKE_PIPE_RELEASED - BRAKE_PIPE_FULL_SERVICE
  if (reduction <= 0) return 0
  if (reduction < first) return (FIRST_REDUCTION_EFFORT * reduction) / first
  if (reduction < full) return FIRST_REDUCTION_EFFORT + ((1 - FIRST_REDUCTION_EFFORT) * (reduction - first)) / (full - first)
  return 1
}

/**
 * Advance the air brake by `h` seconds: the brake pipe follows the handle, the cylinders follow
 * the brake pipe.
 *  - `apply` drops at once to the first reduction, then empties down to full service;
 *  - `release` refills the pipe; a pressure above the first reduction is not a stable position, so
 *    the release then completes by itself;
 *  - an emergency application vents the pipe whatever the handle says.
 * Empty cylinders wait for a dead time before they start to fill.
 */
function stepBrake(brake: BrakeState, h: number): void {
  const refill = ((BRAKE_PIPE_RELEASED - BRAKE_PIPE_FULL_SERVICE) / BRAKE_RELEASE_TIME) * h
  if (brake.emergencyBrake) {
    brake.brakePipe = Math.max(0, brake.brakePipe - (BRAKE_PIPE_RELEASED / BRAKE_EMERGENCY_VENT_TIME) * h)
  } else if (brake.brakeCommand === 'apply') {
    if (brake.brakePipe > BRAKE_PIPE_FIRST_REDUCTION) {
      brake.brakePipe = BRAKE_PIPE_FIRST_REDUCTION
    } else {
      const drop = ((BRAKE_PIPE_FIRST_REDUCTION - BRAKE_PIPE_FULL_SERVICE) / BRAKE_APPLY_TIME) * h
      brake.brakePipe = Math.min(brake.brakePipe, Math.max(BRAKE_PIPE_FULL_SERVICE, brake.brakePipe - drop))
    }
  } else if (brake.brakeCommand === 'release' || brake.brakePipe > BRAKE_PIPE_FIRST_REDUCTION) {
    brake.brakePipe = Math.min(BRAKE_PIPE_RELEASED, brake.brakePipe + refill)
  }

  const target = cylinderTarget(brake.brakePipe)
  if (target > brake.brakeCylinder) {
    let fillTime = h
    if (brake.brakeCylinder <= 0) {
      // Empty cylinders: nothing happens until the dead time has run out
      const deadTime = brake.emergencyBrake ? CYLINDER_DEAD_TIME_EMERGENCY : CYLINDER_DEAD_TIME
      const waited = brake.brakeLag + h
      fillTime = Math.max(0, waited - Math.max(deadTime, brake.brakeLag))
      brake.brakeLag = waited
    }
    const rate = 1 / (brake.emergencyBrake ? CYLINDER_FILL_TIME_EMERGENCY : CYLINDER_FILL_TIME)
    brake.brakeCylinder = Math.min(target, brake.brakeCylinder + rate * fillTime)
  } else {
    brake.brakeCylinder = Math.max(target, brake.brakeCylinder - h / CYLINDER_RELEASE_TIME)
    if (brake.brakeCylinder <= 0) brake.brakeLag = 0
  }
}

function interpolate(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1])
  }
  return ys[ys.length - 1]
}

/** Adhesion that braking may count on (TSI): 0.15 up to 250 km/h, down to 0.10 at 350 km/h */
export function brakeAdhesion(speed: number): number {
  const kmh = speed * 3.6
  return Math.max(0.1, Math.min(0.15, 0.15 - (0.05 * (kmh - 250)) / 100))
}

/**
 * Braking effort (N) of the brakes alone. The tables give total decelerations, so the running
 * resistance is taken out of them; what is left is proportional to the filling of the cylinders
 * and capped by the adhesion. Below full service pressure the brake pipe is being vented by an
 * emergency application, and the curve moves from the service one to the emergency one.
 */
function brakeForce(rake: RakePhysics, brake: BrakeState, speed: number): number {
  if (brake.brakeCylinder <= 0) return 0
  const emergencyShare = Math.max(0, Math.min(1, (BRAKE_PIPE_FULL_SERVICE - brake.brakePipe) / BRAKE_PIPE_FULL_SERVICE))
  const service = interpolate(BRAKE_CURVE_SPEEDS, FULL_SERVICE_DECELERATION, speed)
  const emergency = interpolate(BRAKE_CURVE_SPEEDS, EMERGENCY_DECELERATION, speed)
  const deceleration = service + (emergency - service) * emergencyShare
  const fullEffort = Math.max(0, ROTATING_MASS_FACTOR * rake.mass * deceleration - runningResistance(rake, speed))
  return Math.min(brake.brakeCylinder * fullEffort, brakeAdhesion(speed) * rake.mass * GRAVITY)
}

/**
 * Brakes applied, as a train is left standing: brake pipe at full service pressure and cylinders
 * full, so that it holds on a ramp until the driver releases them.
 */
export function applyParkedBrake(brake: BrakeState): void {
  brake.emergencyBrake = false
  brake.brakePipe = BRAKE_PIPE_FULL_SERVICE
  brake.brakeCylinder = 1
  brake.brakeLag = 0
  brake.brakeCommand = 'hold'
}

/** Move the brake handle (see `BrakeCommand`). Ignored while the emergency brake is latched. */
export function setBrakeCommand(train: TrainSet, command: BrakeCommand): void {
  if (train.emergencyBrake) return
  train.brakeCommand = command
}

// ─── Track under the train ────────────────────────────────────────────────────

/** Height (world metres) of the rail under a bogie, null when its segment is gone */
function railHeight(net: Network, pos: TrackPosition, env: DrivingEnvironment): number | null {
  const seg = net.segments.get(pos.segId)
  return seg ? segmentHeightAt(net, seg, pos.t) * env.levelHeight : null
}

/**
 * Slope of the track under the train (rise over run, positive when its head is higher than its
 * tail): the height difference between its first and last bogies over the track between them.
 * Averaging over the whole rake smooths the breaks of the profile.
 */
function trainSlope(net: Network, train: TrainSet, env: DrivingEnvironment): number {
  const vehicles = train.vehicles
  if (vehicles.length === 0) return 0
  const head = railHeight(net, vehicles[0].front, env)
  const tail = railHeight(net, vehicles[vehicles.length - 1].rear, env)
  if (head === null || tail === null) return 0
  let run = 0
  vehicles.forEach((veh, i) => {
    run += bogieDistance(veh)
    if (i > 0) run += jointSpacing(vehicles[i - 1], veh)
  })
  const slope = run > 0 ? (head - tail) / run : 0
  return Number.isFinite(slope) ? slope : 0
}

/** Curvature 1/R (1/m) of the track under a bogie, 0 on straight track */
function curvatureAt(net: Network, pos: TrackPosition): number {
  const radius = getTrackCurvatureAt(net, pos).radius
  return Number.isFinite(radius) && radius > 0 ? 1 / radius : 0
}

/** Curve resistance (N) of the rake, and the sharpest curvature under one of its bogies */
function curveLoad(net: Network, train: TrainSet): { force: number; maxCurvature: number } {
  let force = 0
  let maxCurvature = 0
  for (const veh of train.vehicles) {
    const front = curvatureAt(net, veh.front)
    const rear = curvatureAt(net, veh.rear)
    maxCurvature = Math.max(maxCurvature, front, rear)
    // Equivalent slope 0.8/R, never more than the weight of the vehicle itself
    const equivalentSlope = Math.min(1, (CURVE_RESISTANCE_METRES * (front + rear)) / 2)
    force += vehicleMass(veh) * GRAVITY * equivalentSlope
  }
  return { force, maxCurvature }
}

// ─── Forces and motion ────────────────────────────────────────────────────────

/**
 * Forces on the train in its current state. "Along the train" means towards its head
 * (`vehicles[0]`), whatever way it is moving.
 */
interface Forces {
  /** Tractive effort, N ≥ 0 */
  traction: number
  /** Traction and gravity along the train, N: the forces that can set it moving */
  active: number
  /** Gravity along the train, N */
  gravity: number
  brake: number
  electricBrake: number
  resistance: number
  curve: number
  /** Brakes, running resistance and curve resistance, N ≥ 0: they only ever oppose the motion */
  dissipative: number
  /** Rise over run under the train, positive when its head is higher than its tail */
  slope: number
  maxCurvature: number
}

function computeForces(net: Network, train: TrainSet, env: DrivingEnvironment, rake: RakePhysics): Forces {
  const speed = train.currentSpeed
  const slope = trainSlope(net, train, env)
  // m·g·sin α: bounded by the weight however steep the user made the ramp
  const gravity = (-rake.mass * GRAVITY * slope) / Math.hypot(1, slope)
  const traction = train.tractionEffort * availableTraction(rake, speed)
  const reverser = train.reverser === 'forward' ? 1 : train.reverser === 'reverse' ? -1 : 0
  const brake = brakeForce(rake, train, speed)
  // The two brakes share the adhesion of the train: the air brake takes its part first
  const electricBrake = Math.min(
    train.electricBrakeEffort * availableElectricBrake(rake, speed),
    Math.max(0, brakeAdhesion(speed) * rake.mass * GRAVITY - brake),
  )
  const resistance = runningResistance(rake, speed)
  const { force: curve, maxCurvature } = curveLoad(net, train)
  return {
    traction,
    active: traction * reverser + gravity,
    gravity,
    brake,
    electricBrake,
    resistance,
    curve,
    dissipative: brake + electricBrake + resistance + curve,
    slope,
    maxCurvature,
  }
}

/**
 * Distance (m) to stop from `speed` with the brake handle held on `apply` from now on (or with the
 * emergency brake when it is latched), traction and electric brake cut, on a constant slope: the application delay of
 * the brake is part of it. Infinity when the brake cannot stop the train on that slope.
 */
function integrateStop(rake: RakePhysics, train: TrainSet, speed: number, gravityAlongMotion: number): number {
  if (speed <= 0) return 0
  const brake: BrakeState = {
    brakePipe: train.brakePipe,
    brakeCylinder: train.brakeCylinder,
    brakeLag: train.brakeLag,
    brakeCommand: 'apply',
    emergencyBrake: train.emergencyBrake,
  }
  const inertia = ROTATING_MASS_FACTOR * rake.mass
  const h = 0.05
  let v = speed
  let distance = 0
  for (let i = 0; i < 12000; i++) {
    stepBrake(brake, h)
    const a = (gravityAlongMotion - brakeForce(rake, brake, v) - runningResistance(rake, v)) / inertia
    const next = v + a * h
    if (next <= 0) return distance + (v * v) / (2 * -a)
    // Brake fully established and the train still gains speed: it will not stop
    const settled = brake.brakeCylinder >= 1 && brake.brakePipe <= (brake.emergencyBrake ? 0 : BRAKE_PIPE_FULL_SERVICE)
    if (a >= 0 && settled) return Infinity
    distance += ((v + next) / 2) * h
    v = next
  }
  return Infinity
}

/** Everything the physics computes for a train in its current state. */
export function trainDynamics(net: Network, train: TrainSet, env: DrivingEnvironment = DEFAULT_DRIVING_ENVIRONMENT): TrainDynamics {
  const rake = rakePhysics(train)
  const forces = computeForces(net, train, env, rake)
  const speed = train.currentSpeed
  const inertia = ROTATING_MASS_FACTOR * rake.mass

  let acceleration = 0
  if (inertia > 0 && !(train.derailed && speed === 0)) {
    if (speed === 0) {
      // At rest the dissipative forces hold the train up to their maximum
      acceleration = Math.max(0, Math.abs(forces.active) - forces.dissipative) / inertia
    } else {
      acceleration = (train.direction * forces.active - forces.dissipative) / inertia
    }
  }

  const stoppingDistance = rake.mass > 0 ? integrateStop(rake, train, speed, train.direction * forces.gravity) : 0
  // Limits are written in km/h; the cant, the curve speeds and the overturning only exist at full size
  const line = env.line ?? DEFAULT_LINE_SETTINGS
  const { limit, next, cantDeficiency } = rakeSpeedState(net, train, speed * 3.6, stoppingDistance, line)

  return {
    mass: rake.mass,
    tractionForce: forces.traction,
    brakeForce: forces.brake,
    electricBrakeForce: forces.electricBrake,
    resistanceForce: forces.resistance,
    gradeForce: train.direction * forces.gravity,
    curveForce: forces.curve,
    acceleration,
    gradientPermille: train.direction * forces.slope * 1000,
    tractionEffort: train.tractionEffort,
    electricBrakeEffort: train.electricBrakeEffort,
    brakePipeBar: train.brakePipe,
    brakeCylinderBar: train.brakeCylinder * BRAKE_CYLINDER_MAX_BAR,
    stoppingDistance,
    lateralAcceleration: speed * speed * forces.maxCurvature,
    speedLimit: Math.min(train.maxSpeed, limit / 3.6),
    nextSpeedLimit: next,
    cantDeficiency,
    curveState: curveStateFor(cantDeficiency, consistAdmittedDeficiency(train.vehicles, line.lineType, speed * 3.6)),
  }
}

/** Outcome of one integration step */
export interface DynamicsStep {
  /** Distance (m, ≥ 0) the train covers during the step, along `train.direction` */
  distance: number
  /** True when the train is at rest and pushed against an obstacle that keeps it there */
  blocked: boolean
}

/**
 * Integrate the controls and the speed of a train over one step of `h` seconds (at most
 * `PHYSICS_STEP`; `tickTrainSet` does the cutting). The train itself is not moved: the distance
 * to cover is returned.
 *
 * The speed stays ≥ 0 and `train.direction` says which way it goes: a train that comes to rest
 * stops exactly (speed 0), and one that starts again the other way — rolling back down a ramp —
 * gets its direction flipped, the reverser staying where the driver left it. At rest the brake
 * and the resistances hold the train as long as they can match what pushes it.
 *
 * A derailed train (`train.derailed`) brakes to a stop under its latched emergency brake and then
 * stays at rest: neither gravity nor the controls set it moving again.
 *
 * `isBlocked(direction)` tells whether an obstacle stands right against the train on that side: a
 * train at rest pushed onto it stays at rest instead of starting and hitting it again every step.
 */
export function stepTrainDynamics(
  net: Network,
  train: TrainSet,
  h: number,
  env: DrivingEnvironment = DEFAULT_DRIVING_ENVIRONMENT,
  isBlocked?: (direction: 1 | -1) => boolean,
): DynamicsStep {
  const rake = rakePhysics(train)
  stepBrake(train, h)
  stepTraction(train, rake, h)
  stepElectricBrake(train, rake, h)
  const forces = computeForces(net, train, env, rake)
  const inertia = ROTATING_MASS_FACTOR * rake.mass
  if (!(inertia > 0) || !(h > 0)) {
    train.currentSpeed = 0
    return { distance: 0, blocked: false }
  }

  const { active, dissipative } = forces
  const speed = train.currentSpeed

  if (speed === 0) {
    // A derailed train stays where it stopped, whatever pushes it
    if (train.derailed || Math.abs(active) <= dissipative) return { distance: 0, blocked: false }
    const direction = active > 0 ? 1 : -1
    if (isBlocked?.(direction)) return { distance: 0, blocked: true }
    const gained = ((Math.abs(active) - dissipative) / inertia) * h
    train.direction = direction
    train.currentSpeed = gained
    return { distance: (gained * h) / 2, blocked: false }
  }

  // Moving: acceleration along the motion
  const acceleration = (train.direction * active - dissipative) / inertia
  const next = speed + acceleration * h
  if (next <= 0) {
    // The train comes to rest within the step; whether it starts again is decided at the next one
    train.currentSpeed = 0
    return { distance: (speed * speed) / (2 * -acceleration), blocked: false }
  }
  train.currentSpeed = next
  return { distance: ((speed + next) / 2) * h, blocked: false }
}
