import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './store'
import { addNode, addSegment, resetIdCounter } from '../core/network'
import { resetMemoryStorage } from '../core/persistence'

describe('EditorStore persistence', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
  })

  it('restores placed rails on store re-instantiation (simulating page reload)', () => {
    // 1. Initial page visit: user places rails
    const store1 = new EditorStore()
    expect(store1.network.nodes.size).toBe(0)

    const n1 = addNode(store1.network, { x: 0, y: 0 })
    const n2 = addNode(store1.network, { x: 246, y: 0 })
    addSegment(store1.network, n1.id, n2.id)
    store1.setProjectName('Mon Circuit')
    store1.markDirty()

    // 2. User reloads the page: a new EditorStore is created
    const store2 = new EditorStore()
    expect(store2.projectName).toBe('Mon Circuit')
    expect(store2.network.nodes.size).toBe(2)
    expect(store2.network.segments.size).toBe(1)

    // User can continue placing rails without ID conflict
    const n3 = addNode(store2.network, { x: 492, y: 0 })
    expect(n3.id).not.toBe(n1.id)
    expect(n3.id).not.toBe(n2.id)
    const seg2 = addSegment(store2.network, n2.id, n3.id)
    expect(seg2).not.toBeNull()
    store2.markDirty()

    // 3. User reloads again: both segments and 3 nodes are still there
    const store3 = new EditorStore()
    expect(store3.network.nodes.size).toBe(3)
    expect(store3.network.segments.size).toBe(2)
  })

  it('clears persisted state when starting a new project', () => {
    const store1 = new EditorStore()
    const n1 = addNode(store1.network, { x: 10, y: 10 })
    const n2 = addNode(store1.network, { x: 200, y: 10 })
    addSegment(store1.network, n1.id, n2.id)
    store1.markDirty()

    // User clicks "New"
    store1.newProject()
    expect(store1.network.nodes.size).toBe(0)
    expect(store1.network.segments.size).toBe(0)

    // After reload, should remain empty
    const store2 = new EditorStore()
    expect(store2.network.nodes.size).toBe(0)
    expect(store2.network.segments.size).toBe(0)
  })

  it('persists camera position on save', () => {
    const store1 = new EditorStore()
    store1.camera.x = 150
    store1.camera.y = -80
    store1.camera.scale = 5
    addNode(store1.network, { x: 150, y: -80 })
    store1.markDirty()

    const store2 = new EditorStore()
    expect(store2.camera.x).toBe(150)
    expect(store2.camera.y).toBe(-80)
    expect(store2.camera.scale).toBe(5)
  })
})
