import { describe, expect, it } from 'vitest'
import {
  bezierPoint,
  bezierTangent,
  bezierNormal,
  discretizeCurve,
  curveLength,
  distToCurve,
  curveRadiusAt,
  minCurveRadius,
  clampVia,
} from './curve'

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

describe('curveRadiusAt', () => {
  it('returns Infinity for a straight line', () => {
    const r = curveRadiusAt(0.5, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 })
    expect(r).toBe(Infinity)
  })

  it('returns a finite positive radius for a curved path', () => {
    const r = curveRadiusAt(0.5, { x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 })
    expect(r).toBeLessThan(Infinity)
    expect(r).toBeGreaterThan(0)
  })

  it('radius is smaller for tighter curves', () => {
    const gentle = curveRadiusAt(0.5, { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 })
    const tight = curveRadiusAt(0.5, { x: 0, y: 0 }, { x: 5, y: 20 }, { x: 10, y: 0 })
    expect(tight).toBeLessThan(gentle)
  })
})

describe('minCurveRadius', () => {
  it('returns Infinity for a straight line', () => {
    const r = minCurveRadius({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 })
    expect(r).toBe(Infinity)
  })

  it('returns a finite value for a curved path', () => {
    const r = minCurveRadius({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 })
    expect(r).toBeLessThan(Infinity)
    expect(r).toBeGreaterThan(0)
  })

  it('is smaller for tighter curves', () => {
    const gentle = minCurveRadius({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 })
    const tight = minCurveRadius({ x: 0, y: 0 }, { x: 5, y: 20 }, { x: 10, y: 0 })
    expect(tight).toBeLessThan(gentle)
  })
})

describe('clampVia', () => {
  it('returns the original via when radius is already acceptable', () => {
    const p0 = { x: 0, y: 0 }
    const via = { x: 5, y: 1 }
    const p2 = { x: 10, y: 0 }
    const minR = minCurveRadius(p0, via, p2)
    const clamped = clampVia(p0, via, p2, minR * 0.9)
    expect(clamped.x).toBeCloseTo(via.x)
    expect(clamped.y).toBeCloseTo(via.y)
  })

  it('pulls via toward midpoint to increase radius', () => {
    const p0 = { x: 0, y: 0 }
    const via = { x: 5, y: 50 }
    const p2 = { x: 10, y: 0 }
    const minR = 100
    const clamped = clampVia(p0, via, p2, minR)
    const newR = minCurveRadius(p0, clamped, p2)
    expect(newR).toBeGreaterThanOrEqual(minR * 0.95)
    // Clamped via should be closer to midpoint than original
    const mid = { x: 5, y: 0 }
    const origDist = Math.hypot(via.x - mid.x, via.y - mid.y)
    const clampedDist = Math.hypot(clamped.x - mid.x, clamped.y - mid.y)
    expect(clampedDist).toBeLessThan(origDist)
  })

  it('returns midpoint when minRadius cannot be satisfied (degenerate)', () => {
    const p0 = { x: 0, y: 0 }
    const via = { x: 5, y: 100 }
    const p2 = { x: 10, y: 0 }
    const minR = 1e15
    const clamped = clampVia(p0, via, p2, minR)
    // Should be at or very near midpoint (straight line)
    expect(clamped.x).toBeCloseTo(5, 0)
    expect(clamped.y).toBeCloseTo(0, 0)
  })
})
