import { beforeEach, describe, expect, it } from 'vitest'
import {
  LEVEL_CLEARANCE,
  MAX_LEVEL,
  MIN_LEVEL,
  addArcCurve,
  addCurveSegment,
  addNode,
  addSegment,
  canSpreadGradient,
  createNetwork,
  dissolveNode,
  gradientRun,
  hitNode,
  hitSegment,
  isRamp,
  levelsMeet,
  nodeLevel,
  removeDuplicateSegments,
  resetIdCounter,
  segmentBand,
  segmentEndLevels,
  segmentGradient,
  segmentHeightAt,
  segmentRunLength,
  setNodesLevel,
  spreadGradient,
} from './network'
import type { Network, Segment } from './types'
import { detectCrossings, separateLevelsAtNode } from './crossing'
import { autoDetectJunctions, splitSegment, turnoutView, weldNodes } from './junction'
import { computeTrackSections } from './sections'
import { snapToNearestTrack } from './locomotive'
import { advanceTrainSet, createVehicle, makeTrainSet } from './train'
import { reconcileNetworkIntersections, splitSegmentAtNode } from '../geometry/reconcile'
import { applyParallelTurnout, performTrackCut } from '../geometry/constructionTemplates'

beforeEach(() => resetIdCounter(0))

/** Two straights crossing at the origin: `ew` along x on the ground, `ns` along y at height `level` */
function cross(level = 0): { net: Network; ew: Segment; ns: Segment } {
  const net = createNetwork()
  const w = addNode(net, { x: -100, y: 0 })
  const e = addNode(net, { x: 100, y: 0 })
  const s = addNode(net, { x: 0, y: -100 }, level)
  const n = addNode(net, { x: 0, y: 100 }, level)
  const ew = addSegment(net, w.id, e.id)!
  const ns = addSegment(net, s.id, n.id)!
  return { net, ew, ns }
}

/** A rail from (0,0) at height `from` to (100,0) at height `to` */
function rail(from: number, to: number) {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 }, from)
  const b = addNode(net, { x: 100, y: 0 }, to)
  return { net, a, b, seg: addSegment(net, a.id, b.id)! }
}

/** Put both nodes of the given rails at `level` */
const setRailsLevel = (net: Network, segs: Segment[], level: number) =>
  setNodesLevel(net, segs.flatMap((seg) => [seg.from, seg.to]), level)

const bandsOf = (net: Network) => [...net.segments.values()].map((seg) => segmentBand(net, seg)).sort()
const heightsOf = (net: Network) => [...net.nodes.values()].map(nodeLevel).sort()

describe('heights are on the nodes', () => {
  it('a node is on the ground unless it says otherwise, and the ground is stored as no field', () => {
    const net = createNetwork()
    const ground = addNode(net, { x: 0, y: 0 })
    const high = addNode(net, { x: 10, y: 0 }, 1.5)
    expect(nodeLevel(ground)).toBe(0)
    expect('level' in ground).toBe(false)
    expect(nodeLevel(high)).toBe(1.5)
    expect(nodeLevel(undefined)).toBe(0)
  })

  it('setNodesLevel clamps without rounding, counts the nodes changed and removes the field on the ground', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 }, 0.25)

    expect(setNodesLevel(net, [a.id, b.id, 'missing'], 0.25)).toBe(1)
    expect(a.level).toBe(0.25)
    expect(setNodesLevel(net, [a.id, b.id], 99)).toBe(2)
    expect(a.level).toBe(MAX_LEVEL)
    expect(setNodesLevel(net, [a.id], -99)).toBe(1)
    expect(a.level).toBe(MIN_LEVEL)
    expect(setNodesLevel(net, [a.id, b.id], 0)).toBe(2)
    expect('level' in a).toBe(false)
    expect('level' in b).toBe(false)
  })

  it('segmentHeightAt interpolates between the two ends, isRamp tells a ramp from a flat rail', () => {
    const ramp = rail(0, 1)
    expect(segmentEndLevels(ramp.net, ramp.seg)).toEqual({ from: 0, to: 1 })
    expect(segmentHeightAt(ramp.net, ramp.seg, 0)).toBe(0)
    expect(segmentHeightAt(ramp.net, ramp.seg, 0.25)).toBeCloseTo(0.25, 12)
    expect(segmentHeightAt(ramp.net, ramp.seg, 1)).toBe(1)
    expect(isRamp(ramp.net, ramp.seg)).toBe(true)

    const down = rail(2, -1)
    expect(segmentHeightAt(down.net, down.seg, 0.5)).toBeCloseTo(0.5, 12)

    const bridge = rail(1, 1)
    expect(segmentHeightAt(bridge.net, bridge.seg, 0.3)).toBe(1)
    expect(isRamp(bridge.net, bridge.seg)).toBe(false)
    const ground = rail(0, 0)
    expect(isRamp(ground.net, ground.seg)).toBe(false)
  })

  it('segmentBand: the level the upper end reaches above ground, else the level the lower end goes down to', () => {
    const band = (from: number, to: number) => {
      const r = rail(from, to)
      return segmentBand(r.net, r.seg)
    }
    expect(band(0, 0)).toBe(0)
    expect(Object.is(band(0, 0), 0)).toBe(true)
    expect(band(1, 1)).toBe(1)
    expect(band(0, 1)).toBe(1)
    expect(band(1, 0)).toBe(1)
    expect(band(0, 0.5)).toBe(1)
    expect(band(1, 2)).toBe(2)
    expect(band(1.5, 1)).toBe(2)
    expect(band(-1, -1)).toBe(-1)
    expect(band(0, -1)).toBe(-1)
    expect(band(-0.5, 0)).toBe(-1)
    expect(band(-1, -2)).toBe(-2)
    // Through the ground: drawn with what is above
    expect(band(-1, 1)).toBe(1)
  })

  it('levelsMeet: closer than LEVEL_CLEARANCE', () => {
    expect(LEVEL_CLEARANCE).toBe(0.5)
    expect(levelsMeet(0, 0)).toBe(true)
    expect(levelsMeet(1, 1.49)).toBe(true)
    expect(levelsMeet(0, 0.5)).toBe(false)
    expect(levelsMeet(0, 1)).toBe(false)
    expect(levelsMeet(-1, 0)).toBe(false)
  })
})

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
    expect(segmentBand(net, ns)).toBe(1)
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
    const c = addNode(net, { x: -50, y: -20 }, 2)
    const d = addNode(net, { x: 50, y: -20 }, 2)
    addCurveSegment(net, c.id, d.id, { x: 0, y: 60 })

    reconcileNetworkIntersections(net)

    expect(net.nodes.size).toBe(4)
    expect(net.segments.size).toBe(2)
  })
})

describe('a ramp meets what is at its height where they meet', () => {
  /** A 0 → `top` ramp along x from 0 to 100, and a ground track across it at x = `at` */
  function rampAcross(at: number, top = 1, rampFirst = true) {
    const net = createNetwork()
    const build = [
      () => {
        const a = addNode(net, { x: 0, y: 0 })
        const b = addNode(net, { x: 100, y: 0 }, top)
        return addSegment(net, a.id, b.id)!
      },
      () => {
        const c = addNode(net, { x: at, y: -50 })
        const d = addNode(net, { x: at, y: 50 })
        return addSegment(net, c.id, d.id)!
      },
    ]
    const [ramp, ground] = rampFirst ? [build[0](), build[1]()] : [build[1](), build[0]()].reverse()
    return { net, ramp, ground }
  }

  for (const rampFirst of [true, false]) {
    it(`crossed at 20 % of its length by a ground track: a crossing (ramp laid ${rampFirst ? 'first' : 'last'})`, () => {
      const { net } = rampAcross(20, 1, rampFirst)
      expect(detectCrossings(net)).toHaveLength(1)

      const res = reconcileNetworkIntersections(net)

      expect(res.splitCount).toBe(2)
      expect(net.nodes.size).toBe(5)
      expect(net.segments.size).toBe(4)
      const centre = [...net.nodes.values()].find((nd) => net.adjacency.get(nd.id)!.length === 4)!
      expect(centre.pos.x).toBeCloseTo(20, 9)
      expect(centre.pos.y).toBeCloseTo(0, 9)
      // The flat track stays flat: the crossing is on the ground and the ramp climbs from there
      expect(nodeLevel(centre)).toBe(0)
      expect(heightsOf(net)).toEqual([0, 0, 0, 0, 1])
      expect(detectCrossings(net)).toHaveLength(1)
    })
  }

  it('crossed at 80 % of its length: the ground track passes under it, no node', () => {
    const { net, ramp, ground } = rampAcross(80)
    expect(detectCrossings(net)).toHaveLength(0)

    const res = reconcileNetworkIntersections(net)

    expect(res).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(net.nodes.size).toBe(4)
    expect([...net.segments.keys()]).toEqual([ramp.id, ground.id])
    expect(detectCrossings(net)).toHaveLength(0)
    expect(computeTrackSections(net)).toHaveLength(2)
  })

  it('a ramp going down passes under the ground track near its bottom', () => {
    const { net } = rampAcross(80, -1)
    expect(reconcileNetworkIntersections(net)).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(detectCrossings(net)).toHaveLength(0)
  })

  it('the end of a ground rail lying on the ramp is wired in near the foot, not near the top', () => {
    const build = (at: number) => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const b = addNode(net, { x: 100, y: 0 }, 1)
      addSegment(net, a.id, b.id)
      const c = addNode(net, { x: at, y: 0 })
      const d = addNode(net, { x: at, y: 50 })
      addSegment(net, c.id, d.id)
      return { net, c, res: reconcileNetworkIntersections(net) }
    }

    const foot = build(20)
    expect(foot.res.splitCount).toBe(1)
    expect(foot.net.adjacency.get(foot.c.id)).toHaveLength(3)
    // The node already carried a rail: it keeps its own height
    expect(nodeLevel(foot.c)).toBe(0)

    const top = build(80)
    expect(top.res.splitCount).toBe(0)
    expect(top.net.adjacency.get(top.c.id)).toHaveLength(1)
  })
})

describe('a node only meets the rails at its height', () => {
  it('the end of a bridge rail lying on a ground rail does not split it', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 200, y: 0 })
    const ground = addSegment(net, a.id, b.id)!
    const c = addNode(net, { x: 100, y: 0 }, 1)
    const d = addNode(net, { x: 200, y: 20 }, 1)
    addSegment(net, c.id, d.id)

    const res = reconcileNetworkIntersections(net)

    expect(res.splitCount).toBe(0)
    expect(net.segments.has(ground.id)).toBe(true)
    expect(net.junctions.size).toBe(0)
  })

  it('two stacked rail ends of different heights are not welded, two of the same height are', () => {
    const build = (level: number) => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const b = addNode(net, { x: 100, y: 0 })
      addSegment(net, a.id, b.id)
      const c = addNode(net, { x: 100, y: 0 }, level)
      const d = addNode(net, { x: 200, y: 0 }, level)
      addSegment(net, c.id, d.id)
      return { net, res: reconcileNetworkIntersections(net) }
    }

    expect(build(0).res.weldedCount).toBe(1)
    const stacked = build(1)
    expect(stacked.res.weldedCount).toBe(0)
    expect(stacked.net.nodes.size).toBe(4)
    expect(build(-1).res.weldedCount).toBe(0)
  })

  it('the top of a ramp is at bridge height: a bridge rail ending there joins it, a ground rail does not', () => {
    const build = (level: number) => {
      const net = createNetwork()
      // Ramp from the ground up to (100, 0), then a flat span
      const a = addNode(net, { x: 0, y: 0 })
      const top = addNode(net, { x: 100, y: 0 }, 1)
      const b = addNode(net, { x: 200, y: 0 }, 1)
      addSegment(net, a.id, top.id)
      addSegment(net, top.id, b.id)
      // A separate rail ending on the top of the ramp
      const c = addNode(net, { x: 100, y: 0 }, level)
      const d = addNode(net, { x: 100, y: 100 }, level)
      addSegment(net, c.id, d.id)
      return reconcileNetworkIntersections(net).weldedCount
    }

    expect(build(1)).toBe(1)
    expect(build(0)).toBe(0)
  })

  it('weldNodes keeps the height of the node that is kept', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 }, 1)
    const b = addNode(net, { x: 100, y: 0 }, 1)
    addSegment(net, a.id, b.id)
    const c = addNode(net, { x: 100, y: 0 }, 1.25)
    const d = addNode(net, { x: 200, y: 0 }, 2)
    const climb = addSegment(net, c.id, d.id)!

    expect(weldNodes(net, b.id, c.id)).toBe(true)

    expect(nodeLevel(b)).toBe(1)
    expect(segmentEndLevels(net, climb)).toEqual({ from: 1, to: 2 })
  })

  it('a lone node has no height of its own yet: it is wired into a bridge rail it lies on, at its height', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 }, 1)
    const b = addNode(net, { x: 200, y: 0 }, 1)
    addSegment(net, a.id, b.id)
    const lone = addNode(net, { x: 100, y: 0 })

    expect(reconcileNetworkIntersections(net).splitCount).toBe(1)
    expect(net.adjacency.get(lone.id)).toHaveLength(2)
    expect(nodeLevel(lone)).toBe(1)
    expect(bandsOf(net)).toEqual([1, 1])
  })

  it('a lone node on a ramp takes the height of the ramp there', () => {
    const { net } = rail(0, 1)
    const lone = addNode(net, { x: 30, y: 0 })

    expect(reconcileNetworkIntersections(net).splitCount).toBe(1)
    expect(nodeLevel(lone)).toBeCloseTo(0.3, 9)
  })
})

describe('superimposed rails', () => {
  it('two rails between the same two nodes are one rail: addSegment and addCurveSegment reuse it', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 }, 1)
    const b = addNode(net, { x: 100, y: 0 }, 1)
    const bridge = addSegment(net, a.id, b.id)!

    expect(addSegment(net, b.id, a.id)!.id).toBe(bridge.id)

    const via = { x: 50, y: 30 }
    const curve = addCurveSegment(net, a.id, b.id, via)!
    expect(curve.id).not.toBe(bridge.id)
    expect(addCurveSegment(net, b.id, a.id, via)!.id).toBe(curve.id)
    expect(net.segments.size).toBe(2)
  })

  it('a rail stacked over another one has its own nodes: both stay, until it comes down onto it', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const ground = addSegment(net, a.id, b.id)!
    const a1 = addNode(net, { x: 0, y: 0 }, 1)
    const b1 = addNode(net, { x: 100, y: 0 }, 1)
    const bridge = addSegment(net, a1.id, b1.id)!

    expect(bridge.id).not.toBe(ground.id)
    expect(removeDuplicateSegments(net, 0.1)).toBe(0)
    expect(reconcileNetworkIntersections(net)).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(net.segments.size).toBe(2)
    expect(net.nodes.size).toBe(4)

    // Lowered: now a second ground rail on top of the first, the older one is kept
    setNodesLevel(net, [a1.id, b1.id], 0)
    expect(reconcileNetworkIntersections(net).weldedCount).toBe(2)
    expect([...net.segments.keys()]).toEqual([ground.id])
    expect(net.nodes.size).toBe(2)
  })
})

describe('the pieces of a rail keep its heights', () => {
  /** A bridge rail from (0,0) to (200,0), straight or curved */
  function bridge(curved: boolean) {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 }, 1)
    const b = addNode(net, { x: 200, y: 0 }, 1)
    const seg = curved ? addCurveSegment(net, a.id, b.id, { x: 100, y: 40 })! : addSegment(net, a.id, b.id)!
    return { net, a, b, seg }
  }

  for (const curved of [false, true]) {
    const shape = curved ? 'curve' : 'straight'

    it(`scissors on a ${shape}`, () => {
      const { net, seg } = bridge(curved)
      expect(performTrackCut(net, { x: 100, y: curved ? 20 : 0 }, 5)).toBe(true)

      expect(net.segments.has(seg.id)).toBe(false)
      expect(bandsOf(net)).toEqual([1, 1])
      expect(heightsOf(net)).toEqual([1, 1, 1])
      for (const piece of net.segments.values()) {
        expect(isRamp(net, piece)).toBe(false)
        expect(piece.parentSegmentId).toBe(seg.id)
      }
    })

    it(`reconcile split of a ${shape} at a node`, () => {
      const { net, seg } = bridge(curved)
      const mid = addNode(net, { x: 100, y: curved ? 20 : 0 })
      const halves = splitSegmentAtNode(net, seg.id, mid.id)!

      expect(segmentEndLevels(net, halves.seg1)).toEqual({ from: 1, to: 1 })
      expect(segmentEndLevels(net, halves.seg2)).toEqual({ from: 1, to: 1 })
      expect(halves.seg1.parentSegmentId).toBe(seg.id)
      // Cut again: still on the bridge, still the same ancestor
      const again = splitSegment(net, halves.seg1.id, { x: 50, y: curved ? 15 : 0 })!
      expect(nodeLevel(again.midNode)).toBe(1)
      expect(segmentBand(net, again.seg1)).toBe(1)
      expect(again.seg2.parentSegmentId).toBe(seg.id)
    })

    it(`a 0 → 1 ramp (${shape}) cut in the middle: a node at 0.5 and two ramps that share the climb`, () => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const b = addNode(net, { x: 200, y: 0 }, 1)
      const seg = curved ? addCurveSegment(net, a.id, b.id, { x: 100, y: 40 })! : addSegment(net, a.id, b.id)!

      const cut = splitSegment(net, seg.id, { x: 100, y: curved ? 20 : 0 })!

      expect(nodeLevel(cut.midNode)).toBeCloseTo(0.5, 9)
      expect(segmentEndLevels(net, cut.seg1).from).toBe(0)
      expect(segmentEndLevels(net, cut.seg1).to).toBeCloseTo(0.5, 9)
      expect(segmentEndLevels(net, cut.seg2).to).toBe(1)
      expect(isRamp(net, cut.seg1) && isRamp(net, cut.seg2)).toBe(true)
    })
  }

  it('scissors a quarter of the way up a ramp leave a node at 0.25', () => {
    const { net } = rail(0, 1)
    expect(performTrackCut(net, { x: 25, y: 0 }, 5)).toBe(true)
    expect(heightsOf(net)).toEqual([0, 0.25, 1])
  })

  it('scissors on a node of a bridge detach a rail end that stays at the height of the bridge', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 }, 1)
    const m = addNode(net, { x: 100, y: 0 }, 1)
    const b = addNode(net, { x: 200, y: 0 }, 1)
    addSegment(net, a.id, m.id)
    addSegment(net, m.id, b.id)

    expect(performTrackCut(net, { x: 100, y: 0 }, 5)).toBe(true)

    expect(net.nodes.size).toBe(4)
    expect(heightsOf(net)).toEqual([1, 1, 1, 1])
    expect(bandsOf(net)).toEqual([1, 1])
  })

  it('splitSegmentAtNode: a lone node takes the height of the ramp, a node that carries a rail keeps its own', () => {
    const lone = rail(0, 1)
    const mid = addNode(lone.net, { x: 50, y: 0 })
    splitSegmentAtNode(lone.net, lone.seg.id, mid.id)
    expect(nodeLevel(mid)).toBeCloseTo(0.5, 9)

    const wired = rail(0, 1)
    const end = addNode(wired.net, { x: 50, y: 0 }, 0.75)
    const far = addNode(wired.net, { x: 50, y: 80 }, 0.75)
    addSegment(wired.net, end.id, far.id)
    const halves = splitSegmentAtNode(wired.net, wired.seg.id, end.id)!
    expect(nodeLevel(end)).toBe(0.75)
    expect(segmentEndLevels(wired.net, halves.seg1)).toEqual({ from: 0, to: 0.75 })
    expect(segmentEndLevels(wired.net, halves.seg2)).toEqual({ from: 0.75, to: 1 })
  })

  it('a curve laid as arc pieces between two heights climbs evenly, joint after joint', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 100 }, 1)
    const chain = addArcCurve(net, a.id, b.id, { x: 100, y: 0 })!

    expect(chain.nodes.length).toBeGreaterThan(0)
    const heights = [0, ...chain.nodes.map(nodeLevel), 1]
    const step = 1 / chain.segments.length
    heights.forEach((h, i) => expect(h).toBeCloseTo(i * step, 6))

    // Between two nodes of the same height every joint is at that height
    const flat = createNetwork()
    const c = addNode(flat, { x: 0, y: 0 }, 2)
    const d = addNode(flat, { x: 100, y: 100 }, 2)
    for (const node of addArcCurve(flat, c.id, d.id, { x: 100, y: 0 })!.nodes) expect(nodeLevel(node)).toBe(2)
  })

  it('a turnout laid on a bridge cuts it into bridge rails and branches off at the same height', () => {
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
    expect(bandsOf(net)).toEqual([1, 1, 1, 1])
    expect(heightsOf(net)).toEqual([1, 1, 1, 1, 1])
    expect(net.junctions.size).toBe(1)
  })

  it('two bridge tracks crossing under reconcile give four bridge rails and a crossing up there', () => {
    const net = createNetwork()
    const w = addNode(net, { x: -100, y: 0 }, 2)
    const e = addNode(net, { x: 100, y: 0 }, 2)
    const s = addNode(net, { x: 0, y: -100 }, 2)
    const n = addNode(net, { x: 0, y: 100 }, 2)
    addSegment(net, w.id, e.id)
    addSegment(net, s.id, n.id)

    reconcileNetworkIntersections(net)

    expect(bandsOf(net)).toEqual([2, 2, 2, 2])
    expect(heightsOf(net)).toEqual([2, 2, 2, 2, 2])
    expect(detectCrossings(net)).toHaveLength(1)
  })

  it('dissolveNode merges two rails whose node is on their common slope, and refuses when it is not', () => {
    const build = (ha: number, hm: number, hb: number, xm = 100) => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 }, ha)
      const m = addNode(net, { x: xm, y: 0 }, hm)
      const b = addNode(net, { x: 200, y: 0 }, hb)
      addSegment(net, a.id, m.id)
      addSegment(net, m.id, b.id)
      return { net, m }
    }

    const flat = build(1, 1, 1)
    const merged = dissolveNode(flat.net, flat.m.id)
    expect(merged && segmentEndLevels(flat.net, merged)).toEqual({ from: 1, to: 1 })
    expect(flat.net.segments.size).toBe(1)

    // An even ramp cut in two (a quarter of the way) is one ramp again
    const even = build(0, 0.25, 1, 50)
    const ramp = dissolveNode(even.net, even.m.id)
    expect(ramp && isRamp(even.net, ramp)).toBe(true)
    expect(even.net.segments.size).toBe(1)

    // The foot of a ramp, or a node off the slope: removing it would change the slope
    for (const kept of [build(0, 0, 1), build(0, 1, 1), build(0, 0.5, 1, 50)]) {
      expect(dissolveNode(kept.net, kept.m.id)).toBeNull()
      expect(kept.net.segments.size).toBe(2)
      expect(kept.net.nodes.has(kept.m.id)).toBe(true)
    }
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
  /** The far ends of a track through `centreId` */
  const farEnds = (track: Segment[], centreId: string) =>
    track.map((seg) => (seg.from === centreId ? seg.to : seg.from))

  it('does nothing while the two tracks would still meet, or without a track through the node', () => {
    const { net, centre, ns } = diamond()
    expect(separateLevelsAtNode(net, centre.id, ns[0].id, 0)).toBeNull()
    expect(separateLevelsAtNode(net, centre.id, ns[0].id, 0.4)).toBeNull()
    expect(separateLevelsAtNode(net, centre.id, 'missing', 1)).toBeNull()
    expect(separateLevelsAtNode(net, farEnds(ns, centre.id)[0], ns[0].id, 1)).toBeNull()
    expect(net.adjacency.get(centre.id)).toHaveLength(4)
    expect(net.nodes.size).toBe(5)
    expect(nodeLevel(centre)).toBe(0)
  })

  it('moves the raised track onto a twin node at its height, and reconcile keeps the two apart', () => {
    const { net, centre, ns, ew } = diamond()
    setNodesLevel(net, farEnds(ns, centre.id), 1)

    const twinId = separateLevelsAtNode(net, centre.id, ns[0].id, 1)!

    expect(twinId).not.toBe(centre.id)
    expect(net.nodes.get(twinId)!.pos).toEqual(centre.pos)
    expect(net.nodes.get(twinId)!.pos).not.toBe(centre.pos)
    expect(nodeLevel(net.nodes.get(twinId))).toBe(1)
    expect(nodeLevel(centre)).toBe(0)
    expect([...net.adjacency.get(centre.id)!].sort()).toEqual(ew.map((seg) => seg.id).sort())
    expect([...net.adjacency.get(twinId)!].sort()).toEqual(ns.map((seg) => seg.id).sort())
    for (const seg of ns) expect([seg.from, seg.to]).toContain(twinId)
    for (const seg of ns) expect([seg.from, seg.to]).not.toContain(centre.id)
    // A bridge is a bridge: both its rails are flat, one level up
    for (const seg of ns) expect(segmentEndLevels(net, seg)).toEqual({ from: 1, to: 1 })
    for (const seg of ew) expect(segmentEndLevels(net, seg)).toEqual({ from: 0, to: 0 })

    expect(reconcileNetworkIntersections(net)).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(net.nodes.size).toBe(6)
    expect(detectCrossings(net)).toHaveLength(0)
    expect(net.junctions.size).toBe(0)
    expect(computeTrackSections(net)).toHaveLength(2)
  })

  it('when the track goes down (tunnel) it is the other one that moves: the twin always carries the upper track', () => {
    const { net, centre, ns, ew } = diamond()
    setNodesLevel(net, farEnds(ns, centre.id), -1)

    const twinId = separateLevelsAtNode(net, centre.id, ns[0].id, -1)!

    expect([...net.adjacency.get(twinId)!].sort()).toEqual(ew.map((seg) => seg.id).sort())
    expect(nodeLevel(net.nodes.get(twinId))).toBe(0)
    expect(nodeLevel(centre)).toBe(-1)
    for (const seg of ns) expect(segmentEndLevels(net, seg)).toEqual({ from: -1, to: -1 })
    for (const seg of ew) expect(segmentEndLevels(net, seg)).toEqual({ from: 0, to: 0 })
  })

  it('two tracks through one node are at the same height there: a crossing, whatever that height', () => {
    const { net, centre } = diamond()
    setNodesLevel(net, [centre.id], 1)
    expect(detectCrossings(net)).toHaveLength(1)
    expect(reconcileNetworkIntersections(net)).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(net.adjacency.get(centre.id)).toHaveLength(4)
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
    expect(turnoutView(net, junc)!.stemNodeId).toBe(centre.id)

    const nsNow = net.adjacency.get(centre.id)!.map((sid) => net.segments.get(sid)!)
      .filter((seg) => [seg.from, seg.to].some((nid) => Math.abs(net.nodes.get(nid)!.pos.y) > 1))
    setNodesLevel(net, farEnds(nsNow, centre.id), 1)
    const twinId = separateLevelsAtNode(net, centre.id, nsNow[0].id, 1)!

    expect(turnoutView(net, junc)!.stemNodeId).toBe(twinId)
    // What notify() re-derives from the topology agrees
    autoDetectJunctions(net)
    expect(turnoutView(net, [...net.junctions.values()].find((j) => j.nodeId === cut.midNode.id))!.stemNodeId).toBe(twinId)
  })
})

describe('picking what is on top', () => {
  it('hitSegment and snapToNearestTrack prefer the upper of two rails at the same distance', () => {
    for (const bridgeFirst of [false, true]) {
      const net = createNetwork()
      const w = addNode(net, { x: -100, y: 0 })
      const e = addNode(net, { x: 100, y: 0 })
      const s = addNode(net, { x: 0, y: -100 }, 1)
      const n = addNode(net, { x: 0, y: 100 }, 1)
      // Either insertion order: the choice does not depend on which rail was laid first
      const bridge = bridgeFirst ? addSegment(net, s.id, n.id)! : null
      const ground = addSegment(net, w.id, e.id)!
      const top = bridge ?? addSegment(net, s.id, n.id)!

      expect(hitSegment(net, { x: 0, y: 0 }, 5)).toBe(top.id)
      expect(snapToNearestTrack(net, { x: 0, y: 0 }, 5)!.segId).toBe(top.id)
      // Clearly nearer the ground rail: distance still wins
      expect(hitSegment(net, { x: 3, y: 0.5 }, 5)).toBe(ground.id)
      expect(snapToNearestTrack(net, { x: 3, y: 0.5 }, 5)!.segId).toBe(ground.id)
      // A tunnel under the ground rail is not what is seen
      setRailsLevel(net, [top], -1)
      expect(hitSegment(net, { x: 0, y: 0 }, 5)).toBe(ground.id)
      expect(snapToNearestTrack(net, { x: 0, y: 0 }, 5)!.segId).toBe(ground.id)
    }
  })

  it('on a ramp it is the height at that place that counts, not the height the ramp reaches', () => {
    for (const rampFirst of [false, true]) {
      // Down from 1 (west) to −1 (east), over a ground track at x = −60 and under another at x = 60
      const net = createNetwork()
      const a = addNode(net, { x: -100, y: 0 }, 1)
      const b = addNode(net, { x: 100, y: 0 }, -1)
      const ramp = rampFirst ? addSegment(net, a.id, b.id)! : null
      const across = (x: number) => addSegment(net, addNode(net, { x, y: -50 }).id, addNode(net, { x, y: 50 }).id)!
      const under = across(-60)
      const over = across(60)
      const rampId = (ramp ?? addSegment(net, a.id, b.id)!).id

      expect(hitSegment(net, { x: -60, y: 0 }, 5)).toBe(rampId)
      expect(snapToNearestTrack(net, { x: -60, y: 0 }, 5)!.segId).toBe(rampId)
      expect(hitSegment(net, { x: 60, y: 0 }, 5)).toBe(over.id)
      expect(snapToNearestTrack(net, { x: 60, y: 0 }, 5)!.segId).toBe(over.id)
      expect(net.segments.has(under.id)).toBe(true)
    }
  })

  it('hitNode prefers the upper of two stacked nodes', () => {
    const { net } = cross()
    reconcileNetworkIntersections(net)
    const centre = [...net.nodes.values()].find((nd) => net.adjacency.get(nd.id)!.length === 4)!
    const ns = net.adjacency.get(centre.id)!.map((sid) => net.segments.get(sid)!)
      .filter((seg) => [seg.from, seg.to].some((nid) => Math.abs(net.nodes.get(nid)!.pos.y) > 1))
    const twinId = separateLevelsAtNode(net, centre.id, ns[0].id, 1)!

    expect(hitNode(net, { x: 0.2, y: 0.1 }, 5)).toBe(twinId)
    setNodesLevel(net, [twinId], -1)
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

describe('gradient of a ramp', () => {
  it('a rail from a node on level 1 down to a ground node: rise × level height ÷ length, in ‰, signed along the rail', () => {
    const net = createNetwork()
    const top = addNode(net, { x: 0, y: 0 }, 1)
    const foot = addNode(net, { x: 150, y: 200 }) // 250 m away
    const seg = addSegment(net, top.id, foot.id)!

    expect(net.segments.size).toBe(1)
    expect(isRamp(net, seg)).toBe(true)
    expect(segmentGradient(net, seg, 6)).toBeCloseTo(-24, 9) // 6 m down over 250 m
    expect(segmentGradient(net, seg, 6 / 87)).toBeCloseTo(-24 / 87, 9)
    // The same rail laid the other way climbs
    const back = createNetwork()
    const a = addNode(back, { x: 150, y: 200 })
    const b = addNode(back, { x: 0, y: 0 }, 1)
    expect(segmentGradient(back, addSegment(back, a.id, b.id)!, 6)).toBeCloseTo(24, 9)
  })

  it('is 0 on a flat rail, whatever its height, and counts half levels', () => {
    expect(segmentGradient(rail(0, 0).net, rail(0, 0).seg, 6)).toBe(0)
    const bridge = rail(2, 2)
    expect(segmentGradient(bridge.net, bridge.seg, 6)).toBe(0)
    const half = rail(0, 0.5)
    expect(segmentGradient(half.net, half.seg, 6)).toBeCloseTo(30, 9)
  })

  it('cut in the middle, a ramp gives two rails of the same slope as before', () => {
    const { net, seg } = rail(1, 0)
    const before = segmentGradient(net, seg, 6)
    expect(before).toBeCloseTo(-60, 9)

    const cut = splitSegment(net, seg.id, { x: 50, y: 0 })!
    expect(nodeLevel(cut.midNode)).toBeCloseTo(0.5, 9)
    const pieces = [...net.segments.values()]
    expect(pieces).toHaveLength(2)
    for (const piece of pieces) {
      // Each piece keeps the direction of the rail it comes from
      expect(Math.abs(segmentGradient(net, piece, 6))).toBeCloseTo(60, 9)
      expect(segmentRunLength(net, piece)).toBeCloseTo(50, 9)
    }
  })
})

describe('evening out the slope of a run of rails', () => {
  /** Rails laid end to end along x through `xs`, the nodes at `levels` */
  function run(xs: number[], levels: number[]) {
    const net = createNetwork()
    const nodes = xs.map((x, i) => addNode(net, { x, y: 0 }, levels[i]))
    const segs = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
    return { net, nodes, segs, ids: segs.map((seg) => seg.id) }
  }
  const gradients = (net: Network, segs: Segment[]) => segs.map((seg) => segmentGradient(net, seg, 6))

  it('three rails of different lengths end up on one slope, the two ends where they were', () => {
    // 100 m, 300 m and 200 m: the climb is all on the first rail
    const { net, nodes, segs, ids } = run([0, 100, 400, 600], [0, 1, 1, 1])
    expect(gradients(net, segs)).toEqual([60, 0, 0])
    expect(canSpreadGradient(net, ids)).toBe(true)

    expect(spreadGradient(net, ids)).toBe(2)

    expect(nodes.map(nodeLevel)).toEqual([0, 1 / 6, 4 / 6, 1])
    for (const permille of gradients(net, segs)) expect(permille).toBeCloseTo(10, 9) // 6 m over 600 m
    // Nothing left to do
    expect(canSpreadGradient(net, ids)).toBe(false)
    expect(spreadGradient(net, ids)).toBe(0)
  })

  it('does not depend on the order of the rails given, nor on the way each one was laid', () => {
    const net = createNetwork()
    const n = [0, 100, 400, 600].map((x, i) => addNode(net, { x, y: 0 }, i === 3 ? -2 : 0))
    const first = addSegment(net, n[1].id, n[0].id)! // laid backwards
    const second = addSegment(net, n[1].id, n[2].id)!
    const third = addSegment(net, n[3].id, n[2].id)! // laid backwards

    expect(spreadGradient(net, [third.id, first.id, second.id])).toBe(2)
    n.map(nodeLevel).forEach((level, i) => expect(level).toBeCloseTo([0, -2 / 6, -8 / 6, -2][i], 12))
    expect(segmentGradient(net, first, 6)).toBeCloseTo(20, 9) // climbs towards n0
    expect(segmentGradient(net, second, 6)).toBeCloseTo(-20, 9)
    expect(segmentGradient(net, third, 6)).toBeCloseTo(20, 9)
  })

  it('flattens a hump between two ends at the same height', () => {
    const { net, nodes, ids } = run([0, 100, 200], [1, 2, 1])
    expect(canSpreadGradient(net, ids)).toBe(true)
    expect(spreadGradient(net, ids)).toBe(1)
    expect(nodes.map(nodeLevel)).toEqual([1, 1, 1])

    // Back on the ground the height is stored as no field at all
    const ground = run([0, 100, 200], [0, 1, 0])
    spreadGradient(ground.net, ground.ids)
    expect('level' in ground.nodes[1]).toBe(false)
  })

  it('measures curves along their arc', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 200, y: 100 }, 1)
    const straight = addSegment(net, a.id, b.id)!
    const curve = addCurveSegment(net, b.id, c.id, { x: 200, y: 0 })!

    expect(spreadGradient(net, [straight.id, curve.id])).toBe(1)
    const arc = segmentRunLength(net, curve)
    expect(arc).toBeGreaterThan(Math.hypot(100, 100))
    expect(nodeLevel(b)).toBeCloseTo(100 / (100 + arc), 9)
    expect(segmentGradient(net, straight, 6)).toBeCloseTo(segmentGradient(net, curve, 6), 9)
  })

  it('a turnout along the run is no obstacle: its branch, not selected, follows the node', () => {
    const { net, nodes, ids } = run([0, 100, 200], [0, 0, 1])
    const side = addNode(net, { x: 200, y: 30 })
    const branch = addSegment(net, nodes[1].id, side.id)!

    expect(gradientRun(net, ids)?.nodeIds).toEqual(nodes.map((node) => node.id))
    expect(spreadGradient(net, ids)).toBe(1)
    expect(nodeLevel(nodes[1])).toBe(0.5)
    expect(segmentEndLevels(net, branch)).toEqual({ from: 0.5, to: 0 })
    // With the branch in the selection there is a fork: not a run
    expect(gradientRun(net, [...ids, branch.id])).toBeNull()
  })

  it('does nothing when the rails are not one run', () => {
    const untouched = (net: Network, ids: string[]) => {
      const before = [...net.nodes.values()].map(nodeLevel)
      expect(gradientRun(net, ids)).toBeNull()
      expect(canSpreadGradient(net, ids)).toBe(false)
      expect(spreadGradient(net, ids)).toBe(0)
      expect([...net.nodes.values()].map(nodeLevel)).toEqual(before)
    }

    // A single rail, nothing, or rails that are gone
    const single = run([0, 100], [0, 1])
    untouched(single.net, single.ids)
    untouched(single.net, [])
    untouched(single.net, ['s_404', 's_405'])

    // Two stretches that do not touch
    const apart = run([0, 100, 200, 300, 400], [0, 1, 0, 1, 0])
    untouched(apart.net, [apart.ids[0], apart.ids[1], apart.ids[3]])
    untouched(apart.net, [apart.ids[0], apart.ids[3]])

    // A fork inside the selection
    const fork = run([0, 100, 200], [0, 1, 0])
    const side = addNode(fork.net, { x: 200, y: 30 }, 2)
    untouched(fork.net, [...fork.ids, addSegment(fork.net, fork.nodes[1].id, side.id)!.id])

    // A closed loop has no ends
    const loop = createNetwork()
    const p = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }].map((pos, i) => addNode(loop, pos, i))
    const sides = [addSegment(loop, p[0].id, p[1].id)!, addSegment(loop, p[1].id, p[2].id)!, addSegment(loop, p[2].id, p[0].id)!]
    untouched(loop, sides.map((seg) => seg.id))
    // A run next to a loop: two ends, but not one stretch
    const q = [{ x: 300, y: 0 }, { x: 400, y: 0 }, { x: 500, y: 0 }].map((pos, i) => addNode(loop, pos, i === 1 ? 1 : 0))
    const stretch = [addSegment(loop, q[0].id, q[1].id)!, addSegment(loop, q[1].id, q[2].id)!]
    untouched(loop, [...sides, ...stretch].map((seg) => seg.id))
  })

  it('once evened out, the inner nodes of a straight run can be dissolved without changing the slope', () => {
    const { net, nodes, ids } = run([0, 100, 400, 600], [0, 1, 1, 1])
    expect(dissolveNode(net, nodes[1].id)).toBeNull() // uneven: removing the node would change the slope
    spreadGradient(net, ids)
    expect(dissolveNode(net, nodes[1].id)).not.toBeNull()
    expect(dissolveNode(net, nodes[2].id)).not.toBeNull()
    const [merged] = [...net.segments.values()]
    expect(Math.abs(segmentGradient(net, merged, 6))).toBeCloseTo(10, 9)
  })
})

describe('a curved ramp crossing a ground track', () => {
  it('detectCrossings and reconcile agree on which of its two crossings is a level crossing', () => {
    // A curve from (-100, 0) to (100, 0) bulging up to y = 50 and climbing from 0 to 1, over a
    // ground track along y = 32: reached at t = 0.2 and t = 0.8, where the curve is at 0.2 and 0.8
    const net = createNetwork()
    const a = addNode(net, { x: -100, y: 0 })
    const b = addNode(net, { x: 100, y: 0 }, 1)
    addCurveSegment(net, a.id, b.id, { x: 0, y: 100 })
    const w = addNode(net, { x: -200, y: 32 })
    const e = addNode(net, { x: 200, y: 32 })
    addSegment(net, w.id, e.id)

    const found = detectCrossings(net)
    expect(found).toHaveLength(1)
    expect(found[0].center.x).toBeCloseTo(-60, 0)

    const nodes = net.nodes.size
    reconcileNetworkIntersections(net, 0.5)
    expect(net.nodes.size).toBe(nodes + 1)
    const added = [...net.nodes.values()].at(-1)!
    expect(added.pos.x).toBeCloseTo(-60, 1)
    expect(added.pos.y).toBeCloseTo(32, 6)
  })
})
