import type { BrakeSource, EditorStore } from '@application/state/editorStore'
import type { ConsoleCommand } from './consoleContract'

const clampThrottle = (value: number): -1 | 0 | 1 => (value > 0 ? 1 : value < 0 ? -1 : 0)

/** Enter driving mode on a train, or move to it when already driving */
function driveTrain(store: EditorStore, trainId: string): void {
  if (!store.trains.some((t) => t.id === trainId)) return
  if (!store.isPlayMode) {
    store.selectTrainById(trainId)
    store.togglePlayMode()
    return
  }
  if (trainId === store.selectedTrainId) return
  // The train left behind keeps its brake where it is: nobody holds its handle any more
  store.centreSelectedTrainBrake()
  store.selectTrainById(trainId)
}

/**
 * The single way from a driving console into the store, whether the console is on this screen or
 * on a phone. Every command but `selectTrain` is ignored outside driving mode, and none of them
 * edits the network. `source` tells the two holders of the brake handle apart (see
 * `EditorStore.setSelectedTrainBrakeCommand`): a phone that lets go, or falls silent, must not
 * take the handle out of the hand that holds it on the PC.
 */
export function applyConsoleCommand(store: EditorStore, command: ConsoleCommand, source: BrakeSource = 'local'): void {
  if (command.type === 'selectTrain') {
    driveTrain(store, command.trainId)
    return
  }
  if (!store.isPlayMode) return
  const train = store.selectedTrain

  switch (command.type) {
    case 'notchStep':
      // The legacy locomotive has a three-position throttle in place of the notches
      if (train) store.stepSelectedTrainNotch(command.step)
      else if (store.locomotive) store.setLocomotiveThrottle(clampThrottle(store.locomotiveThrottle + command.step))
      return
    case 'notchSet':
      if (!Number.isFinite(command.notch)) return
      // The store clamps to MIN_NOTCH … MAX_NOTCH
      if (train) store.setSelectedTrainNotch(Math.round(command.notch))
      else if (store.locomotive) store.setLocomotiveThrottle(clampThrottle(Math.round(command.notch)))
      return
    case 'brake':
      store.setSelectedTrainBrakeCommand(command.command, source)
      return
    case 'reverser':
      store.setSelectedTrainReverser(command.reverser)
      return
    case 'emergencyBrake':
      store.toggleSelectedTrainEmergencyBrake()
      return
    case 'steer':
      store.steerUpcomingTurnout(command.side)
      return
    case 'switchCab':
      // The legacy locomotive changes direction by changing cab
      if (train) store.switchSelectedTrainCab()
      else store.flipLocomotiveDirection()
      return
    case 'selectTrainByOffset': {
      const count = store.trains.length
      const index = store.trains.findIndex((t) => t.id === store.selectedTrainId)
      if (count < 2 || index < 0) return
      driveTrain(store, store.trains[(index + command.offset + count) % count].id)
      return
    }
    case 'releaseControls':
      store.togglePlayMode()
      return
    case 'rerail':
      store.rerailSelectedTrain()
      return
  }
}
