import { BRAKE_CYLINDER_MAX_BAR, type BrakeCommand } from '@domain/models/trainDynamics'
import type { ConsoleState } from './consoleContract'

// ─────────────────── The automatic pilot ───────────────────
//
// It drives the way a console does: from the `ConsoleState` a driver sees — the limit in force,
// the lower one ahead, the closed signal, the train ahead — and a place to stop at, it says where
// the handles should be. Nothing here knows the track: the same orders would drive a train from a
// phone.
//
// The speed it aims at is the highest that still lets it meet everything ahead by braking at a
// comfortable share of what the brake can do: for a limit `v` at distance `d`, √(v² + 2·a·d).
// It runs under the limit by a margin, pulls when below that speed, coasts in a band around it,
// and brakes above — the electric brake first, the air brake when that is not enough.

export interface PilotTarget {
  /** Metres from the head of the train to where it must stand still (a platform); null when nowhere */
  stopIn: number | null
}

export interface PilotOrders {
  notch: number
  brake: BrakeCommand
  /** Put the reverser forward (at a stand, to leave) */
  forward: boolean
  /** Reset an emergency stop now that the train stands still */
  resetEmergency: boolean
}

/** Share of the full service deceleration the pilot plans its braking with */
export const PILOT_BRAKING_SHARE = 0.55
/** The deceleration it plans with, m/s², whatever the train says it can do */
export const PILOT_MIN_DECELERATION = 0.25
export const PILOT_MAX_DECELERATION = 0.75
/** Full service deceleration assumed while the train is too slow for its stopping distance to tell, m/s² */
const DEFAULT_FULL_DECELERATION = 0.9
/** It runs this far under a limit: a share of it, and a fixed step, m/s */
const LIMIT_SHARE = 0.97
const LIMIT_STEP = 0.5
/** Seconds between an order and its effect (the brake cylinders fill with a delay) */
const REACTION_S = 2.5
/** It stops this far short of a closed signal, and of a train ahead, m */
const SIGNAL_MARGIN = 35
const TRAIN_MARGIN = 60
/** It pulls below the speed aimed at by more than this, and brakes above it by more than that, m/s */
const PULL_BELOW = 0.8
const BRAKE_ABOVE = 0.4
/** The last metres to a stopping place are crept over: at most this fast, slower as it nears, never under the floor, m/s */
const CREEP_SPEED = 1.5
const CREEP_FLOOR = 0.4
/** Creeping speed per metre left, 1/s */
const CREEP_PER_METRE = 0.25
/** A stopping place is reached within this, m */
export const PILOT_STOP_TOLERANCE = 1.5

interface Constraint {
  /** Speed to be down to, m/s */
  speed: number
  /** Metres to where */
  distance: number
}

/** Everything ahead the train has to be slow, or stopped, for */
function constraintsOf(state: ConsoleState, target: PilotTarget): Constraint[] {
  const constraints: Constraint[] = []
  const next = state.guidance?.nextLimit
  if (next) constraints.push({ speed: Math.max(0, (next.speed / 3.6) * LIMIT_SHARE - LIMIT_STEP), distance: next.distance })
  const signals = state.signals
  if (signals) {
    // A closed signal: the next one when it says why it is closed, else the first closed one beyond
    if (signals.next && (signals.next.cause !== undefined || signals.next.color === 'red')) constraints.push({ speed: 0, distance: signals.next.distance - SIGNAL_MARGIN })
    else if (signals.closedDistance !== null) constraints.push({ speed: 0, distance: signals.closedDistance - SIGNAL_MARGIN })
    // A stop shown in the cab holds at the next marker board
    if (signals.cab && signals.cab.speed <= 0) constraints.push({ speed: 0, distance: (signals.cab.markerDistance ?? 0) - SIGNAL_MARGIN })
  }
  if (state.ahead) constraints.push({ speed: Math.max(0, state.ahead.speed), distance: state.ahead.distance - TRAIN_MARGIN })
  if (target.stopIn !== null) constraints.push({ speed: 0, distance: target.stopIn })
  return constraints
}

/** The speed (m/s) the pilot aims at right now, and the deceleration (m/s²) it would need to meet what is ahead */
export function pilotSpeed(state: ConsoleState, target: PilotTarget): { speed: number; needed: number; full: number } {
  const v = state.speed
  const full = v > 3 && state.stoppingDistance !== null && state.stoppingDistance > 1 ? (v * v) / (2 * state.stoppingDistance) : DEFAULT_FULL_DECELERATION
  const plan = Math.max(PILOT_MIN_DECELERATION, Math.min(PILOT_MAX_DECELERATION, PILOT_BRAKING_SHARE * full))
  let speed = state.maxSpeed
  if (state.guidance) speed = Math.min(speed, (state.guidance.speedLimit / 3.6) * LIMIT_SHARE - LIMIT_STEP)
  // What the cab shows is a limit of its own on a cab-signalled line
  const cab = state.signals?.cab
  if (cab && cab.speed > 0) speed = Math.min(speed, (cab.speed / 3.6) * LIMIT_SHARE - LIMIT_STEP)
  if (state.signals?.onSight) speed = Math.min(speed, (state.signals.onSightSpeed / 3.6) * LIMIT_SHARE - LIMIT_STEP)
  let needed = 0
  for (const c of constraintsOf(state, target)) {
    const room = c.distance - v * REACTION_S
    let allowed = Math.sqrt(c.speed * c.speed + 2 * plan * Math.max(0, room))
    // The last metres to a stop are crept over, so that the train does not come to rest short of it
    if (c.speed === 0 && c.distance > PILOT_STOP_TOLERANCE) allowed = Math.max(allowed, Math.min(CREEP_SPEED, Math.max(CREEP_FLOOR, CREEP_PER_METRE * c.distance)))
    if (c.speed === 0 && c.distance <= PILOT_STOP_TOLERANCE) allowed = 0
    speed = Math.min(speed, allowed)
    if (v > c.speed) needed = Math.max(needed, (v * v - c.speed * c.speed) / (2 * Math.max(1, c.distance)))
  }
  return { speed: Math.max(0, speed), needed, full }
}

/** Where the handles should be for a train in `state` that is to stop at `target` */
export function pilotOrders(state: ConsoleState, target: PilotTarget): PilotOrders {
  const orders: PilotOrders = { notch: 0, brake: 'hold', forward: false, resetEmergency: false }
  if (state.guidance?.derailed) return orders
  if (state.emergencyBrake) {
    orders.resetEmergency = state.emergencyReleasable
    return orders
  }
  const v = state.speed
  const level = state.brake ? state.brake.cylinderBar / BRAKE_CYLINDER_MAX_BAR : 0
  const air = (wanted: number): BrakeCommand => (level < wanted - 0.08 ? 'apply' : level > wanted + 0.08 ? 'release' : 'hold')
  const aim = pilotSpeed(state, target)

  // Nowhere to go: stand still, brakes on
  if (aim.speed <= 0.01) {
    orders.brake = state.stopped ? air(0.7) : air(v > 2 ? Math.min(1, Math.max(0.5, aim.needed / aim.full)) : 0.6)
    return orders
  }
  // Leaving: the reverser forward first, with the handle out of traction and the train at a stand
  if (state.stopped && state.reverser !== 'forward') {
    orders.forward = true
    orders.brake = air(0.7)
    return orders
  }
  const error = v - aim.speed
  if (error < -PULL_BELOW) {
    orders.brake = air(0)
    // No traction against brake cylinders that are still full
    orders.notch = level > 0.05 ? 0 : Math.max(1, Math.min(state.maxNotch, Math.ceil(-error / 1.5)))
    return orders
  }
  if (error <= BRAKE_ABOVE) {
    orders.brake = air(0)
    return orders
  }
  // Too fast for what is ahead: the electric brake by how much, the air brake when it has to be met soon
  orders.notch = Math.max(state.minNotch, -Math.ceil(error / 0.8))
  const share = aim.needed / aim.full
  orders.brake = air(Math.min(1, Math.max(error > 2 ? (error - 2) / 4 : 0, share > 0.6 * PILOT_BRAKING_SHARE ? share : 0)))
  return orders
}
