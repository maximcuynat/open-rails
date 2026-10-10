import type { Reverser } from '@domain/models/train'
import type { BrakeCommand } from '@domain/models/trainDynamics'
import type { CurveState, Derailment, UpcomingSpeedLimit } from '@domain/models/speedLimits'
import type { SignallingLevel } from '@domain/models/signals'
import type { SignalColor, SignalIndication, SlowdownSpeed } from '@domain/models/signalling'
import type { CabIndicationKind } from '@domain/models/cabSignalling'

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
  /** The lower limit ahead the train has to brake for first and the distance to it; `null` when none is in sight */
  nextLimit: UpcomingSpeedLimit | null
  /** How the train takes the curve it is in */
  curve: CurveState
  /** Set once the train has left the rails: it stays put until it is put back on the track */
  derailed: Derailment | null
}

/** A signal ahead of the train, as its signalling level shows it (`signalAspect`) */
export interface ConsoleSignal {
  /** Distance from the head of the train, m */
  distance: number
  /** Colour of the standard level; at the pro level, the colour of the lit lamp(s) */
  color: SignalColor
  /** Pro level only: the French indication */
  indication: SignalIndication | null
  /** Pro level only: `F` (may be passed on sight after a stop) or `Nf` (never passed closed) */
  plate: 'F' | 'Nf' | null
  /** False for a marker board without lamps (cab-signalled line) */
  lit: boolean
  /** Name of what is shown: « Voie libre », « Avertissement »… */
  label: string
  /**
   * Pro level, only there when lit: the announcement of points to take at that speed (two yellow
   * lamps side by side), km/h; the lamps flash for 60
   */
  slowdown?: SlowdownSpeed
  /** Pro level, only there when lit: the reminder of that speed before the points (two yellow lamps one above the other) */
  reminder?: SlowdownSpeed
}

/** The target speed shown in the cab of a high-speed line (see `cabSignalling.ts`) */
export interface ConsoleCabSignal {
  kind: CabIndicationKind
  /** km/h; 0 for a stop */
  speed: number
  /** The next block will show something more restrictive */
  flashing: boolean
  /** Distance to the next marker board, m; `null` when there is none ahead */
  markerDistance: number | null
}

/** What the signals say to the driver. Only there on a network that has signals */
export interface ConsoleSignals {
  level: SignallingLevel
  /** The next signal on the route; `null` when none is in sight */
  next: ConsoleSignal | null
  /** Distance (m) to the first closed signal on the route when it is not the next one, else `null` */
  closedDistance: number | null
  /** A closed signal is nearer than the stopping distance and its margin: brake now */
  brakeAlert: boolean
  /** Stopped before a closed path signal, waiting for its route */
  waiting: boolean
  /**
   * Pro level: running on sight, `onSightSpeed` km/h at most — after passing a closed block signal,
   * or while the cab shows red. The speed limit of `guidance` already counts it
   */
  onSight: boolean
  onSightSpeed: number
  /** A closed signal was passed against the rules; stays until the next signal is passed properly */
  passed: { braked: boolean } | null
  /** Pro level on a high-speed line: the cab display stands for the lineside signals */
  cab: ConsoleCabSignal | null
  /**
   * Only there while it lasts: the train was caught over the speed its cab checks it against
   * (cab-signalled line), with or without the emergency brake
   */
  overspeed?: { braked: boolean }
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
  /** Absent on a network without signal, for the legacy locomotive, and from a PC of an older version */
  signals?: ConsoleSignals
  /** The train met first on the route ahead; null when the route is clear as far as it is looked at. Absent from an older PC */
  ahead?: ConsoleTrainAhead | null
}

/** The train ahead of the driven one on its route, as the points lie */
export interface ConsoleTrainAhead {
  /** Metres from the leading end of the driven train to the nearest end of that train */
  distance: number
  /** Its speed along the route, m/s: positive when it runs away from the driven train, negative when it comes towards it */
  speed: number
  /** Who drives it (« PC », the name of a desk); null when nobody does */
  driver: string | null
}

/** How far ahead of a driven train another train is looked for, metres */
export const TRAIN_AHEAD_REACH = 10_000

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
  /** True for a train someone drives: this PC or a desk */
  driven: boolean
  /** Who drives it: `host` (the PC), the number of a desk, null for nobody. Absent from a PC of an older version */
  driver?: 'host' | number | null
  /** What that driver is called (« PC », the name a desk gave, « Pupitre 3 ») */
  driverName?: string
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
