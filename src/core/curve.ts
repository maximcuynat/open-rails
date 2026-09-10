import type { Point } from './types'

/** Point on a quadratic Bezier curve at parameter t. */
export function bezierPoint(t: number, p0: Point, p1: Point, p2: Point): Point {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  }
}

/** Tangent vector (not normalized) on a quadratic Bezier at parameter t. */
export function bezierTangent(t: number, p0: Point, p1: Point, p2: Point): Point {
  const u = 1 - t
  return {
    x: 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
    y: 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
  }
}

/** Normal (perpendicular to tangent, normalized) at parameter t. */
export function bezierNormal(t: number, p0: Point, p1: Point, p2: Point): Point {
  const tan = bezierTangent(t, p0, p1, p2)
  const len = Math.hypot(tan.x, tan.y)
  if (len === 0) return { x: 0, y: 0 }
  return { x: -tan.y / len, y: tan.x / len }
}

/** Discretize a quadratic Bezier into N+1 points (t = 0..1 in N steps). */
export function discretizeCurve(p0: Point, via: Point, p2: Point, samples: number): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    pts.push(bezierPoint(t, p0, via, p2))
  }
  return pts
}

/** Approximate arc length of a quadratic Bezier by sampling. */
export function curveLength(p0: Point, via: Point, p2: Point, samples = 64): number {
  let len = 0
  let prev = p0
  for (let i = 1; i <= samples; i++) {
    const t = i / samples
    const pt = bezierPoint(t, p0, via, p2)
    len += Math.hypot(pt.x - prev.x, pt.y - prev.y)
    prev = pt
  }
  return len
}

/** Choose a sample count based on curve length and scale for adequate resolution. */
export function curveSamples(p0: Point, via: Point, p2: Point, pxPerUnit: number): number {
  const len = curveLength(p0, via, p2, 32)
  const pxLen = len * pxPerUnit
  return Math.max(8, Math.min(512, Math.ceil(pxLen / 4)))
}

/** Distance from a point to a quadratic Bezier curve (discretized). */
export function distToCurve(p: Point, p0: Point, via: Point, p2: Point, samples = 32): number {
  let best = Infinity
  let prev = p0
  for (let i = 1; i <= samples; i++) {
    const t = i / samples
    const pt = bezierPoint(t, p0, via, p2)
    const d = distToSeg(p, prev, pt)
    if (d < best) best = d
    prev = pt
  }
  return best
}

function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
