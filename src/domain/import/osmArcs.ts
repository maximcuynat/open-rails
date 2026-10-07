import type { Point } from '../models/types'
import { MAX_ARC_PIECE_DEG } from '../geometry/curve'

// Straight lines and circular arcs, the two shapes a chain of OSM nodes is fitted with, and the
// rails they are cut into. Angles are signed the way `signedAngle` measures them; nothing here
// depends on which way the y axis points.

export const RAD = Math.PI / 180

/** Below this angle (degrees) between a chord and the direction the track leaves it in, the track is straight */
export const STRAIGHT_TOLERANCE_DEG = 0.15

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
export const reversed = (v: Point): Point => ({ x: -v.x, y: -v.y })
export const lerp = (a: Point, b: Point, k: number): Point => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })

/** `v` at length 1; null when it has no length */
export function unit(v: Point): Point | null {
  const len = Math.hypot(v.x, v.y)
  return len > 1e-12 ? { x: v.x / len, y: v.y / len } : null
}

/** Angle in radians from direction `a` to direction `b`, in −π…π */
export function signedAngle(a: Point, b: Point): number {
  return Math.atan2(cross(a, b), dot(a, b))
}

/** Unsigned angle between two directions, in degrees */
export function angleDeg(a: Point, b: Point): number {
  return Math.abs(signedAngle(a, b)) / RAD
}

export function rotate(v: Point, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }
}

/** `direction` mirrored in the line of `chord` (both of length 1): how an arc that left along it arrives */
export function mirrored(direction: Point, chord: Point): Point {
  const along = dot(direction, chord)
  return { x: 2 * along * chord.x - direction.x, y: 2 * along * chord.y - direction.y }
}

/** A straight line or a circular arc from `p0` to `p1`, run from `t0` to `t1` (unit directions of travel) */
export interface Prim {
  p0: Point
  p1: Point
  t0: Point
  t1: Point
  /** Signed turn from `t0` to `t1` in radians; 0 on a straight line */
  sweep: number
  /** Infinity on a straight line */
  radius: number
  length: number
}

export function linePrim(p0: Point, p1: Point): Prim | null {
  const dir = unit(sub(p1, p0))
  if (!dir) return null
  return { p0, p1, t0: dir, t1: dir, sweep: 0, radius: Infinity, length: distance(p0, p1) }
}

/**
 * The arc that leaves `p0` along `t0` and reaches `p1`: a straight line when `t0` points at `p1`
 * within the tolerance. Null when the points coincide or the arc would turn more than `maxSweepDeg`.
 */
export function arcPrim(p0: Point, t0: Point, p1: Point, maxSweepDeg = 120): Prim | null {
  const chord = sub(p1, p0)
  const length = Math.hypot(chord.x, chord.y)
  if (length < 1e-9) return null
  const half = signedAngle(t0, chord)
  if (Math.abs(half) < STRAIGHT_TOLERANCE_DEG * RAD) return linePrim(p0, p1)
  const sweep = 2 * half
  if (Math.abs(sweep) > maxSweepDeg * RAD) return null
  const radius = length / (2 * Math.sin(Math.abs(half)))
  return { p0, p1, t0, t1: rotate(t0, sweep), sweep, radius, length: radius * Math.abs(sweep) }
}

function arcCentre(prim: Prim): Point {
  const towards = rotate(prim.t0, prim.sweep > 0 ? Math.PI / 2 : -Math.PI / 2)
  return { x: prim.p0.x + towards.x * prim.radius, y: prim.p0.y + towards.y * prim.radius }
}

/** The point at the share `f` (0…1) of the length of a primitive */
export function primPoint(prim: Prim, f: number): Point {
  if (f <= 0) return prim.p0
  if (f >= 1) return prim.p1
  if (prim.sweep === 0) return lerp(prim.p0, prim.p1, f)
  const centre = arcCentre(prim)
  const spoke = rotate(sub(prim.p0, centre), f * prim.sweep)
  return { x: centre.x + spoke.x, y: centre.y + spoke.y }
}

/** The stretch of a primitive between the shares `f0` and `f1` of its length */
export function primBetween(prim: Prim, f0: number, f1: number): Prim {
  if (f0 <= 0 && f1 >= 1) return prim
  const share = f1 - f0
  return {
    p0: primPoint(prim, f0),
    p1: primPoint(prim, f1),
    t0: rotate(prim.t0, f0 * prim.sweep),
    t1: rotate(prim.t0, f1 * prim.sweep),
    sweep: prim.sweep * share,
    radius: prim.radius,
    length: prim.length * share,
  }
}

/** Distance from a point to a primitive */
export function primDistance(prim: Prim, q: Point): number {
  if (prim.sweep === 0) {
    const along = dot(sub(q, prim.p0), prim.t0)
    if (along <= 0) return distance(q, prim.p0)
    if (along >= prim.length) return distance(q, prim.p1)
    return Math.abs(cross(prim.t0, sub(q, prim.p0)))
  }
  const centre = arcCentre(prim)
  const share = signedAngle(sub(prim.p0, centre), sub(q, centre)) / prim.sweep
  if (share < 0 || share > 1) return Math.min(distance(q, prim.p0), distance(q, prim.p1))
  return Math.abs(distance(q, centre) - prim.radius)
}

/**
 * Two arcs from `p0` to `p1` that leave along `t0`, arrive along `t1` and meet tangent to each
 * other: the biarc whose two control legs have the same length, so each half is a true circular
 * arc. Null when the directions cannot be joined by gentle arcs.
 */
export function biarc(p0: Point, t0: Point, p1: Point, t1: Point, maxSweepDeg = 100): [Prim, Prim] | null {
  const v = sub(p1, p0)
  const sum = { x: t0.x + t1.x, y: t0.y + t1.y }
  // |v − d (t0 + t1)| = 2 d
  const a = 2 * (dot(t0, t1) - 1)
  const b = -2 * dot(v, sum)
  const c = dot(v, v)
  let d: number
  if (Math.abs(a) < 1e-12) {
    if (b >= -1e-12) return null
    d = -c / b
  } else {
    d = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a)
  }
  if (!Number.isFinite(d) || d <= 1e-9) return null
  const q0 = { x: p0.x + t0.x * d, y: p0.y + t0.y * d }
  const q1 = { x: p1.x - t1.x * d, y: p1.y - t1.y * d }
  const joint = lerp(q0, q1, 0.5)
  const through = unit(sub(q1, q0))
  if (!through) return null
  const first = arcPrim(p0, t0, joint, maxSweepDeg)
  const second = arcPrim(joint, through, p1, maxSweepDeg)
  if (!first || !second) return null
  // The second arc is built from its start: it arrives along `t1` by construction, to rounding
  return [first, { ...second, t1 }]
}

/** A rail: straight, or a quadratic Bézier with its control point where the end tangents meet */
export interface RailShape {
  p0: Point
  p1: Point
  via?: Point
  /** Shares of the length of the primitive it was cut from */
  f0: number
  f1: number
}

/**
 * A primitive as rails: one straight rail, or equal pieces of arc of at most `maxPieceDeg` each.
 * The two legs of every piece are equal, which is what makes it read as a circular arc.
 */
export function primRails(prim: Prim, maxPieceDeg = MAX_ARC_PIECE_DEG): RailShape[] {
  if (prim.sweep === 0) return [{ p0: prim.p0, p1: prim.p1, f0: 0, f1: 1 }]
  const count = Math.max(1, Math.ceil(Math.abs(prim.sweep) / RAD / maxPieceDeg - 1e-9))
  const leg = prim.radius * Math.tan(Math.abs(prim.sweep) / count / 2)
  const rails: RailShape[] = []
  let p0 = prim.p0
  for (let i = 0; i < count; i++) {
    const f0 = i / count
    const f1 = (i + 1) / count
    const tangent = rotate(prim.t0, f0 * prim.sweep)
    const p1 = primPoint(prim, f1)
    rails.push({ p0, p1, via: { x: p0.x + tangent.x * leg, y: p0.y + tangent.y * leg }, f0, f1 })
    p0 = p1
  }
  return rails
}
