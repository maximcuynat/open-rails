import { beforeEach, describe, expect, it } from 'vitest'
import {
  addCurveSegment,
  addNode,
  addSegment,
  createNetwork,
  dissolveNode,
  hitNode,
  hitSegment,
  nodeLevels,
  removeDuplicateSegments,
  resetIdCounter,
  segmentLevel,
  setSegmentsLevel,
} from './network'
import type { Network, Segment } from './types'
import { detectCrossings, separateLevelsAtNode } from './crossing'
import { autoDetectJunctions, splitSegment } from './junction'
import { computeTrackSections } from './sections'
import { snapToNearestTrack } from './locomotive'
import { advanceTrainSet, createVehicle, makeTrainSet } from './train'
import { reconcileNetworkIntersections, splitSegmentAtNode } from '../geometry/reconcile'
import { applyParallelTurnout, performTrackCut } from '../geometry/constructionTemplates'

beforeEach(() => resetIdCounter(0))

/** Two straights crossing at the origin: `ew` along x on the ground, `ns` along y on `level` */
function cross(level = 0): { net: Network; ew: Segment; ns: Segment } {
  const net = createNetwork()
  const w = addNode(net, { x: -100, y: 0 })
  const e = addNode(net, { x: 100, y: 0 })
  const s = addNode(net, { x: 0, y: -100 })
  const n = addNode(net, { x: 0, y: 100 })
  const ew = addSegment(net, w.id, e.id)!
  const ns = addSegment(net, s.id, n.id, level)!
  return { net, ew, ns }
}

const levelsOf = (net: Network) => [...net.segments.values()].map(segmentLevel).sort()

describe('two tracks crossing', () => {
  it('on the same level get a crossing node, as before', () => {
    const { net } = cross()
    const res = reconcileNetworkIntersections(net)

    expect(res.splitCount).toBe(2)
    expect(net.nodes.size).toBe(5)
    expect(net.segments.size).toBe(4)
    expect(detectCrossings(net)).toHaveLength(1)
  })

  it('on different levels are left alone: no node, no crossing, two independent sections', () => {
    const { net, ew, ns } = cross(1)
    expect(detectCrossings(net)).toHaveLength(0)

    const res = reconcileNetworkIntersections(net)

    expect(res).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(net.nodes.size).toBe(4)
    expect([...net.segments.keys()]).toEqual([ew.id, ns.id])
    expect(detectCrossings(net)).toHaveLength(0)

    const sections = computeTrackSections(net)
    expect(sections).toHaveLength(2)
    expect(sections.map((sec) => sec.segmentIds).sort()).toEqual([[ew.id], [ns.id]])
    for (const sec of sections) expect(sec.crossingNodeIds ?? []).toHaveLength(0)
  })

  it('a curve over a straight is not cut either, on either of its two crossings', () => {
    const net = createNetwork()
    const a = addNode(net, { x: -100, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    addSegment(net, a.id, b.id)
    const c = addNode(net, { x: -50, y: -20 })
    const d = addNode(net, { x: 50, y: -20 })
    addCurveSegment(net, c.id, d.id, { x: 0, y: 60 }, 2)

    reconcileNetworkIntersections(net)

    expect(net.nodes.size).toBe(4)
    expect(net.segments.size).toBe(2)
  })
})

describe('a node only meets the rails of its level', () => {
  it('the end of a bridge rail lying on a ground rail does not split it', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 200, y: 0 })
    const ground = addSegment(net, a.id, b.id)!
    const c = addNode(net, { x: 100, y: 0 })
    const d = addNode(net, { x: 200, y: 20 })
    addSegment(net, c.id, d.id, 1)

    const res = reconcileNetworkIntersections(net)

    expect(res.splitCount).toBe(0)
    expect(net.segments.has(ground.id)).toBe(true)
    expect(net.junctions.size).toBe(0)
  })

  it('two stacked rail ends of different levels are not welded, two of the same level are', () => {
    const build = (level: number) => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const b = addNode(net, { x: 100, y: 0 })
      addSegment(net, a.id, b.id)
      const c = addNode(net, { x: 100, y: 0 })
      const d = addNode(net, { x: 200, y: 0 })
      addSegment(net, c.id, d.id, level)
      return { net, res: reconcileNetworkIntersections(net) }
    }

    expect(build(0).res.weldedCount).toBe(1)
    const stacked = build(1)
    expect(stacked.res.weldedCount).toBe(0)
    expect(stacked.net.nodes.size).toBe(4)
  })

  it('a ramp node (two levels) still joins a rail of either level', () => {
    const net = createNetwork()
    // Ramp: ground rail then bridge rail, meeting at (100, 0)
    const a = addNode(net, { x: 0, y: 0 })
    const ramp = addNode(net, { x: 100, y: 0 })
    const b = addNode(net, { x: 200, y: 0 })
    addSegment(net, a.id, ramp.id)
    addSegment(net, ramp.id, b.id, 1)
    expect([...nodeLevels(net, ramp.id)].sort()).toEqual([0, 1])
    // A separate bridge rail ending on the ramp node
    const c = addNode(net, { x: 100, y: 0 })
    const d = addNode(net, { x: 100, y: 100 })
    addSegment(net, c.id, d.id, 1)

    expect(reconcileNetworkIntersections(net).weldedCount).toBe(1)
  })

  it('a lone node is on no level yet and is wired into a bridge rail it lies on', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 200, y: 0 })
    addSegment(net, a.id, b.id, 1)
    const lone = addNode(net, { x: 100, y: 0 })

    expect(reconcileNetworkIntersections(net).splitCount).toBe(1)
    expect(net.adjacency.get(lone.id)).toHaveLength(2)
    expect(levelsOf(net)).toEqual([1, 1])
  })
})

describe('superimposed rails', () => {
  it('addSegment and addCurveSegment reuse the rail of the same level only', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const ground = addSegment(net, a.id, b.id)!
    const bridge = addSegment(net, a.id, b.id, 1)!

    expect(bridge.id).not.toBe(ground.id)
    expect(addSegment(net, b.id, a.id)!.id).toBe(ground.id)
    expect(addSegment(net, b.id, a.id, 1)!.id).toBe(bridge.id)

    const via = { x: 50, y: 30 }
    const curve = addCurveSegment(net, a.id, b.id, via)!
    const upperCurve = addCurveSegment(net, a.id, b.id, via, -1)!
    expect(upperCurve.id).not.toBe(curve.id)
    expect(addCurveSegment(net, a.id, b.id, via, -1)!.id).toBe(upperCurve.id)
    expect(net.segments.size).toBe(4)
  })

  it('removeDuplicateSegments keeps a rail stacked on another level and drops a true duplicate', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const ground = addSegment(net, a.id, b.id)!
    const bridge = addSegment(net, a.id, b.id, 1)!
    expect(removeDuplicateSegments(net, 0.1)).toBe(0)

    // Lowered by hand: now a second ground rail on top of the first
    setSegmentsLevel(net, [bridge.id], 0)
    expect(removeDuplicateSegments(net, 0.1)).toBe(1)
    expect([...net.segments.keys()]).toEqual([ground.id])
  })
})

describe('a rail hands its level down to its pieces', () => {
  /** A bridge rail from (0,0) to (200,0), straight or curved */
  function bridge(curved: boolean) {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 200, y: 0 })
    const seg = curved ? addCurveSegment(net, a.id, b.id, { x: 100, y: 40 }, 1)! : addSegment(net, a.id, b.id, 1)!
    return { net, a, b, seg }
  }

  for (const curved of [false, true]) {
    const shape = curved ? 'curve' : 'straight'

    it(`scissors on a ${shape}`, () => {
      const { net, seg } = bridge(curved)
      expect(performTrackCut(net, { x: 100, y: curved ? 20 : 0 }, 5)).toBe(true)

      expect(net.segments.has(seg.id)).toBe(false)
      expect(levelsOf(net)).toEqual([1, 1])
      for (const piece of net.segments.values()) expect(piece.parentSegmentId).toBe(seg.id)
    })

    it(`reconcile split of a ${shape} at a node`, () => {
      const { net, seg } = bridge(curved)
      const mid = addNode(net, { x: 100, y: curved ? 20 : 0 })
      const halves = splitSegmentAtNode(net, seg.id, mid.id)!

      expect(segmentLevel(halves.seg1)).toBe(1)
      expect(segmentLevel(halves.seg2)).toBe(1)
      expect(halves.seg1.parentSegmentId).toBe(seg.id)
      // Cut again: still on the bridge, still the same ancestor
      const again = splitSegment(net, halves.seg1.id, { x: 50, y: curved ? 15 : 0 })!
      expect(segmentLevel(again.seg1)).toBe(1)
      expect(again.seg2.parentSegmentId).toBe(seg.id)
    })
  }

  it('a turnout laid on a bridge cuts it into bridge rails and branches off on the same level', () => {
    const { net, seg } = bridge(false)
    const placed = applyParallelTurnout(net, {
      valid: true,
      segId: seg.id,
      startPos: { x: 50, y: 0 },
      midPos: { x: 90, y: 2 },
      endPos: { x: 130, y: 4 },
      via1: { x: 70, y: 0 },
      via2: { x: 110, y: 4 },
    } as Parameters<typeof applyParallelTurnout>[1])

    expect(placed).not.toBeNull()
    expect(net.segments.size).toBe(4)
    expect(levelsOf(net)).toEqual([1, 1, 1, 1])
    expect(net.junctions.size).toBe(1)
  })

  it('two ground tracks crossing under reconcile give four ground rails, two bridge tracks four bridge rails', () => {
    const net = createNetwork()
    const w = addNode(net, { x: -100, y: 0 })
    const e = addNode(net, { x: 100, y: 0 })
    const s = addNode(net, { x: 0, y: -100 })
    const n = addNode(net, { x: 0, y: 100 })
    addSegment(net, w.id, e.id, 2)
    addSegment(net, s.id, n.id, 2)

    reconcileNetworkIntersections(net)

    expect(levelsOf(net)).toEqual([2, 2, 2, 2])
    expect(detectCrossings(net)).toHaveLength(1)
  })

  it('dissolveNode merges two halves of one level and refuses to merge across a ramp', () => {
    const build = (l1: number, l2: number) => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const m = addNode(net, { x: 100, y: 0 })
      const b = addNode(net, { x: 200, y: 0 })
      addSegment(net, a.id, m.id, l1)
      addSegment(net, m.id, b.id, l2)
      return { net, m }
    }

    const flat = build(1, 1)
    const merged = dissolveNode(flat.net, flat.m.id)
    expect(merged && segmentLevel(merged)).toBe(1)
    expect(flat.net.segments.size).toBe(1)

    const ramp = build(0, 1)
    expect(dissolveNode(ramp.net, ramp.m.id)).toBeNull()
    expect(ramp.net.segments.size).toBe(2)
    expect(ramp.net.nodes.has(ramp.m.id)).toBe(true)
  })
})

describe('separateLevelsAtNode', () => {
  /** A reconciled diamond; returns its centre node and the two halves of each track */
  function diamond() {
    const { net } = cross()
    reconcileNetworkIntersections(net)
    const centre = [...net.nodes.values()].find((nd) => net.adjacency.get(nd.id)!.length === 4)!
    const arms = net.adjacency.get(centre.id)!.map((sid) => net.segments.get(sid)!)
    const isNs = (seg: Segment) => [seg.from, seg.to].some((nid) => Math.abs(net.nodes.get(nid)!.pos.y) > 1)
    return { net, centre, ns: arms.filter(isNs), ew: arms.filter((seg) => !isNs(seg)) }
  }

  it('does nothing while the two tracks share a level', () => {
    const { net, centre, ns } = diamond()
    expect(separateLevelsAtNode(net, centre.id)).toBeNull()

    // One half raised: the track is a ramp that still touches the ground at the crossing
    setSegmentsLevel(net, [ns[0].id], 1)
    expect(separateLevelsAtNode(net, centre.id)).toBeNull()
    expect(net.adjacency.get(centre.id)).toHaveLength(4)
  })

  it('moves the upper track onto a twin node, and reconcile keeps the two apart', () => {
    const { net, centre, ns, ew } = diamond()
    setSegmentsLevel(net, ns.map((seg) => seg.id), 1)

    const twinId = separateLevelsAtNode(net, centre.id)!

    expect(twinId).not.toBe(centre.id)
    expect(net.nodes.get(twinId)!.pos).toEqual(centre.pos)
    expect(net.nodes.get(twinId)!.pos).not.toBe(centre.pos)
    expect([...net.adjacency.get(centre.id)!].sort()).toEqual(ew.map((seg) => seg.id).sort())
    expect([...net.adjacency.get(twinId)!].sort()).toEqual(ns.map((seg) => seg.id).sort())
    for (const seg of ns) expect([seg.from, seg.to]).toContain(twinId)
    for (const seg of ns) expect([seg.from, seg.to]).not.toContain(centre.id)

    expect(reconcileNetworkIntersections(net)).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(net.nodes.size).toBe(6)
    expect(detectCrossings(net)).toHaveLength(0)
    expect(net.junctions.size).toBe(0)
    expect(computeTrackSections(net)).toHaveLength(2)
  })

  it('moves the lower track out when it is the tunnel that was lowered: the upper one is always the one moved', () => {
    const { net, centre, ns, ew } = diamond()
    setSegmentsLevel(net, ns.map((seg) => seg.id), -1)

    const twinId = separateLevelsAtNode(net, centre.id)!

    expect([...net.adjacency.get(twinId)!].sort()).toEqual(ew.map((seg) => seg.id).sort())
  })

  it('an unseparated node carrying two tracks without a common level is not reported as a crossing', () => {
    const { net, ns } = diamond()
    setSegmentsLevel(net, ns.map((seg) => seg.id), 1)
    expect(detectCrossings(net)).toHaveLength(0)
  })

  it('repoints the junctions that looked at the crossing node through a moved rail', () => {
    const { net, centre, ns } = diamond()
    // A turnout on the north-south track, 50 m from the crossing, branching away from it
    const arm = ns.find((seg) => [seg.from, seg.to].some((nid) => net.nodes.get(nid)!.pos.y > 1))!
    const cut = splitSegment(net, arm.id, { x: 0, y: 50 })!
    const tip = addNode(net, { x: 8, y: 100 })
    addSegment(net, cut.midNode.id, tip.id)
    autoDetectJunctions(net)
    const junc = [...net.junctions.values()].find((j) => j.nodeId === cut.midNode.id)!
    expect(junc.stemNodeId).toBe(centre.id)

    const nsNow = net.adjacency.get(centre.id)!.map((sid) => net.segments.get(sid)!)
      .filter((seg) => [seg.from, seg.to].some((nid) => Math.abs(net.nodes.get(nid)!.pos.y) > 1))
    setSegmentsLevel(net, nsNow.map((seg) => seg.id), 1)
    const twinId = separateLevelsAtNode(net, centre.id)!

    expect(junc.stemNodeId).toBe(twinId)
    // What notify() re-derives from the topology agrees
    autoDetectJunctions(net)
    expect([...net.junctions.values()].find((j) => j.nodeId === cut.midNode.id)!.stemNodeId).toBe(twinId)
  })
})

describe('picking what is on top', () => {
  it('hitSegment and snapToNearestTrack prefer the upper of two rails at the same distance', () => {
    for (const bridgeFirst of [false, true]) {
      const net = createNetwork()
      const w = addNode(net, { x: -100, y: 0 })
      const e = addNode(net, { x: 100, y: 0 })
      const s = addNode(net, { x: 0, y: -100 })
      const n = addNode(net, { x: 0, y: 100 })
      // Either insertion order: the choice does not depend on which rail was laid first
      const bridge = bridgeFirst ? addSegment(net, s.id, n.id, 1)! : null
      const ground = addSegment(net, w.id, e.id)!
      const top = bridge ?? addSegment(net, s.id, n.id, 1)!

      expect(hitSegment(net, { x: 0, y: 0 }, 5)).toBe(top.id)
      expect(snapToNearestTrack(net, { x: 0, y: 0 }, 5)!.segId).toBe(top.id)
      // Clearly nearer the ground rail: distance still wins
      expect(hitSegment(net, { x: 3, y: 0.5 }, 5)).toBe(ground.id)
      expect(snapToNearestTrack(net, { x: 3, y: 0.5 }, 5)!.segId).toBe(ground.id)
      // A tunnel under the ground rail is not what is seen
      setSegmentsLevel(net, [top.id], -1)
      expect(hitSegment(net, { x: 0, y: 0 }, 5)).toBe(ground.id)
      expect(snapToNearestTrack(net, { x: 0, y: 0 }, 5)!.segId).toBe(ground.id)
    }
  })

  it('hitNode prefers the upper of two stacked nodes', () => {
    const { net } = cross()
    reconcileNetworkIntersections(net)
    const centre = [...net.nodes.values()].find((nd) => net.adjacency.get(nd.id)!.length === 4)!
    const ns = net.adjacency.get(centre.id)!.map((sid) => net.segments.get(sid)!)
      .filter((seg) => [seg.from, seg.to].some((nid) => Math.abs(net.nodes.get(nid)!.pos.y) > 1))
    setSegmentsLevel(net, ns.map((seg) => seg.id), 1)
    const twinId = separateLevelsAtNode(net, centre.id)!

    expect(hitNode(net, { x: 0.2, y: 0.1 }, 5)).toBe(twinId)
    setSegmentsLevel(net, ns.map((seg) => seg.id), -1)
    expect(hitNode(net, { x: 0.2, y: 0.1 }, 5)).toBe(centre.id)
  })

  it('without levels the first of two equidistant rails is still the one picked', () => {
    const { net, ew } = cross()
    expect(hitSegment(net, { x: 0, y: 0 }, 5)).toBe(ew.id)
    expect(snapToNearestTrack(net, { x: 0, y: 0 }, 5)!.segId).toBe(ew.id)
  })
})

describe('trains on stacked tracks', () => {
  /** A loco on each track, both about to run through the point where the tracks cross */
  function twoTrains(level: number) {
    const { net } = cross(level)
    reconcileNetworkIntersections(net)
    const segAt = (x: number, y: number) => snapToNearestTrack(net, { x, y }, 1)!
    const onEw = segAt(-40, 0)
    const onNs = segAt(0, -40)
    const a = makeTrainSet('A', [createVehicle(net, onEw.segId, onEw.t, 'loco', 1)!])
    const b = makeTrainSet('B', [createVehicle(net, onNs.segId, onNs.t, 'loco', 1)!])
    // Whatever way the rails are oriented, drive each loco towards the crossing point
    for (const train of [a, b]) {
      const before = Math.hypot(...Object.values(trainNose(net, train)))
      advanceTrainSet(net, train, 1, [a, b])
      if (Math.hypot(...Object.values(trainNose(net, train))) > before) train.direction = -1
    }
    return { net, a, b }
  }

  const trainNose = (net: Network, train: ReturnType<typeof makeTrainSet>) => {
    const seg = net.segments.get(train.vehicles[0].front.segId)!
    const from = net.nodes.get(seg.from)!.pos
    const to = net.nodes.get(seg.to)!.pos
    const t = train.vehicles[0].front.t
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
  }

  it('a train on the bridge and a train under it run through the same spot without blocking each other', () => {
    const { net, a, b } = twoTrains(1)
    // B parks right over the track of A, then A runs the whole way under it
    let refusedB = 0
    for (let i = 0; i < 60; i++) if (!advanceTrainSet(net, b, 0.5, [a, b])) refusedB++
    expect(refusedB).toBe(0)
    expect(Math.abs(trainNose(net, b).y)).toBeLessThan(15)

    let refusedA = 0
    for (let i = 0; i < 120; i++) if (!advanceTrainSet(net, a, 0.5, [a, b])) refusedA++
    expect(refusedA).toBe(0)
    expect(Math.abs(trainNose(net, a).x)).toBeGreaterThan(15)
  })
})
