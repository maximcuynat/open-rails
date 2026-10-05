import { describe, it, expect } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment, nodeLevel, segmentGradient } from '@domain/models/network'
import { reconcileNetworkIntersections } from '@domain/geometry/reconcile'
import { placementThresholds } from '@domain/geometry/scale'
import {
  computeAutoConnectGeometry,
  applyAutoConnect,
  computeCrossoverPreview,
  applyCrossover,
  computeParallelTurnoutPreview,
  applyParallelTurnout,
  computeFreeformParallelTurnout,
  applyFreeformParallelTurnout,
  computePassingSidingPreview,
  applyPassingSiding,
  computeBalloonLoopPreview,
  applyBalloonLoop,
  performTrackCut,
} from './constructionTemplates'

describe('constructionTemplates', () => {
  describe('Auto-Connect', () => {
    it('connects two aligned nodes with a straight track', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 20, y: 0 })

      const geom = computeAutoConnectGeometry(net, n1.id, n2.id)
      expect(geom).not.toBeNull()
      expect(geom?.kind).toBe('straight')

      const success = applyAutoConnect(net, n1.id, n2.id)
      expect(success).toBe(true)
      expect(net.segments.size).toBe(1)
    })

    it('connects two perpendicular tracks with a smooth single curve', () => {
      const net = createNetwork()
      // Track 1 heading east into n1
      const n0 = addNode(net, { x: -20, y: 0 })
      const n1 = addNode(net, { x: 0, y: 0 })
      addSegment(net, n0.id, n1.id)

      // Track 2 heading south from n2
      const n2 = addNode(net, { x: 30, y: 30 })
      const n3 = addNode(net, { x: 30, y: 50 })
      addSegment(net, n2.id, n3.id)

      const geom = computeAutoConnectGeometry(net, n1.id, n2.id)
      expect(geom).not.toBeNull()
      expect(geom?.kind).toBe('single-curve')
      expect(geom?.segments[0].via).toBeDefined()

      const success = applyAutoConnect(net, n1.id, n2.id)
      expect(success).toBe(true)
      expect(net.segments.size).toBe(3)
    })

    it('connects two parallel offset tracks with an S-curve (reverse curve)', () => {
      const net = createNetwork()
      // Track 1 along y=0 heading east
      const n0 = addNode(net, { x: -20, y: 0 })
      const n1 = addNode(net, { x: 0, y: 0 })
      addSegment(net, n0.id, n1.id)

      // Track 2 along y=10 heading east from n2
      const n2 = addNode(net, { x: 40, y: 10 })
      const n3 = addNode(net, { x: 60, y: 10 })
      addSegment(net, n2.id, n3.id)

      const geom = computeAutoConnectGeometry(net, n1.id, n2.id)
      expect(geom).not.toBeNull()
      expect(geom?.kind).toBe('s-curve')
      expect(geom?.segments.length).toBe(2)
      expect(geom?.intermediateNodes.length).toBe(1)

      const success = applyAutoConnect(net, n1.id, n2.id)
      expect(success).toBe(true)
      expect(net.segments.size).toBe(4) // 2 original + 2 S-curve segments
    })
  })

  describe('Crossover (Bretelle de communication)', () => {
    it('computes and creates a diagonal crossover between 2 parallel tracks', () => {
      const net = createNetwork()
      // Track 1
      const t1A = addNode(net, { x: 0, y: 0 })
      const t1B = addNode(net, { x: 100, y: 0 })
      const s1 = addSegment(net, t1A.id, t1B.id)!

      // Track 2 parallel at y = 4
      const t2A = addNode(net, { x: 0, y: 4 })
      const t2B = addNode(net, { x: 100, y: 4 })
      const s2 = addSegment(net, t2A.id, t2B.id)!

      const preview = computeCrossoverPreview(net, s1.id, s2.id, { x: 50, y: 2 }, 15)
      expect(preview).not.toBeNull()
      expect(preview?.valid).toBe(true)
      expect(preview?.distance).toBeCloseTo(4, 1)

      const success = applyCrossover(net, preview!)
      expect(success).toBe(true)
      // Both tracks should be split and joined by 2 curved segments (S-curve)
      expect(net.segments.size).toBeGreaterThan(4)
      const curves = Array.from(net.segments.values()).filter((s) => s.kind === 'curve')
      expect(curves.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Parallel Turnout (Aiguillage Parallèle avec contre-courbe)', () => {
    it('creates a parallel turnout branching off a track and ending strictly parallel', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 100, y: 0 })
      addSegment(net, n1.id, n2.id)

      const preview = computeParallelTurnoutPreview(net, { x: 30, y: 1 }, 4.0, 40.0, 1)
      expect(preview).not.toBeNull()
      expect(preview?.valid).toBe(true)
      expect(preview?.offset).toBe(4.0)
      expect(preview?.endPos.y).toBeCloseTo(4.0, 1) // strictly at parallel offset
      expect(preview?.tangent.y).toBeCloseTo(0, 3) // tangent parallel to x-axis

      const res = applyParallelTurnout(net, preview!)
      expect(res).not.toBeNull()
      expect(net.nodes.size).toBe(5) // 2 original + 1 turnout node + 1 midpoint node + 1 end node
      const curves = Array.from(net.segments.values()).filter((s) => s.kind === 'curve')
      expect(curves.length).toBe(2) // 2 curved segments forming the smooth S-curve
    })

    it('computes freeform parallel turnout to interactive cursor with free end and spacing', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 100, y: 0 })
      addSegment(net, n1.id, n2.id)

      // Target cursor at dx = 35m, lateral offset = 5.2m
      const geom = computeFreeformParallelTurnout({ x: 10, y: 0 }, { x: 1, y: 0 }, { x: 45, y: 5.2 })
      expect(geom).not.toBeNull()
      expect(geom?.valid).toBe(true)
      expect(geom?.dx).toBe(35)
      expect(geom?.offset).toBeCloseTo(5.2, 2)
      expect(geom?.endPos.x).toBe(45)
      expect(geom?.endPos.y).toBeCloseTo(5.2, 2)
      expect(geom?.tangent.x).toBe(1)
      expect(geom?.tangent.y).toBe(0)
      expect(geom?.radius).toBeGreaterThan(15)

      const res = applyFreeformParallelTurnout(net, n1.id, geom!)
      expect(res.midNode).toBeDefined()
      expect(res.endNode).toBeDefined()
      expect(res.endNode.pos.y).toBeCloseTo(5.2, 2)
      // 1 straight original + 2 halves of ~16.9° each, inserted as 2 arc pieces per half (max 15° per piece)
      expect(net.segments.size).toBe(5)
    })

    it('flags a freeform parallel turnout tighter than the minimum radius as invalid', () => {
      // 4 m advance for 3 m offset: R = (16 + 9) / 12 ≈ 2.1 m
      const tight = computeFreeformParallelTurnout({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 4, y: 3 })
      expect(tight?.radius).toBeCloseTo(25 / 12, 6)
      expect(tight?.valid).toBe(false)

      // Same geometry accepted when the caller lowers the minimum, refused when it raises it
      expect(computeFreeformParallelTurnout({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 4, y: 3 }, { minRadius: 2 })?.valid).toBe(true)
      const wide = computeFreeformParallelTurnout({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 35, y: 5.2 })
      expect(wide?.valid).toBe(true)
      expect(computeFreeformParallelTurnout({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 35, y: 5.2 }, { minRadius: 100 })?.valid).toBe(false)
    })
  })

  describe('Passing Siding (Voie d\'évitement)', () => {
    it('generates a siding alongside an existing track', () => {
      const net = createNetwork()
      const nA = addNode(net, { x: 0, y: 0 })
      const nB = addNode(net, { x: 200, y: 0 })
      const seg = addSegment(net, nA.id, nB.id)!

      const preview = computePassingSidingPreview(net, seg.id, { x: 100, y: 0 }, 80, 4.0)
      expect(preview).not.toBeNull()
      expect(preview?.valid).toBe(true)
      expect(preview?.length).toBe(80)

      const success = applyPassingSiding(net, preview!)
      expect(success).toBe(true)
      expect(net.nodes.size).toBeGreaterThan(4)
      const curves = Array.from(net.segments.values()).filter((s) => s.kind === 'curve')
      expect(curves.length).toBe(4) // 2 entry curves + 2 exit curves
    })
  })

  describe('Passing siding on a ramp', () => {
    it('leaves the main line on its slope and lets the siding climb evenly alongside it', () => {
      const net = createNetwork()
      const nA = addNode(net, { x: 0, y: 0 })
      const nB = addNode(net, { x: 200, y: 0 }, 2)
      const seg = addSegment(net, nA.id, nB.id)!
      const slope = segmentGradient(net, seg, 6) // 60 ‰

      const preview = computePassingSidingPreview(net, seg.id, { x: 100, y: 0 }, 80, 4.0)!
      expect(applyPassingSiding(net, preview)).toBe(true)

      // Every node of the main line sits on the original slope, the two turnouts included
      const onMain = [...net.nodes.values()].filter((n) => Math.abs(n.pos.y) < 1e-9)
      expect(onMain).toHaveLength(4)
      for (const n of onMain) expect(nodeLevel(n)).toBeCloseTo(n.pos.x / 100, 9)
      const main = [...net.segments.values()].filter((s) => Math.abs(net.nodes.get(s.from)!.pos.y) < 1e-9 && Math.abs(net.nodes.get(s.to)!.pos.y) < 1e-9)
      expect(main).toHaveLength(3)
      for (const s of main) expect(Math.abs(segmentGradient(net, s, 6))).toBeCloseTo(slope, 6)

      // The five rails of the siding share one slope, a little under that of the main line
      // (the siding is the longer way round)
      const siding = [...net.segments.values()].filter((s) => !main.includes(s))
      expect(siding).toHaveLength(5)
      const slopes = siding.map((s) => Math.abs(segmentGradient(net, s, 6)))
      for (const permille of slopes) expect(permille).toBeCloseTo(slopes[0], 6)
      expect(slopes[0]).toBeLessThan(slope)
      expect(slopes[0]).toBeGreaterThan(slope * 0.95)
    })

    it('on a flat bridge the whole siding is at the height of the bridge', () => {
      const net = createNetwork()
      const nA = addNode(net, { x: 0, y: 0 }, 1)
      const nB = addNode(net, { x: 200, y: 0 }, 1)
      const seg = addSegment(net, nA.id, nB.id)!
      expect(applyPassingSiding(net, computePassingSidingPreview(net, seg.id, { x: 100, y: 0 }, 80, 4.0)!)).toBe(true)
      for (const n of net.nodes.values()) expect(nodeLevel(n)).toBe(1)
    })
  })

  describe('Balloon Loop (Boucle de retournement)', () => {
    it('is laid at the height of the end node it leaves from, and joined to it', () => {
      for (const level of [1, -1, 0.5]) {
        const net = createNetwork()
        const n0 = addNode(net, { x: 0, y: 0 }, level)
        const n1 = addNode(net, { x: 50, y: 0 }, level)
        addSegment(net, n0.id, n1.id)

        const preview = computeBalloonLoopPreview(net, n1.id, 30)!
        expect(preview.level).toBe(level)
        expect(applyBalloonLoop(net, preview)).toBe(true)

        for (const n of net.nodes.values()) expect(nodeLevel(n)).toBe(level)
        // Welded to the track: no second node left at the end of it, which now carries the loop
        const atEnd = [...net.nodes.values()].filter((n) => Math.hypot(n.pos.x - 50, n.pos.y) < 1e-6)
        expect(atEnd).toHaveLength(1)
        expect(net.adjacency.get(atEnd[0].id)).toHaveLength(3)
      }
    })

    it('generates a loop reconnecting to the track endpoint', () => {
      const net = createNetwork()
      const n0 = addNode(net, { x: 0, y: 0 })
      const n1 = addNode(net, { x: 50, y: 0 })
      addSegment(net, n0.id, n1.id)

      const preview = computeBalloonLoopPreview(net, n1.id, 30)
      expect(preview).not.toBeNull()
      expect(preview?.valid).toBe(true)

      const success = applyBalloonLoop(net, preview!)
      expect(success).toBe(true)
      expect(net.segments.size).toBeGreaterThan(5)
    })
  })

  describe('Track Cut / Split Tool', () => {
    it('splits a segment into 2 at the cut point', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 100, y: 0 })
      addSegment(net, n1.id, n2.id)

      const success = performTrackCut(net, { x: 50, y: 0 }, 5.0)
      expect(success).toBe(true)
      expect(net.nodes.size).toBe(3)
      expect(net.segments.size).toBe(2)
    })

    it('cuts the segment under the cursor, not the first one of the network', () => {
      const net = createNetwork()
      const a1 = addNode(net, { x: 0, y: 0 })
      const a2 = addNode(net, { x: 100, y: 0 })
      const segA = addSegment(net, a1.id, a2.id)!
      const b1 = addNode(net, { x: 0, y: 50 })
      const b2 = addNode(net, { x: 100, y: 50 })
      const segB = addSegment(net, b1.id, b2.id)!

      expect(performTrackCut(net, { x: 40, y: 50.5 }, 2.0)).toBe(true)
      expect(net.segments.has(segA.id)).toBe(true) // A untouched
      expect(net.segments.has(segB.id)).toBe(false) // B replaced by its two halves
      expect(net.segments.size).toBe(3)
      const mid = [...net.nodes.values()].find((n) => ![a1.id, a2.id, b1.id, b2.id].includes(n.id))!
      expect(mid.pos).toEqual({ x: 40, y: 50 })
    })

    it('does nothing when the click is not on a track', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 100, y: 0 })
      addSegment(net, n1.id, n2.id)

      expect(performTrackCut(net, { x: 5000, y: 5000 }, 5.0)).toBe(false)
      expect(performTrackCut(net, { x: 50, y: 5.5 }, 5.0)).toBe(false)
      expect(net.nodes.size).toBe(2)
      expect(net.segments.size).toBe(1)
    })

    it('cuts a curved segment only when the click is on the curve', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 100, y: 100 })
      addCurveSegment(net, n1.id, n2.id, { x: 100, y: 0 })

      // On the chord, far from the curve itself
      expect(performTrackCut(net, { x: 50, y: 50 }, 2.0)).toBe(false)
      // On the curve apex (75, 25)
      expect(performTrackCut(net, { x: 75, y: 25 }, 2.0)).toBe(true)
      expect(net.segments.size).toBe(2)
    })

    it('detaches a node by pulling the rail end back along its own direction', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 100, y: 0 })
      const n3 = addNode(net, { x: 200, y: 0 })
      addSegment(net, n1.id, n2.id)
      const seg2 = addSegment(net, n2.id, n3.id)!

      expect(performTrackCut(net, { x: 100, y: 0 }, 1.0, 0.25)).toBe(true)
      expect(net.nodes.size).toBe(4)
      expect(net.segments.size).toBe(2)
      // The last segment of the node is detached; its new end stays on the track axis: no kink
      const detached = net.nodes.get(net.segments.get(seg2.id)!.from)!
      expect(detached.id).not.toBe(n2.id)
      expect(detached.pos).toEqual({ x: 100.25, y: 0 })
      expect(net.adjacency.get(n2.id)?.length).toBe(1)
      expect(net.adjacency.get(detached.id)).toEqual([seg2.id])
    })

    it('keeps the tangent of a detached curve end', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: -100, y: 0 })
      const n2 = addNode(net, { x: 0, y: 0 })
      const n3 = addNode(net, { x: 50, y: 50 })
      addSegment(net, n1.id, n2.id)
      const curve = addCurveSegment(net, n2.id, n3.id, { x: 50, y: 0 })!

      expect(performTrackCut(net, { x: 0, y: 0 }, 1.0, 0.25)).toBe(true)
      const detached = net.nodes.get(net.segments.get(curve.id)!.from)!
      // Moved towards the control point: the start tangent is still +x
      expect(detached.pos).toEqual({ x: 0.25, y: 0 })
      expect(net.segments.get(curve.id)!.via).toEqual({ x: 50, y: 0 })
    })

    it('the detached end survives the reconcile pass that follows, at 1:1 and at HO scale', () => {
      for (const gauge of [undefined, 0.0165]) {
        const th = placementThresholds(gauge)
        const net = createNetwork()
        const n1 = addNode(net, { x: 0, y: 0 })
        const n2 = addNode(net, { x: 100 * th.k, y: 0 })
        const n3 = addNode(net, { x: 200 * th.k, y: 0 })
        addSegment(net, n1.id, n2.id)
        addSegment(net, n2.id, n3.id)

        expect(performTrackCut(net, n2.pos, 1.0 * th.k, th.detachGap)).toBe(true)
        const res = reconcileNetworkIntersections(net, th.reconcileTolerance)
        expect(res).toEqual({ splitCount: 0, weldedCount: 0 })
        expect(net.nodes.size).toBe(4)
        expect(net.adjacency.get(n2.id)?.length).toBe(1)
      }
    })
  })
})
