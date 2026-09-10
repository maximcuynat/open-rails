import { describe, expect, it } from 'vitest'
import {
  bezierStartTangent,
  bezierEndTangent,
  viaFromArc,
  viaFromTwoTangents,
  outgoingTangent,
  segmentTangentAt,
  arcRadius,
  arcDeflectionDeg,
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

describe('viaFromArc', () => {
  it('returns midpoint for straight line (end on tangent)', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 10, y: 0 }
    const dir = { x: 1, y: 0 }
    const via = viaFromArc(start, end, dir)
    expect(via.x).toBeCloseTo(5)
    expect(via.y).toBeCloseTo(0)
  })

  it('produces a small-angle curve when end slightly off tangent', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 100, y: 10 }
    const dir = { x: 1, y: 0 }
    const via = viaFromArc(start, end, dir)
    // For a circular arc, the via is along the tangent line (y≈0)
    // The via should be far along the tangent for a gentle curve
    expect(via.x).toBeGreaterThan(0)
    // Via y should be close to 0 (along the tangent line)
    expect(Math.abs(via.y)).toBeLessThan(1)
  })

  it('produces a 90° curve when end at 45° from tangent (quarter circle)', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 10, y: 10 }
    const dir = { x: 1, y: 0 }
    const via = viaFromArc(start, end, dir)
    // tangent at 0°, chord at 45° → α=45° → deflection=90° (quarter circle)
    // via is along the tangent (y=0) at x≈10
    expect(via.x).toBeCloseTo(10, 0)
    expect(via.y).toBeCloseTo(0, 0)
  })

  it('does NOT force 90° — small angle stays small', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 100, y: 5 } // very slight deviation
    const dir = { x: 1, y: 0 }
    const via = viaFromArc(start, end, dir)
    // For small angle, the via should be along the tangent at roughly
    // half the chord distance (not at the endpoint or beyond)
    expect(via.x).toBeGreaterThan(40)
    expect(via.x).toBeLessThan(60)
    expect(via.y).toBeCloseTo(0, 0)
    // The deflection should be small (not 90°)
    const deflection = arcDeflectionDeg(start, end, dir)
    expect(deflection).toBeLessThan(10)
  })

  it('handles end behind the tangent (large angle)', () => {
    const start = { x: 0, y: 0 }
    const end = { x: -10, y: 10 }
    const dir = { x: 1, y: 0 }
    const via = viaFromArc(start, end, dir)
    // Should produce a valid via (not crash)
    expect(isFinite(via.x)).toBe(true)
    expect(isFinite(via.y)).toBe(true)
  })
})

describe('arcRadius', () => {
  it('returns Infinity for straight line', () => {
    const r = arcRadius({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 1, y: 0 })
    expect(r).toBe(Infinity)
  })

  it('returns a finite radius for a curved arc', () => {
    const r = arcRadius({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 1, y: 0 })
    expect(r).toBeLessThan(Infinity)
    expect(r).toBeGreaterThan(0)
  })

  it('larger radius for gentler curve', () => {
    const tight = arcRadius({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 1, y: 0 })
    const gentle = arcRadius({ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 1, y: 0 })
    expect(gentle).toBeGreaterThan(tight)
  })
})

describe('arcDeflectionDeg', () => {
  it('returns 0 for straight line', () => {
    const deg = arcDeflectionDeg({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 1, y: 0 })
    expect(deg).toBeLessThan(0.1)
  })

  it('returns approximately 90° for a 45° chord (quarter circle)', () => {
    const deg = arcDeflectionDeg({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 1, y: 0 })
    // chord at 45°, tangent at 0° → α = 45° → deflection = 90°
    expect(deg).toBeCloseTo(90, 0)
  })

  it('returns approximately 180° for perpendicular chord (U-turn)', () => {
    const deg = arcDeflectionDeg({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 1, y: 0 })
    // chord at 90°, tangent at 0° → α = 90° → deflection = 180° (semicircle)
    expect(deg).toBeCloseTo(180, 0)
  })

  it('small deflection for slight curve', () => {
    const deg = arcDeflectionDeg({ x: 0, y: 0 }, { x: 100, y: 5 }, { x: 1, y: 0 })
    expect(deg).toBeLessThan(10)
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

  it('falls back to arc when tangents are parallel', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 10, y: 0 }
    const inDir = { x: 1, y: 0 }
    const outDir = { x: 1, y: 0 } // parallel
    const via = viaFromTwoTangents(start, end, inDir, outDir)
    // Should fall back to viaFromArc which returns midpoint for straight
    expect(via.x).toBeCloseTo(5)
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
