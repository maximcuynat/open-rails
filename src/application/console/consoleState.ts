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
import {
  ON_SIGHT_SPEED,
  isNodeReserved,
  signalAspect,
  trainSignalView,
  type TrainSignalView,
} from '@domain/models/signalling'
import type { SignallingLevel } from '@domain/models/signals'
import { cabLineSpeed, cabSignal, isCabSignalled, type CabSignal } from '@domain/models/cabSignalling'
import type { Network } from '@domain/models/types'
import type {
  ConsoleBrake,
  ConsoleBrakeTone,
  ConsoleCabSignal,
  ConsoleGuidance,
  ConsoleSignal,
  ConsoleSignals,
  ConsoleState,
  ConsoleTurnout,
  FleetEntry,
} from './consoleContract'

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

/** The limits and the curve as the console shows them: speeds in km/h, plain JSON */
export function trainGuidance(
  train: Pick<TrainSet, 'derailed'>,
  dynamics: Pick<TrainDynamics, 'speedLimit' | 'nextSpeedLimit' | 'curveState'>,
): ConsoleGuidance | undefined {
  const speedLimit = Math.round(dynamics.speedLimit * 3.6)
  if (!Number.isFinite(speedLimit)) return undefined
  const next = dynamics.nextSpeedLimit
  return {
    speedLimit,
    nextLimit: next && Number.isFinite(next.speed) && Number.isFinite(next.distance)
      ? { speed: next.speed, distance: Math.max(0, next.distance) }
      : null,
    curve: dynamics.curveState,
    derailed: train.derailed ? { speed: train.derailed.speed, limit: train.derailed.limit } : null,
  }
}

/** The cab display as the console shows it: plain JSON, whole km/h */
export function cabConsoleSignal(cab: CabSignal): ConsoleCabSignal {
  return {
    kind: cab.indication.kind,
    speed: Math.round(cab.indication.speed),
    flashing: cab.indication.flashing,
    markerDistance: cab.marker ? Math.max(0, cab.marker.distance) : null,
  }
}

/**
 * What the signals say to the driver, as the console shows it: each signal read by the signalling
 * level of the project (`signalAspect`). Undefined on a network without signal: the console then
 * shows nothing of the signalling at all.
 */
export function trainSignals(
  net: Network,
  view: TrainSignalView,
  level: SignallingLevel,
  train: Pick<TrainSet, 'signalPassed' | 'overspeed'>,
  cab: ConsoleCabSignal | null = null,
): ConsoleSignals | undefined {
  if (net.signals.size === 0) return undefined
  const ahead = view.nextSignal
  const signal = ahead ? net.signals.get(ahead.id) : undefined
  let next: ConsoleSignal | null = null
  if (ahead && signal) {
    const aspect = signalAspect(signal, ahead.state, level, ahead)
    next = {
      distance: Math.max(0, ahead.distance),
      color: aspect.color,
      indication: aspect.indication,
      plate: aspect.plate,
      lit: aspect.lit,
      label: aspect.label,
    }
    // Only there when lit: the state of a signal that shows neither is what it always was
    if (aspect.slowdown) next.slowdown = aspect.slowdown
    if (aspect.reminder) next.reminder = aspect.reminder
  }
  const closed = view.closedSignal
  const signals: ConsoleSignals = {
    level,
    next,
    closedDistance: closed && closed.id !== ahead?.id ? Math.max(0, closed.distance) : null,
    brakeAlert: view.brakeAlert,
    waiting: view.waitingAt !== null,
    // The red of the cab is a running on sight too
    onSight: view.onSight || cab?.kind === 'sight',
    onSightSpeed: ON_SIGHT_SPEED,
    passed: train.signalPassed ? { braked: train.signalPassed.braked } : null,
    cab,
  }
  if (train.overspeed) signals.overspeed = { braked: train.overspeed.braked }
  return signals
}

/**
 * What a console shows of a train, from the train and what the physics computes for it.
 * `upcomingTurnout` comes from the track ahead, which the train alone does not know, and `signals`
 * from the signalling (`trainSignals`).
 */
export function trainConsoleState(
  train: TrainSet,
  dynamics: TrainDynamics,
  upcomingTurnout: ConsoleTurnout | null = null,
  signals?: ConsoleSignals,
): ConsoleState {
  const stopped = isTrainStopped(train)
  const brake: ConsoleBrake = {
    command: train.brakeCommand,
    tone: brakeTone(train, dynamics),
    pipeBar: dynamics.brakePipeBar,
    cylinderBar: dynamics.brakeCylinderBar,
  }
  const state: ConsoleState = {
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
    guidance: trainGuidance(train, dynamics),
  }
  // No key at all without signalling: the state of a network without signal is what it always was
  if (signals) state.signals = signals
  return state
}

/**
 * The signalling of the driven train, read from the store after the simulation step. The cab
 * display is read from what the engine counted for the train and from the limit the physics
 * already worked out: nothing is walked here.
 */
function drivenTrainSignals(store: EditorStore, train: TrainSet, dynamics: TrainDynamics): ConsoleSignals | undefined {
  const net = store.network
  if (net.signals.size === 0) return undefined
  const view = trainSignalView(store.signalling, train.id, dynamics.stoppingDistance)
  const line = store.lineSettings
  let cab: ConsoleCabSignal | null = null
  if (isCabSignalled(store.signallingLevel, line)) {
    const read = cabSignal(store.signalling, train.id, view, Math.round(dynamics.speedLimit * 3.6), cabLineSpeed(line, train.maxSpeed))
    if (read) cab = cabConsoleSignal(read)
  }
  return trainSignals(net, view, store.signallingLevel, train, cab)
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
    // Points held for another train are locked too; the driver may still set those held for his own
    const heldForAnother = (junction: { nodeId: string }): boolean => isNodeReserved(store.signalling, junction.nodeId, train.id)
    return trainConsoleState(
      train,
      dynamics,
      trainTurnoutAhead(store.network, train, store.trains, heldForAnother),
      drivenTrainSignals(store, train, dynamics),
    )
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
