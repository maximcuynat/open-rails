import type { EditorStore } from '@application/state/editorStore'
import {
  MAX_NOTCH,
  MIN_NOTCH,
  canSwitchDrivingCab,
  isTrainStopped,
  trainTurnoutAhead,
  turnoutAhead,
  type TrainSet,
} from '@domain/models/train'
import {
  BRAKE_PIPE_FULL_SERVICE,
  BRAKE_PIPE_RELEASED,
  type TrainDynamics,
} from '@domain/models/trainDynamics'
import { DEFAULT_ROLLING_STOCK, ROLLING_STOCK } from '@domain/models/rollingStock'
import type { ConsoleBrake, ConsoleBrakeTone, ConsoleState, ConsoleTurnout, FleetEntry } from './consoleContract'

/** Pressure difference (bar) under which a gauge is read as being on its mark */
const PRESSURE_TOLERANCE = 0.05

/** State of the air brake in one word, from the pressures rather than from the handle */
export function brakeTone(
  train: Pick<TrainSet, 'emergencyBrake' | 'brakeCommand'>,
  dynamics: Pick<TrainDynamics, 'brakePipeBar' | 'brakeCylinderBar'>,
): ConsoleBrakeTone {
  if (train.emergencyBrake) return 'emergency'
  const pipeFull = dynamics.brakePipeBar >= BRAKE_PIPE_RELEASED - PRESSURE_TOLERANCE
  const cylindersEmpty = dynamics.brakeCylinderBar <= PRESSURE_TOLERANCE
  if (pipeFull && cylindersEmpty) return 'released'
  // The cylinders empty some seconds after the brake pipe is back to its pressure
  if (pipeFull || train.brakeCommand === 'release') return 'releasing'
  if (train.brakeCommand === 'apply' && dynamics.brakePipeBar > BRAKE_PIPE_FULL_SERVICE + PRESSURE_TOLERANCE) {
    return 'applying'
  }
  return 'applied'
}

function countVehicles(train: TrainSet): { locoCount: number; wagonCount: number } {
  const locoCount = train.vehicles.filter((v) => v.kind === 'loco').length
  return { locoCount, wagonCount: train.vehicles.length - locoCount }
}

/**
 * What a console shows of a train, from the train and what the physics computes for it.
 * `upcomingTurnout` comes from the track ahead, which the train alone does not know.
 */
export function trainConsoleState(
  train: TrainSet,
  dynamics: TrainDynamics,
  upcomingTurnout: ConsoleTurnout | null = null,
): ConsoleState {
  const stopped = isTrainStopped(train)
  const brake: ConsoleBrake = {
    command: train.brakeCommand,
    tone: brakeTone(train, dynamics),
    pipeBar: dynamics.brakePipeBar,
    cylinderBar: dynamics.brakeCylinderBar,
  }
  return {
    trainId: train.id,
    speed: train.currentSpeed,
    maxSpeed: train.maxSpeed,
    stopped,
    notch: train.notch,
    minNotch: MIN_NOTCH,
    maxNotch: MAX_NOTCH,
    // The electric brake under N, the traction otherwise
    handleEffort: train.notch < 0 ? dynamics.electricBrakeEffort : dynamics.tractionEffort,
    reverser: train.reverser,
    reverserLocked: !stopped || train.notch !== 0,
    emergencyBrake: train.emergencyBrake,
    emergencyReleasable: train.emergencyBrake && stopped,
    brake,
    acceleration: dynamics.acceleration,
    gradientPermille: dynamics.gradientPermille,
    // Plain JSON: an infinite distance (the brake cannot hold the train) travels as null
    stoppingDistance: Number.isFinite(dynamics.stoppingDistance) ? dynamics.stoppingDistance : null,
    ...countVehicles(train),
    upcomingTurnout,
    canSwitchCab: canSwitchDrivingCab(train),
  }
}

/** The reduced state of the legacy single locomotive: a speed and a three-position throttle, no air brake */
function legacyConsoleState(store: EditorStore, upcomingTurnout: ConsoleTurnout | null): ConsoleState {
  const speed = store.locomotiveCurrentSpeed
  const throttle = store.locomotiveThrottle
  const moving = speed > 0
  let acceleration = 0
  if (throttle === 1 && speed < store.locomotiveMaxSpeed) acceleration = store.locomotiveAcceleration
  else if (throttle === -1 && moving) acceleration = -store.locomotiveBraking
  else if (throttle === 0 && moving) acceleration = -store.locomotiveCoastingDecel
  return {
    trainId: null,
    speed,
    maxSpeed: store.locomotiveMaxSpeed,
    stopped: !moving,
    notch: throttle,
    minNotch: -1,
    maxNotch: 1,
    handleEffort: Math.abs(throttle),
    reverser: 'forward',
    reverserLocked: true,
    emergencyBrake: false,
    emergencyReleasable: false,
    brake: null,
    acceleration,
    gradientPermille: 0,
    stoppingDistance: (speed * speed) / (2 * store.locomotiveBraking),
    locoCount: 1,
    wagonCount: store.locomotive?.wagonCount ?? 0,
    upcomingTurnout,
    // It changes direction with its own « Inverser » control, at any speed
    canSwitchCab: false,
    legacyThrottle: throttle,
  }
}

/** The state of the console for whatever is driven right now; `null` outside driving mode */
export function buildConsoleState(store: EditorStore): ConsoleState | null {
  if (!store.isPlayMode) return null
  const train = store.selectedTrain
  const dynamics = store.selectedTrainDynamics
  if (train && dynamics) {
    return trainConsoleState(train, dynamics, trainTurnoutAhead(store.network, train, store.trains))
  }
  const loco = store.locomotive
  // Same end and direction as the steering of the legacy locomotive
  return loco ? legacyConsoleState(store, turnoutAhead(store.network, loco.front, loco.direction, store.trains)) : null
}

/** Every train of the layout, in fleet order, for a list to pick from */
export function buildFleet(store: EditorStore): FleetEntry[] {
  return store.trains.map((train, index) => ({
    id: train.id,
    rank: index + 1,
    model: ROLLING_STOCK[train.vehicles[0]?.model ?? DEFAULT_ROLLING_STOCK].label,
    ...countVehicles(train),
    speed: train.currentSpeed,
    driven: store.isPlayMode && train.id === store.selectedTrainId,
  }))
}
