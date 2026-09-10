import type { Point } from './types'

/** Point on a quadratic Bezier curve at parameter t. */
export function bezierPoint(t: number, p0: Point, p1: Point, p2: Point): Point {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  }
}

/** First derivative of a quadratic Bezier at parameter t. */
export function bezierDerivative1(t: number, p0: Point, p1: Point, p2: Point): Point {
  const u = 1 - t
  return {
    x: 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
    y: 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
  }
}

/** Second derivative of a quadratic Bezier (constant, independent of t). */
export function bezierDerivative2(p0: Point, p1: Point, p2: Point): Point {
  return {
    x: 2 * (p2.x - 2 * p1.x + p0.x),
    y: 2 * (p2.y - 2 * p1.y + p0.y),
  }
}

/** Tangent vector (not normalized) on a quadratic Bezier at parameter t. */
export function bezierTangent(t: number, p0: Point, p1: Point, p2: Point): Point {
  return bezierDerivative1(t, p0, p1, p2)
}

/** Radius of curvature at parameter t. Returns Infinity for straight segments. */
export function curveRadiusAt(t: number, p0: Point, p1: Point, p2: Point): number {
  const d1 = bezierDerivative1(t, p0, p1, p2)
  const d2 = bezierDerivative2(p0, p1, p2)
  const cross = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(cross) < 1e-12) return Infinity
  const speed = Math.hypot(d1.x, d1.y)
  return speed * speed * speed / Math.abs(cross)
}

/** Minimum radius of curvature along the Bezier (sampling). */
export function minCurveRadius(p0: Point, p1: Point, p2: Point, samples = 64): number {
  let min = Infinity
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const r = curveRadiusAt(t, p0, p1, p2)
    if (r < min) min = r
  }
  return min
}

/** Clamp the via point so the curve respects a minimum radius.
 *  Moves via toward the chord midpoint until minRadius is satisfied. */
export function clampVia(p0: Point, via: Point, p2: Point, minRadius: number): Point {
  const mid = { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 }
  let current = { ...via }
  let r = minCurveRadius(p0, current, p2, 32)
  if (r >= minRadius) return current

  // Binary search: lerp via toward midpoint by factor f
  let lo = 0
  let hi = 1
  for (let iter = 0; iter < 40; iter++) {
    const f = (lo + hi) / 2
    current = {
      x: via.x + (mid.x - via.x) * f,
      y: via.y + (mid.y - via.y) * f,
    }
    r = minCurveRadius(p0, current, p2, 32)
    if (r >= minRadius) {
      hi = f
    } else {
      lo = f
    }
  }
  return {
    x: via.x + (mid.x - via.x) * hi,
    y: via.y + (mid.y - via.y) * hi,
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
