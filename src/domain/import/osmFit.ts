import type { Point } from '../models/types'
import { automaticCant, cantForRampLength, layableCant } from '../models/cant'
import type { LineType } from '../models/speedLimits'
import { curveSpeedLimit } from '../models/trackSpeed'
import type { Chain } from './osmGraph'
import { rawLeave } from './osmJunctions'
import { angleDeg, arcPrim, biarc, cross, dot, linePrim, primBetween, primDistance, RAD, reversed, rotate, signedAngle, STRAIGHT_TOLERANCE_DEG, sub, unit, type Prim } from './osmArcs'

// A chain of OSM nodes fitted with straight lines and circular arcs that meet tangent to each other.
// OSM draws a track as a broken line with a node every 15 to 60 m, each a few decimetres off: laid
// node to node it would make far more rails than the track has, and every one of those decimetres
// would show as a bend, so as a speed limit. A track is laid out as straight lines and circular
// curves, and that is what is looked for here:
// 1. the chain is cut into runs of nodes that lie on one line or on one circle, each as long as
//    the tolerance allows, and the line or the circle is fitted to all the nodes of the run;
// 2. two runs that follow each other do not quite meet: each is cut short of the other and the
//    gap is closed by two arcs tangent to both, which is where the transition curve of the real
//    track is;
// 3. at each end of the chain the direction is imposed by the node (see `settleNodeTangents`):
//    two arcs again, from the node to the fitted track a few metres on;
// 4. a track whose speed OSM gives (`DesignSpeed`) is judged the way the editor will judge it once
//    laid (`allowedSpeeds`): where its curves allow less than that speed, the joining pieces are
//    chosen for the speed they allow and the nodes around are given more room (`fitChain`).

/** Distance (m) from each end of a chain over which the track is brought from the direction imposed at the node to its own */
export const MIN_JOINT_SPACING = 10
/** Around a double slip the rails are bent onto its line, over this distance (m) */
export const SLIP_CLEARANCE = 30
/** Farthest (m) the line or the circle of a run may pass from one of its nodes */
export const DEFAULT_FIT_TOLERANCE = 0.3
/** A chain needs this much track (m) between the stretches taken up at its two ends to be fitted; shorter, it is one piece */
const MIN_BODY = 10
/** A circle is only read in four nodes or more (three always lie on one), of this radius (m) at least… */
const MIN_CIRCLE_NODES = 4
const MIN_CIRCLE_RADIUS = 30
/** …turning by this much (degrees) at most over the run */
const MAX_RUN_SWEEP_DEG = 150
/** Farthest (m) a curve is taken to bulge out of a stretch between two nodes */
const MAX_STRETCH_BULGE = 1
/** A circle counts for this many lines when the chain is cut into runs: what a line can cover, a line does */
const CIRCLE_COST = 1.15
/** A run shorter than this (m) counts for more, up to this much more for a run of no length */
const FULL_RUN = 30
const SHORT_RUN_COST = 1.5
/** A run shorter than this (m) is left out when the runs around it can be joined over it */
const SHORT_RUN = 30
/** Lengths (m) tried, longest first, for the stretch of each run given up to the piece that joins it to the next */
const JOIN_REACHES = [60, 40, 25, 15, 10, 5]
/** …and longer ones, tried after them where a track has a speed the usual ones do not give it */
const LONG_JOIN_REACHES = [120, 240]
/** …which never takes more than this share of a run */
const MAX_JOIN_SHARE = 0.45
/** The single arc that joins two runs turns by this much (degrees) at most */
const MAX_JOIN_SWEEP_DEG = 60
/** Two arcs of the same hand whose radii are within this ratio are one arc */
const SAME_RADIUS = 0.02
/** Two primitives are on the same line when their directions agree within this (degrees) */
const SEAM_TOLERANCE_DEG = 0.02
/** A single piece is laid to a direction that is imposed when it arrives within this (degrees) of it: the kink left cannot be seen */
const JOIN_TOLERANCE_DEG = 0.3

/** Where a track allows less than its zone, the tolerance of the nodes around is multiplied by this, as many times… */
const WIDENING = 1.5
const MAX_WIDENINGS = 4
/** …and up to this many times the tolerance of the chain: 0.9 m for the 0.3 m of a first fitting */
const MAX_WIDENING = 3

/** A primitive of a fitted chain, with the stretch of the chain (distances along it) it stands for */
export interface FittedPrim extends Prim {
  s0: number
  s1: number
  /** Where it comes from: a line or a circle fitted to nodes, the piece that joins two of those, the piece that leaves an end node, a chain laid as one piece */
  role?: 'run' | 'join' | 'leave' | 'piece'
}

/** True for a chain laid as a single piece from one end to the other: too short to be fitted */
export function isSinglePiece(chain: Chain, clearStart: number, clearEnd: number): boolean {
  return chain.length < clearStart + clearEnd + MIN_BODY
}

/** The line fitted to the nodes `a`…`b` of a chain, as the primitive from the first to the last; null when they do not lie on one */
function lineRun(pts: Point[], a: number, b: number, tolerance: number[]): Prim | null {
  let gx = 0
  let gy = 0
  for (let k = a; k <= b; k++) {
    gx += pts[k].x
    gy += pts[k].y
  }
  const n = b - a + 1
  gx /= n
  gy /= n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let k = a; k <= b; k++) {
    const x = pts[k].x - gx
    const y = pts[k].y - gy
    sxx += x * x
    sxy += x * y
    syy += y * y
  }
  // Direction of the greatest spread, turned the way the chain runs
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  let dir = { x: Math.cos(angle), y: Math.sin(angle) }
  if (dot(dir, sub(pts[b], pts[a])) < 0) dir = reversed(dir)
  const g = { x: gx, y: gy }
  for (let k = a; k <= b; k++) if (Math.abs(cross(dir, sub(pts[k], g))) > tolerance[k]) return null
  const along = (p: Point): Point => {
    const t = dot(sub(p, g), dir)
    return { x: gx + dir.x * t, y: gy + dir.y * t }
  }
  return linePrim(along(pts[a]), along(pts[b]))
}

/** Angle (radians) by which a chain turns at one of its nodes; 0 at its ends */
function turnAt(pts: Point[], k: number): number {
  if (k <= 0 || k >= pts.length - 1) return 0
  const u = unit(sub(pts[k], pts[k - 1]))
  const v = unit(sub(pts[k + 1], pts[k]))
  return u && v ? Math.abs(signedAngle(u, v)) : 0
}

/**
 * How far (m) the track may lie from the straight stretch OSM draws between two nodes: what a
 * curve bulges out of a stretch that turns by the same angle at both ends — a stretch that turns
 * at one end only is a straight line before a bend — and never more than `MAX_STRETCH_BULGE`,
 * since long stretches are drawn where the track is straight.
 */
function stretchBulge(pts: Point[], k: number): number {
  const length = Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y)
  return Math.min(MAX_STRETCH_BULGE, (length * Math.min(turnAt(pts, k), turnAt(pts, k + 1))) / 8)
}

/** The circle fitted to the nodes `a`…`b` of a chain, as the arc from the first to the last; null when they do not lie on one */
function circleRun(pts: Point[], a: number, b: number, tolerance: number[]): Prim | null {
  const n = b - a + 1
  if (n < MIN_CIRCLE_NODES) return null
  // Least squares on x² + y² + A x + B y + C = 0, about the first node to keep the sums small
  const o = pts[a]
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  let syy = 0
  let sxz = 0
  let syz = 0
  let sz = 0
  for (let k = a; k <= b; k++) {
    const x = pts[k].x - o.x
    const y = pts[k].y - o.y
    const z = x * x + y * y
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
    syy += y * y
    sxz += x * z
    syz += y * z
    sz += z
  }
  // Cramer on [sxx sxy sx; sxy syy sy; sx sy n] (A, B, C) = −(sxz, syz, sz)
  const det = sxx * (syy * n - sy * sy) - sxy * (sxy * n - sy * sx) + sx * (sxy * sy - syy * sx)
  if (Math.abs(det) < 1e-9) return null
  const A = -(sxz * (syy * n - sy * sy) - sxy * (syz * n - sy * sz) + sx * (syz * sy - syy * sz)) / det
  const B = -(sxx * (syz * n - sy * sz) - sxz * (sxy * n - sy * sx) + sx * (sxy * sz - syz * sx)) / det
  const C = -(sxx * (syy * sz - sy * syz) - sxy * (sxy * sz - syz * sx) + sxz * (sxy * sy - syy * sx)) / det
  const squared = (A * A + B * B) / 4 - C
  if (!(squared > 0)) return null
  const radius = Math.sqrt(squared)
  if (!(radius >= MIN_CIRCLE_RADIUS)) return null
  const centre = { x: o.x - A / 2, y: o.y - B / 2 }

  // The nodes run round the circle one way, each on it within the tolerance
  let sweep = 0
  let hand = 0
  for (let k = a; k <= b; k++) {
    const spoke = sub(pts[k], centre)
    if (Math.abs(Math.hypot(spoke.x, spoke.y) - radius) > tolerance[k]) return null
    if (k === a) continue
    const step = signedAngle(sub(pts[k - 1], centre), spoke)
    if (hand === 0) hand = Math.sign(step)
    else if (Math.sign(step) === -hand) return null
    sweep += step
  }
  if (hand === 0 || Math.abs(sweep) > MAX_RUN_SWEEP_DEG * RAD) return null
  // Between two nodes the circle may only leave the straight stretch OSM draws by what a curve
  // drawn with such stretches would: four nodes far apart lie on a circle that is nowhere near the track
  for (let k = a; k < b; k++) {
    const middle = { x: (pts[k].x + pts[k + 1].x) / 2, y: (pts[k].y + pts[k + 1].y) / 2 }
    const off = Math.abs(Math.hypot(middle.x - centre.x, middle.y - centre.y) - radius)
    if (off > Math.max(tolerance[k], tolerance[k + 1]) + stretchBulge(pts, k)) return null
  }
  const onto = (p: Point): Point => {
    const spoke = unit(sub(p, centre))!
    return { x: centre.x + spoke.x * radius, y: centre.y + spoke.y * radius }
  }
  const p0 = onto(pts[a])
  const t0 = rotate(unit(sub(p0, centre))!, (hand * Math.PI) / 2)
  return { p0, p1: onto(pts[b]), t0, t1: rotate(t0, sweep), sweep, radius, length: radius * Math.abs(sweep) }
}

/**
 * The runs of a chain: each a line or an arc fitted to nodes that lie on one, the last node of a
 * run being the first of the next. Of all the ways to cut the chain into such runs, the one with
 * the fewest is kept, a short run counting for more than a long one: taking each run as long as it
 * will go leaves scraps of two nodes between the real lines and curves, where the track would have
 * to turn sharply to join them.
 */
function fitRuns(chain: Chain, tolerance: number[]): FittedPrim[] {
  const { pts, stations } = chain
  const last = pts.length - 1
  // How far a line, and a circle, can be run from each node
  const lineEnd: number[] = []
  const arcEnd: number[] = []
  for (let a = 0; a < last; a++) {
    let b = a + 1
    while (b < last && lineRun(pts, a, b + 1, tolerance)) b++
    lineEnd.push(b)
    b = a + MIN_CIRCLE_NODES - 2
    while (b < last && circleRun(pts, a, b + 1, tolerance)) b++
    arcEnd.push(b >= a + MIN_CIRCLE_NODES - 1 ? b : -1)
  }

  const cost = (a: number, b: number): number => {
    const length = stations[b] - stations[a]
    return (b <= lineEnd[a] ? 1 : CIRCLE_COST) + (length >= FULL_RUN ? 0 : SHORT_RUN_COST * (1 - length / FULL_RUN))
  }
  const best: number[] = [0]
  const from: number[] = [0]
  for (let b = 1; b <= last; b++) {
    best.push(Infinity)
    from.push(b - 1)
    for (let a = b - 1; a >= 0; a--) {
      if (b > Math.max(lineEnd[a], arcEnd[a])) continue
      const total = best[a] + cost(a, b)
      if (total < best[b]) {
        best[b] = total
        from[b] = a
      }
    }
  }

  const runs: FittedPrim[] = []
  for (let b = last; b > 0; b = from[b]) {
    const a = from[b]
    // A stretch of a run that fits is taken to fit; when its own fit says otherwise it is laid straight
    const prim = (b <= lineEnd[a] ? lineRun(pts, a, b, tolerance) : circleRun(pts, a, b, tolerance)) ?? linePrim(pts[a], pts[b])
    if (prim && prim.length > 1e-6) runs.push({ ...prim, s0: stations[a], s1: stations[b], role: 'run' })
  }
  return runs.reverse()
}

/** Two primitives that follow each other tangent, made one when they are the same line or the same circle */
function merged(first: Prim, second: Prim): Prim | null {
  if (first.sweep === 0 && second.sweep === 0) return linePrim(first.p0, second.p1)
  if (first.sweep * second.sweep <= 0) return null
  if (Math.abs(first.radius - second.radius) > SAME_RADIUS * Math.max(first.radius, second.radius)) return null
  return arcPrim(first.p0, first.t0, second.p1)
}

/**
 * The piece that joins a place and a direction to another: two arcs tangent to both and to each
 * other, one primitive when they are the same. Null when the directions cannot be joined gently.
 */
function joinPiece(p0: Point, t0: Point, p1: Point, t1: Point): Prim[] | null {
  const two = biarc(p0, t0, p1, t1)
  if (!two) return null
  const one = merged(two[0], two[1])
  return one ? [one] : two
}

/**
 * The single arc that leaves a place along a direction and lands tangent on a primitive, with the
 * share of the length of that primitive at which it lands. Null when there is none that lands on
 * it going its way: the direction is that of the primitive already, or points away from it.
 */
function tangentArc(p0: Point, t0: Point, onto: Prim): { arc: Prim; share: number } | null {
  const normal = rotate(t0, Math.PI / 2)
  // Signed radius of the arc: its centre is `p0 + normal * rho`
  let rho: number
  let landing: Point
  if (onto.sweep === 0) {
    const slack = 1 - dot(onto.t0, t0)
    if (slack < 1e-9) return null
    rho = cross(onto.t0, sub(p0, onto.p0)) / slack
    const side = rotate(onto.t0, Math.PI / 2)
    landing = { x: p0.x + normal.x * rho - side.x * rho, y: p0.y + normal.y * rho - side.y * rho }
  } else {
    const rhoOnto = onto.radius * Math.sign(onto.sweep)
    const ontoNormal = rotate(onto.t0, Math.PI / 2)
    const centre = { x: onto.p0.x + ontoNormal.x * rhoOnto, y: onto.p0.y + ontoNormal.y * rhoOnto }
    const w = sub(p0, centre)
    const slack = 2 * (dot(normal, w) + rhoOnto)
    if (Math.abs(slack) < 1e-9) return null
    rho = (rhoOnto * rhoOnto - dot(w, w)) / slack
    if (Math.abs(rho - rhoOnto) < 1e-9) return null
    const own = { x: p0.x + normal.x * rho, y: p0.y + normal.y * rho }
    const k = rhoOnto / (rho - rhoOnto)
    landing = { x: centre.x - (own.x - centre.x) * k, y: centre.y - (own.y - centre.y) * k }
  }
  if (!Number.isFinite(rho)) return null
  const arc = arcPrim(p0, t0, landing, MAX_JOIN_SWEEP_DEG)
  if (!arc) return null
  const share = onto.sweep === 0
    ? dot(sub(landing, onto.p0), onto.t0) / onto.length
    : signedAngle(sub(onto.p0, centreOf(onto)), sub(landing, centreOf(onto))) / onto.sweep
  if (!(share > 0 && share < 1)) return null
  // It lands going the way of the primitive
  const there = rotate(onto.t0, share * onto.sweep)
  if (angleDeg(arc.t1, there) > 0.5) return null
  return { arc: { ...arc, t1: there }, share }
}

function centreOf(arc: Prim): Point {
  const normal = rotate(arc.t0, arc.sweep > 0 ? Math.PI / 2 : -Math.PI / 2)
  return { x: arc.p0.x + normal.x * arc.radius, y: arc.p0.y + normal.y * arc.radius }
}

/** True when a joining piece turns one way only: no S between a line and the curve that follows it */
function turnsOneWay(piece: Prim[]): boolean {
  return piece.length < 2 || piece[0].sweep * piece[1].sweep >= 0
}

/**
 * True when a joining piece does not turn against the runs it joins: between a line and a curve,
 * or two curves of the same hand, it turns their way. (Two curves of opposite hands make an S
 * whatever joins them, and two lines turn the way they meet.)
 */
function turnsWith(piece: Prim[], before: Prim, after: Prim): boolean {
  const hands = new Set([Math.sign(before.sweep), Math.sign(after.sweep)].filter((hand) => hand !== 0))
  if (hands.size !== 1) return true
  const [hand] = hands
  return piece.every((prim) => prim.sweep * hand >= 0 || Math.abs(prim.sweep) < STRAIGHT_TOLERANCE_DEG * RAD)
}

/** A fitted primitive cut down to the stretch of the chain between two distances along it */
function between(prim: FittedPrim, s0: number, s1: number): FittedPrim {
  const span = prim.s1 - prim.s0
  return { ...primBetween(prim, (s0 - prim.s0) / span, (s1 - prim.s0) / span), s0, s1, role: prim.role }
}

/** A piece of several primitives as fitted primitives over a stretch of the chain, shared by length */
function over(piece: Prim[], s0: number, s1: number, role: FittedPrim['role']): FittedPrim[] {
  let total = 0
  for (const prim of piece) total += prim.length
  let run = 0
  return piece.map((prim) => {
    const from = total > 0 ? s0 + ((s1 - s0) * run) / total : s0
    run += prim.length
    return { ...prim, s0: from, s1: total > 0 ? s0 + ((s1 - s0) * run) / total : s1, role }
  })
}

/** What a chain is built for: the speed OSM gives its track, on a conventional or a high-speed line */
export interface DesignSpeed {
  lineType: LineType
  /** Speed (km/h) of the zone laid over a stretch of the chain, the lowest when there are several; null where OSM gives none */
  over(s0: number, s1: number): number | null
}

/** Two arcs that follow each other are one curve for the editor when their radii are within this share (`trackSpeed`) */
const SAME_CURVE_RADIUS = 0.1
/** An arc of a larger radius (m) is straight for the editor */
const STRAIGHT_RADIUS = 50_000

/**
 * The speed (km/h) the editor will allow on each primitive of a fitted track, next to the speed its
 * zone asks for (null where there is none, and the primitive is then not judged). It is worked out
 * the way `trackProfile` does once the rails are laid: arcs of the same hand and of like radius
 * that follow each other are one curve, which gets the cant of its radius and of the zone speed —
 * or less when it is too short for the ramps of that cant — and the speed that radius and that
 * cant allow.
 */
export function allowedSpeeds(track: FittedPrim[], design: DesignSpeed): { allowed: number; wanted: number | null }[] {
  const curved = (prim: Prim): boolean => prim.sweep !== 0 && prim.radius <= STRAIGHT_RADIUS
  const out: { allowed: number; wanted: number | null }[] = []
  for (let i = 0; i < track.length; ) {
    if (!curved(track[i])) {
      out.push({ allowed: Infinity, wanted: design.over(track[i].s0, track[i].s1) })
      i++
      continue
    }
    let k = i
    let length = track[i].length
    while (
      k + 1 < track.length &&
      curved(track[k + 1]) &&
      track[k + 1].sweep * track[k].sweep > 0 &&
      Math.abs(track[k + 1].radius - track[k].radius) <= SAME_CURVE_RADIUS * Math.max(track[k + 1].radius, track[k].radius)
    ) {
      k++
      length += track[k].length
    }
    for (; i <= k; i++) {
      const wanted = design.over(track[i].s0, track[i].s1)
      if (wanted === null) {
        out.push({ allowed: Infinity, wanted })
        continue
      }
      let cant = automaticCant(track[i].radius, wanted, design.lineType)
      const fitting = cantForRampLength(length, wanted)
      if (cant > fitting) cant = layableCant(fitting)
      out.push({ allowed: curveSpeedLimit(track[i].radius, cant, design.lineType), wanted })
    }
  }
  return out
}

/**
 * How much slower than its zones a fitted track is: for each primitive that allows less than its
 * zone asks for, by how much the zone speed exceeds it, as a share of what is allowed. 0 for a
 * track that can be run at the speed of its zones from end to end, and when no speed is known.
 */
function slowness(track: FittedPrim[], design: DesignSpeed | undefined): number {
  if (!design) return 0
  let total = 0
  for (const { allowed, wanted } of allowedSpeeds(track, design)) if (wanted !== null && allowed < wanted) total += wanted / allowed - 1
  return total
}

/** The lengths tried for a joining piece, in order: the usual ones, then the long ones on a track whose speed is known */
function reaches(design: DesignSpeed | undefined): number[] {
  return design ? [...JOIN_REACHES, ...LONG_JOIN_REACHES] : JOIN_REACHES
}

/** A node of a chain, how far along it, and how far (m) the track may pass from it */
interface ChainNode {
  p: Point
  s: number
  tolerance: number
}

/** How far (m) a piece passes beyond the tolerance of the nodes it stands for (`from` < s < `to`); 0 or less when it stays within it */
function excess(piece: Prim[], nodes: ChainNode[], from: number, to: number): number {
  let worst = -Infinity
  for (const node of nodes) {
    if (node.s <= from || node.s >= to) continue
    worst = Math.max(worst, Math.min(...piece.map((prim) => primDistance(prim, node.p))) - node.tolerance)
  }
  return worst
}

/** Two runs joined: what is left of the first, the piece between them, what is left of the second */
interface RunJoin {
  before: FittedPrim
  piece: Prim[]
  after: FittedPrim
  /** Farthest (m) the piece passes beyond the tolerance of a node of the chain it stands for */
  off: number
  /** It turns one way only and passes within the tolerance of those nodes */
  right: boolean
  /** How much slower than its zones the track is around it (`slowness`) */
  slow: number
}

/**
 * The runs of a chain joined into one track, tangent from end to end. Each run gives up a stretch
 * at each of its ends to the piece that joins it to its neighbour: one arc that leaves it and lands
 * tangent on the next run, else two arcs — the longest that turn one way only, pass within the
 * tolerance of the nodes between and can be run at the speed of the zone; failing that, of the
 * pieces that stay within the tolerance, the fastest. A run too short to be more than the place
 * where two others meet is left out when its neighbours can be joined over it.
 */
function joinRuns(runs: FittedPrim[], nodes: ChainNode[], design: DesignSpeed | undefined): FittedPrim[] {
  if (runs.length === 0) return []

  /** `current` (what is left of the run of length `wholeLength`) joined to `next` */
  const join = (current: FittedPrim, wholeLength: number, next: FittedPrim): RunJoin | null => {
    const room = MAX_JOIN_SHARE * Math.min(wholeLength, next.length)
    const judged = (before: FittedPrim, piece: Prim[], after: FittedPrim): RunJoin => {
      const off = excess(piece, nodes, before.s1, after.s0)
      const slow = slowness([before, ...over(piece, before.s1, after.s0, 'join'), after], design)
      return { before, piece, after, off, slow, right: turnsOneWay(piece) && turnsWith(piece, current, next) && off <= 0 }
    }
    /** True when `a` is to be kept rather than `b`: within the tolerance first, then the faster, then the one that turns one way */
    const better = (a: RunJoin, b: RunJoin): boolean => {
      if (a.off <= 0 !== b.off <= 0) return a.off <= 0
      if (a.off > 0) return a.off < b.off
      if (a.slow !== b.slow) return a.slow < b.slow
      return a.right && !b.right
    }
    let chosen: RunJoin | null = null
    const tried = new Set<number>()
    for (const wanted of reaches(design)) {
      const reach = Math.min(wanted, room)
      if (tried.has(reach)) continue
      tried.add(reach)
      // Distances along the chain stand for lengths along the runs: close enough to cut them
      const before = between(current, current.s0, current.s1 - (reach * (current.s1 - current.s0)) / current.length)
      const candidates: RunJoin[] = []
      const landed = tangentArc(before.p1, before.t1, next)
      if (landed && landed.share <= MAX_JOIN_SHARE) {
        candidates.push(judged(before, [landed.arc], between(next, next.s0 + landed.share * (next.s1 - next.s0), next.s1)))
      }
      const after = between(next, next.s0 + (reach * (next.s1 - next.s0)) / next.length, next.s1)
      const two = joinPiece(before.p1, before.t1, after.p0, after.t0)
      if (two) candidates.push(judged(before, two, after))
      for (const candidate of candidates) {
        if (candidate.right && candidate.slow === 0) return candidate
        if (!chosen || better(candidate, chosen)) chosen = candidate
      }
    }
    return chosen
  }

  const track: FittedPrim[] = []
  // What is left of the current run once its start was given up to the piece before it
  let current = runs[0]
  let wholeLength = runs[0].length
  for (let i = 1; i < runs.length; i++) {
    let joined = join(current, wholeLength, runs[i])
    if (runs[i].length < SHORT_RUN && i + 1 < runs.length && current.length >= SHORT_RUN) {
      const over2 = join(current, wholeLength, runs[i + 1])
      if (over2?.right && over2.slow <= (joined?.slow ?? Infinity)) {
        joined = over2
        i++
      }
    }
    if (!joined) {
      // No gentle piece: the two runs are laid as they are and meet at an angle
      track.push(current)
    } else {
      if (joined.before.length > 1e-6) track.push(joined.before)
      track.push(...over(joined.piece, joined.before.s1, joined.after.s0, 'join'))
    }
    current = joined ? joined.after : runs[i]
    wholeLength = runs[i].length
  }
  if (current.length > 1e-6) track.push(current)
  return track
}

/** A fitted track cut in two at a distance along its chain */
function cutAt(track: FittedPrim[], s: number): { before: FittedPrim[]; after: FittedPrim[] } {
  const before: FittedPrim[] = []
  const after: FittedPrim[] = []
  for (const prim of track) {
    if (prim.s1 <= s + 1e-9) before.push(prim)
    else if (prim.s0 >= s - 1e-9) after.push(prim)
    else {
      before.push(between(prim, prim.s0, s))
      after.push(between(prim, s, prim.s1))
    }
  }
  return { before, after }
}

/** A primitive run the other way */
function turnedBack(prim: Prim): Prim {
  return { p0: prim.p1, p1: prim.p0, t0: reversed(prim.t1), t1: reversed(prim.t0), sweep: -prim.sweep, radius: prim.radius, length: prim.length }
}

/** A fitted track run the other way, on a chain of this length */
function trackTurnedBack(track: FittedPrim[], length: number): FittedPrim[] {
  return track.map((prim) => ({ ...turnedBack(prim), s0: length - prim.s1, s1: length - prim.s0, role: prim.role })).reverse()
}

/** From a place and a direction to a place, arriving along `arrive` when it is given */
function reachPiece(p0: Point, t0: Point, p1: Point, arrive: Point | null): Prim[] {
  const single = arcPrim(p0, t0, p1)
  if (single && (!arrive || angleDeg(single.t1, arrive) <= JOIN_TOLERANCE_DEG)) return [single]
  const two = arrive && joinPiece(p0, t0, p1, arrive)
  if (two) return two
  const direct = single ?? linePrim(p0, p1)
  return direct ? [direct] : []
}

/**
 * The start of a fitted track brought to the node it leaves (`p0`) and the direction imposed there
 * (`t0`). The track is joined at `clear` from the node or beyond, as far as `limit`: by one arc
 * that lands tangent on it, else by two arcs to a place on it, the furthest that turns one way only
 * and stays within the tolerance of the nodes it passes. When that piece allows less than the speed
 * of the zone, the fastest of the pieces that stay within the tolerance is laid instead, were it
 * to turn one way and then the other. Failing all that, two arcs to the nearest place.
 */
function leaveNode(
  track: FittedPrim[],
  nodes: ChainNode[],
  p0: Point,
  t0: Point,
  clear: number,
  limit: number,
  design: DesignSpeed | undefined,
): FittedPrim[] {
  let best: { track: FittedPrim[]; slow: number; oneWay: boolean } | null = null
  /** Keeps a way of leaving the node that stays within the tolerance; true when nothing better is to be looked for */
  const offer = (piece: Prim[], rest: FittedPrim[]): boolean => {
    const laid = [...over(piece, 0, rest[0].s0, 'leave'), ...rest]
    // Slower than the zone or not is a matter of the piece and of the track it lands on
    const slow = slowness(laid.slice(0, piece.length + 2), design)
    const oneWay = turnsOneWay(piece)
    if (!best || slow < best.slow || (slow === best.slow && oneWay && !best.oneWay)) best = { track: laid, slow, oneWay }
    return slow === 0 && oneWay
  }

  for (const prim of track) {
    if (prim.s1 <= clear) continue
    if (prim.s0 >= limit) break
    const landed = tangentArc(p0, t0, prim)
    if (!landed) continue
    const s = prim.s0 + landed.share * (prim.s1 - prim.s0)
    if (s < clear || s > limit || excess([landed.arc], nodes, 0, s) > 0) continue
    if (offer([landed.arc], cutAt(track, s).after)) return best!.track
  }

  let nearest: { track: FittedPrim[]; s: number } | null = null
  const tried = new Set<number>()
  for (const wanted of [...JOIN_REACHES, 0, ...reaches(design).slice(JOIN_REACHES.length)]) {
    const s = Math.max(clear, Math.min(wanted, limit))
    if (tried.has(s)) continue
    tried.add(s)
    const rest = cutAt(track, s).after
    if (rest.length === 0) continue
    const piece = reachPiece(p0, t0, rest[0].p0, rest[0].t0)
    if (piece.length === 0) continue
    if (!nearest || s < nearest.s) nearest = { track: [...over(piece, 0, rest[0].s0, 'leave'), ...rest], s }
    // A piece that turns one way and then the other is only kept for the speed it gives: on a
    // track whose speed is known, where the short piece that turns one way is a sharp one
    if ((design || turnsOneWay(piece)) && excess(piece, nodes, 0, s) <= 0 && offer(piece, rest)) break
  }
  return (best as { track: FittedPrim[] } | null)?.track ?? nearest?.track ?? []
}

/**
 * Fit a chain. `leaveStart` and `leaveEnd` are the directions in which it leaves its two end nodes
 * (see `settleNodeTangents`), null where nothing constrains it; `clearStart` and `clearEnd` the
 * distances from its ends within which it gets no node of its own choosing: the track is brought
 * from the direction of the node to its own over that distance at least. Returns the primitives in
 * order. The first starts on the first node of the chain and the last ends on its last node, but
 * at an end nothing constrains (a track end): there the track stops where its line or its circle
 * passes the node, within the tolerance of it.
 *
 * `design` is the speed the track is built for, when OSM says it. The track is then laid so that
 * the editor allows that speed on it wherever the nodes let it: no node is left further than
 * `MAX_WIDENING` times the tolerance for it.
 */
export function fitChain(
  chain: Chain,
  leaveStart: Point | null,
  leaveEnd: Point | null,
  clearStart: number,
  clearEnd: number,
  tolerance: number,
  design?: DesignSpeed,
): FittedPrim[] {
  const first = chain.pts[0]
  const last = chain.pts[chain.pts.length - 1]
  const length = chain.length
  const closed = chain.nodes[0] === chain.nodes[chain.nodes.length - 1]
  // A loop cannot be laid as one piece from a node to itself
  const onePiece = (): FittedPrim[] =>
    closed ? [] : over(reachPiece(first, leaveStart ?? rawLeave(chain, true), last, leaveEnd ? reversed(leaveEnd) : null), 0, length, 'piece')
  if (isSinglePiece(chain, clearStart, clearEnd)) return onePiece()

  // Each end may take up to this share of what lies between the two clearances
  const spare = MAX_JOIN_SHARE * (length - clearStart - clearEnd)
  const backwards: DesignSpeed | undefined = design && { lineType: design.lineType, over: (s0, s1) => design.over(length - s1, length - s0) }
  const lay = (tolerances: number[]): FittedPrim[] => {
    const nodes: ChainNode[] = chain.pts.map((p, k) => ({ p, s: chain.stations[k], tolerance: tolerances[k] }))
    let track = joinRuns(fitRuns(chain, tolerances), nodes, design)
    // The end first, on the track run backwards, then the start. An end no node constrains is left
    // where the fitting puts it: on the line or the circle of its run, beside the OSM node
    if (leaveEnd) {
      const backNodes = nodes.map((node) => ({ ...node, s: length - node.s })).reverse()
      track = trackTurnedBack(leaveNode(trackTurnedBack(track, length), backNodes, last, leaveEnd, clearEnd, clearEnd + spare, backwards), length)
    }
    if (leaveStart) track = leaveNode(track, nodes, first, leaveStart, clearStart, clearStart + spare, design)
    return withoutSeams(track)
  }

  const tolerances = chain.pts.map(() => tolerance)
  let track = lay(tolerances)
  if (design) {
    // OSM draws a curve with a node every 30 to 60 m, each a few decimetres off: fitted within
    // those decimetres it comes out as straight lines between the nodes and a sharp bend at each,
    // that no train takes at the speed of the line. Where the track allows less than its zone, the
    // nodes around are given more room and the chain is fitted again, as long as it gets faster
    let least = slowness(track, design)
    let latest = track
    for (let round = 0; round < MAX_WIDENINGS && least > 0; round++) {
      if (!widenAround(chain, latest, design, tolerances, tolerance * MAX_WIDENING)) break
      latest = lay(tolerances)
      const slow = slowness(latest, design)
      if (latest.length > 0 && slow < least) {
        least = slow
        track = latest
      }
    }
  }
  return track.length > 0 ? track : onePiece()
}

/**
 * Give more room to the nodes of a chain around the primitives of a fitted track that allow less
 * than their zone: their tolerance grows by `WIDENING`, up to `most`. False when none could grow.
 */
function widenAround(chain: Chain, track: FittedPrim[], design: DesignSpeed, tolerances: number[], most: number): boolean {
  const { stations } = chain
  const wider = new Set<number>()
  allowedSpeeds(track, design).forEach(({ allowed, wanted }, i) => {
    if (wanted === null || allowed >= wanted) return
    // The nodes the primitive lies between, and one more on each side: the run that replaces it reaches further
    let lo = stations.findIndex((s) => s >= track[i].s0 - 1e-6)
    let hi = stations.findIndex((s) => s > track[i].s1 + 1e-6)
    if (lo < 0) lo = stations.length - 1
    if (hi < 0) hi = stations.length - 1
    for (let k = Math.max(0, lo - 2); k <= Math.min(stations.length - 1, hi + 1); k++) wider.add(k)
  })
  let grown = false
  for (const k of wider) {
    if (tolerances[k] >= most - 1e-9) continue
    tolerances[k] = Math.min(most, tolerances[k] * WIDENING)
    grown = true
  }
  return grown
}

/** A fitted track in which two primitives that follow each other on the same line or the same circle are one */
function withoutSeams(track: FittedPrim[]): FittedPrim[] {
  const out: FittedPrim[] = []
  for (const prim of track) {
    const before = out[out.length - 1]
    const one = before && angleDeg(before.t1, prim.t0) <= SEAM_TOLERANCE_DEG ? merged(before, prim) : null
    if (one && angleDeg(one.t1, prim.t1) <= SEAM_TOLERANCE_DEG) out[out.length - 1] = { ...one, s0: before.s0, s1: prim.s1, role: before.role }
    else out.push(prim)
  }
  return out
}
