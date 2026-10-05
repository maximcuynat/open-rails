import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, MAX_LEVEL, MIN_LEVEL, nodeLevels, resetIdCounter, segmentLevel } from '@domain/models/network'
import type { Network, Point } from '@domain/models/types'
import { detectCrossings } from '@domain/models/crossing'
import { positionOnSegment } from '@domain/models/locomotive'
import { loadNetworkFromStorage, resetMemoryStorage } from '@infrastructure/persistence/persistence'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

/** Segments of the track running along y (north-south), whatever they have been cut into */
const nsRails = (net: Network) =>
  [...net.segments.values()].filter((seg) => {
    const a = net.nodes.get(seg.from)!.pos
    const b = net.nodes.get(seg.to)!.pos
    return Math.abs(a.x - b.x) < 1e-6
  })

const nodesAtOrigin = (net: Network) => [...net.nodes.values()].filter((n) => Math.hypot(n.pos.x, n.pos.y) < 1e-6)

/** A store holding a committed diamond: two straights crossing at the origin, reconciled */
function storeWithDiamond() {
  const store = new EditorStore()
  const net = store.network
  const w = addNode(net, { x: -100, y: 0 })
  const e = addNode(net, { x: 100, y: 0 })
  const s = addNode(net, { x: 0, y: -100 })
  const n = addNode(net, { x: 0, y: 100 })
  addSegment(net, w.id, e.id)
  addSegment(net, s.id, n.id)
  store.reconcileNetwork()
  store.markDirty()
  return store
}

/** Number of recorded history snapshots (the history itself is private to the store) */
const undoSteps = (store: EditorStore) => (store as unknown as { history: unknown[] }).history.length

const selectNs = (store: EditorStore) =>
  store.setSelection({ nodes: new Set(), segments: new Set(nsRails(store.network).map((seg) => seg.id)) })

describe('shiftSelectionLevel', () => {
  it('returns false and records nothing when no rail is selected or the step is zero', () => {
    const store = storeWithDiamond()
    const steps = undoSteps(store)

    expect(store.shiftSelectionLevel(1)).toBe(false)
    selectNs(store)
    expect(store.shiftSelectionLevel(0)).toBe(false)
    expect(undoSteps(store)).toBe(steps)
  })

  it('turns a diamond into a bridge, and back into a diamond when the track comes down again', () => {
    const store = storeWithDiamond()
    expect(detectCrossings(store.network)).toHaveLength(1)
    expect(nodesAtOrigin(store.network)).toHaveLength(1)
    selectNs(store)

    expect(store.shiftSelectionLevel(1)).toBe(true)

    expect(nsRails(store.network).map(segmentLevel)).toEqual([1, 1])
    expect(nodesAtOrigin(store.network)).toHaveLength(2)
    expect(detectCrossings(store.network)).toHaveLength(0)
    expect(store.network.segments.size).toBe(4)
    // notify() reconciles junctions on every call: the two stacked nodes must survive it
    store.notify()
    store.reconcileNetwork()
    expect(nodesAtOrigin(store.network)).toHaveLength(2)
    // The selection still holds the raised track
    expect([...store.selection.segments].sort()).toEqual(nsRails(store.network).map((seg) => seg.id).sort())

    expect(store.shiftSelectionLevel(-1)).toBe(true)

    expect(nsRails(store.network).map(segmentLevel)).toEqual([0, 0])
    expect(nodesAtOrigin(store.network)).toHaveLength(1)
    expect(store.network.adjacency.get(nodesAtOrigin(store.network)[0].id)).toHaveLength(4)
    expect(detectCrossings(store.network)).toHaveLength(1)
    expect(store.network.segments.size).toBe(4)
  })

  it('bringing a bridge that was laid without a node down to the ground cuts both tracks into a diamond', () => {
    const store = new EditorStore()
    const net = store.network
    const w = addNode(net, { x: -100, y: 0 })
    const e = addNode(net, { x: 100, y: 0 })
    const s = addNode(net, { x: 0, y: -100 })
    const n = addNode(net, { x: 0, y: 100 })
    addSegment(net, w.id, e.id)
    const bridge = addSegment(net, s.id, n.id, 1)!
    store.reconcileNetwork()
    store.markDirty()
    expect(net.segments.size).toBe(2)
    store.setSelection({ nodes: new Set(), segments: new Set([bridge.id]) })

    expect(store.shiftSelectionLevel(-1)).toBe(true)

    expect(net.segments.size).toBe(4)
    expect(detectCrossings(net)).toHaveLength(1)
    // The selection follows the track: the two halves replace the rail that was cut
    expect([...store.selection.segments].sort()).toEqual(nsRails(net).map((seg) => seg.id).sort())
  })

  it('shifts every selected rail from its own level and stops at the bounds', () => {
    const store = storeWithDiamond()
    selectNs(store)
    const [first, second] = nsRails(store.network)
    first.level = 2

    expect(store.shiftSelectionLevel(1)).toBe(true)
    expect([segmentLevel(first), segmentLevel(second)]).toEqual([3, 1])

    for (let i = 0; i < 12; i++) store.shiftSelectionLevel(1)
    expect([segmentLevel(first), segmentLevel(second)]).toEqual([MAX_LEVEL, MAX_LEVEL])
    // Nothing left to raise: no change, no undo step
    const steps = undoSteps(store)
    expect(store.shiftSelectionLevel(1)).toBe(false)
    expect(undoSteps(store)).toBe(steps)

    for (let i = 0; i < 12; i++) store.shiftSelectionLevel(-1)
    expect([segmentLevel(first), segmentLevel(second)]).toEqual([MIN_LEVEL, MIN_LEVEL])
  })

  it('is one undo step each way, and redo restores the bridge', () => {
    const store = storeWithDiamond()
    selectNs(store)
    const steps = undoSteps(store)

    store.shiftSelectionLevel(1)
    expect(undoSteps(store)).toBe(steps + 1)

    store.undo()
    expect(nsRails(store.network).map(segmentLevel)).toEqual([0, 0])
    expect(nodesAtOrigin(store.network)).toHaveLength(1)
    expect(detectCrossings(store.network)).toHaveLength(1)

    store.redo()
    expect(nsRails(store.network).map(segmentLevel)).toEqual([1, 1])
    expect(nodesAtOrigin(store.network)).toHaveLength(2)
    expect(detectCrossings(store.network)).toHaveLength(0)
  })

  it('is saved: the reloaded project has the bridge, its two stacked nodes and no crossing', () => {
    const store = storeWithDiamond()
    selectNs(store)
    store.shiftSelectionLevel(1)

    const loaded = loadNetworkFromStorage()!.network
    expect(nsRails(loaded).map(segmentLevel)).toEqual([1, 1])
    expect(nodesAtOrigin(loaded)).toHaveLength(2)
    expect(loaded.segments.size).toBe(4)
    expect(detectCrossings(loaded)).toHaveLength(0)
  })

  it('leaves the trains standing on the shifted track exactly where they were', () => {
    const store = storeWithDiamond()
    store.camera.scale = 3
    store.setTrainPlacementKind('tgv_loco')
    expect(store.placeTrainItem({ x: 0, y: 5 })).toBe(true) // astride the crossing, on the north-south track
    expect(store.placeTrainItem({ x: -60, y: 0 })).toBe(true)
    const bogies = (): Point[] =>
      store.trains.flatMap((t) => t.vehicles.flatMap((v) => [v.front, v.rear].map((p) => positionOnSegment(store.network, p.segId, p.t)!)))
    const before = bogies()
    expect(before).toHaveLength(4)
    selectNs(store)

    store.shiftSelectionLevel(1)
    const raised = bogies()
    store.shiftSelectionLevel(-1)
    const lowered = bogies()

    for (const after of [raised, lowered]) {
      expect(after).toHaveLength(4)
      after.forEach((p, i) => {
        expect(p.x).toBeCloseTo(before[i].x, 9)
        expect(p.y).toBeCloseTo(before[i].y, 9)
      })
    }
  })

  it('a parallel copy of a bridge track is a bridge too', () => {
    const store = storeWithDiamond()
    selectNs(store)
    store.shiftSelectionLevel(1)

    expect(store.createParallelTrackFromSelection(4)).toBe(true)

    const copies = [...store.selection.segments].map((sid) => store.network.segments.get(sid)!)
    expect(copies.length).toBeGreaterThan(0)
    for (const copy of copies) expect(segmentLevel(copy)).toBe(1)
    // It passes over the east-west track without cutting it
    expect(detectCrossings(store.network)).toHaveLength(0)
  })

  it('a rail laid from a node of the bridge stays on the bridge', () => {
    const store = storeWithDiamond()
    selectNs(store)
    store.shiftSelectionLevel(1)
    const twin = nodesAtOrigin(store.network).find((n) => nodeLevels(store.network, n.id).has(1))!
    const spur = addNode(store.network, { x: 60, y: 60 })
    store.setSelection({ nodes: new Set([twin.id, spur.id]), segments: new Set() })

    expect(store.connectSelectedNodes()).toBe(true)

    const rail = [...store.network.segments.values()].find((seg) => seg.from === spur.id || seg.to === spur.id)!
    expect(segmentLevel(rail)).toBe(1)
    // The bridge is not welded back onto the track below
    expect(nodesAtOrigin(store.network)).toHaveLength(2)
    expect(detectCrossings(store.network)).toHaveLength(0)
  })
})
