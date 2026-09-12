import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment } from '../core/network'
import { autoDetectJunctions, toggleJunction } from '../core/junction'
import {
  getNodeSegmentEndVector,
  getNodeSegmentEnds,
  getConnectedEndPairs,
  GAUGE,
  BALLAST_WIDTH,
} from './renderer'
import type { Camera, Selection } from './renderer'

const dummyCam: Camera = { x: 0, y: 0, scale: 1 }
const dummySel: Selection = { nodes: new Set(), segments: new Set() }

describe('Junction Alignment & Dynamic Geometry', () => {
  it('computes correct outgoing tangent and left normal regardless of segment orientation', () => {
    const net = createNetwork()
    const nA = addNode(net, { x: 0, y: 100 })
    const nB = addNode(net, { x: 100, y: 100 })
    const seg = addSegment(net, nA.id, nB.id)!

    // At nA (node is seg.from): outgoing points towards +X (1, 0), left normal is -Y (0, -1)
    const vecA = getNodeSegmentEndVector(net, seg, nA.id)
    expect(vecA.tangent.x).toBeCloseTo(1, 4)
    expect(vecA.tangent.y).toBeCloseTo(0, 4)
    expect(vecA.normal.x).toBeCloseTo(0, 4)
    expect(vecA.normal.y).toBeCloseTo(1, 4)

    // At nB (node is seg.to): outgoing points towards -X (-1, 0), left normal is +Y (0, -1)
    const vecB = getNodeSegmentEndVector(net, seg, nB.id)
    expect(vecB.tangent.x).toBeCloseTo(-1, 4)
    expect(vecB.tangent.y).toBeCloseTo(0, 4)
    expect(vecB.normal.x).toBeCloseTo(0, 4)
    expect(vecB.normal.y).toBeCloseTo(-1, 4)
  })

  it('aligns rails and ballast with 0 error for collinear segments drawn in opposite directions', () => {
    const net = createNetwork()
    // n1 -> nCenter, and n2 -> nCenter (both drawn pointing INTO nCenter)
    const n1 = addNode(net, { x: 0, y: 100 })
    const nCenter = addNode(net, { x: 100, y: 100 })
    const n2 = addNode(net, { x: 200, y: 100 })

    addSegment(net, n1.id, nCenter.id) // to === nCenter
    addSegment(net, n2.id, nCenter.id) // to === nCenter

    const ends = getNodeSegmentEnds(net, nCenter, dummyCam, 0, 0, dummySel)
    expect(ends.length).toBe(2)

    const pairs = getConnectedEndPairs(nCenter, ends, dummyCam, 0, 0)
    expect(pairs.length).toBe(1)

    const p = pairs[0]
    const hg = GAUGE / 2
    const hb = BALLAST_WIDTH / 2

    // Left rail of seg 1 must match left rail of seg 2 exactly
    expect(p.r1LW.x).toBeCloseTo(100, 4)
    expect(p.r1LW.y).toBeCloseTo(100 + hg, 4)
    expect(p.r2LW.x).toBeCloseTo(100, 4)
    expect(p.r2LW.y).toBeCloseTo(100 + hg, 4)
    expect(p.jLeftW.x).toBeCloseTo(100, 4)
    expect(p.jLeftW.y).toBeCloseTo(100 + hg, 4)

    // Right rail of seg 1 must match right rail of seg 2 exactly
    expect(p.r1RW.x).toBeCloseTo(100, 4)
    expect(p.r1RW.y).toBeCloseTo(100 - hg, 4)
    expect(p.r2RW.x).toBeCloseTo(100, 4)
    expect(p.r2RW.y).toBeCloseTo(100 - hg, 4)
    expect(p.jRightW.x).toBeCloseTo(100, 4)
    expect(p.jRightW.y).toBeCloseTo(100 - hg, 4)

    // Ballast edges must match exactly
    expect(p.b1LW.y).toBeCloseTo(100 + hb, 4)
    expect(p.b2LW.y).toBeCloseTo(100 + hb, 4)
    expect(p.b1RW.y).toBeCloseTo(100 - hb, 4)
    expect(p.b2RW.y).toBeCloseTo(100 - hb, 4)
  })

  it('computes dynamic miter intersection when tracks meet at 90 degrees', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 100 })
    const corner = addNode(net, { x: 100, y: 100 })
    const n2 = addNode(net, { x: 100, y: 200 })

    addSegment(net, n1.id, corner.id)
    addSegment(net, corner.id, n2.id)

    const ends = getNodeSegmentEnds(net, corner, dummyCam, 0, 0, dummySel)
    const pairs = getConnectedEndPairs(corner, ends, dummyCam, 0, 0)
    expect(pairs.length).toBe(1)

    const p = pairs[0]
    const hg = GAUGE / 2
    // For 90 degree corner, bisector distance is hg / cos(45°) = hg * sqrt(2)
    const expectedMiter = hg * Math.SQRT2

    const distLeft = Math.hypot(p.jLeftW.x - corner.pos.x, p.jLeftW.y - corner.pos.y)
    expect(distLeft).toBeCloseTo(expectedMiter, 3)

    const distRight = Math.hypot(p.jRightW.x - corner.pos.x, p.jRightW.y - corner.pos.y)
    expect(distRight).toBeCloseTo(expectedMiter, 3)
  })

  it('connects turnout routes correctly and rejects straight-diverging pairing', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 246, y: 0 })
    const div = addNode(net, { x: 240, y: 40 })

    const sStem = addSegment(net, stem.id, apex.id)!
    const sStraight = addSegment(net, apex.id, straight.id)!
    const sDiv = addCurveSegment(net, apex.id, div.id, { x: 120, y: 0 })!

    autoDetectJunctions(net)
    expect(net.junctions.size).toBe(1)

    const ends = getNodeSegmentEnds(net, apex, dummyCam, 0, 0, dummySel)
    expect(ends.length).toBe(3)

    const pairs = getConnectedEndPairs(apex, ends, dummyCam, 0, 0)
    // Exactly 2 pairs: (stem, straight) and (stem, diverging)
    // (straight, diverging) MUST NOT be paired
    expect(pairs.length).toBe(2)

    const pairSegs = pairs.map(p => new Set([p.e1.segId, p.e2.segId]))
    expect(pairSegs.some(s => s.has(sStem.id) && s.has(sStraight.id))).toBe(true)
    expect(pairSegs.some(s => s.has(sStem.id) && s.has(sDiv.id))).toBe(true)
    expect(pairSegs.some(s => s.has(sStraight.id) && s.has(sDiv.id))).toBe(false)
  })

  it('dynamically reflects activeBranch when toggling junction', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 246, y: 0 })
    const div = addNode(net, { x: 240, y: 40 })

    addSegment(net, stem.id, apex.id)
    const sStraight = addSegment(net, apex.id, straight.id)!
    const sDiv = addCurveSegment(net, apex.id, div.id, { x: 120, y: 0 })!

    const [junc] = autoDetectJunctions(net)
    expect(junc.activeBranch).toBe('straight')

    // In 'straight' mode, diverging branch is inactive
    let ends = getNodeSegmentEnds(net, apex, dummyCam, 0, 0, dummySel)
    let divEnd = ends.find(e => e.segId === sDiv.id)
    let straightEnd = ends.find(e => e.segId === sStraight.id)
    expect(divEnd?.isInactive).toBe(true)
    expect(straightEnd?.isInactive).toBe(false)

    // Toggle junction to 'diverging'
    toggleJunction(junc)
    expect(junc.activeBranch).toBe('diverging')

    ends = getNodeSegmentEnds(net, apex, dummyCam, 0, 0, dummySel)
    divEnd = ends.find(e => e.segId === sDiv.id)
    straightEnd = ends.find(e => e.segId === sStraight.id)
    expect(divEnd?.isInactive).toBe(false)
    expect(straightEnd?.isInactive).toBe(true)
  })
})
