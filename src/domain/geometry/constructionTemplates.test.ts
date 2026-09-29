import { describe, it, expect } from 'vitest'
import { createNetwork, addNode, addSegment } from '@domain/models/network'
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
      expect(net.segments.size).toBe(3) // 1 straight original + 2 curves
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

  describe('Balloon Loop (Boucle de retournement)', () => {
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
  })
})
