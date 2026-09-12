import { beforeEach, describe, expect, it } from 'vitest'
import {
  createNetwork,
  addNode,
  addSegment,
  addCurveSegment,
  resetIdCounter,
} from './network'
import { placeTurnout, toggleJunction } from './junction'
import {
  serializeNetwork,
  deserializeNetwork,
  saveNetworkToStorage,
  loadNetworkFromStorage,
  clearNetworkStorage,
  resetMemoryStorage,
  STORAGE_KEY,
} from './persistence'
import { createCamera } from '../render/camera'

describe('persistence module', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
  })

  it('serializes and deserializes an empty network', () => {
    const net = createNetwork()
    const serialized = serializeNetwork(net, 'Empty Project')
    expect(serialized.version).toBe(1)
    expect(serialized.name).toBe('Empty Project')
    expect(serialized.nodes).toHaveLength(0)
    expect(serialized.segments).toHaveLength(0)

    const restored = deserializeNetwork(serialized)
    expect(restored.projectName).toBe('Empty Project')
    expect(restored.network.nodes.size).toBe(0)
    expect(restored.network.segments.size).toBe(0)
  })

  it('serializes and restores straight and curved segments with camera', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const n3 = addNode(net, { x: 150, y: 50 })

    addSegment(net, n1.id, n2.id)
    addCurveSegment(net, n2.id, n3.id, { x: 130, y: 20 })

    const cam = createCamera(50, 25, 4)
    const serialized = serializeNetwork(net, 'Test Layout', cam)

    expect(serialized.nodes).toHaveLength(3)
    expect(serialized.segments).toHaveLength(2)
    expect(serialized.camera).toEqual({ x: 50, y: 25, scale: 4 })

    const restored = deserializeNetwork(serialized)
    expect(restored.network.nodes.size).toBe(3)
    expect(restored.network.segments.size).toBe(2)
    expect(restored.camera).toEqual({ x: 50, y: 25, scale: 4 })

    // Check adjacency reconstruction
    expect(restored.network.adjacency.get(n2.id)).toHaveLength(2)

    // Check curve via preservation
    const curveSeg = [...restored.network.segments.values()].find((s) => s.kind === 'curve')
    expect(curveSeg?.via).toEqual({ x: 130, y: 20 })
  })

  it('preserves turnout junction state (activeBranch)', () => {
    const net = createNetwork()
    const turnout = placeTurnout(net, {
      startPos: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      frogNumber: 6,
      hand: 'left',
    })

    // Switch the turnout to diverging
    toggleJunction(turnout.junction)
    expect(turnout.junction.activeBranch).toBe('diverging')

    const serialized = serializeNetwork(net, 'Turnout Project')
    const restored = deserializeNetwork(serialized)

    expect(restored.network.junctions.size).toBe(1)
    const restoredJunc = [...restored.network.junctions.values()][0]
    expect(restoredJunc.activeBranch).toBe('diverging')
    expect(restoredJunc.hand).toBe('left')
  })

  it('synchronizes idCounter after restore to prevent collisions', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    addSegment(net, n1.id, n2.id)

    const serialized = serializeNetwork(net)

    // Reset counter to 0 as if page just reloaded
    resetIdCounter(0)

    const restored = deserializeNetwork(serialized)
    // Next node added should have an ID strictly greater than existing nodes
    const nNew = addNode(restored.network, { x: 200, y: 0 })
    expect(restored.network.nodes.has(nNew.id)).toBe(true)
    expect(nNew.id).not.toBe(n1.id)
    expect(nNew.id).not.toBe(n2.id)
  })

  it('saves to and loads from localStorage correctly', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 10, y: 20 })
    const n2 = addNode(net, { x: 200, y: 20 })
    addSegment(net, n1.id, n2.id)

    const cam = createCamera(100, 20, 2.5)
    const saved = saveNetworkToStorage(net, 'My Train Layout', cam)
    expect(saved).toBe(true)

    const loaded = loadNetworkFromStorage()
    expect(loaded).not.toBeNull()
    expect(loaded?.projectName).toBe('My Train Layout')
    expect(loaded?.network.nodes.size).toBe(2)
    expect(loaded?.network.segments.size).toBe(1)
    expect(loaded?.camera?.scale).toBe(2.5)
  })

  it('clears storage properly', () => {
    const net = createNetwork()
    addNode(net, { x: 0, y: 0 })
    saveNetworkToStorage(net)
    expect(loadNetworkFromStorage()).not.toBeNull()

    clearNetworkStorage()
    expect(loadNetworkFromStorage()).toBeNull()
  })

  it('handles invalid or corrupted data in storage gracefully', () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, 'corrupted{json')
      expect(loadNetworkFromStorage()).toBeNull()

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes: 'not an array' }))
      const loaded = loadNetworkFromStorage()
      expect(loaded?.network.nodes.size).toBe(0)
    }
  })
})
