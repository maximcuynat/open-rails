/**
 * What the signalling does to the trains: the one step the simulation runs after the trains have
 * moved. Kept apart from `signalling.ts`, which only reads the trains, so that `train.ts` has
 * nothing to import from the signalling but a type.
 */

import type { Network, SignalId } from './types'
import type { SignallingSettings } from './signals'
import { DEFAULT_SIGNALLING_SETTINGS } from './signals'
import type { LineSettings } from './speedLimits'
import {
  cabControlSpeed,
  cabOverspeedThreshold,
  isCabSignalled,
  latchCabClearance,
} from './cabSignalling'
import {
  ON_SIGHT_SPEED,
  isSightClearance,
  updateSignalling,
  type SignalPassing,
  type SignallingState,
  type StoppingDistanceOf,
} from './signalling'
import { rakeSpeedLimit } from './trackSpeed'
import { triggerEmergencyBrake, type TrainSet } from './train'

/** A closed signal passed against the rules, as it is left on the train (`TrainSet.signalPassed`) */
export interface SignalPassedAtDanger {
  signalId: SignalId
  /** Speed of the train when it passed the signal, km/h */
  speed: number
  /** True when the emergency brake was applied for it (`SignallingSettings.stopEnforced`) */
  braked: boolean
}

/** A train caught over the speed its cab checks it against, as it is left on the train (`TrainSet.overspeed`) */
export interface CabOverspeed {
  /** Speed of the train when it was caught, km/h */
  speed: number
  /** The speed it was checked against, km/h (`cabControlSpeed`) */
  limit: number
  /** True when the emergency brake was applied for it (`SignallingSettings.stopEnforced`) */
  braked: boolean
}

/** What `tickSignalling` reads besides the trains and the settings */
export interface TickSignallingOptions {
  /**
   * Line settings of the project. The pro level reads the speed of the points from them, and on a
   * high-speed line it runs the cab signalling: free blocks counted for each train, overspeed check.
   */
  line?: LineSettings
  /**
   * The speed limit in force over a train, km/h, when the caller has it in hand (the driven train:
   * `trainDynamics(...).speedLimit`); the overspeed check works it out itself otherwise.
   */
  speedLimitOf?: (train: TrainSet) => number | null | undefined
  /** Called once each time a train is caught overspeeding */
  onOverspeed?: (train: TrainSet, overspeed: CabOverspeed) => void
}

/**
 * Run the signalling for one simulation step, after the trains have moved: bring `state` up to date
 * (`updateSignalling`) and deal with the signals passed. A closed signal passed against the rules
 * of the level leaves its trace on the train (`train.signalPassed`) and, when
 * `settings.stopEnforced` is on, latches its emergency brake; a signal passed properly clears the
 * trace. Returns the signals passed during the step, for the interface to tell the driver once.
 * `stoppingDistanceOf`: see `updateSignalling`.
 *
 * On a cab-signalled line (pro level, high-speed line in `options.line`) it also keeps what each
 * cab shows (`TrainSignalling.cab`) and checks the speed of every moving train against it: a train
 * over `cabOverspeedThreshold` gets its trace (`train.overspeed`) and, when `settings.stopEnforced`
 * is on, its emergency brake — once, until it is back under the speed checked (and at a stand when
 * it was braked).
 */
export function tickSignalling(
  net: Network,
  trains: readonly TrainSet[],
  state: SignallingState,
  settings: SignallingSettings = DEFAULT_SIGNALLING_SETTINGS,
  stoppingDistanceOf?: StoppingDistanceOf,
  options: TickSignallingOptions = {},
): SignalPassing[] {
  const line = options.line
  const cab = !!line && net.signals.size > 0 && isCabSignalled(settings.level, line)
  const passings = updateSignalling(net, trains, state, settings, stoppingDistanceOf, { line, clearance: cab })
  for (const passing of passings) {
    const train = trains.find((candidate) => candidate.id === passing.trainId)
    if (!train) continue
    if (!passing.fault) {
      if (train.signalPassed) train.signalPassed = null
      continue
    }
    train.signalPassed = { signalId: passing.signalId, speed: passing.speed * 3.6, braked: settings.stopEnforced }
    if (settings.stopEnforced) triggerEmergencyBrake(train)
  }
  if (!cab) return passings

  for (const train of trains) {
    const record = state.trains.get(train.id)
    if (!record) continue
    record.cab = record.clearance ? latchCabClearance(record.cab, record.clearance) : null
    if (!record.cab || train.derailed) continue
    const speed = train.currentSpeed * 3.6
    if (!(speed > 0) && !train.overspeed) continue
    const sight = record.onSight || isSightClearance(record.cab)
    let control = ON_SIGHT_SPEED
    if (!sight) {
      const given = options.speedLimitOf?.(train)
      const limit = typeof given === 'number' && Number.isFinite(given) ? given : rakeSpeedLimit(net, train, line, { turnouts: true })
      control = cabControlSpeed(record.cab, Math.round(limit))
    }
    if (speed > cabOverspeedThreshold(control, sight)) {
      if (train.overspeed) continue
      train.overspeed = { speed, limit: control, braked: settings.stopEnforced }
      if (settings.stopEnforced) triggerEmergencyBrake(train)
      options.onOverspeed?.(train, train.overspeed)
    } else if (train.overspeed && speed <= control && (!train.overspeed.braked || speed === 0)) {
      train.overspeed = null
    }
  }
  return passings
}
