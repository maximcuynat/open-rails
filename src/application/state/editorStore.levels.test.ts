import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, isRamp, MAX_LEVEL, MIN_LEVEL, nodeLevel, resetIdCounter, segmentEndLevels, setNodesLevel } from '@domain/models/network'
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

/** Heights of the two ends of each rail of the north-south track: `[1, 1]` twice for a bridge */
const nsHeights = (net: Network) => nsRails(net).map((seg) => Object.values(segmentEndLevels(net, seg)))

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
  it('returns false and records nothing when nothing is selected or the step is zero', () => {
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

    expect(nsHeights(store.network)).toEqual([[1, 1], [1, 1]])
    expect(nodesAtOrigin(store.network)).toHaveLength(2)
    expect(nodesAtOrigin(store.network).map(nodeLevel).sort()).toEqual([0, 1])
    // The track that was not selected has not moved
    for (const seg of store.network.segments.values()) {
      if (!nsRails(store.network).includes(seg)) expect(segmentEndLevels(store.network, seg)).toEqual({ from: 0, to: 0 })
    }
    expect(detectCrossings(store.network)).toHaveLength(0)
    expect(store.network.segments.size).toBe(4)
    // notify() reconciles junctions on every call: the two stacked nodes must survive it
    store.notify()
    store.reconcileNetwork()
    expect(nodesAtOrigin(store.network)).toHaveLength(2)
    // The selection still holds the raised track
    expect([...store.selection.segments].sort()).toEqual(nsRails(store.network).map((seg) => seg.id).sort())

    expect(store.shiftSelectionLevel(-1)).toBe(true)

    expect(nsHeights(store.network)).toEqual([[0, 0], [0, 0]])
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
    const s = addNode(net, { x: 0, y: -100 }, 1)
    const n = addNode(net, { x: 0, y: 100 }, 1)
    addSegment(net, w.id, e.id)
    const bridge = addSegment(net, s.id, n.id)!
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

  it('shifts every node of the selected rails from its own height, once, and stops at the bounds', () => {
    const store = storeWithDiamond()
    const net = store.network
    selectNs(store)
    const north = [...net.nodes.values()].find((n) => n.pos.y > 50)!
    setNodesLevel(net, [north.id], 2)
    const nsNodeHeights = () => [...new Set(nsRails(net).flatMap((seg) => [seg.from, seg.to]))].map((nid) => nodeLevel(net.nodes.get(nid))).sort()

    expect(store.shiftSelectionLevel(1)).toBe(true)
    // The crossing node is shared by both selected rails: it went up once, not twice
    expect(nsNodeHeights()).toEqual([1, 1, 3])

    for (let i = 0; i < 12; i++) store.shiftSelectionLevel(1)
    expect(nsNodeHeights()).toEqual([MAX_LEVEL, MAX_LEVEL, MAX_LEVEL])
    // Nothing left to raise: no change, no undo step
    const steps = undoSteps(store)
    expect(store.shiftSelectionLevel(1)).toBe(false)
    expect(undoSteps(store)).toBe(steps)

    for (let i = 0; i < 12; i++) store.shiftSelectionLevel(-1)
    expect(nsNodeHeights()).toEqual([MIN_LEVEL, MIN_LEVEL, MIN_LEVEL])
  })

  it('raising a rail between two neighbours turns them into its ramps, and nothing moves', () => {
    const store = new EditorStore()
    const net = store.network
    const xs = [0, 100, 200, 300]
    const nodes = xs.map((x) => addNode(net, { x, y: 0 }))
    const [west, middle, east] = [0, 1, 2].map((i) => addSegment(net, nodes[i].id, nodes[i + 1].id)!)
    store.reconcileNetwork()
    store.markDirty()
    store.camera.scale = 3
    store.setTrainPlacementKind('tgv_loco')
    expect(store.placeTrainItem({ x: 95, y: 0 })).toBe(true) // astride the foot of the future ramp
    const bogies = (): Point[] =>
      store.trains.flatMap((t) => t.vehicles.flatMap((v) => [v.front, v.rear].map((p) => positionOnSegment(net, p.segId, p.t)!)))
    const bogiesBefore = bogies()
    const positions = () => [...net.nodes.values()].map((n) => ({ id: n.id, ...n.pos }))
    const before = positions()
    store.setSelection({ nodes: new Set(), segments: new Set([middle.id]) })

    expect(store.shiftSelectionLevel(1)).toBe(true)

    expect(segmentEndLevels(net, middle)).toEqual({ from: 1, to: 1 })
    expect(segmentEndLevels(net, west)).toEqual({ from: 0, to: 1 })
    expect(segmentEndLevels(net, east)).toEqual({ from: 1, to: 0 })
    expect(isRamp(net, west) && isRamp(net, east)).toBe(true)
    expect(isRamp(net, middle)).toBe(false)
    // Same rails, same nodes, same coordinates
    expect([...net.segments.keys()]).toEqual([west.id, middle.id, east.id])
    expect(positions()).toEqual(before)
    expect([...store.selection.segments]).toEqual([middle.id])
    bogies().forEach((p, i) => {
      expect(p.x).toBeCloseTo(bogiesBefore[i].x, 9)
      expect(p.y).toBeCloseTo(bogiesBefore[i].y, 9)
    })

    // And back: three ground rails again
    expect(store.shiftSelectionLevel(-1)).toBe(true)
    for (const seg of [west, middle, east]) expect(segmentEndLevels(net, seg)).toEqual({ from: 0, to: 0 })
    expect(positions()).toEqual(before)
  })

  it('without any rail selected it shifts the selected nodes', () => {
    const store = new EditorStore()
    const net = store.network
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    store.markDirty()
    store.setSelection({ nodes: new Set([b.id]), segments: new Set() })
    const steps = undoSteps(store)

    expect(store.shiftSelectionLevel(1)).toBe(true)

    expect(segmentEndLevels(net, seg)).toEqual({ from: 0, to: 1 })
    expect(undoSteps(store)).toBe(steps + 1)
    expect([...store.selection.nodes]).toEqual([b.id])
  })

  it('a crossing whose two tracks are both selected goes up as it is: still a crossing', () => {
    const store = storeWithDiamond()
    store.setSelection({ nodes: new Set(), segments: new Set(store.network.segments.keys()) })

    expect(store.shiftSelectionLevel(1)).toBe(true)

    expect(nodesAtOrigin(store.network)).toHaveLength(1)
    expect([...store.network.nodes.values()].map(nodeLevel)).toEqual([1, 1, 1, 1, 1])
    expect(detectCrossings(store.network)).toHaveLength(1)
  })

  it('is one undo step each way, and redo restores the bridge', () => {
    const store = storeWithDiamond()
    selectNs(store)
    const steps = undoSteps(store)

    store.shiftSelectionLevel(1)
    expect(undoSteps(store)).toBe(steps + 1)

    store.undo()
    expect(nsHeights(store.network)).toEqual([[0, 0], [0, 0]])
    expect(nodesAtOrigin(store.network)).toHaveLength(1)
    expect(detectCrossings(store.network)).toHaveLength(1)

    store.redo()
    expect(nsHeights(store.network)).toEqual([[1, 1], [1, 1]])
    expect(nodesAtOrigin(store.network)).toHaveLength(2)
    expect(detectCrossings(store.network)).toHaveLength(0)
  })

  it('is saved: the reloaded project has the bridge, its two stacked nodes and no crossing', () => {
    const store = storeWithDiamond()
    selectNs(store)
    store.shiftSelectionLevel(1)

    const loaded = loadNetworkFromStorage()!.network
    expect(nsHeights(loaded)).toEqual([[1, 1], [1, 1]])
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
    for (const copy of copies) expect(segmentEndLevels(store.network, copy)).toEqual({ from: 1, to: 1 })
    // It passes over the east-west track without cutting it
    expect(detectCrossings(store.network)).toHaveLength(0)
  })

  it('a rail laid from a node of the bridge to a node on the ground is a ramp, and the bridge stays a bridge', () => {
    const store = storeWithDiamond()
    selectNs(store)
    store.shiftSelectionLevel(1)
    const twin = nodesAtOrigin(store.network).find((n) => nodeLevel(n) === 1)!
    const spur = addNode(store.network, { x: 60, y: 60 })
    store.setSelection({ nodes: new Set([twin.id, spur.id]), segments: new Set() })

    expect(store.connectSelectedNodes()).toBe(true)

    const rail = [...store.network.segments.values()].find((seg) => seg.from === spur.id || seg.to === spur.id)!
    expect(Object.values(segmentEndLevels(store.network, rail)).sort()).toEqual([0, 1])
    expect(nsHeights(store.network)).toEqual([[1, 1], [1, 1]])
    // The bridge is not welded back onto the track below
    expect(nodesAtOrigin(store.network)).toHaveLength(2)
    expect(detectCrossings(store.network)).toHaveLength(0)
  })
})
