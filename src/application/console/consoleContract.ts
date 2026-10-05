import type { Reverser } from '@domain/models/train'
import type { BrakeCommand } from '@domain/models/trainDynamics'
import type { CurveState, Derailment, UpcomingSpeedLimit } from '@domain/models/speedLimits'

/**
 * The contract between a driving console and whatever drives the train. A console only ever sees
 * a `ConsoleState` and only ever emits `ConsoleCommand`s: the same console runs on the PC (state
 * read from the store) and on a phone (state received over the network).
 *
 * Everything here is plain JSON: no `Infinity`, no class instance, no `Map`.
 */

export type ConsoleBrakeTone = 'released' | 'releasing' | 'applying' | 'applied' | 'emergency'

/** The air brake as the console shows it */
export interface ConsoleBrake {
  /** Position of the brake handle: held keys and buttons move it away from `hold` */
  command: BrakeCommand
  tone: ConsoleBrakeTone
  /** Brake pipe pressure, bar */
  pipeBar: number
  /** Brake cylinder pressure, bar */
  cylinderBar: number
}

/** The turnout the `steer` command would act on */
export interface ConsoleTurnout {
  /** Distance from the head of the train, m */
  distance: number
  /** Side the open route leaves on, seen from the cab; `null` when it cannot be told */
  side: 'left' | 'right' | null
  /** Occupied by a train: it cannot be thrown */
  locked: boolean
}

/** What the track asks of the driver right now: the speed limits and the curve under the train */
export interface ConsoleGuidance {
  /** Speed limit in force over the train, km/h */
  speedLimit: number
  /** The next lower limit ahead and the distance to it; `null` when none is in sight */
  nextLimit: UpcomingSpeedLimit | null
  /** How the train takes the curve it is in */
  curve: CurveState
  /** Set once the train has left the rails: it stays put until it is put back on the track */
  derailed: Derailment | null
}

export interface ConsoleState {
  /** Id of the driven train; `null` for the legacy single locomotive */
  trainId: string | null
  /** Speed along the track, m/s (≥ 0) */
  speed: number
  /** Top speed of the train, m/s */
  maxSpeed: number
  stopped: boolean
  /** Combined handle: 1 … maxNotch traction, 0 neutral, -1 … minNotch electric brake */
  notch: number
  minNotch: number
  maxNotch: number
  /** Share of the traction or electric brake effort really applied on the current notch, 0…1 */
  handleEffort: number
  reverser: Reverser
  /** The reverser only moves at rest with the handle out of traction */
  reverserLocked: boolean
  emergencyBrake: boolean
  /** An emergency stop can only be reset once the train has stopped */
  emergencyReleasable: boolean
  /** `null` for the legacy locomotive, which has no air brake */
  brake: ConsoleBrake | null
  /** m/s², positive when the train gains speed */
  acceleration: number
  /** Slope under the train in ‰, positive uphill in the direction of motion */
  gradientPermille: number
  /** Stopping distance at full service braking, m; `null` when the brake cannot hold the train */
  stoppingDistance: number | null
  locoCount: number
  wagonCount: number
  /** The next turnout ahead that the driver can throw; `null` when there is none in sight */
  upcomingTurnout: ConsoleTurnout | null
  /** True when the driver can take the cab at the other end (train stopped, power car there) */
  canSwitchCab: boolean
  /** Legacy locomotive only: its throttle (-1 brake, 0 coast, 1 accelerate) */
  legacyThrottle?: -1 | 0 | 1
  /** Absent for the legacy locomotive, which knows no speed limit, and from a PC of an older version */
  guidance?: ConsoleGuidance
}

/** One train of the layout, for the list a phone picks its train from */
export interface FleetEntry {
  id: string
  /** 1-based rank in the fleet, as shown to the player */
  rank: number
  /** Display name of the rolling stock model, e.g. « TGV Duplex » */
  model: string
  locoCount: number
  wagonCount: number
  /** m/s */
  speed: number
  /** True for the train currently driven on the PC */
  driven: boolean
}

export type ConsoleCommand =
  | { type: 'notchStep'; step: 1 | -1 }
  /** Clamped to minNotch … maxNotch by whoever applies it */
  | { type: 'notchSet'; notch: number }
  /** Held command: `apply` and `release` last until a `hold` */
  | { type: 'brake'; command: BrakeCommand }
  | { type: 'reverser'; reverser: Reverser }
  /** Toggles the emergency brake (resetting it obeys `emergencyReleasable`) */
  | { type: 'emergencyBrake' }
  | { type: 'steer'; side: 'left' | 'right' }
  | { type: 'switchCab' }
  /** Drive this train: enters driving mode if needed */
  | { type: 'selectTrain'; trainId: string }
  /** Previous / next train of the fleet */
  | { type: 'selectTrainByOffset'; offset: 1 | -1 }
  /** Leave driving mode */
  | { type: 'releaseControls' }
  /** Put the derailed train back on the track */
  | { type: 'rerail' }

export const CONSOLE_COMMAND_TYPES = [
  'notchStep',
  'notchSet',
  'brake',
  'reverser',
  'emergencyBrake',
  'steer',
  'switchCab',
  'selectTrain',
  'selectTrainByOffset',
  'releaseControls',
  'rerail',
] as const satisfies readonly ConsoleCommand['type'][]
