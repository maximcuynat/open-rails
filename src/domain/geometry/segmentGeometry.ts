import type { Network, Point, Segment } from '../models/types'
import { bezierPoint, closestCurveParam, curveLengthBetween, curveParamAtDistance, distToCurve } from './curve'

// ─────────────────── The shape of a rail, in one place ───────────────────
//
// A rail is a straight line between its two nodes, or a quadratic curve through a control point.
// Everything that asks where a rail goes — a point or a direction at a parameter, a length, the
// parameter a distance further — asks here, so that there is one answer to each and one place to
// teach a new shape of rail. The parameter `t` runs from 0 at `seg.from` to 1 at `seg.to`.

/** The points a rail is drawn from: its two ends and, for a curve, its control point */
export interface SegmentEnds {
  a: Point
  b: Point
  /** Control point of a curved rail; absent for a straight one */
  via?: Point
}

/** Ends (and control point) of a rail, null when one of its nodes is missing */
export function segmentEnds(net: Network, seg: Segment): SegmentEnds | null {
  const from = net.nodes.get(seg.from)
  const to = net.nodes.get(seg.to)
  if (!from || !to) return null
  // A curve whose control point was lost is read as the straight line between its ends. Always the
  // same three fields: the drawing loops read these objects for every rail of every frame, and the
  // engine reads objects of one shape faster than objects of two
  return { a: from.pos, b: to.pos, via: seg.kind === 'curve' ? seg.via : undefined }
}

/** Point of a rail at parameter `t` */
export function pointOnShape(ends: SegmentEnds, t: number): Point {
  if (ends.via) return bezierPoint(t, ends.a, ends.via, ends.b)
  return { x: ends.a.x + (ends.b.x - ends.a.x) * t, y: ends.a.y + (ends.b.y - ends.a.y) * t }
}

/** Unit direction of a rail at parameter `t`, towards `seg.to`; +x for a rail without length */
export function tangentOnShape(ends: SegmentEnds, t: number): Point {
  let dx = ends.b.x - ends.a.x
  let dy = ends.b.y - ends.a.y
  if (ends.via) {
    dx = 2 * (1 - t) * (ends.via.x - ends.a.x) + 2 * t * (ends.b.x - ends.via.x)
    dy = 2 * (1 - t) * (ends.via.y - ends.a.y) + 2 * t * (ends.b.y - ends.via.y)
  }
  const len = Math.hypot(dx, dy)
  return len === 0 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len }
}

/**
 * Vector along which a rail leaves one of its ends, into the rail: from `seg.from` when `atFrom`,
 * from `seg.to` otherwise. Not normalised (its length says nothing); null vector for a rail without
 * length there.
 */
export function leaveVectorOnShape(ends: SegmentEnds, atFrom: boolean): Point {
  const here = atFrom ? ends.a : ends.b
  const towards = ends.via ?? (atFrom ? ends.b : ends.a)
  return { x: towards.x - here.x, y: towards.y - here.y }
}

/** Unit direction in which a rail leaves one of its ends, into the rail; +x for a rail without length there */
export function leaveDirectionOnShape(ends: SegmentEnds, atFrom: boolean): Point {
  const v = leaveVectorOnShape(ends, atFrom)
  const len = Math.hypot(v.x, v.y)
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 }
}

/** Parameter (0…1) of the point of a rail closest to `p` */
export function closestParamOnShape(ends: SegmentEnds, p: Point): number {
  if (ends.via) return closestCurveParam(p, ends.a, ends.via, ends.b)
  const dx = ends.b.x - ends.a.x
  const dy = ends.b.y - ends.a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : ((p.x - ends.a.x) * dx + (p.y - ends.a.y) * dy) / len2
  return Math.max(0, Math.min(1, t))
}

/** Distance from `p` to a rail (world metres) */
export function distanceToShape(ends: SegmentEnds, p: Point): number {
  if (ends.via) return distToCurve(p, ends.a, ends.via, ends.b)
  const t = closestParamOnShape(ends, p)
  return Math.hypot(ends.a.x + (ends.b.x - ends.a.x) * t - p.x, ends.a.y + (ends.b.y - ends.a.y) * t - p.y)
}

/** Length of a rail between the parameters `t0` and `t1`, whichever is the larger (world metres) */
export function shapeLengthBetween(ends: SegmentEnds, t0: number, t1: number): number {
  if (ends.via) return curveLengthBetween(ends.a, ends.via, ends.b, t0, t1)
  return Math.abs(t1 - t0) * Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y)
}

/**
 * Parameter of the place `distance` along a rail from the one at `t`: towards `seg.to` when
 * positive, towards `seg.from` when negative. Not held within 0…1 on a straight rail — the caller
 * knows how much rail is left — and stopped at the end reached on a curve.
 */
export function shapeParamAtDistance(ends: SegmentEnds, t: number, distance: number): number {
  if (ends.via) return curveParamAtDistance(ends.a, ends.via, ends.b, t, distance)
  const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y)
  return length === 0 ? t : t + distance / length
}

/** Velocity of a rail at parameter `t`: its direction towards `seg.to`, not brought to unit length */
export function derivativeOnShape(ends: SegmentEnds, t: number): Point {
  if (!ends.via) return { x: ends.b.x - ends.a.x, y: ends.b.y - ends.a.y }
  const u = 1 - t
  return {
    x: 2 * u * (ends.via.x - ends.a.x) + 2 * t * (ends.b.x - ends.via.x),
    y: 2 * u * (ends.via.y - ends.a.y) + 2 * t * (ends.b.y - ends.via.y),
  }
}

/** The same rail read from its other end: `t` there is `1 − t` here */
export function reversedShape(ends: SegmentEnds): SegmentEnds {
  return { a: ends.b, b: ends.a, via: ends.via }
}

// ─────────────────── A rail as a polyline ───────────────────

/**
 * Number of chords that keep the flattened line of a rail within `tolerance` (world metres) of it;
 * 1 for a straight rail and for a flat curve.
 */
export function shapeChordCount(ends: SegmentEnds, tolerance: number): number {
  if (!ends.via) return 1
  // The curve is at most half the distance from the control point to the middle of the chord away
  // from its chord, and cutting it in n divides that by n²
  const sagitta = Math.hypot(ends.via.x - (ends.a.x + ends.b.x) / 2, ends.via.y - (ends.a.y + ends.b.y) / 2) / 2
  return Math.max(1, Math.ceil(Math.sqrt(sagitta / tolerance)))
}

/**
 * Points of a rail in order, from the parameter `t0` to `t1` (the whole rail when left out): a
 * curve as `chords` chords evenly spread in `t`, a straight rail as its two ends whatever the
 * count. The caller chooses the count — a fixed one, or `shapeChordCount` for a tolerance.
 */
export function shapePolyline(ends: SegmentEnds, chords: number, t0 = 0, t1 = 1): Point[] {
  if (!ends.via) {
    return t0 === 0 && t1 === 1 ? [ends.a, ends.b] : [pointOnShape(ends, t0), pointOnShape(ends, t1)]
  }
  const pts: Point[] = []
  for (let i = 0; i <= chords; i++) pts.push(pointOnShape(ends, t0 + ((t1 - t0) * i) / chords))
  return pts
}

// ─────────────────── The box of a rail ───────────────────

/** A box along the axes, in world metres */
export interface ShapeBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Box holding a rail: the one of its ends and, for a curve, of its control point, which the curve
 * never leaves. Larger than the curve itself, which is enough to set aside what is clear of a rail.
 */
export function shapeBounds(ends: SegmentEnds): ShapeBox {
  const { a, b, via } = ends
  let minX = a.x < b.x ? a.x : b.x
  let maxX = a.x > b.x ? a.x : b.x
  let minY = a.y < b.y ? a.y : b.y
  let maxY = a.y > b.y ? a.y : b.y
  if (via) {
    if (via.x < minX) minX = via.x
    if (via.x > maxX) maxX = via.x
    if (via.y < minY) minY = via.y
    if (via.y > maxY) maxY = via.y
  }
  return { minX, maxX, minY, maxY }
}

/** True when the box of a rail (`shapeBounds`) and `box` overlap or touch; nothing is allocated */
export function shapeBoundsMeet(ends: SegmentEnds, box: ShapeBox): boolean {
  const { a, b, via } = ends
  let minX = a.x < b.x ? a.x : b.x
  let maxX = a.x > b.x ? a.x : b.x
  if (via) {
    if (via.x < minX) minX = via.x
    if (via.x > maxX) maxX = via.x
  }
  if (maxX < box.minX || minX > box.maxX) return false
  let minY = a.y < b.y ? a.y : b.y
  let maxY = a.y > b.y ? a.y : b.y
  if (via) {
    if (via.y < minY) minY = via.y
    if (via.y > maxY) maxY = via.y
  }
  return !(maxY < box.minY || minY > box.maxY)
}

/** Box holding a rail (`shapeBounds`), null when one of its nodes is missing */
export function segmentBounds(net: Network, seg: Segment): ShapeBox | null {
  const ends = segmentEnds(net, seg)
  return ends ? shapeBounds(ends) : null
}

// ─────────────────── A rail as pieces to draw ───────────────────

/**
 * What a rail is drawn from between the parameters `t0` and `t1`, in the order walked (`t0` may be
 * the larger one): a list of lines and quadratic curves, each with the ends and control point a
 * canvas or an SVG path takes as they are. A straight rail and a curve give one piece — the rail
 * itself when the stretch is all of it, the exact sub-curve otherwise; the list is there for a
 * rail made of several.
 */
export function shapePieces(ends: SegmentEnds, t0 = 0, t1 = 1): SegmentEnds[] {
  if (t0 <= 0 && t1 >= 1) return [ends]
  const a = pointOnShape(ends, t0)
  const b = pointOnShape(ends, t1)
  if (!ends.via) return [{ a, b, via: undefined }]
  // A quadratic curve between two of its parameters is a quadratic curve again: its control point
  // lies on the tangent at the start, half the stretch away (De Casteljau)
  const d = derivativeOnShape(ends, t0)
  const half = (t1 - t0) / 2
  return [{ a, b, via: { x: a.x + half * d.x, y: a.y + half * d.y } }]
}

/** Whole length of a rail (world metres); 0 when one of its nodes is missing */
export function segmentShapeLength(net: Network, seg: Segment): number {
  const ends = segmentEnds(net, seg)
  return ends ? shapeLengthBetween(ends, 0, 1) : 0
}

/** Length of a rail between two parameters (world metres); 0 when one of its nodes is missing */
export function segmentShapeLengthBetween(net: Network, seg: Segment, t0: number, t1: number): number {
  const ends = segmentEnds(net, seg)
  return ends ? shapeLengthBetween(ends, t0, t1) : 0
}
