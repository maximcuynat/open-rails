// Shared by the example tests: open an example in a store and drive its train the way a player
// does, through the store calls the keyboard and the console make.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EditorStore } from '@application/state/editorStore'
import { resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'
import { positionOnSegment } from '@domain/models/locomotive'
import { resetIdCounter, segmentHeightAt } from '@domain/models/network'
import { MAX_NOTCH, MIN_NOTCH, type TrainSet } from '@domain/models/train'
import type { Point } from '@domain/models/types'

/** Simulation step of the drives, s: the longest one the editor's own loop takes */
const STEP = 0.1
/** Deceleration (m/s²) the driver plans his braking with: well within a full service application */
const PLANNED_BRAKING = 0.45

/** The project file of an example, read from the folder (the app fetches it by URL) */
export function readExample(id: string): SerializedProject {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./${id}.json`, import.meta.url)), 'utf8'))
}

/** A fresh editor with the example open, as File ▸ Exemples leaves it */
export function openExample(id: string): EditorStore {
  resetMemoryStorage()
  resetIdCounter()
  const store = new EditorStore()
  store.loadFromData(readExample(id))
  return store
}

/** Where the leading bogie of a train is, and how high (levels) */
export function headOf(store: EditorStore, train: TrainSet): Point & { level: number } {
  const lead = train.vehicles[0].front
  const pos = positionOnSegment(store.network, lead.segId, lead.t)!
  return { ...pos, level: segmentHeightAt(store.network, store.network.segments.get(lead.segId)!, lead.t) }
}

/** What went wrong during a drive: nothing may */
export interface DriveLog {
  /** Metres run by the driven train */
  distance: number
  /** Seconds of simulation */
  time: number
  faults: string[]
}

function noteFaults(store: EditorStore, log: DriveLog): void {
  for (const train of store.trains) {
    const fault = train.derailed
      ? 'derailed'
      : train.signalPassed
        ? 'passed a closed signal'
        : train.emergencyBrake
          ? 'emergency brake'
          : train.impactSpeed > 0
            ? 'ran into something'
            : null
    if (fault && !log.faults.includes(`${train.id}: ${fault}`)) log.faults.push(`${train.id}: ${fault}`)
  }
}

/**
 * One step of a careful driver on the selected train: reverser forward, brake released, traction
 * up to the speed limit, braking in time for the next lower limit, for a closed signal and for a
 * stop `stopIn` metres ahead when one is asked for.
 */
function driverStep(store: EditorStore, stopIn: number | null): void {
  const train = store.selectedTrain!
  const dynamics = store.selectedTrainDynamics!
  const signals = store.selectedTrainSignals
  const speed = train.currentSpeed
  const brakingFrom = (distance: number, to: number): number => Math.sqrt(to * to + 2 * PLANNED_BRAKING * Math.max(0, distance))

  let target = dynamics.speedLimit - 1
  const next = dynamics.nextSpeedLimit
  // The brakes take a few seconds to come on: the braking is planned from that much further back
  if (next) target = Math.min(target, brakingFrom(next.distance - 60 - speed * 5, next.speed / 3.6 - 1))
  let stop = stopIn
  if (signals?.closedSignal) stop = Math.min(stop ?? Infinity, signals.closedSignal.distance - 25)
  if (stop !== null) target = Math.min(target, brakingFrom(stop - 15, 0))

  if (train.reverser !== 'forward' && speed === 0) store.setSelectedTrainReverser('forward')
  if (target <= 0.3) {
    store.setSelectedTrainNotch(0)
    store.setSelectedTrainBrakeCommand('apply')
  } else if (speed > target + 0.3) {
    store.setSelectedTrainNotch(MIN_NOTCH)
    store.setSelectedTrainBrakeCommand(speed > target + 2 ? 'apply' : 'hold')
  } else if (speed < target - 1.5) {
    store.setSelectedTrainBrakeCommand('release')
    // Traction only once the brakes are off
    store.setSelectedTrainNotch(train.brakeCylinder > 0.05 ? 0 : MAX_NOTCH)
  } else {
    store.setSelectedTrainBrakeCommand('release')
    store.setSelectedTrainNotch(0)
  }
  store.tickAllTrains(STEP)
}

/**
 * Drive the selected train carefully until `done` says so, or `maxSeconds` of simulation have
 * passed. `stopIn` gives, at each step, the distance to a place the train must stop at (null: none).
 */
export function drive(
  store: EditorStore,
  done: (log: DriveLog) => boolean,
  maxSeconds: number,
  stopIn: () => number | null = () => null,
): DriveLog {
  const log: DriveLog = { distance: 0, time: 0, faults: [] }
  while (log.time < maxSeconds && !done(log)) {
    driverStep(store, stopIn())
    log.distance += store.selectedTrain!.currentSpeed * STEP
    log.time += STEP
    noteFaults(store, log)
  }
  return log
}

/** Drive the selected train flat out — brake released, full traction, nothing looked at — until `done` or `maxSeconds` */
export function driveFlatOut(store: EditorStore, done: () => boolean, maxSeconds: number): DriveLog {
  const log: DriveLog = { distance: 0, time: 0, faults: [] }
  store.setSelectedTrainReverser('forward')
  store.setSelectedTrainBrakeCommand('release')
  while (log.time < maxSeconds && !done()) {
    if (store.selectedTrain!.brakeCylinder <= 0.05) store.setSelectedTrainNotch(MAX_NOTCH)
    store.tickAllTrains(STEP)
    log.distance += store.selectedTrain!.currentSpeed * STEP
    log.time += STEP
    noteFaults(store, log)
  }
  return log
}

/** Turn the next points ahead of the selected train to `position` with the steering keys (← / →) */
export function steerPointsTo(store: EditorStore, junctionId: string, position: number): boolean {
  const junction = store.network.junctions.get(junctionId)!
  for (const side of ['left', 'right'] as const) {
    if (junction.active !== position) store.steerUpcomingTurnout(side)
  }
  return junction.active === position
}
