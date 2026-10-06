import type { Point } from '../models/types'

// ─────────────────── A polyline turned into straight lines and tangent arcs ───────────────────
//
// A line imported from a map is a polyline: thousands of short chords, noisy by a few decimetres.
// The track it stands for is made of a few straight lines and circular arcs, tangent to each other.
// `fitPath` finds those pieces again: it returns a path that starts on the first point, ends on the
// last one, never turns a corner, and stays within a tolerance of every point.
//
// How it works:
//
// 1. Runs. The points are cut from left to right into runs, each fitted by the least-squares
//    straight line or circle (geometric distance, Gauss-Newton), each as long as the tolerance
//    allows. A straight line is preferred unless a circle goes markedly further.
// 2. Tangency. Lines and circles fitted on their own almost touch but never exactly: they cross
//    at a small angle or miss each other by a few centimetres. Every fit is summed up by its best
//    value and the stiffness of its points around it, and all of them are moved together, as
//    little as that stiffness allows, until each one is exactly tangent to the next and the first
//    and the last pass through the end points. Each constraint only ties two neighbours, so the
//    system to solve is a narrow band and its cost grows with the number of pieces, not its square.
//    Two straight lines that meet at an angle get a short arc in the corner first.
// 3. Pieces. The tangent points give each piece its start pose and its length. The chain is then
//    walked from the first point and closed onto the last one by a correction of a few nanometres
//    (tangency is a double root: the tangent points are only known to the square root of the
//    machine precision). The points are dealt out again between the pieces at their tangent
//    points, and steps 2 and 3 repeated, as long as that helps.
// 4. Check. Every point is measured against the path, and the path against the polyline. Where
//    the tolerance is exceeded the runs are fitted again more tightly around that place. A
//    stretch that still does not fit is cut in two there and each half fitted on its own, down to
//    two or three points, whose polyline with its corner rounded always fits.
//
// The end points are noisy like the others, and a long straight line cannot both pass through its
// two end points and stay close to all the points between. So the path is also fitted free of
// them, starting and ending abeam of them, and brought onto them by one arc over a short distance.
// A direction imposed at an end goes into step 2 when the points agree with it; when they do not,
// the path fitted without it is joined by two tangent arcs.

/** One piece of a path: a straight line (curvature 0) or a circular arc, from its own start pose */
export interface FittedPiece {
  /** Start point (world metres) */
  x: number
  y: number
  /** Direction of travel at the start, radians: `atan2(dy, dx)` in world axes */
  heading: number
  /** Signed, 1/m: positive turns towards increasing heading; 0 for a straight line */
  curvature: number
  /** Length along the piece (metres), always positive */
  length: number
}

/** A place on a path and the direction of travel there */
export interface PathPose {
  x: number
  y: number
  /** Radians, continuous along a path: it is not brought back within ±π */
  heading: number
}

export interface ArcFitOptions {
  /** Largest distance (m) between an input point and the fitted path */
  tolerance: number
  /**
   * Largest distance (m) between the input polyline and the fitted path between two points; the
   * tolerance by default. A curve drawn with few points is a polygon whose sides cut inside the
   * real arc: with the default the path follows the sides and rounds the corners, with a larger
   * value (or `Infinity`) it is the arc through the points.
   */
  chordTolerance?: number
  /** Direction of travel imposed at the first point (need not be a unit vector) */
  startTangent?: Point
  /** Direction of travel imposed at the last point (need not be a unit vector) */
  endTangent?: Point
  /** Radius (m) above which a fitted curve is laid as a straight line; 100 km by default */
  maxRadius?: number
  /**
   * Radius (m) below which no arc is fitted, no limit by default. It comes before the tolerance:
   * a corner that cannot be rounded that wide within the tolerance is rounded that wide anyway,
   * as far as the straight lines on both sides leave room.
   */
  minRadius?: number
}

const TAU = Math.PI * 2

/** Share of the tolerance a run may use on its own; the rest is left for making the runs tangent */
const FIT_SHARE = 0.85
/**
 * Share of the chord tolerance allowed at the three places checked on each side of the polyline:
 * between two of them an arc can bulge a twelfth further, which this margin covers
 */
const CHORD_SHARE = 0.92
/** A circle replaces a straight line when it follows the points this many times further */
const CIRCLE_GAIN = 1.5
/** Times the fit is tightened around the places out of tolerance before the polyline itself is used */
const MAX_ROUNDS = 8
/** Rounds given to a path held on its two end points before it is fitted free of them */
const PINNED_ROUNDS = 4
/** What is left of the share of the tolerance of a point each time a round ends out of tolerance around it */
const TIGHTEN = 0.7
/** Radius (m) of the arc that brings a path back onto an end point it passes beside, room allowing */
const JOIN_RADIUS = 4000
/** Times the points of the runs are dealt out again before the runs are made tangent */
const SETTLE_PASSES = 4
/** Times the points are dealt out again between neighbouring pieces once the tangent points are known */
const REASSIGN_PASSES = 4
/** Largest difference (rad) between an imposed direction and the path that needs no correction */
const SAME_HEADING = 1e-10
/** Shortest piece kept (m) */
const MIN_LENGTH = 1e-9

function wrapAngle(a: number): number {
  let r = a % TAU
  if (r > Math.PI) r -= TAU
  else if (r <= -Math.PI) r += TAU
  return r
}

// ─────────────────── Pieces: closed forms ───────────────────

/** Pose at the distance `s` from the start of a piece (not held within its length) */
function poseOnPiece(piece: FittedPiece, s: number): PathPose {
  const k = piece.curvature
  const a = k * s
  // Along and across the start direction: sin(a)/k and (1 − cos a)/k, written so that neither
  // loses its digits when the arc is nearly straight
  let along = s
  let across = (s * a) / 2
  if (Math.abs(a) > 1e-8) {
    const half = Math.sin(a / 2)
    along = Math.sin(a) / k
    across = (2 * half * half) / k
  }
  const c = Math.cos(piece.heading)
  const sn = Math.sin(piece.heading)
  return { x: piece.x + along * c - across * sn, y: piece.y + along * sn + across * c, heading: piece.heading + a }
}

/** Pose at the end of a piece */
export function pieceEnd(piece: FittedPiece): PathPose {
  return poseOnPiece(piece, piece.length)
}

/** Length of a path (metres) */
export function pathLength(pieces: readonly FittedPiece[]): number {
  let length = 0
  for (const piece of pieces) length += piece.length
  return length
}

/** Pose at the distance `s` along a path, held within its two ends; the origin for an empty path */
export function pointOnPath(pieces: readonly FittedPiece[], s: number): PathPose {
  if (pieces.length === 0) return { x: 0, y: 0, heading: 0 }
  let left = Math.max(0, s)
  for (let i = 0; i < pieces.length - 1; i++) {
    if (left <= pieces[i].length) return poseOnPiece(pieces[i], left)
    left -= pieces[i].length
  }
  const last = pieces[pieces.length - 1]
  return poseOnPiece(last, Math.min(left, last.length))
}

/** Distance from the point (x, y) to a piece */
function distanceToPiece(piece: FittedPiece, x: number, y: number): number {
  const c = Math.cos(piece.heading)
  const sn = Math.sin(piece.heading)
  const dx = x - piece.x
  const dy = y - piece.y
  // The point in the frame of the start pose: `u` ahead, `v` to the side the heading grows towards
  const u = dx * c + dy * sn
  const v = dy * c - dx * sn
  const k = piece.curvature
  let s = u
  let off = v
  if (Math.abs(k) > 1e-13) {
    // Distance along the arc of the foot of the point, and its offset from the whole circle
    let a = Math.atan2(k * u, 1 - k * v)
    if (k > 0 && a < 0) a += TAU
    if (k < 0 && a > 0) a -= TAU
    s = a / k
    const A = 2 * v - k * (u * u + v * v)
    off = A / (1 + Math.sqrt(Math.max(1 - k * A, 0)))
  }
  if (s >= 0 && s <= piece.length) return Math.abs(off)
  const end = pieceEnd(piece)
  return Math.min(Math.hypot(dx, dy), Math.hypot(x - end.x, y - end.y))
}

/** Distance from `p` to a path; `Infinity` for an empty path */
export function distanceToPath(pieces: readonly FittedPiece[], p: Point): number {
  let best = Infinity
  for (const piece of pieces) best = Math.min(best, distanceToPiece(piece, p.x, p.y))
  return best
}

/** The arc (or straight line) that leaves `(x, y)` along `heading` and passes through `(qx, qy)` */
function arcThrough(x: number, y: number, heading: number, qx: number, qy: number): FittedPiece {
  const wx = qx - x
  const wy = qy - y
  const chord = Math.hypot(wx, wy)
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  // Angle from the start direction to the chord: half of what the arc turns by
  const half = Math.atan2(c * wy - s * wx, c * wx + s * wy)
  const sinHalf = Math.sin(half)
  if (Math.abs(sinHalf) < 1e-12) return { x, y, heading, curvature: 0, length: chord }
  return { x, y, heading, curvature: (2 * sinHalf) / chord, length: (chord * half) / sinHalf }
}

/**
 * Two tangent arcs from one pose to another (a biarc): the one whose two arcs have control
 * polygons of equal sides. One piece when a single arc or line already does it.
 */
function biarc(x1: number, y1: number, h1: number, x2: number, y2: number, h2: number): FittedPiece[] {
  const t1x = Math.cos(h1)
  const t1y = Math.sin(h1)
  const t2x = Math.cos(h2)
  const t2y = Math.sin(h2)
  const vx = x2 - x1
  const vy = y2 - y1
  const vv = vx * vx + vy * vy
  const vt = vx * (t1x + t2x) + vy * (t1y + t2y)
  const denom = 2 * (1 - (t1x * t2x + t1y * t2y))
  let d: number
  if (denom < 1e-12) {
    // Same direction at both ends: an S of two equal arcs, or two half circles when the second
    // point is straight to the side
    const vt2 = vx * t2x + vy * t2y
    d = Math.abs(vt2) < 1e-12 * Math.sqrt(vv) ? 0 : vv / (4 * vt2)
  } else {
    d = (-vt + Math.sqrt(vt * vt + denom * vv)) / denom
  }
  // Where the two arcs meet
  const mx = (x1 + x2 + d * (t1x - t2x)) / 2
  const my = (y1 + y2 + d * (t1y - t2y)) / 2
  const first = arcThrough(x1, y1, h1, mx, my)
  if (first.length < MIN_LENGTH) return [arcThrough(x1, y1, h1, x2, y2)]
  const second = arcThrough(mx, my, pieceEnd(first).heading, x2, y2)
  if (second.length < MIN_LENGTH) return [first]
  return [first, second]
}

/** The same path run the other way */
function reversePath(pieces: readonly FittedPiece[]): FittedPiece[] {
  const out: FittedPiece[] = []
  for (let i = pieces.length - 1; i >= 0; i--) {
    const end = pieceEnd(pieces[i])
    out.push({ x: end.x, y: end.y, heading: end.heading + Math.PI, curvature: -pieces[i].curvature, length: pieces[i].length })
  }
  return out
}

/** What is left of a path beyond the distance `s` from its start */
function pathBeyond(pieces: readonly FittedPiece[], s: number): FittedPiece[] {
  const out: FittedPiece[] = []
  let left = s
  for (const piece of pieces) {
    if (left <= 0) {
      out.push(piece)
    } else if (left < piece.length - MIN_LENGTH) {
      const pose = poseOnPiece(piece, left)
      out.push({ x: pose.x, y: pose.y, heading: pose.heading, curvature: piece.curvature, length: piece.length - left })
    }
    left -= piece.length
  }
  return out
}

// ─────────────────── A line or a circle among the points ───────────────────
//
// Lines and circles are written the same way, so that a circle of ten kilometres is no harder than
// a line: from a fixed reference point `c` near the points, the closest point of the shape is
// `c + d·n`, the shape runs through it along the direction `phi` (`n` is that direction turned a
// quarter towards increasing heading) and bends with the curvature `k`. A line is `k = 0`.

interface Locus {
  /** Reference point: fixed, only there to keep the numbers small */
  cx: number
  cy: number
  phi: number
  d: number
  k: number
  /** A straight line: `k` stays 0 */
  straight: boolean
  /** First and last input point of the run it was fitted on; equal when it has no points of its own */
  lo: number
  hi: number
  /** Length (m) it is expected to cover: tells one turn of a circle from the next */
  span: number
  /** Best value for its points alone (`phi`, `d`, `k`) */
  best: [number, number, number]
  /** Stiffness of its points around that value, as a symmetric matrix: pp, pd, pk, dd, dk, kk */
  h: number[]
  /** Inverse of `h` (zero on `k` for a line); refreshed before the loci are made tangent */
  hInv: number[]
}

/** Everything a fit reads, built once per call */
interface FitContext {
  pts: Point[]
  n: number
  /** Length of the polyline up to each point */
  cum: Float64Array
  tolerance: number
  chordTolerance: number
  /** Curvature below which a circle is a straight line, and above which none is fitted */
  minCurvature: number
  maxCurvature: number
  minRadius: number
  /**
   * Whether the path is held on the first and the last point while it is fitted. When it is not,
   * it starts and ends abeam of them, on the first and last locus, and is joined to them afterwards.
   */
  pinned: boolean
  /** Share of the fitting tolerance left at each point: reduced where a round ended out of tolerance */
  share: Float64Array
  pointLimit: Float64Array
  /** Points around which the last round that failed did */
  lastFailed: number[]
  /** Limit at the middle of the side that starts at each point */
  sideLimit: Float64Array
}

/** Signed distance from the point (x, y) to a locus, positive on the side the heading grows towards */
function offsetFrom(l: Locus, x: number, y: number): number {
  const nx = -Math.sin(l.phi)
  const ny = Math.cos(l.phi)
  const wx = x - l.cx - l.d * nx
  const wy = y - l.cy - l.d * ny
  const A = 2 * (wx * nx + wy * ny) - l.k * (wx * wx + wy * wy)
  return A / (1 + Math.sqrt(Math.max(1 - l.k * A, 0)))
}

/** Unit normal of a locus at (the foot of) a point, on the side the heading grows towards */
function normalAt(l: Locus, x: number, y: number): Point {
  const nx = -Math.sin(l.phi)
  const ny = Math.cos(l.phi)
  const wx = x - l.cx - l.d * nx
  const wy = y - l.cy - l.d * ny
  const mx = nx - l.k * wx
  const my = ny - l.k * wy
  const len = Math.hypot(mx, my)
  return len === 0 ? { x: nx, y: ny } : { x: mx / len, y: my / len }
}

/** Foot of a point on a locus */
function endOnLocus(l: Locus, p: Point): Point {
  const e = offsetFrom(l, p.x, p.y)
  const n = normalAt(l, p.x, p.y)
  return { x: p.x - e * n.x, y: p.y - e * n.y }
}

/** Direction of travel of a locus at (the foot of) a point */
function headingAt(l: Locus, x: number, y: number): number {
  const n = normalAt(l, x, y)
  return Math.atan2(-n.x, n.y)
}

/**
 * Signed distance from a point to a locus and its slope with respect to `phi`, `d` and `k`,
 * written into `out` (4 numbers)
 */
function offsetAndSlopes(l: Locus, phi: number, d: number, k: number, x: number, y: number, out: Float64Array): void {
  const nx = -Math.sin(phi)
  const ny = Math.cos(phi)
  const wx = x - l.cx - d * nx
  const wy = y - l.cy - d * ny
  const wn = wx * nx + wy * ny
  const wt = wx * ny - wy * nx
  const ww = wx * wx + wy * wy
  const A = 2 * wn - k * ww
  const S = Math.sqrt(Math.max(1 - k * A, 1e-18))
  const e = A / (1 + S)
  out[0] = e
  out[1] = (-wt * (1 + k * d)) / S
  out[2] = -(1 - k * wn) / S
  out[3] = (e * e - ww) / (2 * S)
}

/**
 * Sum of the squared distances of a run to a locus at the given parameters, with the normal
 * matrix (6 numbers, same order as `Locus.h`) and the gradient (3 numbers) written into `out`
 * after the sum itself
 */
function normalEquations(ctx: FitContext, l: Locus, phi: number, d: number, k: number, out: Float64Array, row: Float64Array): void {
  out.fill(0)
  for (let i = l.lo; i <= l.hi; i++) {
    offsetAndSlopes(l, phi, d, k, ctx.pts[i].x, ctx.pts[i].y, row)
    const e = row[0]
    const jp = row[1]
    const jd = row[2]
    const jk = l.straight ? 0 : row[3]
    out[0] += e * e
    out[1] += jp * jp
    out[2] += jp * jd
    out[3] += jp * jk
    out[4] += jd * jd
    out[5] += jd * jk
    out[6] += jk * jk
    out[7] += jp * e
    out[8] += jd * e
    out[9] += jk * e
  }
}

/**
 * Inverse of a symmetric 3×3 matrix (pp, pd, pk, dd, dk, kk), or of its 2×2 corner with zeros on
 * `k` for a straight line; null when it is not positive. The three parameters have different
 * units (a turn of 1 rad moves a far point by kilometres), so the matrix is scaled by its diagonal first.
 */
function invertSymmetric(h: readonly number[], straight: boolean): number[] | null {
  if (!(h[0] > 0) || !(h[3] > 0) || (!straight && !(h[5] > 0))) return null
  const s0 = 1 / Math.sqrt(h[0])
  const s1 = 1 / Math.sqrt(h[3])
  const b = h[1] * s0 * s1
  if (straight) {
    const det = 1 - b * b
    if (!(det > 1e-14)) return null
    return [(s0 * s0) / det, (-b * s0 * s1) / det, 0, (s1 * s1) / det, 0, 0]
  }
  const s2 = 1 / Math.sqrt(h[5])
  const c = h[2] * s0 * s2
  const e = h[4] * s1 * s2
  const a00 = 1 - e * e
  const a01 = c * e - b
  const a02 = b * e - c
  const det = a00 + b * a01 + c * a02
  if (!(det > 1e-14)) return null
  return [
    (a00 * s0 * s0) / det,
    (a01 * s0 * s1) / det,
    (a02 * s0 * s2) / det,
    ((1 - c * c) * s1 * s1) / det,
    ((b * c - e) * s1 * s2) / det,
    ((1 - b * b) * s2 * s2) / det,
  ]
}

/** A symmetric matrix (pp, pd, pk, dd, dk, kk) times a vector */
function timesSymmetric(h: readonly number[], v0: number, v1: number, v2: number): [number, number, number] {
  return [h[0] * v0 + h[1] * v1 + h[2] * v2, h[1] * v0 + h[3] * v1 + h[4] * v2, h[2] * v0 + h[4] * v1 + h[5] * v2]
}

/**
 * Stiffness of a locus that has no points of its own (or too few): it holds its value weakly, so
 * that its neighbours, which have points, decide. `weight` is in points: 1 holds like one point.
 */
function addHold(l: Locus, weight: number): void {
  const reach = Math.max(l.span, 1)
  l.h[0] += weight * reach * reach
  l.h[3] += weight
  l.h[5] += (weight * reach ** 4) / 4
}

/** A locus through the first, middle and last point of a run: where its fit starts from */
function startLocus(ctx: FitContext, lo: number, hi: number, straight: boolean): Locus {
  const mid = (lo + hi) >> 1
  const a = ctx.pts[lo]
  const m = ctx.pts[mid]
  const b = ctx.pts[hi]
  let phi = Math.atan2(b.y - a.y, b.x - a.x)
  let k = 0
  if (!straight && mid > lo && mid < hi) {
    const ax = m.x - a.x
    const ay = m.y - a.y
    const bx = b.x - m.x
    const by = b.y - m.y
    const la = Math.hypot(ax, ay)
    const lb = Math.hypot(bx, by)
    const lc = Math.hypot(b.x - a.x, b.y - a.y)
    if (lc > 1e-9 * (la + lb)) {
      // Circle through three points: its curvature, and its direction at the middle one (the
      // inversion centred there turns the circle into the line through the images of the other two)
      k = (2 * (ax * by - ay * bx)) / (la * lb * lc)
      phi = Math.atan2(by / (lb * lb) + ay / (la * la), bx / (lb * lb) + ax / (la * la))
    }
  }
  return {
    cx: m.x,
    cy: m.y,
    phi,
    // A line through two points is taken from the first one
    d: 0,
    k,
    straight,
    lo,
    hi,
    span: ctx.cum[hi] - ctx.cum[lo],
    best: [phi, 0, k],
    h: [0, 0, 0, 0, 0, 0],
    hInv: [0, 0, 0, 0, 0, 0],
  }
}

const scratchA = new Float64Array(10)
const scratchB = new Float64Array(10)
const scratchRow = new Float64Array(4)

/**
 * Least-squares fit of a locus on its run, from its current value (Gauss-Newton, damped when a
 * step makes things worse). Leaves the best value in the locus, in `best`, and the stiffness in `h`.
 */
function fitLocus(ctx: FitContext, l: Locus): void {
  const reach = Math.max(l.span, 1)
  let cur = scratchA
  let next = scratchB
  normalEquations(ctx, l, l.phi, l.d, l.k, cur, scratchRow)
  let damping = 1e-9
  for (let it = 0; it < 30 && cur[0] > 1e-22; it++) {
    const damped = [cur[1] * (1 + damping), cur[2], cur[3], cur[4] * (1 + damping), cur[5], cur[6] * (1 + damping)]
    const inv = invertSymmetric(damped, l.straight)
    if (!inv) break
    const step = timesSymmetric(inv, -cur[7], -cur[8], -cur[9])
    normalEquations(ctx, l, l.phi + step[0], l.d + step[1], l.k + step[2], next, scratchRow)
    if (!(next[0] <= cur[0])) {
      damping *= 10
      if (damping > 1e9) break
      continue
    }
    l.phi += step[0]
    l.d += step[1]
    l.k += step[2]
    const swap = cur
    cur = next
    next = swap
    damping = Math.max(damping / 10, 1e-12)
    if (Math.abs(step[0]) * reach + Math.abs(step[1]) + Math.abs(step[2]) * reach * reach < 1e-10) break
  }
  l.best = [l.phi, l.d, l.k]
  l.h = [cur[1], cur[2], cur[3], cur[4], cur[5], cur[6]]
  addHold(l, 1e-9)
}

/**
 * Whether a locus stays within the limits of every point and every side of its run — or, with
 * `tightenedOnly`, of the ones whose limits have been tightened
 */
function withinLimits(ctx: FitContext, l: Locus, tightenedOnly = false): boolean {
  const pts = ctx.pts
  for (let i = l.lo; i <= l.hi; i++) {
    if (tightenedOnly && ctx.share[i] === 1) continue
    if (Math.abs(offsetFrom(l, pts[i].x, pts[i].y)) > ctx.pointLimit[i]) return false
  }
  if (ctx.chordTolerance === Infinity) return true
  for (let i = l.lo; i < l.hi; i++) {
    if (tightenedOnly && ctx.share[i] === 1 && ctx.share[i + 1] === 1) continue
    const e = offsetFrom(l, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2)
    if (Math.abs(e) > ctx.sideLimit[i]) return false
  }
  return true
}

/** The line or circle fitted on the points `lo`…`hi`, null when it does not stay within the limits */
function tryRun(ctx: FitContext, lo: number, hi: number, straight: boolean): Locus | null {
  const l = startLocus(ctx, lo, hi, straight)
  fitLocus(ctx, l)
  if (!straight && Math.abs(l.k) > ctx.maxCurvature) return null
  return withinLimits(ctx, l) ? l : null
}

/**
 * The longest run from the point `lo` that a line (or a circle) fits, reaching at least `first`;
 * null when it does not even reach that far. Doubling steps, then a search between the last run
 * that fitted and the first that did not.
 */
function longestRun(ctx: FitContext, lo: number, first: number, straight: boolean): Locus | null {
  let best = tryRun(ctx, lo, first, straight)
  if (!best) return null
  const last = ctx.n - 1
  let good = first
  let bad = -1
  for (let step = Math.max(1, first - lo); good < last; step *= 2) {
    const hi = Math.min(last, good + step)
    const l = tryRun(ctx, lo, hi, straight)
    if (!l) {
      bad = hi
      break
    }
    best = l
    good = hi
  }
  while (bad - good > 1) {
    const hi = (good + bad) >> 1
    const l = tryRun(ctx, lo, hi, straight)
    if (l) {
      best = l
      good = hi
    } else {
      bad = hi
    }
  }
  return best
}

/** The points cut into runs from left to right, each sharing its last point with the next */
function cutIntoRuns(ctx: FitContext): Locus[] {
  const runs: Locus[] = []
  const last = ctx.n - 1
  let lo = 0
  while (lo < last) {
    // Two points always make a line
    const line = longestRun(ctx, lo, lo + 1, true) as Locus
    let chosen = line
    if (line.hi < last) {
      // A circle has one more freedom than a line and always goes a little further, into the
      // curve that follows a straight: it is only worth it when it goes markedly further
      const lineLength = ctx.cum[line.hi] - ctx.cum[lo]
      let hi = Math.max(line.hi + 1, lo + 2)
      while (hi < last && ctx.cum[hi] - ctx.cum[lo] <= CIRCLE_GAIN * lineLength) hi++
      if (ctx.cum[hi] - ctx.cum[lo] > CIRCLE_GAIN * lineLength) {
        const circle = longestRun(ctx, lo, hi, false)
        if (circle && Math.abs(circle.k) >= ctx.minCurvature) chosen = circle
      }
    }
    runs.push(chosen)
    lo = chosen.hi
  }
  return runs
}

/**
 * The runs with an arc in every corner between two straight lines: the widest one that stays
 * within the tolerance of the corner and leaves each line more than half of its length.
 */
function roundCorners(ctx: FitContext, runs: Locus[]): Locus[] {
  const out: Locus[] = []
  for (const run of runs) {
    const prev = out[out.length - 1]
    if (!prev || !prev.straight || !run.straight) {
      out.push(run)
      continue
    }
    const tax = Math.cos(prev.phi)
    const tay = Math.sin(prev.phi)
    const tbx = Math.cos(run.phi)
    const tby = Math.sin(run.phi)
    const cross = tax * tby - tay * tbx
    const turn = Math.atan2(cross, tax * tbx + tay * tby)
    if (Math.abs(turn) < 1e-7) {
      // The same direction: one line (the check that follows says whether it holds)
      const merged = startLocus(ctx, prev.lo, run.hi, true)
      fitLocus(ctx, merged)
      out[out.length - 1] = merged
      continue
    }
    // Where the two lines cross
    const pax = prev.cx - prev.d * tay
    const pay = prev.cy + prev.d * tax
    const pbx = run.cx - run.d * tby
    const pby = run.cy + run.d * tbx
    const along = ((pbx - pax) * tby - (pby - pay) * tbx) / cross
    const X = pax + along * tax
    const Y = pay + along * tay
    const half = Math.abs(turn) / 2
    const room = 0.45 * Math.min(prev.span, run.span)
    const widest = room / Math.tan(half)
    // The corner is `R·(1/cos(half) − 1)` away from the arc
    let radius = Math.min((0.8 * ctx.tolerance) / (1 / Math.cos(half) - 1), widest)
    if (ctx.minRadius > 0) radius = Math.min(Math.max(radius, ctx.minRadius), widest)
    // Middle of the arc, on the bisector of the corner, and the direction there
    const bisect = Math.hypot(tbx - tax, tby - tay)
    const depth = radius * (1 / Math.cos(half) - 1)
    const phi = Math.atan2(tay + tby, tax + tbx)
    const k = Math.sign(turn) / radius
    const corner: Locus = {
      cx: X + (depth * (tbx - tax)) / bisect,
      cy: Y + (depth * (tby - tay)) / bisect,
      phi,
      d: 0,
      k,
      straight: false,
      lo: run.lo,
      hi: run.lo,
      span: radius * Math.abs(turn),
      best: [phi, 0, k],
      h: [0, 0, 0, 0, 0, 0],
      hInv: [0, 0, 0, 0, 0, 0],
    }
    addHold(corner, 1e-3)
    out.push(corner, run)
  }
  return out
}

// ─────────────────── Making the loci tangent ───────────────────

/** One condition on one locus or on two neighbours: its value and its slopes */
interface Constraint {
  a: number
  ja: [number, number, number]
  /** −1 when the condition bears on one locus only */
  b: number
  jb: [number, number, number]
  value: number
}

/** The locus `index` passes through the point (x, y) */
function passesThrough(loci: Locus[], index: number, x: number, y: number): Constraint {
  const l = loci[index]
  offsetAndSlopes(l, l.phi, l.d, l.k, x, y, scratchRow)
  return { a: index, ja: [scratchRow[1], scratchRow[2], l.straight ? 0 : scratchRow[3]], b: -1, jb: [0, 0, 0], value: scratchRow[0] }
}

/** The locus `index` runs along `heading` at the point (x, y) */
function runsAlong(loci: Locus[], index: number, x: number, y: number, heading: number): Constraint {
  const l = loci[index]
  const hx = Math.cos(heading)
  const hy = Math.sin(heading)
  const nx = -Math.sin(l.phi)
  const ny = Math.cos(l.phi)
  // The normal there, `n − k·w`, has nothing along the imposed direction
  const hn = hx * nx + hy * ny
  const ht = hx * ny - hy * nx
  const hu = hx * (x - l.cx) + hy * (y - l.cy)
  return {
    a: index,
    ja: [-(1 + l.k * l.d) * ht, l.k * hn, l.straight ? 0 : l.d * hn - hu],
    b: -1,
    jb: [0, 0, 0],
    value: hn * (1 + l.k * l.d) - l.k * hu,
  }
}

/**
 * The locus `index` is tangent to the next one and runs the same way there.
 *
 * Each one is written as the oriented circle `α·|x|² + β·x + γ = 0` with `|β|² − 4αγ = 1` (a line
 * is α = 0). The cosine of the angle at which two of them cross is `β₁·β₂ − 2(α₁γ₂ + α₂γ₁)`: they
 * are tangent when it is 1. It is taken around a point between the two, to keep its digits.
 */
function tangentToNext(loci: Locus[], index: number): Constraint {
  const A = loci[index]
  const B = loci[index + 1]
  const ox = (A.cx + B.cx) / 2
  const oy = (A.cy + B.cy) / 2
  const side = (l: Locus) => {
    const nx = -Math.sin(l.phi)
    const ny = Math.cos(l.phi)
    const px = l.cx - ox + l.d * nx
    const py = l.cy - oy + l.d * ny
    const pp = px * px + py * py
    const pn = px * nx + py * ny
    const pt = px * ny - py * nx
    return { nx, ny, px, py, pp, pn, pt, alpha: l.k / 2, bx: -(l.k * px + nx), by: -(l.k * py + ny), gamma: (l.k / 2) * pp + pn }
  }
  const a = side(A)
  const b = side(B)
  // Slopes of the cosine with respect to the parameters of `l`, the other locus being `o`
  const slopes = (l: Locus, s: ReturnType<typeof side>, o: ReturnType<typeof side>): [number, number, number] => {
    const lead = 1 + l.k * l.d
    const tDotBeta = s.ny * o.bx - s.nx * o.by
    const nDotBeta = s.nx * o.bx + s.ny * o.by
    return [
      lead * (tDotBeta + 2 * o.alpha * s.pt),
      -l.k * nDotBeta - 2 * o.alpha * (l.k * s.pn + 1),
      l.straight ? 0 : -(s.px * o.bx + s.py * o.by) - o.gamma - o.alpha * s.pp,
    ]
  }
  return {
    a: index,
    ja: slopes(A, a, b),
    b: index + 1,
    jb: slopes(B, b, a),
    value: a.bx * b.bx + a.by * b.by - 2 * (a.alpha * b.gamma + b.alpha * a.gamma) - 1,
  }
}

/** Slopes of a constraint on the locus `index`, null when it does not bear on it */
function slopesOn(c: Constraint, index: number): [number, number, number] | null {
  return c.a === index ? c.ja : c.b === index ? c.jb : null
}

/**
 * Solves `M·x = rhs` for a symmetric positive band matrix given by its upper band (`band[r][j]`
 * is `M[r][r + j]`). Returns −1, or the row at which it is found not to be positive.
 */
function solveBand(band: number[][], rhs: number[], width: number): number {
  const m = rhs.length
  // Each row is scaled by its diagonal: the conditions have unrelated units
  const scale = new Array<number>(m)
  for (let r = 0; r < m; r++) {
    if (!(band[r][0] > 0)) return r
    scale[r] = 1 / Math.sqrt(band[r][0])
  }
  for (let r = 0; r < m; r++) {
    for (let j = 0; j <= width && r + j < m; j++) band[r][j] *= scale[r] * scale[r + j]
    band[r][0] += 1e-13
    rhs[r] *= scale[r]
  }
  // Band Cholesky, in place: M = Uᵀ·U
  for (let r = 0; r < m; r++) {
    for (let j = 0; j <= width && r + j < m; j++) {
      let sum = band[r][j]
      for (let p = Math.max(0, r + j - width); p < r; p++) sum -= band[p][r - p] * band[p][r + j - p]
      if (j === 0) {
        if (!(sum > 1e-13)) return r
        band[r][0] = Math.sqrt(sum)
      } else {
        band[r][j] = sum / band[r][0]
      }
    }
  }
  for (let r = 0; r < m; r++) {
    let sum = rhs[r]
    for (let p = Math.max(0, r - width); p < r; p++) sum -= band[p][r - p] * rhs[p]
    rhs[r] = sum / band[r][0]
  }
  for (let r = m - 1; r >= 0; r--) {
    let sum = rhs[r]
    for (let j = 1; j <= width && r + j < m; j++) sum -= band[r][j] * rhs[r + j]
    rhs[r] = sum / band[r][0]
  }
  for (let r = 0; r < m; r++) rhs[r] *= scale[r]
  return -1
}

/** Constraints further apart than this never bear on the same locus */
const BAND = 3
/** Most steps taken to make a chain tangent */
const TANGENT_STEPS = 60

/**
 * Moves the loci, as little as the stiffness of their points allows, until each is tangent to the
 * next — and, when the path is pinned, until the first passes through the first point and the last
 * through the last point, along the headings given. Returns −1, or the
 * index of the locus it stumbled on when it cannot.
 *
 * Each step solves the problem with the constraints taken as straight (their value and slopes
 * where the loci stand): minimise Σ (q − best)ᵀ·H·(q − best) under J·step = −value.
 */
function makeTangent(ctx: FitContext, loci: Locus[], startHeading: number | null, endHeading: number | null): number {
  const first = ctx.pts[0]
  const last = ctx.pts[ctx.n - 1]
  const n = loci.length
  let freedoms = 0
  for (const l of loci) {
    const inv = invertSymmetric(l.h, l.straight)
    if (!inv) return loci.indexOf(l)
    l.hInv = inv
    freedoms += l.straight ? 2 : 3
  }
  const count = n - 1 + (ctx.pinned ? 2 : 0) + (startHeading === null ? 0 : 1) + (endHeading === null ? 0 : 1)
  if (count > freedoms) return 0
  if (count === 0) return -1

  for (let it = 0; it < TANGENT_STEPS; it++) {
    const cons: Constraint[] = []
    if (ctx.pinned) cons.push(passesThrough(loci, 0, first.x, first.y))
    if (startHeading !== null) cons.push(runsAlong(loci, 0, first.x, first.y, startHeading))
    for (let i = 0; i + 1 < n; i++) cons.push(tangentToNext(loci, i))
    if (endHeading !== null) cons.push(runsAlong(loci, n - 1, last.x, last.y, endHeading))
    if (ctx.pinned) cons.push(passesThrough(loci, n - 1, last.x, last.y))

    // M = J·H⁻¹·Jᵀ and the right-hand side `value − J·(q − best)`
    const band: number[][] = []
    const rhs: number[] = []
    for (let r = 0; r < cons.length; r++) {
      const c = cons[r]
      const row = new Array<number>(BAND + 1).fill(0)
      let value = c.value
      for (const index of c.b < 0 ? [c.a] : [c.a, c.b]) {
        const l = loci[index]
        const j = slopesOn(c, index) as [number, number, number]
        value -= j[0] * (l.phi - l.best[0]) + j[1] * (l.d - l.best[1]) + j[2] * (l.k - l.best[2])
        const y = timesSymmetric(l.hInv, j[0], j[1], j[2])
        for (let s = r; s <= r + BAND && s < cons.length; s++) {
          const other = slopesOn(cons[s], index)
          if (other) row[s - r] += other[0] * y[0] + other[1] * y[1] + other[2] * y[2]
        }
      }
      band.push(row)
      rhs.push(value)
    }
    const stuck = solveBand(band, rhs, BAND)
    if (stuck >= 0) return cons[stuck].a

    // step = −(q − best) − H⁻¹·Jᵀ·λ, locus by locus
    const pull = loci.map(() => [0, 0, 0])
    for (let r = 0; r < cons.length; r++) {
      const c = cons[r]
      for (let p = 0; p < 3; p++) {
        pull[c.a][p] += rhs[r] * c.ja[p]
        if (c.b >= 0) pull[c.b][p] += rhs[r] * c.jb[p]
      }
    }
    // Full steps settle in a handful of rounds; when they keep overshooting, half steps do
    const gain = it < 12 ? 1 : 0.5
    let moved = 0
    let mover = 0
    for (let i = 0; i < n; i++) {
      const l = loci[i]
      const y = timesSymmetric(l.hInv, pull[i][0], pull[i][1], pull[i][2])
      const dPhi = gain * (-(l.phi - l.best[0]) - y[0])
      const dD = gain * (-(l.d - l.best[1]) - y[1])
      const dK = l.straight ? 0 : gain * (-(l.k - l.best[2]) - y[2])
      if (!Number.isFinite(dPhi + dD + dK) || Math.abs(dPhi) > 1) return i
      l.phi += dPhi
      l.d += dD
      l.k += dK
      const reach = Math.max(l.span, 1)
      const step = Math.abs(dPhi) * reach + Math.abs(dD) + Math.abs(dK) * reach * reach
      if (step > moved) {
        moved = step
        mover = i
      }
    }
    if (moved < 1e-11) return -1
    if (it === TANGENT_STEPS - 1) return moved < 1e-7 ? -1 : mover
    // Still moving by a millimetre after this many steps: it is going round in circles
    if (it >= 24 && moved > 1e-3) return mover
  }
  return 0
}

/** Where a locus meets the next one: the point and the direction of travel there */
interface Joint {
  x: number
  y: number
  heading: number
}

/** The tangent point of each locus with the next; null when two neighbours have the same curvature */
function tangentPoints(loci: Locus[]): Joint[] | null {
  const joints: Joint[] = []
  for (let i = 0; i + 1 < loci.length; i++) {
    const A = loci[i]
    const B = loci[i + 1]
    const nax = -Math.sin(A.phi)
    const nay = Math.cos(A.phi)
    const nbx = -Math.sin(B.phi)
    const nby = Math.cos(B.phi)
    // Closest points to the reference of A, taken as the origin
    const pax = A.d * nax
    const pay = A.d * nay
    const pbx = B.cx - A.cx + B.d * nbx
    const pby = B.cy - A.cy + B.d * nby
    // The common normal is along the line of the centres, written so that it holds for a line too
    const vx = A.k * B.k * (pax - pbx) + B.k * nax - A.k * nbx
    const vy = A.k * B.k * (pay - pby) + B.k * nay - A.k * nby
    const len = Math.hypot(vx, vy)
    const dk = B.k - A.k
    if (dk === 0 || !(len > 0)) return null
    const sign = dk > 0 ? 1 : -1
    const nx = (sign * vx) / len
    const ny = (sign * vy) / len
    // The point that has this normal, on the more curved of the two
    const x = Math.abs(A.k) > Math.abs(B.k) ? pax + (nax - nx) / A.k : pbx + (nbx - nx) / B.k
    const y = Math.abs(A.k) > Math.abs(B.k) ? pay + (nay - ny) / A.k : pby + (nby - ny) / B.k
    joints.push({ x: A.cx + x, y: A.cy + y, heading: Math.atan2(-nx, ny) })
  }
  return joints
}

/**
 * Deals the points out again: each locus gets the points between its two tangent points, and is
 * fitted again on them. A run was cut where its fit gave up, which is a little after the track
 * really changes shape; the tangent points say where that is. A locus left with too few points to
 * be fitted is taken out, unless it is the arc in the corner of two straight lines. False when
 * nothing changed.
 */
function dealPoints(ctx: FitContext, loci: Locus[], joints: Joint[]): boolean {
  const breaks: number[] = [0]
  for (let i = 0; i < joints.length; i++) {
    const from = Math.max(breaks[i], loci[i].lo)
    const to = Math.max(from, loci[i + 1].hi)
    let best = from
    let bestDist = Infinity
    for (let p = from; p <= to; p++) {
      const dist = (ctx.pts[p].x - joints[i].x) ** 2 + (ctx.pts[p].y - joints[i].y) ** 2
      if (dist < bestDist) {
        bestDist = dist
        best = p
      }
    }
    breaks.push(best)
  }
  breaks.push(ctx.n - 1)

  // Which loci stay: the ones with enough points, and the corners
  const kept: number[] = []
  for (let i = 0; i < loci.length; i++) {
    const enough = breaks[i + 1] - breaks[i] >= (loci[i].straight ? 1 : 2)
    const before = kept.length > 0 ? loci[kept[kept.length - 1]] : null
    let after: Locus | null = null
    for (let j = i + 1; j < loci.length && !after; j++) {
      if (breaks[j + 1] - breaks[j] >= (loci[j].straight ? 1 : 2)) after = loci[j]
    }
    const corner = !loci[i].straight && (!before || before.straight) && (!after || after.straight)
    if (enough || corner) kept.push(i)
  }
  if (kept.length === 0) return false
  let changed = kept.length !== loci.length
  const next: Locus[] = []
  for (let at = 0; at < kept.length; at++) {
    const l = loci[kept[at]]
    // A locus taken out leaves its points to the one before it
    const lo = at === 0 ? 0 : breaks[kept[at]]
    const hi = at + 1 < kept.length ? Math.max(lo, breaks[kept[at + 1]]) : ctx.n - 1
    next.push(l)
    if (lo === l.lo && hi === l.hi) continue
    changed = true
    l.lo = lo
    l.hi = hi
    if (hi - lo >= (l.straight ? 1 : 2)) {
      l.span = ctx.cum[hi] - ctx.cum[lo]
      fitLocus(ctx, l)
    } else {
      // Too few points to say anything: it stays where it is and follows its neighbours
      l.best = [l.phi, l.d, l.k]
      l.h = [0, 0, 0, 0, 0, 0]
      addHold(l, 1e-3)
    }
  }
  loci.length = 0
  loci.push(...next)
  return changed
}

/** Where a path starts or ends on its first or last locus: on the end point itself when pinned, abeam of it otherwise */
function endOn(ctx: FitContext, l: Locus, p: Point): Point {
  return ctx.pinned ? p : endOnLocus(l, p)
}

/**
 * The pieces of a chain of tangent loci, from the first point: each one runs from a tangent point
 * to the next. Null with the index of the locus that has no length left between its two neighbours.
 */
function layPieces(ctx: FitContext, loci: Locus[], joints: Joint[], startHeading: number | null): FittedPiece[] | number {
  const n = loci.length
  const first = endOn(ctx, loci[0], ctx.pts[0])
  const last = endOn(ctx, loci[n - 1], ctx.pts[ctx.n - 1])
  const pieces: FittedPiece[] = []
  let pose: PathPose = { x: first.x, y: first.y, heading: startHeading ?? headingAt(loci[0], first.x, first.y) }
  let inX = first.x
  let inY = first.y
  for (let i = 0; i < n; i++) {
    const l = loci[i]
    const outX = i + 1 < n ? joints[i].x : last.x
    const outY = i + 1 < n ? joints[i].y : last.y
    let length: number
    if (l.straight || Math.abs(l.k) * l.span < 1e-9) {
      length = (outX - inX) * Math.cos(l.phi) + (outY - inY) * Math.sin(l.phi)
    } else {
      const inHeading = i > 0 ? joints[i - 1].heading : headingAt(l, first.x, first.y)
      const outHeading = i + 1 < n ? joints[i].heading : headingAt(l, last.x, last.y)
      // The headings give the length within a whole number of turns: the one closest to the run
      const turn = TAU / Math.abs(l.k)
      length = wrapAngle(outHeading - inHeading) / l.k
      length += turn * Math.round((l.span - length) / turn)
    }
    if (!(length > MIN_LENGTH)) return i
    const piece: FittedPiece = { x: pose.x, y: pose.y, heading: pose.heading, curvature: l.straight ? 0 : l.k, length }
    pieces.push(piece)
    pose = pieceEnd(piece)
    inX = outX
    inY = outY
  }
  return pieces
}

/**
 * Closes a chain of pieces onto the point (x, y) — and onto `heading` when given — by the smallest
 * change of its lengths, of the curvature of its arcs and, when `freeStart`, of its first heading
 * (Newton steps of least norm). The chain is rebuilt from its first point at every step, so it
 * stays tangent throughout. False when it does not get there.
 */
function closeChain(pieces: FittedPiece[], x: number, y: number, heading: number | null, freeStart: boolean): boolean {
  const n = pieces.length
  const total = pathLength(pieces)
  const rows = heading === null ? 2 : 3
  let previous = Infinity
  for (let it = 0; it < 40; it++) {
    // Walk the chain: each piece starts where the one before ends
    const ends: PathPose[] = []
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        pieces[i].x = ends[i - 1].x
        pieces[i].y = ends[i - 1].y
        pieces[i].heading = ends[i - 1].heading
      }
      ends.push(pieceEnd(pieces[i]))
    }
    const end = ends[n - 1]
    const res = [end.x - x, end.y - y, heading === null ? 0 : wrapAngle(end.heading - heading) * total]
    const miss = Math.hypot(res[0], res[1], res[2])
    if (!Number.isFinite(miss)) return false
    if (miss < 1e-10 || (miss < 1e-7 && miss >= previous)) return true
    previous = miss

    // Columns of the Jacobian of the end pose, each scaled so that a unit step moves the end by about a metre
    const cols: number[][] = []
    for (let i = 0; i < n; i++) {
      const p = pieces[i]
      const k = p.curvature
      const armX = -(end.y - ends[i].y)
      const armY = end.x - ends[i].x
      cols.push([Math.cos(ends[i].heading) + k * armX, Math.sin(ends[i].heading) + k * armY, k * total])
      if (k === 0) continue
      // How the end of the piece itself moves with its curvature, in its own frame, then the rest
      // of the chain turning about that end by `length` per unit of curvature
      const a = k * p.length
      let along = (-p.length * p.length * a) / 3
      let across = (p.length * p.length) / 2
      if (Math.abs(a) > 1e-3) {
        along = (a * Math.cos(a) - Math.sin(a)) / (k * k)
        across = (a * Math.sin(a) - (1 - Math.cos(a))) / (k * k)
      }
      const c = Math.cos(p.heading)
      const s = Math.sin(p.heading)
      const unit = 1 / (p.length * p.length)
      cols.push([(along * c - across * s + p.length * armX) * unit, (along * s + across * c + p.length * armY) * unit, p.length * total * unit])
    }
    if (freeStart) cols.push([-(end.y - pieces[0].y) / total, (end.x - pieces[0].x) / total, 1])

    // Least-norm step: δ = Jᵀ·(J·Jᵀ)⁻¹·(−res), with a 2×2 or 3×3 system
    const g = [0, 0, 0, 0, 0, 0]
    for (const col of cols) {
      g[0] += col[0] * col[0]
      g[1] += col[0] * col[1]
      g[2] += col[0] * col[2]
      g[3] += col[1] * col[1]
      g[4] += col[1] * col[2]
      g[5] += col[2] * col[2]
    }
    const inv = invertSymmetric(g, rows === 2)
    if (!inv) return false
    const y3 = timesSymmetric(inv, -res[0], -res[1], rows === 2 ? 0 : -res[2])
    let c = 0
    for (let i = 0; i < n; i++) {
      const p = pieces[i]
      const before = p.length
      p.length += cols[c][0] * y3[0] + cols[c][1] * y3[1] + cols[c][2] * y3[2]
      c++
      if (!(p.length > MIN_LENGTH)) return false
      if (p.curvature === 0) continue
      p.curvature += (cols[c][0] * y3[0] + cols[c][1] * y3[1] + cols[c][2] * y3[2]) / (before * before)
      c++
    }
    if (freeStart) pieces[0].heading += (cols[c][0] * y3[0] + cols[c][1] * y3[1] + cols[c][2] * y3[2]) / total
  }
  return false
}

// ─────────────────── Checking a path against the points ───────────────────

/**
 * Indices of the input points that are further than the tolerance from a path, and of the two ends
 * of every side of the polyline that is further than the chord tolerance from it. Points and
 * pieces both run in order, so each point is only measured against the few pieces around the one
 * the point before it was closest to.
 */
function pointsOutOfTolerance(ctx: FitContext, pieces: readonly FittedPiece[]): number[] {
  const failed: number[] = []
  let cur = 0
  const measure = (x: number, y: number): number => {
    let best = Infinity
    let bestAt = cur
    const to = Math.min(pieces.length - 1, cur + 8)
    for (let j = Math.max(0, cur - 2); j <= to; j++) {
      const dist = distanceToPiece(pieces[j], x, y)
      if (dist < best) {
        best = dist
        bestAt = j
      }
    }
    cur = bestAt
    return best
  }
  const pts = ctx.pts
  const checkSides = ctx.chordTolerance !== Infinity
  for (let i = 0; i < ctx.n; i++) {
    let out = measure(pts[i].x, pts[i].y) > ctx.tolerance
    if (out && failed[failed.length - 1] !== i) failed.push(i)
    if (!checkSides || i + 1 >= ctx.n) continue
    out = false
    for (let q = 1; q <= 3 && !out; q++) {
      const f = q / 4
      out = measure(pts[i].x + (pts[i + 1].x - pts[i].x) * f, pts[i].y + (pts[i + 1].y - pts[i].y) * f) > CHORD_SHARE * ctx.chordTolerance
    }
    if (out) {
      if (failed[failed.length - 1] !== i) failed.push(i)
      failed.push(i + 1)
    }
  }
  return failed
}

// ─────────────────── One fit ───────────────────

/** Refreshes the limits of every point and side from the share of the tolerance left to it */
function refreshLimits(ctx: FitContext): void {
  for (let i = 0; i < ctx.n; i++) {
    ctx.pointLimit[i] = FIT_SHARE * ctx.tolerance * ctx.share[i]
    if (i + 1 < ctx.n) ctx.sideLimit[i] = FIT_SHARE * ctx.chordTolerance * Math.min(ctx.share[i], ctx.share[i + 1])
  }
}

/** A copy of a chain of loci that later fits do not touch */
function copyLoci(loci: Locus[]): Locus[] {
  return loci.map((l) => ({ ...l, best: [l.best[0], l.best[1], l.best[2]], h: [...l.h] }))
}

/**
 * The pieces of a chain of loci once made tangent, or the indices of the points around which that
 * failed. The loci are left as they stand in the path returned: moved, dealt their points again,
 * fewer when some had none left.
 */
function solveChain(ctx: FitContext, loci: Locus[], startHeading: number | null, endHeading: number | null): FittedPiece[] | number[] {
  let joints: Joint[] = []
  // The last chain that stayed within tolerance, and why the first one did not when none has yet
  let good: { loci: Locus[]; pieces: FittedPiece[] } | null = null
  let failed: number[] = []
  for (let pass = 0; pass <= REASSIGN_PASSES; pass++) {
    // Dealing the points out again is a refinement: one that does not hold is simply not taken.
    // Nor is one that hands a locus points on which the fit was tightened and that it does not
    // follow that closely: the tightening would be undone
    if (pass > 0 && (!dealPoints(ctx, loci, joints) || !loci.every((l) => withinLimits(ctx, l, true)))) break
    const stuck = makeTangent(ctx, loci, startHeading, endHeading)
    const next = stuck < 0 ? tangentPoints(loci) : null
    if (!next) {
      if (pass === 0) failed = [loci[Math.max(stuck, 0)].lo, loci[Math.max(stuck, 0)].hi]
      break
    }
    joints = next
    const laid = layPieces(ctx, loci, joints, startHeading)
    if (typeof laid === 'number') {
      if (pass === 0) failed = [loci[laid].lo, loci[laid].hi]
      break
    }
    const last = endOn(ctx, loci[loci.length - 1], ctx.pts[ctx.n - 1])
    if (!closeChain(laid, last.x, last.y, endHeading, startHeading === null)) {
      if (pass === 0) failed = [ctx.n - 1]
      break
    }
    const out = pointsOutOfTolerance(ctx, laid)
    if (out.length === 0) good = { loci: copyLoci(loci), pieces: laid }
    else if (!good) failed = out
  }
  if (!good) return failed.length > 0 ? failed : [0]
  loci.length = 0
  loci.push(...good.loci)
  return good.pieces
}

/**
 * The runs with their points dealt out where the fitted lines and circles come closest to each
 * other, a few times over. A run is cut where its fit gives up, which is some way into the next
 * shape: a line runs on into the curve that follows it, and drags the fit of both. Stops as soon
 * as a deal would undo a tightening.
 */
function settleRuns(ctx: FitContext, runs: Locus[]): Locus[] {
  let settled = runs
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    const next = copyLoci(settled)
    const joints = tangentPoints(next)
    if (!joints || !dealPoints(ctx, next, joints) || !next.every((l) => withinLimits(ctx, l, true))) break
    settled = next
  }
  return settled
}

/** One attempt with the current limits: the pieces, or the indices of the points around which it failed */
function attempt(ctx: FitContext, startHeading: number | null, endHeading: number | null): FittedPiece[] | number[] {
  let loci = roundCorners(ctx, settleRuns(ctx, cutIntoRuns(ctx)))
  let result = solveChain(ctx, loci, startHeading, endHeading)
  if (typeof result[0] === 'number') return result

  // Runs are cut from the left, so a curve is often entered by a short arc of its own before the
  // real one, and a point further off than the others can cut an arc in two. Two neighbouring
  // arcs that turn the same way are tried as one: kept when the whole path still fits.
  for (let i = 0; i + 1 < loci.length; ) {
    const a = loci[i]
    const b = loci[i + 1]
    if (a.straight || b.straight || a.k * b.k <= 0 || b.hi - a.lo < 2) {
      i++
      continue
    }
    const merged = copyLoci(loci)
    const one = startLocus(ctx, a.lo, b.hi, false)
    fitLocus(ctx, one)
    merged.splice(i, 2, one)
    const shorter = solveChain(ctx, merged, startHeading, endHeading)
    if (typeof shorter[0] === 'number') {
      i++
    } else {
      loci = merged
      result = shorter
    }
  }
  return result
}

/**
 * The fitted path, tightening the fit around the places out of tolerance from one round to the
 * next, with the number of rounds it took; null when `rounds` were not enough
 */
function fitWithin(
  ctx: FitContext,
  startHeading: number | null,
  endHeading: number | null,
  rounds: number,
): { pieces: FittedPiece[]; rounds: number } | null {
  ctx.share.fill(1)
  for (let round = 0; round < rounds; round++) {
    refreshLimits(ctx)
    const result = attempt(ctx, startHeading, endHeading)
    if (typeof result[0] !== 'number') return { pieces: result as FittedPiece[], rounds: round + 1 }
    ctx.lastFailed = result as number[]
    // Each point out of tolerance tightens the fit on itself and its two neighbours on each side
    const done = new Uint8Array(ctx.n)
    for (const at of result as number[]) {
      for (let i = Math.max(0, at - 2); i <= Math.min(ctx.n - 1, at + 2); i++) {
        if (done[i]) continue
        done[i] = 1
        ctx.share[i] *= TIGHTEN
      }
    }
  }
  return null
}

/**
 * The polyline itself with every corner rounded as wide as the tolerance and the two sides allow:
 * what is left when nothing shorter fits. Built straight from the points, each piece from its own
 * coordinates.
 */
function roundedPolyline(ctx: FitContext): FittedPiece[] {
  const pts = ctx.pts
  const pieces: FittedPiece[] = []
  let fromX = pts[0].x
  let fromY = pts[0].y
  for (let i = 0; i + 1 < ctx.n; i++) {
    const side = ctx.cum[i + 1] - ctx.cum[i]
    const tx = (pts[i + 1].x - pts[i].x) / side
    const ty = (pts[i + 1].y - pts[i].y) / side
    const heading = Math.atan2(ty, tx)
    let toX = pts[i + 1].x
    let toY = pts[i + 1].y
    let arc: FittedPiece | null = null
    if (i + 2 < ctx.n) {
      const next = ctx.cum[i + 2] - ctx.cum[i + 1]
      const ux = (pts[i + 2].x - pts[i + 1].x) / next
      const uy = (pts[i + 2].y - pts[i + 1].y) / next
      const turn = Math.atan2(tx * uy - ty * ux, tx * ux + ty * uy)
      const half = Math.abs(turn) / 2
      if (half > 1e-9) {
        const widest = (0.45 * Math.min(side, next)) / Math.tan(half)
        let radius = Math.min((0.8 * ctx.tolerance) / (1 / Math.cos(half) - 1), widest)
        if (ctx.minRadius > 0) radius = Math.min(Math.max(radius, ctx.minRadius), widest)
        const tangent = radius * Math.tan(half)
        toX -= tangent * tx
        toY -= tangent * ty
        arc = { x: toX, y: toY, heading, curvature: Math.sign(turn) / radius, length: radius * Math.abs(turn) }
      }
    }
    const length = (toX - fromX) * tx + (toY - fromY) * ty
    if (length > MIN_LENGTH) pieces.push({ x: fromX, y: fromY, heading, curvature: 0, length })
    if (arc && arc.length > 0) {
      pieces.push(arc)
      const end = pieceEnd(arc)
      fromX = end.x
      fromY = end.y
    } else {
      fromX = toX
      fromY = toY
    }
  }
  return pieces
}

// ─────────────────── End points and imposed directions ───────────────────

/**
 * A path that leaves the point (x, y) — along `heading` when given — and joins `pieces` again at
 * most `distance` down: one arc replaces its beginning, two tangent arcs when the direction is
 * imposed. As far down as keeps the points within tolerance.
 */
function leaveFrom(
  ctx: FitContext,
  pieces: FittedPiece[],
  x: number,
  y: number,
  heading: number | null,
  distance: number,
  out: (p: FittedPiece[]) => number,
): FittedPiece[] {
  let best: FittedPiece[] = pieces
  let bestOut = Infinity
  for (let tries = 0; tries < 6; tries++) {
    const pose = pointOnPath(pieces, distance)
    const head =
      heading === null
        ? reversePath([arcThrough(pose.x, pose.y, pose.heading + Math.PI, x, y)])
        : biarc(x, y, heading, pose.x, pose.y, pose.heading)
    const result = [...head, ...pathBeyond(pieces, distance)]
    // The longest correction that keeps every point within tolerance; failing that, the one that
    // leaves the fewest out
    const count = ctx.minRadius > 0 ? 0 : out(result)
    if (count < bestOut) {
      best = result
      bestOut = count
    }
    if (count === 0) break
    distance /= 2
  }
  return best
}

/**
 * `pieces` made to start and end on the two end points, along the imposed directions: untouched
 * where it already does, joined by one or two arcs over a short distance where it does not.
 */
function joinEnds(ctx: FitContext, pieces: FittedPiece[], startHeading: number | null, endHeading: number | null): FittedPiece[] {
  const first = ctx.pts[0]
  const last = ctx.pts[ctx.n - 1]
  const total = pathLength(pieces)
  const end = pieceEnd(pieces[pieces.length - 1])
  const gapStart = Math.hypot(pieces[0].x - first.x, pieces[0].y - first.y)
  const gapEnd = Math.hypot(end.x - last.x, end.y - last.y)
  const offStart = startHeading === null ? 0 : Math.abs(wrapAngle(startHeading - pieces[0].heading))
  const offEnd = endHeading === null ? 0 : Math.abs(wrapAngle(endHeading - end.heading))
  const atStart = gapStart > 1e-7 || offStart > SAME_HEADING
  const atEnd = gapEnd > 1e-7 || offEnd > SAME_HEADING
  if (!atStart && !atEnd) return pieces
  // How far down the path a correction is spread. Two arcs that take up an angle `off` over a
  // distance `s` stray about `s·off/4` from the path and have a radius of about `s/(3·off)`; an
  // arc that takes up a gap `g` over `s` has a radius of `s²/(2·g)`
  const lead = (gap: number, off: number) => {
    const wanted = Math.max(off > SAME_HEADING ? (3 * ctx.tolerance) / off : 0, Math.sqrt(2 * gap * JOIN_RADIUS))
    return ctx.minRadius > 0 ? Math.max(wanted, 3 * off * ctx.minRadius, Math.sqrt(4 * gap * ctx.minRadius)) : wanted
  }
  const out = (p: FittedPiece[]) => pointsOutOfTolerance(ctx, p).length
  const check = (p: FittedPiece[]) => out(p) === 0
  const leadStart = atStart ? lead(gapStart, offStart) : 0
  const leadEnd = atEnd ? lead(gapEnd, offEnd) : 0
  if (startHeading !== null && endHeading !== null && leadStart + leadEnd >= total) {
    // No room for a correction at each end: two arcs from end to end, when the points allow it
    // or when the path is too short for anything else
    const whole = biarc(first.x, first.y, startHeading, last.x, last.y, endHeading)
    if (ctx.n === 2 || check(whole)) return whole
  }
  if (!atEnd && startHeading !== null && leadStart >= total) {
    // The correction takes the whole path: the one arc that leaves along the direction and reaches the end
    const arc = arcThrough(first.x, first.y, startHeading, last.x, last.y)
    if (check([arc])) return [arc]
  }
  if (!atStart && endHeading !== null && leadEnd >= total) {
    const arc = reversePath([arcThrough(last.x, last.y, endHeading + Math.PI, first.x, first.y)])
    if (check(arc)) return arc
  }
  const room = atStart && atEnd ? total / 2 : total * 0.9
  let joined = pieces
  if (atStart) joined = leaveFrom(ctx, joined, first.x, first.y, startHeading, Math.min(leadStart, room), out)
  if (atEnd) {
    const back = leaveFrom(
      ctx,
      reversePath(joined),
      last.x,
      last.y,
      endHeading === null ? null : endHeading + Math.PI,
      Math.min(leadEnd, room),
      (p) => out(reversePath(p)),
    )
    joined = reversePath(back)
  }
  return joined
}

// ─────────────────── The fit ───────────────────

/** The points without the ones that repeat the point before them; the first and the last are kept as they are */
function distinctPoints(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const prev = out[out.length - 1]
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-6) out.push({ x: p.x, y: p.y })
  }
  const last = points[points.length - 1]
  if (out.length > 1 && last && Number.isFinite(last.x) && Number.isFinite(last.y)) out[out.length - 1] = { x: last.x, y: last.y }
  return out
}

/**
 * Tidies a finished path: its first point is the first input point to the last digit, its first
 * heading is within ±π and the next ones run on from piece to piece without jumps of a whole turn,
 * and two neighbours with the same curvature are one piece.
 */
function tidy(pieces: FittedPiece[], first: Point): FittedPiece[] {
  const out: FittedPiece[] = []
  for (const piece of pieces) {
    const prev = out[out.length - 1]
    if (!prev) {
      out.push({ ...piece, x: first.x, y: first.y, heading: wrapAngle(piece.heading) })
      continue
    }
    const end = pieceEnd(prev)
    const heading = piece.heading + TAU * Math.round((end.heading - piece.heading) / TAU)
    const reach = prev.length + piece.length
    if (Math.abs(prev.curvature - piece.curvature) * reach * reach < 1e-9) {
      prev.length = reach
    } else {
      out.push({ ...piece, heading })
    }
  }
  return out
}

/** What a fit is asked for, the same for the whole path and for each of its stretches */
interface FitSettings {
  tolerance: number
  chordTolerance: number
  minCurvature: number
  minRadius: number
}

/**
 * The path fitted on a stretch of points, from its first to its last one and along the headings
 * given: not yet tidied.
 */
function fitStretch(pts: Point[], settings: FitSettings, startHeading: number | null, endHeading: number | null): FittedPiece[] {
  const n = pts.length
  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  const ctx: FitContext = {
    pts,
    n,
    cum,
    tolerance: settings.tolerance,
    chordTolerance: settings.chordTolerance,
    minCurvature: settings.minCurvature,
    maxCurvature: settings.minRadius > 0 ? 1 / settings.minRadius : Infinity,
    minRadius: settings.minRadius,
    pinned: true,
    share: new Float64Array(n),
    pointLimit: new Float64Array(n),
    sideLimit: new Float64Array(n),
    lastFailed: [],
  }

  // Three ways to the two end points and the imposed directions, each of which may fail or need
  // the fit tightened where another does not: held on the end points with the directions as
  // conditions of the fit (the answer when the points agree with them, and it costs no extra
  // piece), held on the end points only, and free of them — what the path then misses is made up
  // over a short distance at each end. The first that fits at once is taken; failing that, the
  // one with the fewest pieces.
  let best: FittedPiece[] | null = null
  let bestWithin = false
  const ways: [boolean, number | null, number | null][] = [[true, startHeading, endHeading]]
  if (startHeading !== null || endHeading !== null) ways.push([true, null, null])
  ways.push([false, null, null])
  for (const [pinned, start, end] of ways) {
    ctx.pinned = pinned
    const fit = fitWithin(ctx, start, end, pinned ? PINNED_ROUNDS : MAX_ROUNDS)
    if (!fit) continue
    const pieces = joinEnds(ctx, fit.pieces, startHeading, endHeading)
    const within = pointsOutOfTolerance(ctx, pieces).length === 0
    if (!best || (within && !bestWithin) || (within === bestWithin && pieces.length < best.length)) {
      best = pieces
      bestWithin = within
    }
    if (within && fit.rounds === 1) break
  }
  if (best) return best
  ctx.pinned = true
  if (n <= 3) return joinEnds(ctx, roundedPolyline(ctx), startHeading, endHeading)

  // Nothing fits the stretch as a whole: it is cut in two at the place that kept failing, the one
  // closest to its middle, and each half is fitted on its own. The second half leaves that point
  // along the direction the first one reaches it with, so the path stays tangent, and whatever
  // is wrong around it is left to the ends of two fits, where they are free to leave the path
  // they found.
  let cut = n >> 1
  for (const at of ctx.lastFailed) {
    if (at > 0 && at < n - 1 && (cut === n >> 1 || Math.abs(at - n / 2) < Math.abs(cut - n / 2))) cut = at
  }
  if (!ctx.lastFailed.includes(cut)) cut = Math.max(1, Math.min(n - 2, cut))
  const before = fitStretch(pts.slice(0, cut + 1), settings, startHeading, null)
  const through = pieceEnd(before[before.length - 1]).heading
  return [...before, ...fitStretch(pts.slice(cut), settings, through, endHeading)]
}

/**
 * Straight lines and circular arcs that run from the first to the last point of `points`, tangent
 * to each other, within `tolerance` of every point: as few as a left-to-right fit finds.
 *
 * Each piece carries its own start pose; the first heading is within ±π and the next ones run on
 * along the path (they are not brought back within ±π). Fewer than two distinct points give no piece.
 *
 * What is guaranteed whatever the points: the two ends, the tangency and the imposed directions.
 * The tolerance is met whenever the points allow it; it gives way to an imposed direction the
 * points contradict over a short path, and to `minRadius`.
 */
export function fitPath(points: readonly Point[], options: ArcFitOptions): FittedPiece[] {
  const pts = distinctPoints(points)
  if (pts.length < 2) return []
  const tolerance = Math.max(options.tolerance, 1e-6)
  const settings: FitSettings = {
    tolerance,
    chordTolerance: Math.max(options.chordTolerance ?? tolerance, 1e-6),
    minCurvature: 1 / (options.maxRadius ?? 100_000),
    minRadius: options.minRadius !== undefined && options.minRadius > 0 ? options.minRadius : 0,
  }
  const heading = (t: Point | undefined) => (t && Math.hypot(t.x, t.y) > 0 ? Math.atan2(t.y, t.x) : null)
  return tidy(fitStretch(pts, settings, heading(options.startTangent), heading(options.endTangent)), pts[0])
}
