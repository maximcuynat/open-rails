import type { Network, NodeId, Point, SegmentId } from '../models/types'
import {
  computeCurvePiece,
  computeFreeformCurve,
  computeReverseFreeformCurve,
} from '../profiles/profiles'
import {
  bezierDerivative1,
  bezierPoint,
  closestCurveParam,
  curvePiecesLength,
  minCurveRadius,
  splitCurveIntoArcPieces,
  tangentArcPieces,
  MAX_ARC_PIECE_DEG,
  type CurvePiece,
} from './curve'
import {
  computeReverseFreeNodeLock,
  computeTurnoutIntersectionLock,
  MAX_TRANSITION_DEFLECTION_DEG,
  segmentTangentAt,
  transitionDeflectionDeg,
  type LockLimits,
} from './tangent'

/** Which construction produced the curve. */
export type CurveToolKind = 'lock' | 'reverse' | 'freeform' | 'catalog'

export interface CurveToolLimits extends LockLimits {
  minChord?: number
}

export interface CurveToolInput {
  startPos: Point
  /** Tangent of the track already attached to the start node, or null for a free start. */
  startTangent: Point | null
  /** Direction used when the start is free (usually start → cursor). */
  fallbackTangent: Point
  /** Existing track under the cursor, or null. */
  trackTarget: { tangent: Point; pointOnTrack: Point } | null
  /** Free end target (cursor, or the node it snapped to). */
  cursor: Point
  trackMode: 'catalog' | 'freeform'
  radius: number
  angle: number
  /** Fixed side, or 'auto' to turn towards the cursor. */
  side: 1 | -1 | 'auto'
  limits?: CurveToolLimits
}

export interface CurveToolResult {
  kind: CurveToolKind
  end: Point
  /**
   * Control point of the curve as a single quadratic Bezier. A freeform arc turning further than
   * one control point can describe has none: `via` is then only a handle whose Bezier passes
   * through the middle of the arc, and `pieces` alone give the shape.
   */
  via: Point
  radius: number
  angle: number
  side: 1 | -1
  /**
   * Angle in degrees between the track already attached to the start node and the direction in
   * which the curve leaves it: 0 for a tangent (G1) join or a free start. Only the 'reverse'
   * construction on a connected start can be non-zero, since it is tangent to the target only.
   */
  startDeflection: number
  /**
   * Same angle at the other end, where the curve joins existing track (0 when it ends in open
   * space). Only known once the end join is resolved: see checkCurveJoins.
   */
  endDeflection: number
  /**
   * False when the curve must not be placed: tighter than the minimum radius, or joining connected
   * track, at either end, at a corner no train could take (> MAX_TRANSITION_DEFLECTION_DEG,
   * fold-back onto the existing rail included).
   */
  valid: boolean
  /** The curve as it will be inserted: arc pieces of bounded deflection. */
  pieces: CurvePiece[]
  length: number
}

/**
 * Widest turn a single freeform arc may take. Closer to a full turn the end comes back behind the
 * start along its own tangent and the radius grows without bound for a chord that stays short.
 */
export const MAX_FREEFORM_TURN_DEG = 330

/** Side of `target` relative to a direction: -1 = left, 1 = right (screen coordinates, +Y down). */
export function curveSide(tangent: Point, start: Point, target: Point): 1 | -1 {
  const cross = tangent.x * (target.y - start.y) - tangent.y * (target.x - start.x)
  return cross < 0 ? -1 : 1
}

/** A bounded arc piece is slightly tighter at its apex than the nominal radius: R·cos(θ/2). */
const PIECE_RADIUS_FACTOR = Math.cos((MAX_ARC_PIECE_DEG * Math.PI) / 360) * (1 - 1e-9)

/**
 * Single geometry decision of the curve tool, shared by the preview, the click and the hover snap:
 * 1. track under the cursor and a tangent lock exists → 'lock' (G1 at both ends);
 * 2. track under the cursor otherwise → 'reverse' (arrives tangent to the target). From a free
 *    start that is a clean join; from connected track the start is generally not tangent, and
 *    the result is invalid when that corner is not traversable;
 * 3. freeform mode → arc from the start tangent through the cursor;
 * 4. catalog mode → piece of the selected radius and angle.
 */
export function computeCurveToolGeometry(input: CurveToolInput): CurveToolResult {
  const { startPos, startTangent, trackTarget, cursor, trackMode, limits = {} } = input
  const tangent = startTangent ?? input.fallbackTangent
  const minRadius = limits.minRadius ?? 15

  let kind: CurveToolKind
  let end: Point
  let via: Point
  let radius: number
  let angle: number
  let side: 1 | -1
  let arcPieces: CurvePiece[] | null = null

  if (trackTarget) {
    const targetPoint = trackTarget.pointOnTrack
    const lock = startTangent
      ? computeTurnoutIntersectionLock(startPos, startTangent, targetPoint, trackTarget.tangent, limits)
      : (trackMode === 'catalog'
          ? computeReverseFreeNodeLock(startPos, targetPoint, trackTarget.tangent, input.radius, limits)
          : null)

    if (lock && lock.valid) {
      kind = 'lock'
      end = lock.lockPoint
      via = lock.via
      radius = lock.radius
      angle = lock.angleDeg
    } else {
      const curve = computeReverseFreeformCurve(startPos, targetPoint, trackTarget.tangent, limits.minChord)
      kind = 'reverse'
      end = curve.end
      via = curve.via
      radius = curve.radius
      angle = curve.angle
    }
    side = curveSide({ x: via.x - startPos.x, y: via.y - startPos.y }, startPos, end)
  } else if (trackMode === 'freeform') {
    const curve = computeFreeformCurve(startPos, tangent, cursor, limits.minChord)
    kind = 'freeform'
    end = curve.end
    via = curve.via
    radius = curve.radius
    angle = curve.angle
    side = curveSide(tangent, startPos, cursor)
    // Past the turn a control point can describe, the arc is built from its circle
    const arc = radius === Infinity ? null : tangentArcPieces(startPos, tangent, cursor)
    if (arc && arc.angleDeg > angle + 1e-6) {
      arcPieces = arc.pieces
      radius = arc.radius
      angle = arc.angleDeg
      const mid = arcPieces[arcPieces.length >> 1]
      const apex = arcPieces.length % 2 === 0 ? mid.start : bezierPoint(0.5, mid.start, mid.via, mid.end)
      via = { x: 2 * apex.x - (startPos.x + end.x) / 2, y: 2 * apex.y - (startPos.y + end.y) / 2 }
    }
  } else {
    side = input.side === 'auto' ? curveSide(tangent, startPos, cursor) : input.side
    const curve = computeCurvePiece(startPos, tangent, input.radius, side, input.angle)
    kind = 'catalog'
    end = curve.end
    via = curve.via
    radius = input.radius
    angle = input.angle
  }

  const pieces = arcPieces ?? splitCurveIntoArcPieces(startPos, via, end)
  let tightest = Infinity
  for (const p of pieces) tightest = Math.min(tightest, minCurveRadius(p.start, p.via, p.end))

  let startDeflection = 0
  const leave = pieces[0].via
  const leaveLen = Math.hypot(leave.x - startPos.x, leave.y - startPos.y)
  const tanLen = startTangent ? Math.hypot(startTangent.x, startTangent.y) : 0
  if (startTangent && leaveLen > 1e-12 && tanLen > 1e-12) {
    const cos = ((leave.x - startPos.x) * startTangent.x + (leave.y - startPos.y) * startTangent.y) / (leaveLen * tanLen)
    startDeflection = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
  }

  return {
    kind,
    end,
    via,
    radius,
    angle,
    side,
    startDeflection,
    endDeflection: 0,
    valid:
      radius >= minRadius &&
      angle <= MAX_FREEFORM_TURN_DEG + 1e-6 &&
      tightest >= minRadius * PIECE_RADIUS_FACTOR &&
      startDeflection <= MAX_TRANSITION_DEFLECTION_DEG + 1e-6,
    pieces,
    length: curvePiecesLength(pieces),
  }
}

/**
 * Pieces to insert once the node the curve ends on is known. That node is not always exactly at
 * `geom.end` (snapped node, split segment): the curve is then refitted to where it actually is.
 */
export function curvePiecesTo(geom: CurveToolResult, start: Point, end: Point): CurvePiece[] {
  if (Math.hypot(end.x - geom.end.x, end.y - geom.end.y) < 1e-9) return geom.pieces
  if (geom.kind === 'freeform') {
    const leave = geom.pieces[0].via
    const arc = tangentArcPieces(start, { x: leave.x - start.x, y: leave.y - start.y }, end)
    if (arc) return arc.pieces
  }
  return splitCurveIntoArcPieces(start, geom.via, end)
}

/** Existing track the end of a curve is joined to: a node, or a point on a segment (which gets split there). */
export interface CurveEndJoin {
  nodeId?: NodeId
  segId?: SegmentId
}

/** Directions in which the rails attached to a node leave it */
function railsLeaving(net: Network, nodeId: NodeId): Point[] {
  const dirs: Point[] = []
  for (const sid of net.adjacency.get(nodeId) ?? []) {
    const seg = net.segments.get(sid)
    const tan = seg && segmentTangentAt(net, seg, nodeId)
    if (seg && tan) dirs.push(seg.from === nodeId ? tan : { x: -tan.x, y: -tan.y })
  }
  return dirs
}

/** Deflection between a new rail leaving a point along `leave` and the existing rail it continues best (0 without rails) */
function joinDeflection(rails: Point[], leave: Point): number {
  const len = Math.hypot(leave.x, leave.y)
  if (rails.length === 0 || len < 1e-12) return 0
  const unit = { x: leave.x / len, y: leave.y / len }
  return Math.min(...rails.map((rail) => transitionDeflectionDeg(rail, unit)))
}

/**
 * Judge a curve-tool result against the track it is joined to, at both ends: the curve is valid
 * only if a train can pass between it and a rail already attached to its start node, and between
 * it and the track its end lands on (`endJoin`, null in open space). A curve folded back over the
 * rail it starts from, or meeting the target at an angle, is refused like a radius that is too tight.
 * Shared by the preview and the click, so that what is shown valid is what gets laid.
 */
export function checkCurveJoins(
  net: Network,
  startId: NodeId,
  geom: CurveToolResult,
  endJoin: CurveEndJoin | null,
): CurveToolResult {
  const start = net.nodes.get(startId)
  if (!start) return geom
  const endNode = endJoin?.nodeId ? net.nodes.get(endJoin.nodeId) : undefined
  const endSeg = endJoin?.segId ? net.segments.get(endJoin.segId) : undefined
  // Judged on the pieces as they get laid (refitted to the node the curve snaps to): a wide arc
  // has no control point of its own
  const laid = endNode ? curvePiecesTo(geom, start.pos, endNode.pos) : geom.pieces
  const leave = laid[0].via
  const arrive = laid[laid.length - 1].via
  const startDeflection = joinDeflection(railsLeaving(net, startId), { x: leave.x - start.pos.x, y: leave.y - start.pos.y })

  let endDeflection = 0
  if (endNode) {
    endDeflection = joinDeflection(railsLeaving(net, endNode.id), { x: arrive.x - endNode.pos.x, y: arrive.y - endNode.pos.y })
  } else if (endSeg) {
    const a = net.nodes.get(endSeg.from)
    const b = net.nodes.get(endSeg.to)
    if (a && b) {
      // Splitting the segment at the end point leaves one rail each way along its tangent there
      const along =
        endSeg.kind === 'curve' && endSeg.via
          ? bezierDerivative1(closestCurveParam(geom.end, a.pos, endSeg.via, b.pos), a.pos, endSeg.via, b.pos)
          : { x: b.pos.x - a.pos.x, y: b.pos.y - a.pos.y }
      const len = Math.hypot(along.x, along.y)
      if (len > 1e-12) {
        const tan = { x: along.x / len, y: along.y / len }
        endDeflection = joinDeflection([tan, { x: -tan.x, y: -tan.y }], { x: arrive.x - geom.end.x, y: arrive.y - geom.end.y })
      }
    }
  }

  const limit = MAX_TRANSITION_DEFLECTION_DEG + 1e-6
  return {
    ...geom,
    startDeflection: Math.max(geom.startDeflection, startDeflection),
    endDeflection,
    valid: geom.valid && startDeflection <= limit && endDeflection <= limit,
  }
}
