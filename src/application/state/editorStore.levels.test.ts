import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, isRamp, MAX_LEVEL, MIN_LEVEL, nodeLevel, resetIdCounter, segmentEndLevels, segmentGradient, setNodesLevel } from '@domain/models/network'
import type { Network, Point } from '@domain/models/types'
import { LEVEL_HEIGHT_RANGE, MAX_GRADIENT_RANGE, SCALE_PRESETS } from '@domain/models/units'
import { analyzeKinematics } from '@domain/services/kinematicDiagnostics'
import { detectCrossings } from '@domain/models/crossing'
import { positionOnSegment } from '@domain/models/locomotive'
import { getStorage, loadNetworkFromStorage, resetMemoryStorage, STORAGE_KEY } from '@infrastructure/persistence/persistence'

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

/** A store holding three rails end to end along x (100 m, 300 m, 200 m), the climb all on the first */
function storeWithUnevenRun() {
  const store = new EditorStore()
  const net = store.network
  const nodes = [0, 100, 400, 600].map((x, i) => addNode(net, { x, y: 0 }, i === 0 ? 0 : 1))
  const segs = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
  store.markDirty()
  const select = (ids = segs.map((seg) => seg.id)) => store.setSelection({ nodes: new Set(), segments: new Set(ids) })
  const heights = () => nodes.map((node) => nodeLevel(store.network.nodes.get(node.id)))
  const slopes = () => segs.map((seg) => segmentGradient(store.network, store.network.segments.get(seg.id)!, store.levelHeight))
  return { store, nodes, segs, select, heights, slopes }
}

describe('spreadSelectionGradient', () => {
  it('puts three rails of different lengths on one slope, in one undo step', () => {
    const { store, segs, select, heights, slopes } = storeWithUnevenRun()
    expect(slopes()).toEqual([60, 0, 0])
    select()
    expect(store.canSpreadSelectionGradient).toBe(true)
    const steps = undoSteps(store)

    expect(store.spreadSelectionGradient()).toBe(true)

    expect(undoSteps(store)).toBe(steps + 1)
    for (const permille of slopes()) expect(permille).toBeCloseTo(10, 9)
    expect(heights()[0]).toBe(0)
    expect(heights()[3]).toBe(1)
    // The rails are the same rails, still selected, and the button has nothing left to do
    expect([...store.selection.segments]).toEqual(segs.map((seg) => seg.id))
    expect(store.canSpreadSelectionGradient).toBe(false)
    expect(store.dirty).toBe(true)
    // Saved as it is
    const saved = loadNetworkFromStorage()!.network
    expect([...saved.nodes.values()].map(nodeLevel)).toEqual(heights())

    store.undo()
    expect(heights()).toEqual([0, 1, 1, 1])
    store.redo()
    for (const permille of slopes()) expect(permille).toBeCloseTo(10, 9)
  })

  it('returns false and records nothing when there is nothing to even out', () => {
    const { store, segs, select } = storeWithUnevenRun()
    const steps = undoSteps(store)
    const refused = () => {
      expect(store.canSpreadSelectionGradient).toBe(false)
      expect(store.spreadSelectionGradient()).toBe(false)
      expect(undoSteps(store)).toBe(steps)
    }

    refused() // nothing selected
    select([segs[0].id]) // a single rail
    refused()
    select([segs[0].id, segs[2].id]) // two rails that do not touch
    refused()
    select([segs[1].id, segs[2].id]) // a run already flat
    refused()
    store.setSelection({ nodes: new Set(store.network.nodes.keys()), segments: new Set() }) // nodes only
    refused()
  })

  it('clears the "too steep" report of the rail that carried the whole climb', () => {
    const { store, select } = storeWithUnevenRun()
    const steep = () => analyzeKinematics(store.network, store.gauge, store.gradientLimits).filter((i) => i.kind === 'steep_gradient')
    expect(steep()).toHaveLength(1) // 60 ‰ against 35 ‰
    select()
    store.spreadSelectionGradient()
    expect(steep()).toHaveLength(0) // 10 ‰ everywhere
  })

  it('leaves the trains standing on the run exactly where they were', () => {
    const { store, select } = storeWithUnevenRun()
    store.camera.scale = 3
    store.setTrainPlacementKind('tgv_loco')
    expect(store.placeTrainItem({ x: 100, y: 0 })).toBe(true) // astride the first inner node
    const bogies = (): Point[] =>
      store.trains.flatMap((t) => t.vehicles.flatMap((v) => [v.front, v.rear].map((p) => positionOnSegment(store.network, p.segId, p.t)!)))
    const before = bogies()
    expect(before).toHaveLength(2)
    select()

    expect(store.spreadSelectionGradient()).toBe(true)
    bogies().forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i].x, 9)
      expect(p.y).toBeCloseTo(before[i].y, 9)
    })
  })

  it('a node brought down onto the track it was passing over is joined to it', () => {
    // Ground, level 1, level 0.5. A ground track crosses under the top, without a node; evened
    // out, the middle node comes down to 0.25, within reach of that track
    const store = new EditorStore()
    const net = store.network
    const nodes = [-100, 0, 100].map((x, i) => addNode(net, { x, y: 0 }, [0, 1, 0.5][i]))
    const segs = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
    const s = addNode(net, { x: 0, y: -100 })
    const n = addNode(net, { x: 0, y: 100 })
    addSegment(net, s.id, n.id)
    store.reconcileNetwork()
    store.markDirty()
    expect(net.segments.size).toBe(3)
    const steps = undoSteps(store)

    store.setSelection({ nodes: new Set(), segments: new Set(segs.map((seg) => seg.id)) })
    expect(store.spreadSelectionGradient()).toBe(true)

    expect(nodesAtOrigin(store.network)).toHaveLength(1)
    expect(store.network.segments.size).toBe(4)
    expect(undoSteps(store)).toBe(steps + 1)
  })
})

describe('spreadSelectionGradient — a run back at the height it left', () => {
  it('is not offered on a whole bridge with its two ramps: it would flatten the bridge', () => {
    const store = new EditorStore()
    const net = store.network
    const nodes = [0, 100, 200, 300].map((x, i) => addNode(net, { x, y: 0 }, [0, 1, 1, 0][i]))
    const segs = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
    store.setSelection({ nodes: new Set(), segments: new Set(segs.map((seg) => seg.id)) })

    expect(store.canSpreadSelectionGradient).toBe(false)
    expect(store.spreadSelectionGradient()).toBe(false)
    expect(nodes.map((node) => node.level ?? 0)).toEqual([0, 1, 1, 0])

    // One ramp and the span next to it: two different ends, the action applies
    store.setSelection({ nodes: new Set(), segments: new Set([segs[0].id, segs[1].id]) })
    expect(store.canSpreadSelectionGradient).toBe(true)
  })
})

describe('gradient settings', () => {
  it('start at 6 m per level and 35 ‰, and follow the scale', () => {
    const store = new EditorStore()
    expect(store.gradientLimits).toEqual({ levelHeight: 6, maxGradient: 35 })

    store.setScalePreset('HO', false)
    expect(store.levelHeight).toBeCloseTo(6 / 87, 12)
    expect(store.levelHeight).toBe(SCALE_PRESETS.HO.defaultLevelHeight)
    expect(store.maxGradient).toBe(35)
    // Saved with the project by the change of scale itself
    expect(loadNetworkFromStorage()!.levelHeight).toBe(store.levelHeight)

    store.setScalePreset('N', false)
    expect(store.levelHeight).toBeCloseTo(6 / 160, 12)
    store.setScalePreset('1:1', false)
    expect(store.levelHeight).toBe(6)
  })

  it('a change of scale resets a custom limit, as it resets the track spacing', () => {
    const store = new EditorStore()
    store.setGradientSettings({ levelHeight: 8, maxGradient: 20 })
    store.setScalePreset('HO', false)
    expect(store.gradientLimits).toEqual({ levelHeight: SCALE_PRESETS.HO.defaultLevelHeight, maxGradient: 35 })
  })

  it('setGradientSettings changes one setting or both, in one undo step, and saves them', () => {
    const store = new EditorStore()
    const steps = undoSteps(store)
    let notified = 0
    store.subscribe(() => notified++)

    store.setGradientSettings({ maxGradient: 25 })
    expect(store.gradientLimits).toEqual({ levelHeight: 6, maxGradient: 25 })
    expect(undoSteps(store)).toBe(steps + 1)
    expect(notified).toBeGreaterThan(0)
    expect(store.dirty).toBe(true)

    store.setGradientSettings({ levelHeight: 7.5 })
    expect(store.gradientLimits).toEqual({ levelHeight: 7.5, maxGradient: 25 })
    store.setGradientSettings({ levelHeight: 5, maxGradient: 40 })
    expect(store.gradientLimits).toEqual({ levelHeight: 5, maxGradient: 40 })
    expect(undoSteps(store)).toBe(steps + 3)

    const saved = loadNetworkFromStorage()!
    expect(saved.levelHeight).toBe(5)
    expect(saved.maxGradient).toBe(40)
  })

  it('ignores values that are not positive finite numbers and keeps the others within bounds', () => {
    const store = new EditorStore()
    const steps = undoSteps(store)

    for (const bad of [0, -3, NaN, Infinity, -Infinity, undefined, '12' as unknown as number]) {
      store.setGradientSettings({ levelHeight: bad, maxGradient: bad })
    }
    store.setGradientSettings({})
    store.setGradientSettings({ levelHeight: 6, maxGradient: 35 }) // no change
    expect(store.gradientLimits).toEqual({ levelHeight: 6, maxGradient: 35 })
    expect(undoSteps(store)).toBe(steps)

    store.setGradientSettings({ levelHeight: 1e9, maxGradient: 1e9 })
    expect(store.gradientLimits).toEqual({ levelHeight: LEVEL_HEIGHT_RANGE.max, maxGradient: MAX_GRADIENT_RANGE.max })
    store.setGradientSettings({ levelHeight: 1e-9, maxGradient: 1e-9 })
    expect(store.gradientLimits).toEqual({ levelHeight: LEVEL_HEIGHT_RANGE.min, maxGradient: MAX_GRADIENT_RANGE.min })
    // A bad value does not stop the good one given with it
    store.setGradientSettings({ levelHeight: NaN, maxGradient: 30 })
    expect(store.gradientLimits).toEqual({ levelHeight: LEVEL_HEIGHT_RANGE.min, maxGradient: 30 })
  })

  it('are restored by undo and redo', () => {
    const store = new EditorStore()
    store.setGradientSettings({ levelHeight: 5, maxGradient: 20 })
    store.setGradientSettings({ maxGradient: 50 })

    store.undo()
    expect(store.gradientLimits).toEqual({ levelHeight: 5, maxGradient: 20 })
    store.undo()
    expect(store.gradientLimits).toEqual({ levelHeight: 6, maxGradient: 35 })
    store.redo()
    store.redo()
    expect(store.gradientLimits).toEqual({ levelHeight: 5, maxGradient: 50 })
  })

  it('are saved with the project and read back: autosave, JSON export and import', () => {
    const store = new EditorStore()
    store.setScalePreset('HO', false)
    store.setGradientSettings({ levelHeight: 0.08, maxGradient: 28.5 })

    // Autosave: a new session starts with them
    const reopened = new EditorStore()
    expect(reopened.scalePreset).toBe('HO')
    expect(reopened.gradientLimits).toEqual({ levelHeight: 0.08, maxGradient: 28.5 })

    // File export and import into an empty session
    const json = JSON.stringify(store.exportProject())
    expect(JSON.parse(json)).toMatchObject({ levelHeight: 0.08, maxGradient: 28.5 })
    resetMemoryStorage()
    const fresh = new EditorStore()
    expect(fresh.gradientLimits).toEqual({ levelHeight: 6, maxGradient: 35 })
    fresh.loadFromData(JSON.parse(json))
    expect(fresh.gradientLimits).toEqual({ levelHeight: 0.08, maxGradient: 28.5 })
  })

  it('a project saved without them gets the defaults of its scale', () => {
    const store = new EditorStore()
    store.setScalePreset('N', false)
    const data = JSON.parse(JSON.stringify(store.exportProject()))
    delete data.levelHeight
    delete data.maxGradient

    // Imported over a session that had its own settings
    resetMemoryStorage()
    const fresh = new EditorStore()
    fresh.setGradientSettings({ levelHeight: 9, maxGradient: 12 })
    fresh.loadFromData(data)
    expect(fresh.scalePreset).toBe('N')
    expect(fresh.gradientLimits).toEqual({ levelHeight: SCALE_PRESETS.N.defaultLevelHeight, maxGradient: 35 })

    // Found in the autosave of an older version
    resetMemoryStorage()
    getStorage()!.setItem(STORAGE_KEY, JSON.stringify(data))
    const reopened = new EditorStore()
    expect(reopened.scalePreset).toBe('N')
    expect(reopened.gradientLimits).toEqual({ levelHeight: SCALE_PRESETS.N.defaultLevelHeight, maxGradient: 35 })

    // Unusable values in a file count as absent
    fresh.loadFromData({ ...data, levelHeight: -1, maxGradient: 'steep' })
    expect(fresh.gradientLimits).toEqual({ levelHeight: SCALE_PRESETS.N.defaultLevelHeight, maxGradient: 35 })
  })
})
