import { describe, expect, it } from 'vitest'
import { bezierPoint, bezierTangent, bezierNormal, discretizeCurve, curveLength, distToCurve } from './curve'

describe('bezierPoint', () => {
  it('returns p0 at t=0', () => {
    const p = bezierPoint(0, { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 })
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(0)
  })

  it('returns p2 at t=1', () => {
    const p = bezierPoint(1, { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 })
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(0)
  })

  it('passes through control point at t=0.5 (symmetric case)', () => {
    const p = bezierPoint(0.5, { x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 })
    expect(p.x).toBeCloseTo(5)
    expect(p.y).toBeCloseTo(5)
  })
})

describe('bezierTangent', () => {
  it('is zero at a degenerate control point', () => {
    const t = bezierTangent(0.5, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 })
    expect(t.x).toBe(0)
    expect(t.y).toBe(0)
  })

  it('points horizontally at t=0.5 for a symmetric arch', () => {
    const t = bezierTangent(0.5, { x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 })
    expect(t.x).toBeCloseTo(10)
    expect(t.y).toBeCloseTo(0)
  })
})

describe('bezierNormal', () => {
  it('is perpendicular to the tangent', () => {
    const p0 = { x: 0, y: 0 }
    const p1 = { x: 5, y: 5 }
    const p2 = { x: 10, y: 0 }
    const n = bezierNormal(0.5, p0, p1, p2)
    const t = bezierTangent(0.5, p0, p1, p2)
    // dot product of normal and tangent should be 0
    expect(n.x * t.x + n.y * t.y).toBeCloseTo(0)
  })

  it('is normalized', () => {
    const n = bezierNormal(0.3, { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 })
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(1)
  })
})

describe('discretizeCurve', () => {
  it('returns N+1 points', () => {
    const pts = discretizeCurve({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, 16)
    expect(pts.length).toBe(17)
  })

  it('starts at p0 and ends at p2', () => {
    const pts = discretizeCurve({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, 8)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[8].x).toBeCloseTo(10)
    expect(pts[8].y).toBeCloseTo(0)
  })
})

describe('curveLength', () => {
  it('equals the straight-line distance for a linear curve', () => {
    const len = curveLength({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, 64)
    expect(len).toBeCloseTo(10, 1)
  })

  it('is greater than the chord for a curved path', () => {
    const len = curveLength({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, 64)
    expect(len).toBeGreaterThan(10)
  })
})

describe('distToCurve', () => {
  it('returns 0 for a point on the curve', () => {
    const p = bezierPoint(0.5, { x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 })
    const d = distToCurve(p, { x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, 64)
    expect(d).toBeLessThan(0.1)
  })

  it('returns positive distance for a point far from the curve', () => {
    const d = distToCurve({ x: 5, y: 50 }, { x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, 64)
    expect(d).toBeGreaterThan(30)
  })

  it('returns 0 at an endpoint', () => {
    const d = distToCurve({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, 64)
    expect(d).toBeLessThan(0.01)
  })
})
