import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { createLocomotive } from '@domain/models/locomotive'
import { MAX_NOTCH, MIN_NOTCH } from '@domain/models/train'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { applyConsoleCommand } from './consoleCommands'
import { CONSOLE_COMMAND_TYPES } from './consoleContract'

function makeStore(trainCount = 1): EditorStore {
  const store = new EditorStore()
  const n1 = addNode(store.network, { x: 0, y: 0 })
  const n2 = addNode(store.network, { x: 4000, y: 0 })
  addSegment(store.network, n1.id, n2.id)
  for (let i = 0; i < trainCount; i++) expect(store.placeTrainLoco({ x: 500 + 1000 * i, y: 0 })).toBe(true)
  return store
}

function makeDrivingStore(trainCount = 1): EditorStore {
  const store = makeStore(trainCount)
  store.selectTrainById(store.trains[0].id)
  store.togglePlayMode()
  return store
}

function makeLegacyStore(): EditorStore {
  const store = makeStore(0)
  const segId = [...store.network.segments.keys()][0]
  store.locomotive = createLocomotive(store.network, segId, 0.5)
  store.togglePlayMode()
  return store
}

describe('applyConsoleCommand', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  it('covers every command of the contract', () => {
    // One `describe`/`it` per command type below: this list is what they are checked against
    expect([...CONSOLE_COMMAND_TYPES].sort()).toEqual([
      'brake', 'emergencyBrake', 'notchSet', 'notchStep', 'releaseControls', 'rerail', 'reverser',
      'selectTrain', 'selectTrainByOffset', 'steer', 'switchCab',
    ])
  })

  it('notchStep moves the handle one notch, down into the electric brake', () => {
    const store = makeDrivingStore()
    const train = store.selectedTrain!
    applyConsoleCommand(store, { type: 'notchStep', step: 1 })
    applyConsoleCommand(store, { type: 'notchStep', step: 1 })
    expect(train.notch).toBe(2)
    for (let i = 0; i < 4; i++) applyConsoleCommand(store, { type: 'notchStep', step: -1 })
    expect(train.notch).toBe(-2)
  })

  it('notchSet puts the handle on a notch, clamped from B5 to P5', () => {
    const store = makeDrivingStore()
    const train = store.selectedTrain!
    applyConsoleCommand(store, { type: 'notchSet', notch: 4 })
    expect(train.notch).toBe(4)
    applyConsoleCommand(store, { type: 'notchSet', notch: -3 })
    expect(train.notch).toBe(-3)
    applyConsoleCommand(store, { type: 'notchSet', notch: 99 })
    expect(train.notch).toBe(MAX_NOTCH)
    applyConsoleCommand(store, { type: 'notchSet', notch: -99 })
    expect(train.notch).toBe(MIN_NOTCH)
    applyConsoleCommand(store, { type: 'notchSet', notch: 2.4 })
    expect(train.notch).toBe(2)
    // Not a number: ignored
    applyConsoleCommand(store, { type: 'notchSet', notch: NaN })
    expect(train.notch).toBe(2)
  })

  it('brake holds the handle on apply or release until a hold', () => {
    const store = makeDrivingStore()
    const train = store.selectedTrain!
    applyConsoleCommand(store, { type: 'brake', command: 'release' })
    expect(train.brakeCommand).toBe('release')
    applyConsoleCommand(store, { type: 'brake', command: 'apply' })
    expect(train.brakeCommand).toBe('apply')
    applyConsoleCommand(store, { type: 'brake', command: 'hold' })
    expect(train.brakeCommand).toBe('hold')
  })

  it('reverser sets the reverser, which the domain refuses in traction', () => {
    const store = makeDrivingStore()
    const train = store.selectedTrain!
    applyConsoleCommand(store, { type: 'reverser', reverser: 'forward' })
    expect(train.reverser).toBe('forward')
    applyConsoleCommand(store, { type: 'notchSet', notch: 1 })
    applyConsoleCommand(store, { type: 'reverser', reverser: 'reverse' })
    expect(train.reverser).toBe('forward')
  })

  it('two sides hold the one brake handle: one letting go leaves it to the other', () => {
    const store = makeDrivingStore()
    const train = store.selectedTrain!
    const brake = (command: 'apply' | 'hold' | 'release', source: 'local' | 'remote') =>
      applyConsoleCommand(store, { type: 'brake', command }, source)

    brake('apply', 'local')
    brake('apply', 'remote')
    brake('hold', 'remote')
    expect(train.brakeCommand).toBe('apply')
    expect(store.heldBrakeCommand('local')).toBe('apply')
    expect(store.heldBrakeCommand('remote')).toBe('hold')
    brake('hold', 'local')
    expect(train.brakeCommand).toBe('hold')

    // The last one to push the handle wins; letting go gives it back to the other
    brake('apply', 'local')
    brake('release', 'remote')
    expect(train.brakeCommand).toBe('release')
    brake('hold', 'remote')
    expect(train.brakeCommand).toBe('apply')
    brake('hold', 'local')
    expect(train.brakeCommand).toBe('hold')

    // Leaving driving mode forgets what was held
    brake('apply', 'remote')
    store.togglePlayMode()
    store.togglePlayMode()
    expect(store.heldBrakeCommand('remote')).toBe('hold')
    brake('release', 'local')
    brake('hold', 'local')
    expect(train.brakeCommand).toBe('hold')
  })

  it('emergencyBrake latches the emergency brake, then resets it at rest', () => {
    const store = makeDrivingStore()
    const train = store.selectedTrain!
    applyConsoleCommand(store, { type: 'emergencyBrake' })
    expect(train.emergencyBrake).toBe(true)
    // Stopped: the same command resets it
    applyConsoleCommand(store, { type: 'emergencyBrake' })
    expect(train.emergencyBrake).toBe(false)

    applyConsoleCommand(store, { type: 'emergencyBrake' })
    train.currentSpeed = 12
    applyConsoleCommand(store, { type: 'emergencyBrake' })
    expect(train.emergencyBrake).toBe(true)
  })

  it('steer asks for the next turnout to be thrown to that side', () => {
    const store = makeDrivingStore()
    const steer = vi.fn()
    store.steerUpcomingTurnout = steer
    applyConsoleCommand(store, { type: 'steer', side: 'left' })
    applyConsoleCommand(store, { type: 'steer', side: 'right' })
    expect(steer.mock.calls).toEqual([['left'], ['right']])
  })

  it('switchCab asks for the cab at the other end of the train', () => {
    const store = makeDrivingStore()
    const lead = store.selectedTrain!.vehicles[0].id
    // A single power car: there is no other cab, the train stays as it is
    applyConsoleCommand(store, { type: 'switchCab' })
    expect(store.selectedTrain!.vehicles[0].id).toBe(lead)

    const switchCab = vi.fn(() => true)
    store.switchSelectedTrainCab = switchCab
    applyConsoleCommand(store, { type: 'switchCab' })
    expect(switchCab).toHaveBeenCalledTimes(1)
  })

  it('selectTrain enters driving mode on that train', () => {
    const store = makeStore(2)
    const [first, second] = store.trains
    expect(store.isPlayMode).toBe(false)

    applyConsoleCommand(store, { type: 'selectTrain', trainId: second.id })
    expect(store.isPlayMode).toBe(true)
    expect(store.selectedTrainId).toBe(second.id)

    // Already driving: it changes train, and nobody holds the brake handle of the one left
    applyConsoleCommand(store, { type: 'brake', command: 'release' })
    applyConsoleCommand(store, { type: 'selectTrain', trainId: first.id })
    expect(store.isPlayMode).toBe(true)
    expect(store.selectedTrainId).toBe(first.id)
    expect(second.brakeCommand).toBe('hold')

    // An unknown train changes nothing
    applyConsoleCommand(store, { type: 'selectTrain', trainId: 'nope' })
    expect(store.selectedTrainId).toBe(first.id)
    expect(store.isPlayMode).toBe(true)
  })

  it('selectTrain on an unknown train does not enter driving mode', () => {
    const store = makeStore(1)
    applyConsoleCommand(store, { type: 'selectTrain', trainId: 'nope' })
    expect(store.isPlayMode).toBe(false)
  })

  it('selectTrainByOffset goes round the fleet both ways', () => {
    const store = makeDrivingStore(3)
    const ids = store.trains.map((t) => t.id)
    applyConsoleCommand(store, { type: 'selectTrainByOffset', offset: 1 })
    expect(store.selectedTrainId).toBe(ids[1])
    applyConsoleCommand(store, { type: 'selectTrainByOffset', offset: -1 })
    applyConsoleCommand(store, { type: 'selectTrainByOffset', offset: -1 })
    expect(store.selectedTrainId).toBe(ids[2])
    applyConsoleCommand(store, { type: 'selectTrainByOffset', offset: 1 })
    expect(store.selectedTrainId).toBe(ids[0])
  })

  it('rerail asks the store to put the driven train back on the track', () => {
    const store = makeDrivingStore()
    const rerail = vi.spyOn(store, 'rerailSelectedTrain')
    applyConsoleCommand(store, { type: 'rerail' })
    expect(rerail).toHaveBeenCalledTimes(1)
    // Like every driving command, it does nothing outside driving mode
    store.togglePlayMode()
    applyConsoleCommand(store, { type: 'rerail' })
    expect(rerail).toHaveBeenCalledTimes(1)
  })

  it('releaseControls leaves driving mode', () => {
    const store = makeDrivingStore()
    applyConsoleCommand(store, { type: 'releaseControls' })
    expect(store.isPlayMode).toBe(false)
    // Not driving: it does not start driving again
    applyConsoleCommand(store, { type: 'releaseControls' })
    expect(store.isPlayMode).toBe(false)
  })

  it('ignores driving commands outside driving mode', () => {
    const store = makeStore(1)
    store.selectTrainById(store.trains[0].id)
    const train = store.selectedTrain!
    const before = JSON.stringify(train)
    applyConsoleCommand(store, { type: 'notchStep', step: 1 })
    applyConsoleCommand(store, { type: 'notchSet', notch: 3 })
    applyConsoleCommand(store, { type: 'brake', command: 'release' })
    applyConsoleCommand(store, { type: 'reverser', reverser: 'forward' })
    applyConsoleCommand(store, { type: 'emergencyBrake' })
    applyConsoleCommand(store, { type: 'selectTrainByOffset', offset: 1 })
    expect(JSON.stringify(train)).toBe(before)
    expect(store.isPlayMode).toBe(false)
  })

  describe('legacy locomotive', () => {
    it('drives its three-position throttle with the notch commands', () => {
      const store = makeLegacyStore()
      applyConsoleCommand(store, { type: 'notchStep', step: 1 })
      expect(store.locomotiveThrottle).toBe(1)
      applyConsoleCommand(store, { type: 'notchStep', step: 1 })
      expect(store.locomotiveThrottle).toBe(1)
      applyConsoleCommand(store, { type: 'notchStep', step: -1 })
      expect(store.locomotiveThrottle).toBe(0)
      applyConsoleCommand(store, { type: 'notchSet', notch: -5 })
      expect(store.locomotiveThrottle).toBe(-1)
      applyConsoleCommand(store, { type: 'notchSet', notch: 0 })
      expect(store.locomotiveThrottle).toBe(0)
    })

    it('changes direction with switchCab and ignores what it does not have', () => {
      const store = makeLegacyStore()
      const front = { ...store.locomotive!.front }
      applyConsoleCommand(store, { type: 'switchCab' })
      expect(store.locomotive!.front).not.toEqual(front)

      applyConsoleCommand(store, { type: 'brake', command: 'apply' })
      applyConsoleCommand(store, { type: 'reverser', reverser: 'reverse' })
      applyConsoleCommand(store, { type: 'emergencyBrake' })
      applyConsoleCommand(store, { type: 'selectTrainByOffset', offset: 1 })
      expect(store.isPlayMode).toBe(true)
      applyConsoleCommand(store, { type: 'releaseControls' })
      expect(store.isPlayMode).toBe(false)
    })
  })
})
