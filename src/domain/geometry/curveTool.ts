import type { Point } from '../models/types'
import {
  computeCurvePiece,
  computeFreeformCurve,
  computeReverseFreeformCurve,
} from '../profiles/profiles'
import {
  curvePiecesLength,
  minCurveRadius,
  splitCurveIntoArcPieces,
  MAX_ARC_PIECE_DEG,
  type CurvePiece,
} from './curve'
import {
  computeReverseFreeNodeLock,
  computeTurnoutIntersectionLock,
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
  via: Point
  radius: number
  angle: number
  side: 1 | -1
  /** False when the curve is tighter than the minimum radius: it must not be placed. */
  valid: boolean
  /** The curve as it will be inserted: arc pieces of bounded deflection. */
  pieces: CurvePiece[]
  length: number
}

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
 * 2. track under the cursor otherwise → 'reverse' (arrives tangent to the target);
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
  } else {
    side = input.side === 'auto' ? curveSide(tangent, startPos, cursor) : input.side
    const curve = computeCurvePiece(startPos, tangent, input.radius, side, input.angle)
    kind = 'catalog'
    end = curve.end
    via = curve.via
    radius = input.radius
    angle = input.angle
  }

  const pieces = splitCurveIntoArcPieces(startPos, via, end)
  let tightest = Infinity
  for (const p of pieces) tightest = Math.min(tightest, minCurveRadius(p.start, p.via, p.end))

  return {
    kind,
    end,
    via,
    radius,
    angle,
    side,
    valid: radius >= minRadius && tightest >= minRadius * PIECE_RADIUS_FACTOR,
    pieces,
    length: curvePiecesLength(pieces),
  }
}
