import { describe, expect, it } from 'vitest'
import {
  bezierStartTangent,
  bezierEndTangent,
  viaFromTangent,
  viaFromTwoTangents,
  outgoingTangent,
  segmentTangentAt,
} from './tangent'
import { addNode, addSegment, addCurveSegment, createNetwork } from './network'

describe('bezierStartTangent', () => {
  it('returns direction from start to via', () => {
    const t = bezierStartTangent({ x: 0, y: 0 }, { x: 10, y: 0 })
    expect(t.x).toBeCloseTo(1)
    expect(t.y).toBeCloseTo(0)
  })

  it('is normalized', () => {
    const t = bezierStartTangent({ x: 0, y: 0 }, { x: 3, y: 4 })
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(1)
    expect(t.x).toBeCloseTo(0.6)
    expect(t.y).toBeCloseTo(0.8)
  })
})

describe('bezierEndTangent', () => {
  it('returns direction from via to end', () => {
    const t = bezierEndTangent({ x: 0, y: 5 }, { x: 10, y: 5 })
    expect(t.x).toBeCloseTo(1)
    expect(t.y).toBeCloseTo(0)
  })

  it('is normalized', () => {
    const t = bezierEndTangent({ x: 0, y: 0 }, { x: 0, y: 5 })
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(1)
    expect(t.y).toBeCloseTo(1)
  })
})

describe('viaFromTangent', () => {
  it('places via along the tangent direction', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 10, y: 0 }
    const dir = { x: 1, y: 0 }
    const via = viaFromTangent(start, end, dir)
    // Chord projection = 10, so via = start + 10 * (1,0) = (10, 0)
    expect(via.x).toBeCloseTo(10)
    expect(via.y).toBeCloseTo(0)
  })

  it('produces a curved via when end is off the tangent line', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 5, y: 5 }
    const dir = { x: 1, y: 0 }
    const via = viaFromTangent(start, end, dir)
    // k = 5*1 + 5*0 = 5, via = (5, 0)
    expect(via.x).toBeCloseTo(5)
    expect(via.y).toBeCloseTo(0)
    // The curve should bend: via is at (5,0) but end is at (5,5)
  })

  it('handles end behind the tangent (k negative)', () => {
    const start = { x: 0, y: 0 }
    const end = { x: -10, y: 0 }
    const dir = { x: 1, y: 0 }
    const via = viaFromTangent(start, end, dir)
    // k = -10, via = (-10, 0) — curve doubles back
    expect(via.x).toBeCloseTo(-10)
    expect(via.y).toBeCloseTo(0)
  })
})

describe('viaFromTwoTangents', () => {
  it('solves for via when tangents are not parallel', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 10, y: 10 }
    const inDir = { x: 1, y: 0 }  // going right
    const outDir = { x: 0, y: 1 } // leaving going up
    const via = viaFromTwoTangents(start, end, inDir, outDir)
    // k*in + m*out = end - start = (10, 10)
    // k*(1,0) + m*(0,1) = (10,10) → k=10, m=10
    // via = start + k * in = (10, 0)
    expect(via.x).toBeCloseTo(10)
    expect(via.y).toBeCloseTo(0)
  })

  it('falls back to viaFromTangent when tangents are parallel', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 10, y: 0 }
    const inDir = { x: 1, y: 0 }
    const outDir = { x: 1, y: 0 } // parallel
    const via = viaFromTwoTangents(start, end, inDir, outDir)
    // Should fall back: via = (10, 0)
    expect(via.x).toBeCloseTo(10)
    expect(via.y).toBeCloseTo(0)
  })
})

describe('segmentTangentAt', () => {
  it('returns direction for straight segment at from node', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    const t = segmentTangentAt(net, seg, a.id)
    expect(t).toEqual({ x: 1, y: 0 })
  })

  it('returns direction for straight segment at to node', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    const t = segmentTangentAt(net, seg, b.id)
    expect(t).toEqual({ x: 1, y: 0 })
  })

  it('returns start tangent for curve at from node', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 10 })
    const seg = addCurveSegment(net, a.id, b.id, { x: 10, y: 0 })!
    const t = segmentTangentAt(net, seg, a.id)
    // Start tangent = direction (via - start) = (10,0) normalized
    expect(t).toEqual({ x: 1, y: 0 })
  })

  it('returns end tangent for curve at to node', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 10 })
    const seg = addCurveSegment(net, a.id, b.id, { x: 10, y: 0 })!
    const t = segmentTangentAt(net, seg, b.id)
    // End tangent = direction (end - via) = (0, 10) normalized
    expect(t).toEqual({ x: 0, y: 1 })
  })
})

describe('outgoingTangent', () => {
  it('returns null for isolated node', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    expect(outgoingTangent(net, a.id)).toBeNull()
  })

  it('returns tangent from connected straight segment', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    addSegment(net, a.id, b.id)
    // At b, the outgoing tangent continues in direction (1, 0)
    const t = outgoingTangent(net, b.id)
    expect(t).toEqual({ x: 1, y: 0 })
  })

  it('returns tangent from connected curve segment at to node', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 10 })
    addCurveSegment(net, a.id, b.id, { x: 10, y: 0 })
    // At b, end tangent = (end - via) = (0, 10) normalized = (0, 1)
    const t = outgoingTangent(net, b.id)
    expect(t).toEqual({ x: 0, y: 1 })
  })

  it('excludes the specified segment', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const c = addNode(net, { x: 20, y: 10 })
    const s1 = addSegment(net, a.id, b.id)!
    addCurveSegment(net, b.id, c.id, { x: 15, y: 5 })
    // At b, excluding s1 should return curve tangent
    const t = outgoingTangent(net, b.id, s1.id)
    expect(t).not.toBeNull()
  })
})
