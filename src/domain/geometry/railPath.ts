import type { PathPiece, Point } from '../models/types'

// ─────────────────── The path of a long rail ───────────────────
//
// A long rail is one rail between two junctions that carries its whole path: an ordered list of
// straight lines and circular arcs, each tangent to the next (`PathPiece`). On a line or an arc
// everything a train asks is a direct formula — the point a distance along, the direction there,
// the radius, the closest point — and the two running rails of an arc are arcs again. A place on
// the path is a distance `s` from its start, in metres; `t` of the rail is `s` over its length.

/** Below this curvature (1/m) a piece is a straight line: a radius of a thousand kilometres */
const STRAIGHT_BELOW = 1e-9
/** An arc is handed to the drawing as quadratic curves of at most this turn (radians): R·θ⁴/128 off, 3 mm at R = 4 km */
const MAX_QUADRATIC_TURN = 0.35

/** A box along the axes, world metres */
export interface PathBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** The path of a rail ready to be asked: its pieces where the rail now lies, and what is worked out once */
export interface RailPath {
  pieces: readonly PathPiece[]
  /** Distance from the start of the path to the start of each piece, and its whole length last */
  starts: Float64Array
  length: number
  box: PathBox
}

/** Where a piece is `u` metres from its start, and the direction of travel there */
export function pieceAt(piece: PathPiece, u: number): { x: number; y: number; heading: number } {
  const { x, y, heading, curvature } = piece
  if (Math.abs(curvature) < STRAIGHT_BELOW) {
    return { x: x + u * Math.cos(heading), y: y + u * Math.sin(heading), heading }
  }
  const end = heading + curvature * u
  return {
    x: x + (Math.sin(end) - Math.sin(heading)) / curvature,
    y: y - (Math.cos(end) - Math.cos(heading)) / curvature,
    heading: end,
  }
}

/** Where a piece ends, and the direction of travel there */
export function pieceEnd(piece: PathPiece): { x: number; y: number; heading: number } {
  return pieceAt(piece, piece.length)
}

function build(pieces: readonly PathPiece[]): RailPath {
  const starts = new Float64Array(pieces.length + 1)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const take = (x: number, y: number, pad: number): void => {
    if (x - pad < minX) minX = x - pad
    if (x + pad > maxX) maxX = x + pad
    if (y - pad < minY) minY = y - pad
    if (y + pad > maxY) maxY = y + pad
  }
  let s = 0
  pieces.forEach((piece, i) => {
    starts[i] = s
    s += piece.length
    // The ends of the piece and, on an arc, points close enough for the arc to stay within `pad` of their chords
    const turn = Math.abs(piece.curvature) * piece.length
    const steps = Math.max(1, Math.ceil(turn / 0.2))
    const pad = turn > 0 ? (1 - Math.cos(turn / steps / 2)) / Math.abs(piece.curvature) : 0
    for (let k = 0; k <= steps; k++) {
      const at = pieceAt(piece, (piece.length * k) / steps)
      take(at.x, at.y, pad)
    }
  })
  starts[pieces.length] = s
  if (pieces.length === 0) minX = maxX = minY = maxY = 0
  return { pieces, starts, length: s, box: { minX, maxX, minY, maxY } }
}

/** The pieces turned, scaled and shifted so that the path runs from `a` to `b` */
function fitToEnds(pieces: readonly PathPiece[], a: Point, b: Point): readonly PathPiece[] {
  if (pieces.length === 0) return pieces
  const from = pieces[0]
  const to = pieceEnd(pieces[pieces.length - 1])
  const was = Math.hypot(to.x - from.x, to.y - from.y)
  const now = Math.hypot(b.x - a.x, b.y - a.y)
  // A path that comes back to its start cannot be turned onto its ends: it is only shifted
  const scale = was > 1e-9 && now > 1e-9 ? now / was : 1
  const turn = was > 1e-9 && now > 1e-9 ? Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(to.y - from.y, to.x - from.x) : 0
  if (Math.abs(scale - 1) < 1e-12 && Math.abs(turn) < 1e-12 && Math.hypot(a.x - from.x, a.y - from.y) < 1e-9) return pieces
  const cos = Math.cos(turn) * scale
  const sin = Math.sin(turn) * scale
  return pieces.map((piece) => {
    const dx = piece.x - from.x
    const dy = piece.y - from.y
    return {
      x: a.x + dx * cos - dy * sin,
      y: a.y + dx * sin + dy * cos,
      heading: piece.heading + turn,
      curvature: piece.curvature / scale,
      length: piece.length * scale,
    }
  })
}

interface Kept {
  ax: number
  ay: number
  bx: number
  by: number
  path: RailPath
}

const kept = new WeakMap<readonly PathPiece[], Kept>()

/**
 * The path of a long rail as it lies between its two nodes `a` and `b`. The stored pieces say what
 * the path is; where the nodes have been moved since, it follows them — turned, scaled and shifted
 * onto them, tangent to tangent as before. Worked out once per list of pieces and place of the
 * nodes: asked again for every question about the rail.
 */
export function railPath(pieces: readonly PathPiece[], a: Point, b: Point): RailPath {
  const last = kept.get(pieces)
  if (last && last.ax === a.x && last.ay === a.y && last.bx === b.x && last.by === b.y) return last.path
  const path = build(fitToEnds(pieces, a, b))
  kept.set(pieces, { ax: a.x, ay: a.y, bx: b.x, by: b.y, path })
  return path
}

/** A path from its pieces as they are, for pieces that belong to no rail (tests, fitting) */
export function pathOf(pieces: readonly PathPiece[]): RailPath {
  return build(pieces)
}

/** Index of the piece that holds the place `s` metres along the path */
function pieceIndexAt(path: RailPath, s: number): number {
  const { starts } = path
  let lo = 0
  let hi = path.pieces.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= s) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Point and direction of travel `s` metres along a path (held within the path) */
export function pathAt(path: RailPath, s: number): { x: number; y: number; heading: number } {
  if (path.pieces.length === 0) return { x: 0, y: 0, heading: 0 }
  const at = Math.max(0, Math.min(path.length, s))
  const i = pieceIndexAt(path, at)
  return pieceAt(path.pieces[i], at - path.starts[i])
}

/** Signed curvature (1/m) `s` metres along a path */
export function pathCurvatureAt(path: RailPath, s: number): number {
  if (path.pieces.length === 0) return 0
  return path.pieces[pieceIndexAt(path, Math.max(0, Math.min(path.length, s)))].curvature
}

/** Place of a piece closest to `p`: metres from its start, and how far `p` is from it */
function closestOnPiece(piece: PathPiece, p: Point): { u: number; distance: number } {
  const { x, y, heading, curvature, length } = piece
  if (Math.abs(curvature) < STRAIGHT_BELOW) {
    const u = Math.max(0, Math.min(length, (p.x - x) * Math.cos(heading) + (p.y - y) * Math.sin(heading)))
    return { u, distance: Math.hypot(x + u * Math.cos(heading) - p.x, y + u * Math.sin(heading) - p.y) }
  }
  // Centre of the arc, and the angle of the radius that sweeps it: it turns as the heading does
  const cx = x - Math.sin(heading) / curvature
  const cy = y + Math.cos(heading) / curvature
  const startAngle = Math.atan2(y - cy, x - cx)
  let swept = Math.atan2(p.y - cy, p.x - cx) - startAngle
  const full = 2 * Math.PI
  if (curvature > 0) swept = ((swept % full) + full) % full
  else swept = -((((-swept) % full) + full) % full)
  const u = swept / curvature
  if (u <= length) return { u, distance: Math.abs(Math.hypot(p.x - cx, p.y - cy) - 1 / Math.abs(curvature)) }
  // Beyond the arc: the nearer of its two ends
  const end = pieceAt(piece, length)
  const toStart = Math.hypot(p.x - x, p.y - y)
  const toEnd = Math.hypot(p.x - end.x, p.y - end.y)
  return toStart <= toEnd ? { u: 0, distance: toStart } : { u: length, distance: toEnd }
}

/** Place of a path closest to `p`: metres from its start, and how far `p` is from it */
export function pathClosest(path: RailPath, p: Point): { s: number; distance: number } {
  let best = { s: 0, distance: Infinity }
  path.pieces.forEach((piece, i) => {
    const found = closestOnPiece(piece, p)
    if (found.distance < best.distance) best = { s: path.starts[i] + found.u, distance: found.distance }
  })
  return best
}

/** A line or a quadratic curve a canvas takes as it is */
export interface DrawnPiece {
  a: Point
  b: Point
  via: Point | undefined
}

/**
 * What a path is drawn from between `s0` and `s1` metres, in the order walked (`s0` may be the
 * larger one): a line per straight piece, and each arc as quadratic curves whose control point is
 * where the tangents of its two ends meet.
 */
export function pathDrawnPieces(path: RailPath, s0: number, s1: number): DrawnPiece[] {
  const out: DrawnPiece[] = []
  const lo = Math.max(0, Math.min(s0, s1))
  const hi = Math.min(path.length, Math.max(s0, s1))
  if (!(hi > lo)) return out
  const backwards = s0 > s1
  const first = pieceIndexAt(path, lo)
  for (let i = first; i < path.pieces.length && path.starts[i] < hi; i++) {
    const piece = path.pieces[i]
    const from = Math.max(lo, path.starts[i]) - path.starts[i]
    const to = Math.min(hi, path.starts[i + 1]) - path.starts[i]
    if (!(to > from)) continue
    const turn = Math.abs(piece.curvature) * (to - from)
    const parts = Math.abs(piece.curvature) < STRAIGHT_BELOW ? 1 : Math.max(1, Math.ceil(turn / MAX_QUADRATIC_TURN))
    for (let k = 0; k < parts; k++) {
      const u0 = from + ((to - from) * k) / parts
      const u1 = from + ((to - from) * (k + 1)) / parts
      const a = pieceAt(piece, u0)
      const b = pieceAt(piece, u1)
      let via: Point | undefined
      if (Math.abs(piece.curvature) >= STRAIGHT_BELOW) {
        const reach = Math.tan((piece.curvature * (u1 - u0)) / 2) / piece.curvature
        via = { x: a.x + Math.cos(a.heading) * reach, y: a.y + Math.sin(a.heading) * reach }
      }
      out.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, via })
    }
  }
  if (backwards) {
    out.reverse()
    for (const piece of out) {
      const a = piece.a
      piece.a = piece.b
      piece.b = a
    }
  }
  return out
}

/**
 * Points of a path in order from `s0` to `s1` metres (`s0` may be the larger one): the ends of its
 * pieces and, on each arc, chords of at most `maxTurn` radians — never more than `maxChords` per arc.
 */
export function pathPolyline(path: RailPath, s0: number, s1: number, maxTurn: number, maxChords: number): Point[] {
  const lo = Math.max(0, Math.min(s0, s1))
  const hi = Math.min(path.length, Math.max(s0, s1))
  const start = pathAt(path, lo)
  const pts: Point[] = [{ x: start.x, y: start.y }]
  if (hi > lo) {
    for (let i = pieceIndexAt(path, lo); i < path.pieces.length && path.starts[i] < hi; i++) {
      const piece = path.pieces[i]
      const from = Math.max(lo, path.starts[i]) - path.starts[i]
      const to = Math.min(hi, path.starts[i + 1]) - path.starts[i]
      if (!(to > from)) continue
      const chords = Math.max(1, Math.min(maxChords, Math.ceil((Math.abs(piece.curvature) * (to - from)) / maxTurn)))
      for (let k = 1; k <= chords; k++) {
        const at = pieceAt(piece, from + ((to - from) * k) / chords)
        pts.push({ x: at.x, y: at.y })
      }
    }
  }
  return s0 > s1 ? pts.reverse() : pts
}

/** The pieces of a path between `s0` and `s1` metres (`s0` < `s1`), as a path of its own */
export function pathSlice(path: RailPath, s0: number, s1: number): PathPiece[] {
  const out: PathPiece[] = []
  const lo = Math.max(0, s0)
  const hi = Math.min(path.length, s1)
  if (!(hi > lo)) return out
  for (let i = pieceIndexAt(path, lo); i < path.pieces.length && path.starts[i] < hi; i++) {
    const piece = path.pieces[i]
    const from = Math.max(lo, path.starts[i]) - path.starts[i]
    const to = Math.min(hi, path.starts[i + 1]) - path.starts[i]
    if (!(to - from > 1e-9)) continue
    const at = pieceAt(piece, from)
    out.push({ x: at.x, y: at.y, heading: at.heading, curvature: piece.curvature, length: to - from })
  }
  return out
}

/** The same path walked from its other end */
export function reversedPieces(pieces: readonly PathPiece[]): PathPiece[] {
  return pieces
    .map((piece) => {
      const end = pieceEnd(piece)
      return { x: end.x, y: end.y, heading: end.heading + Math.PI, curvature: -piece.curvature, length: piece.length }
    })
    .reverse()
}

/** Tightest curve of a path: its radius (m) and the hand it turns to, null for a path of straight lines only */
export function pathTightestCurve(path: RailPath): { radius: number; hand: 1 | -1 } | null {
  let tightest = 0
  for (const piece of path.pieces) {
    if (Math.abs(piece.curvature) > Math.abs(tightest)) tightest = piece.curvature
  }
  return Math.abs(tightest) < STRAIGHT_BELOW ? null : { radius: 1 / Math.abs(tightest), hand: tightest > 0 ? 1 : -1 }
}

const checksums = new WeakMap<readonly PathPiece[], number>()

/**
 * A number that changes with the pieces of a path: what a copy of the network compared value by
 * value keeps of a long rail, in place of all its pieces. Worked out once per list.
 */
export function pathChecksum(pieces: readonly PathPiece[]): number {
  let sum = checksums.get(pieces)
  if (sum === undefined) {
    sum = pieces.length
    pieces.forEach((piece, i) => {
      sum = sum! * 1.000001 + (i + 1) * (piece.x + 2 * piece.y + 3 * piece.heading + 5e3 * piece.curvature + 7 * piece.length)
    })
    checksums.set(pieces, sum)
  }
  return sum
}
