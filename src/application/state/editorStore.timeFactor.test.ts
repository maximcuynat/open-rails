import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

/**
 * A store with a train on a long straight track, the controls taken, the brakes released (the
 * cylinder takes a few seconds to empty, in tenths of a second) and the handle at full power
 */
function driving(): EditorStore {
  const store = new EditorStore()
  const net = store.network
  let previous = addNode(net, { x: 0, y: 0 })
  for (let x = 500; x <= 20_000; x += 500) {
    const next = addNode(net, { x, y: 0 })
    addSegment(net, previous.id, next.id)
    previous = next
  }
  store.markDirty()
  store.notify()
  expect(store.placeTrainItem({ x: 1000, y: 0 })).toBe(true)
  store.togglePlayMode()
  store.setSelectedTrainReverser('forward')
  store.setSelectedTrainBrakeCommand('release')
  for (let i = 0; i < 200 && store.selectedTrain!.brakeCylinder > 0.05; i++) store.tickAllTrains(0.1)
  expect(store.selectedTrain!.brakeCylinder).toBeLessThanOrEqual(0.05)
  for (let i = 0; i < 12; i++) store.stepSelectedTrainNotch(1)
  return store
}

describe('the time factor', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('is one of ×1, ×2, ×5, ×10, cycles, and follows the user to the next store', () => {
    const store = new EditorStore()
    expect(store.timeFactor).toBe(1)
    store.setTimeFactor(3)
    expect(store.timeFactor).toBe(1)
    store.cycleTimeFactor()
    expect(store.timeFactor).toBe(2)
    store.setTimeFactor(10)
    expect(store.timeFactor).toBe(10)
    store.cycleTimeFactor()
    expect(store.timeFactor).toBe(1)
    store.setTimeFactor(5)
    expect(new EditorStore().timeFactor).toBe(5)
  })

  it('repeats the step of a frame as many times as the factor says: ×10 for a tenth is ten tenths', () => {
    const fast = driving()
    const slow = driving()
    fast.setTimeFactor(10)
    fast.simulateFrame(0.1)
    for (let i = 0; i < 10; i++) slow.simulateFrame(0.1)
    const front = (store: EditorStore) => store.trains[0].vehicles[0].front
    expect(fast.trains[0].currentSpeed).toBeGreaterThan(0)
    expect(fast.trains[0].currentSpeed).toBeCloseTo(slow.trains[0].currentSpeed, 6)
    expect(front(fast).segId).toBe(front(slow).segId)
    expect(front(fast).t).toBeCloseTo(front(slow).t, 6)
  })
})
