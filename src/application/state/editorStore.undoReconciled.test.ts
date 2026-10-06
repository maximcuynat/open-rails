import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { isNetworkReconciled } from '@domain/geometry/reconcile'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

/** Two rails across each other, laid without the pass that gives them a node where they cross */
function layCross(store: EditorStore, x: number): void {
  const a = addNode(store.network, { x, y: -50 })
  const b = addNode(store.network, { x, y: 50 })
  const c = addNode(store.network, { x: x - 50, y: 0 })
  const d = addNode(store.network, { x: x + 50, y: 0 })
  addSegment(store.network, a.id, b.id)
  addSegment(store.network, c.id, d.id)
}

const track = (store: EditorStore) => {
  const project = store.exportProject()
  return { nodes: project.nodes, segments: project.segments }
}

describe('undo of a step taken from a reconciled track', () => {
  it('puts the track back as it was, and the next edit is still mended', () => {
    const store = new EditorStore()
    layCross(store, 0)
    store.reconcileNetwork()
    store.markDirty()
    const first = track(store)
    expect(first.segments).toHaveLength(4)

    layCross(store, 300)
    store.reconcileNetwork()
    store.markDirty()
    expect(track(store).segments).toHaveLength(8)

    store.undo()
    expect(track(store)).toEqual(first)
    const tolerance = store.getPlacementThresholds().reconcileTolerance
    expect(isNetworkReconciled(store.network, tolerance)).toBe(true)

    // A rail laid across the track put back: the pass that follows cuts both
    const e = addNode(store.network, { x: 25, y: -40 })
    const f = addNode(store.network, { x: 25, y: 40 })
    addSegment(store.network, e.id, f.id)
    expect(store.reconcileNetwork().splitCount).toBe(2)

    store.redo()
    expect(track(store).segments).toHaveLength(8)
  })

  it('a step taken from a track that was not reconciled is still mended when it is put back', () => {
    const store = new EditorStore()
    layCross(store, 0)
    store.markDirty()
    expect(track(store).segments).toHaveLength(2)

    layCross(store, 300)
    store.markDirty()
    store.undo()
    // As before: reading the step back gives the crossing its node
    expect(track(store).segments).toHaveLength(4)
  })
})
