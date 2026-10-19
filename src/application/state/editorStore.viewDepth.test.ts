import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

/** A ground track (x 0 → 400) that goes on into a tunnel (x 400 → 1400, level −1), and a train on the tunnel */
function drivingInTunnel(): { store: EditorStore; ground: string; tunnel: string } {
  const store = new EditorStore()
  const net = store.network
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 400, y: 0 })
  const c = addNode(net, { x: 600, y: 0 }, -1)
  const d = addNode(net, { x: 1400, y: 0 }, -1)
  const ground = addSegment(net, a.id, b.id)!.id
  addSegment(net, b.id, c.id)
  const tunnel = addSegment(net, c.id, d.id)!.id
  store.markDirty()
  store.notify()
  expect(store.placeTrainItem({ x: 1000, y: 0 })).toBe(true)
  store.togglePlayMode()
  expect(store.isPlayMode).toBe(true)
  return { store, ground, tunnel }
}

describe('the view at the surface or below ground', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('starts at the surface and is switched by hand', () => {
    const store = new EditorStore()
    expect(store.viewDepth).toBe('surface')
    const version = store.getVersion()
    store.toggleViewDepth()
    expect(store.viewDepth).toBe('underground')
    expect(store.getVersion()).toBeGreaterThan(version)
    store.setViewDepth('surface')
    expect(store.viewDepth).toBe('surface')
  })

  it('goes below ground with the train of this screen, once per crossing of the ground', () => {
    const { store, ground } = drivingInTunnel()
    const train = store.trains[0]
    store.tickAllTrains(0.05)
    // The train is taken in a tunnel: the view goes there
    expect(store.viewDepth).toBe('underground')
    // A side chosen by hand meanwhile stays as long as the train stays where it is
    store.setViewDepth('surface')
    store.tickAllTrains(0.05)
    expect(store.viewDepth).toBe('surface')
    store.setViewDepth('underground')
    // Out of the tunnel: back to the surface
    for (const veh of train.vehicles) {
      veh.front = { ...veh.front, segId: ground, t: 0.6 }
      veh.rear = { ...veh.rear, segId: ground, t: 0.4 }
    }
    store.tickAllTrains(0.05)
    expect(store.viewDepth).toBe('surface')
  })
})
