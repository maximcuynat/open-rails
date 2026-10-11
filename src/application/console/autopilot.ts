import { BRAKE_CYLINDER_MAX_BAR, BRAKE_PIPE_RELEASED, FIRST_REDUCTION_EFFORT, brakePipeFor, type BrakeCommand } from '@domain/models/trainDynamics'
import type { ConsoleCabSignal, ConsoleState } from './consoleContract'

// ─────────────────── The automatic pilot ───────────────────
//
// It drives the way a console does: from the `ConsoleState` a driver sees — the limit in force,
// the lower one ahead, the closed signal, what the cab announces, the train ahead — and a place to stop at, it says where
// the handles should be. Nothing here knows the track: the same orders would drive a train from a
// phone.
//
// The speed it aims at is the highest that still lets it meet everything ahead by braking at a
// comfortable share of what the brake can do: for a limit `v` at distance `d`, √(v² + 2·a·d).
// It runs under the limit by a margin and holds that speed with the handle, one notch at a time:
// it asks itself what acceleration would bring the train onto the speed aimed at in a few seconds
// (the slope of the braking curve it follows added in), compares it with the one the train has, and
// moves the handle a notch towards it. The handle keeps what it found, so a ramp or the drag of
// high speed leave no gap.
//
// It brakes with the electric brake first. The air brake comes in once the handle is at its stop
// (or under the speed where the electric brake fades out), for what is still missing; with too
// much braking the air brake eases first, down to its first reduction, then the handle. It sets
// the brake pipe to the pressure that gives the filling wanted, and leaves it there.

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
/** Seconds between an order and its effect (the electric brake builds up, the brake cylinders fill with a delay) */
const REACTION_S = 2.5
/**
 * Under this speed the brakes are on already when it matters, and the allowance shrinks with the
 * speed: the braking curve then ends at a steady deceleration instead of trailing off, m/s
 */
const REACTION_FULL_FROM = 10
/** It stops this far short of a closed signal, and of a train ahead, m */
const SIGNAL_MARGIN = 35
const TRAIN_MARGIN = 60
/** A gap to the speed aimed at is to be closed in about this long, s */
const SETTLE_S = 4
/** The most it asks the traction for, m/s² */
const PULL_AT_MOST = 1.2
/** The handle stays where it is while the acceleration is this close to the one wanted, m/s² */
const ACCELERATION_BAND = 0.05
/** Under this speed the electric brake has faded out: the handle comes back to N, m/s */
const ELECTRIC_BRAKE_FROM = 3
/** The brake pipe is where it should be within this, bar: it is left alone until it is that far off, then taken all the way */
const PIPE_TOLERANCE = 0.08
/** The first reduction is let go once it brakes this much more than wanted, as a share of the full service */
const FIRST_REDUCTION_EXCESS = 0.1
/** The air brake comes in whatever the handle does once what is ahead takes this much more than the deceleration planned */
const BEHIND_THE_CURVE = 1.15
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

/** The speed (m/s) it runs at under a limit in km/h */
const underLimit = (kmh: number): number => Math.max(0, (kmh / 3.6) * LIMIT_SHARE - LIMIT_STEP)

/** The cab announces a speed for the next marker board, and says how far that is */
const announcedAhead = (cab: ConsoleCabSignal): cab is ConsoleCabSignal & { markerDistance: number } => cab.kind === 'announce' && cab.markerDistance !== null

/** Everything ahead the train has to be slow, or stopped, for */
function constraintsOf(state: ConsoleState, target: PilotTarget): Constraint[] {
  const constraints: Constraint[] = []
  const next = state.guidance?.nextLimit
  if (next) constraints.push({ speed: underLimit(next.speed), distance: next.distance })
  const signals = state.signals
  if (signals) {
    // A closed signal: the next one when it says why it is closed, else the first closed one beyond
    if (signals.next && (signals.next.cause !== undefined || signals.next.color === 'red')) constraints.push({ speed: 0, distance: signals.next.distance - SIGNAL_MARGIN })
    else if (signals.closedDistance !== null) constraints.push({ speed: 0, distance: signals.closedDistance - SIGNAL_MARGIN })
    // A stop shown in the cab holds at the next marker board
    if (signals.cab && signals.cab.speed <= 0) constraints.push({ speed: 0, distance: (signals.cab.markerDistance ?? 0) - SIGNAL_MARGIN })
    // A speed announced in the cab is to be met at the next marker board: the block is there to come down in
    else if (signals.cab && announcedAhead(signals.cab)) constraints.push({ speed: underLimit(signals.cab.speed), distance: signals.cab.markerDistance })
  }
  if (state.ahead) constraints.push({ speed: Math.max(0, state.ahead.speed), distance: state.ahead.distance - TRAIN_MARGIN })
  if (target.stopIn !== null) constraints.push({ speed: 0, distance: target.stopIn })
  return constraints
}

export interface PilotAim {
  /** The speed it aims at right now, m/s */
  speed: number
  /** How that speed changes as the train runs on, m/s²: under zero down a braking curve */
  slope: number
  /** The deceleration it would take to meet what is ahead, m/s² */
  needed: number
  /** The deceleration it plans its braking with, m/s² */
  plan: number
  /** The full service deceleration of the train, m/s² */
  full: number
}

/** The speed the pilot aims at right now, and the deceleration it would need to meet what is ahead */
export function pilotSpeed(state: ConsoleState, target: PilotTarget): PilotAim {
  const v = state.speed
  const full = v > 3 && state.stoppingDistance !== null && state.stoppingDistance > 1 ? (v * v) / (2 * state.stoppingDistance) : DEFAULT_FULL_DECELERATION
  const plan = Math.max(PILOT_MIN_DECELERATION, Math.min(PILOT_MAX_DECELERATION, PILOT_BRAKING_SHARE * full))
  let speed = state.maxSpeed
  if (state.guidance) speed = Math.min(speed, underLimit(state.guidance.speedLimit))
  // What the cab shows is a limit of its own on a cab-signalled line, unless it is for the next marker board
  const cab = state.signals?.cab
  if (cab && cab.speed > 0 && !announcedAhead(cab)) speed = Math.min(speed, underLimit(cab.speed))
  if (state.signals?.onSight) speed = Math.min(speed, underLimit(state.signals.onSightSpeed))
  let slope = 0
  let needed = 0
  for (const c of constraintsOf(state, target)) {
    const room = c.distance - v * REACTION_S * Math.min(1, v / REACTION_FULL_FROM)
    const curve = Math.sqrt(c.speed * c.speed + 2 * plan * Math.max(0, room))
    let allowed = curve
    // The last metres to a stop are crept over, so that the train does not come to rest short of it
    if (c.speed === 0 && c.distance > PILOT_STOP_TOLERANCE) allowed = Math.max(allowed, Math.min(CREEP_SPEED, Math.max(CREEP_FLOOR, CREEP_PER_METRE * c.distance)))
    if (c.speed === 0 && c.distance <= PILOT_STOP_TOLERANCE) allowed = 0
    if (allowed < speed) {
      speed = allowed
      // Down the curve the speed allowed falls as the train nears: by `plan` when it runs on it
      slope = allowed === curve && room > 0 ? (-plan * v) / Math.max(curve, 1) : 0
    }
    if (v > c.speed) needed = Math.max(needed, (v * v - c.speed * c.speed) / (2 * Math.max(1, c.distance)))
  }
  return { speed: Math.max(0, speed), slope, needed, plan, full }
}

/**
 * The handle one notch nearer the acceleration wanted. Away from N it waits for the effort to have
 * caught up with the notch it is on (the effort follows the handle with a ramp): moving on sooner
 * would only run the handle to its stop. `easing` says whether the electric brake may be eased:
 * not while the air brake still has some to give back.
 */
function stepHandle(state: ConsoleState, wanted: number, easing: boolean): number {
  const { notch } = state
  if (notch < 0 && state.speed < ELECTRIC_BRAKE_FROM) return notch + 1
  const gap = state.acceleration - wanted
  if (Math.abs(gap) <= ACCELERATION_BAND) return notch
  const next = notch + (gap < 0 ? 1 : -1)
  if (next > state.maxNotch || next < state.minNotch) return notch
  if (next < 0 && state.speed < ELECTRIC_BRAKE_FROM) return notch
  if (notch < 0 && next > notch && !easing) return notch
  if (notch !== 0 && Math.abs(next) > Math.abs(notch)) {
    const span = notch > 0 ? state.maxNotch : -state.minNotch
    if (state.handleEffort < (Math.abs(notch) - 0.5) / span) return notch
  }
  return next
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
  const pipe = state.brake ? state.brake.pipeBar : BRAKE_PIPE_RELEASED
  /** The brake handle for the cylinders to settle at `filling`: the brake pipe taken to the pressure that gives it */
  const air = (filling: number): BrakeCommand => {
    const off = pipe - brakePipeFor(filling)
    // A handle already moving goes on until the pressure is there
    if (state.brake?.command === 'apply') return off > 0 ? 'apply' : 'hold'
    if (state.brake?.command === 'release') return off < 0 ? 'release' : 'hold'
    return off > PIPE_TOLERANCE ? 'apply' : off < -PIPE_TOLERANCE ? 'release' : 'hold'
  }
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
  const wanted = Math.max(-aim.full, Math.min(PULL_AT_MOST, aim.slope - error / SETTLE_S))
  // The handle first; no traction against brake cylinders that are still full
  const notch = stepHandle(state, wanted, level <= FIRST_REDUCTION_EFFORT + 0.05)
  orders.notch = level > 0.05 ? Math.min(0, notch) : notch

  // The filling that would give the acceleration wanted, the handle staying where it is
  const filling = level + (state.acceleration - wanted) / aim.full
  const applied = pipe < BRAKE_PIPE_RELEASED - 0.01
  const electricSpent = state.notch <= state.minNotch || v < ELECTRIC_BRAKE_FROM
  let filled: number | null
  if (!applied) filled = electricSpent && filling >= FIRST_REDUCTION_EFFORT ? filling : 0
  // Too much of it: down to the first reduction while the handle eases, then off
  else if (filling < FIRST_REDUCTION_EFFORT) filled = state.notch < 0 || filling > FIRST_REDUCTION_EFFORT - FIRST_REDUCTION_EXCESS ? FIRST_REDUCTION_EFFORT : 0
  // More of it only once the handle is at its stop
  else filled = filling > level && !electricSpent ? null : filling
  // Whatever the handle gives: well over the speed aimed at, or behind the braking curve
  const least = Math.max(error > 2 ? (error - 2) / 4 : 0, aim.needed > BEHIND_THE_CURVE * aim.plan ? aim.needed / aim.full : 0)
  if (least > 0) filled = Math.max(filled ?? level, least)
  orders.brake = filled === null ? 'hold' : air(Math.min(1, filled))
  return orders
}
