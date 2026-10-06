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
  // A curve whose control point was lost is read as the straight line between its ends
  return seg.kind === 'curve' && seg.via ? { a: from.pos, b: to.pos, via: seg.via } : { a: from.pos, b: to.pos }
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
