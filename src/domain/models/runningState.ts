import type { TrackPosition } from './locomotive'
import { MAX_NOTCH, MIN_NOTCH, type TrainSet } from './train'
import { BRAKE_PIPE_RELEASED, type BrakeCommand } from './trainDynamics'

/**
 * What a train was doing when the game was last written down: kept apart from the project (a
 * saved file, an undo step hold where the trains stand, never how they run), so that a page
 * loaded again finds the game as it was left.
 */
export interface TrainRunningState {
  /** Where the head of the train stood: the state is only given back to a train still there */
  at: TrackPosition
  speed: number
  reverser: TrainSet['reverser']
  notch: number
  brakeCommand: BrakeCommand
  brakePipe: number
  brakeCylinder: number
  brakeLag: number
  emergencyBrake: boolean
  tractionEffort: number
  electricBrakeEffort: number
  /** The automatic pilot held it */
  piloted?: true
}

export interface SavedGame {
  version: 1
  trains: Record<string, TrainRunningState>
  /** The screen was on no train (free view) */
  freeView?: true
}

/** The game as it runs now; null without a train */
export function captureGame(trains: readonly TrainSet[], piloted: ReadonlySet<string>, freeView: boolean): SavedGame | null {
  if (trains.length === 0) return null
  const game: SavedGame = { version: 1, trains: {} }
  for (const train of trains) {
    const lead = train.vehicles[0]
    if (!lead) continue
    const state: TrainRunningState = {
      at: { ...lead.front },
      speed: train.currentSpeed,
      reverser: train.reverser,
      notch: train.notch,
      brakeCommand: train.brakeCommand,
      brakePipe: train.brakePipe,
      brakeCylinder: train.brakeCylinder,
      brakeLag: train.brakeLag,
      emergencyBrake: train.emergencyBrake,
      tractionEffort: train.tractionEffort,
      electricBrakeEffort: train.electricBrakeEffort,
    }
    if (piloted.has(train.id)) state.piloted = true
    game.trains[train.id] = state
  }
  if (freeView) game.freeView = true
  return game
}

const REVERSERS: readonly unknown[] = ['forward', 'neutral', 'reverse']
const BRAKE_COMMANDS: readonly unknown[] = ['apply', 'hold', 'release']
/** Two positions are the same place when their `t` differ by less than this: what a save and a load may round */
const SAME_PLACE = 1e-6

const within = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

/** A saved state read back, or null when anything in it is not what was written */
function readState(raw: unknown, train: TrainSet): TrainRunningState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Record<string, unknown>
  const at = s.at as Partial<TrackPosition> | null | undefined
  if (typeof at !== 'object' || at === null || typeof at.segId !== 'string' || typeof at.t !== 'number' || typeof at.forward !== 'boolean') return null
  if (!within(s.speed, 0, train.maxSpeed * 1.5) || !REVERSERS.includes(s.reverser) || !BRAKE_COMMANDS.includes(s.brakeCommand)) return null
  if (!within(s.notch, MIN_NOTCH, MAX_NOTCH) || !Number.isInteger(s.notch)) return null
  if (!within(s.brakePipe, 0, BRAKE_PIPE_RELEASED) || !within(s.brakeCylinder, 0, 10) || !within(s.brakeLag, 0, 60)) return null
  if (typeof s.emergencyBrake !== 'boolean' || !within(s.tractionEffort, 0, 1e7) || !within(s.electricBrakeEffort, 0, 1e7)) return null
  const state = { ...s, at: { segId: at.segId, t: at.t, forward: at.forward } } as unknown as TrainRunningState
  if (s.piloted !== true) delete state.piloted
  return state
}

export interface RestoredGame {
  /** The trains the automatic pilot held */
  piloted: string[]
  freeView: boolean
  /** How many trains got their state back */
  restored: number
}

/**
 * Give the trains back what they were doing. A train that is not where the game left it (the
 * project was changed since, or is another one) keeps the rest it was loaded at, and so does a
 * train whose saved state does not read. `raw` is whatever the storage held.
 */
export function applyGame(trains: readonly TrainSet[], raw: unknown): RestoredGame {
  const out: RestoredGame = { piloted: [], freeView: false, restored: 0 }
  if (typeof raw !== 'object' || raw === null || (raw as SavedGame).version !== 1) return out
  const saved = (raw as SavedGame).trains
  if (typeof saved !== 'object' || saved === null) return out
  for (const train of trains) {
    const lead = train.vehicles[0]
    const state = lead && Object.prototype.hasOwnProperty.call(saved, train.id) ? readState(saved[train.id], train) : null
    if (!state || !lead) continue
    if (state.at.segId !== lead.front.segId || state.at.forward !== lead.front.forward || Math.abs(state.at.t - lead.front.t) > SAME_PLACE) continue
    train.currentSpeed = state.speed
    train.reverser = state.reverser
    train.notch = state.notch
    train.brakeCommand = state.brakeCommand
    train.brakePipe = state.brakePipe
    train.brakeCylinder = state.brakeCylinder
    train.brakeLag = state.brakeLag
    train.emergencyBrake = state.emergencyBrake
    train.tractionEffort = state.tractionEffort
    train.electricBrakeEffort = state.electricBrakeEffort
    if (state.piloted) out.piloted.push(train.id)
    out.restored++
  }
  // The free view only stands with a pilot on a train: nobody would drive otherwise
  out.freeView = (raw as SavedGame).freeView === true && out.piloted.length > 0
  return out
}
