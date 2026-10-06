import type { Point, Network, Segment, NodeId, RailNode, SegmentId } from '../models/types'
import { bezierPoint, bezierDerivative1 } from './curve'
import { segmentEnds, tangentOnShape } from './segmentGeometry'

/** Tangent at the START (t=0) of a quadratic Bezier: direction (via - start). */
export function bezierStartTangent(start: Point, via: Point): Point {
  const dx = via.x - start.x
  const dy = via.y - start.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: 1, y: 0 }
  return { x: dx / len, y: dy / len }
}

/** Tangent at the END (t=1) of a quadratic Bezier: direction (end - via). */
export function bezierEndTangent(via: Point, end: Point): Point {
  const dx = end.x - via.x
  const dy = end.y - via.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: 1, y: 0 }
  return { x: dx / len, y: dy / len }
}

/**
 * Largest change of direction, in degrees, a train can take when it passes from one rail to the
 * next at a node. Track laid with the tools is G1-continuous (0° at every node) and the catalog
 * turnouts leave tangent to their stem, so this only has to absorb hand-edited geometry: it is set
 * to the divergence of the sharpest catalog turnout (#4, 15°), which keeps a branch drawn as a
 * straight chord usable. Anything sharper is a corner, not a track transition:
 * - `isPassageOpen` refuses it, so trains and routes treat it as an end of track;
 * - `proposeJunction` does not read a turnout in a fork whose routes exceed it;
 * - `analyzeKinematics` reports it.
 */
export const MAX_TRANSITION_DEFLECTION_DEG = 15

/**
 * Deflection in degrees between two rails meeting at a node, given the unit direction in which
 * each one leaves the node: 0° = straight through, 90° = right-angle corner, 180° = fold-back.
 */
export function transitionDeflectionDeg(leaveA: Point, leaveB: Point): number {
  const dot = Math.max(-1, Math.min(1, leaveA.x * leaveB.x + leaveA.y * leaveB.y))
  return (Math.acos(-dot) * 180) / Math.PI
}

/** True when a train can pass between two rails leaving a node in directions `leaveA` and `leaveB`. */
export function isTraversableDeflection(leaveA: Point, leaveB: Point): boolean {
  return transitionDeflectionDeg(leaveA, leaveB) <= MAX_TRANSITION_DEFLECTION_DEG + 1e-6
}

/** Get the outgoing tangent direction at a node, coming FROM a specific segment.
 *  Returns the direction the track is heading as it leaves that node.
 *  If nodeId is the "from" end of seg, tangent is start->to direction.
 *  If nodeId is the "to" end of seg, tangent is the curve's end tangent. */
export function segmentTangentAt(
  net: Network,
  seg: Segment,
  nodeId: NodeId,
): Point | null {
  const ends = segmentEnds(net, seg)
  if (!ends) return null
  // Direction of travel from `seg.from` to `seg.to`, read at the end asked for
  if (nodeId === seg.from) return tangentOnShape(ends, 0)
  if (nodeId === seg.to) return tangentOnShape(ends, 1)
  return null
}

/** Get the outgoing tangent at a node based on its incoming connection.
 *  Finds the segment connected to this node that is NOT the one we're extending,
 *  and computes the tangent direction the track is heading.
 *  If no previous segment exists, returns null (free direction). */
export function outgoingTangent(
  net: Network,
  nodeId: NodeId,
  excludeSegId?: string,
): Point | null {
  const adj = net.adjacency.get(nodeId)
  if (!adj || adj.length === 0) return null

  for (const segId of adj) {
    if (segId === excludeSegId) continue
    const seg = net.segments.get(segId)
    if (!seg) continue
    const tangent = segmentTangentAt(net, seg, nodeId)
    if (tangent) return tangent
  }
  return null
}

/**
 * Find the optimal tangent direction at a node aligned with the user's cursor drag.
 * Evaluates all connected segments at the node and picks, among the directions that continue
 * one of them past the node, the one best aligned with the vector (cursor - node.pos).
 * If the node has no connected segments, returns null.
 */
export function getTangentForPlacement(
  net: Network,
  nodeId: NodeId,
  cursor: Point,
): Point | null {
  const node = net.nodes.get(nodeId)
  if (!node) return null
  const adj = net.adjacency.get(nodeId)
  if (!adj || adj.length === 0) return null

  const dx = cursor.x - node.pos.x
  const dy = cursor.y - node.pos.y
  const dLen = Math.hypot(dx, dy)
  const userDir = dLen > 0.01 ? { x: dx / dLen, y: dy / dLen } : null

  let bestTangent: Point | null = null
  let bestDot = -Infinity

  for (const segId of adj) {
    const seg = net.segments.get(segId)
    if (!seg) continue
    const tan = segmentTangentAt(net, seg, nodeId)
    if (!tan) continue
    // New track leaves a node as the continuation of a rail attached to it, never folded back
    // over that rail: at a dead end only one direction exists, whatever side the cursor is on;
    // at a through node the other rail supplies the opposite direction.
    const onward = seg.from === nodeId ? { x: -tan.x, y: -tan.y } : tan

    if (!userDir) {
      if (!bestTangent) bestTangent = onward
      continue
    }

    const dot = userDir.x * onward.x + userDir.y * onward.y
    if (dot > bestDot) {
      bestDot = dot
      bestTangent = onward
    }
  }

  return bestTangent
}

/** Compute a via point for a quadratic Bezier that approximates a circular arc.
 *
 *  Given a start point, an incoming tangent direction, and an end point,
 *  this computes the Bezier control point by finding the circular arc that:
 *  1. Starts at `start` with tangent `incomingDir`
 *  2. Passes through `end`
 *
 *  The arc's deflection angle can be anything (not just 90°), determined
 *  by where the user places the end point relative to the tangent direction.
 *
 *  Math:
 *  - The tangent-chord angle α = angle between incomingDir and chord (start→end)
 *  - For a circular arc, the tangent at the end makes the same angle α with
 *    the chord, but on the opposite side.
 *  - The Bezier control point P1 is at the intersection of:
 *      Line 1: start + t * incomingDir (tangent at start)
 *      Line 2: end + s * endTangentDir (tangent at end)
 *  - endTangentDir = chordDir rotated by -α
 *  - Radius R = chord / (2 * sin(α))
 *  - Deflection angle = 2α
 */
export function viaFromArc(
  start: Point,
  end: Point,
  incomingDir: Point,
): Point {
  const chord = { x: end.x - start.x, y: end.y - start.y }
  const chordLen = Math.hypot(chord.x, chord.y)
  if (chordLen < 1e-6) return { ...start }

  const chordDir = { x: chord.x / chordLen, y: chord.y / chordLen }

  // Tangent-chord angle α (signed)
  const cos_α = incomingDir.x * chordDir.x + incomingDir.y * chordDir.y
  const sin_α = incomingDir.x * chordDir.y - incomingDir.y * chordDir.x
  const α = Math.atan2(sin_α, cos_α)

  if (Math.abs(α) < 1e-4) {
    // Nearly straight — via = midpoint
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  }

  // End tangent: chordDir rotated by +α (same direction as the tangent-chord angle).
  // For a circular arc: start tangent angle = θ, chord angle = θ + α,
  // end tangent angle = θ + 2α. So endTangent = chordDir rotated by α.
  const cos_a = Math.cos(α)
  const sin_a = Math.sin(α)
  const endTangentDir = {
    x: chordDir.x * cos_a - chordDir.y * sin_a,
    y: chordDir.x * sin_a + chordDir.y * cos_a,
  }

  // Solve: start + t * incomingDir = end + s * endTangentDir
  // t * in - s * out = chord
  // Cramer's rule: | in.x  -out.x | | t |   | chord.x |
  //                | in.y  -out.y | | s | = | chord.y |
  const det = incomingDir.x * (-endTangentDir.y) - incomingDir.y * (-endTangentDir.x)

  if (Math.abs(det) < 1e-10) {
    // Tangents parallel — straight line
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  }

  const t = (chord.x * (-endTangentDir.y) - chord.y * (-endTangentDir.x)) / det

  return {
    x: start.x + t * incomingDir.x,
    y: start.y + t * incomingDir.y,
  }
}

/** Compute the radius of the circular arc from start, end, and incoming tangent. */
export function arcRadius(start: Point, end: Point, incomingDir: Point): number {
  const chord = { x: end.x - start.x, y: end.y - start.y }
  const chordLen = Math.hypot(chord.x, chord.y)
  if (chordLen < 1e-6) return Infinity

  const chordDir = { x: chord.x / chordLen, y: chord.y / chordLen }
  const cos_α = incomingDir.x * chordDir.x + incomingDir.y * chordDir.y
  const sin_α = incomingDir.x * chordDir.y - incomingDir.y * chordDir.x
  const α = Math.atan2(sin_α, cos_α)

  if (Math.abs(α) < 1e-4) return Infinity

  // R = chord / (2 * sin(α))
  return chordLen / (2 * Math.sin(α))
}

/** Compute the deflection angle (total turn) of the arc in degrees. */
export function arcDeflectionDeg(start: Point, end: Point, incomingDir: Point): number {
  const chord = { x: end.x - start.x, y: end.y - start.y }
  const chordLen = Math.hypot(chord.x, chord.y)
  if (chordLen < 1e-6) return 0

  const chordDir = { x: chord.x / chordLen, y: chord.y / chordLen }
  const cos_α = incomingDir.x * chordDir.x + incomingDir.y * chordDir.y
  const sin_α = incomingDir.x * chordDir.y - incomingDir.y * chordDir.x
  const α = Math.atan2(sin_α, cos_α)

  // Total deflection = 2 * α, in degrees
  return Math.abs(2 * α * 180 / Math.PI)
}

/** Compute a via point for a curve with G1 continuity at BOTH ends.
 *  Given the start, end, incoming tangent at start, and outgoing tangent at end,
 *  find the quadratic Bezier control point that best satisfies both.
 *
 *  For a quadratic Bezier:
 *    B'(0) = 2(P1 - P0) → P1 = P0 + (k/2) * incomingDir
 *    B'(1) = 2(P2 - P1) → P1 = P2 - (m/2) * outgoingDir
 *
 *  Setting equal: P0 + (k/2)*in = P2 - (m/2)*out
 *  This gives us 2 equations (x, y) and 2 unknowns (k, m).
 *  Solve the linear system.
 */
export function viaFromTwoTangents(
  start: Point,
  end: Point,
  incomingDir: Point,
  outgoingDir: Point,
): Point {
  // P1 = start + k * incomingDir = end - m * outgoingDir
  // start + k * in = end - m * out
  // k * in + m * out = end - start
  //
  // | in.x  out.x | | k |   | end.x - start.x |
  // | in.y  out.y | | m | = | end.y - start.y |
  //
  // Solve by Cramer's rule

  const rx = end.x - start.x
  const ry = end.y - start.y
  const det = incomingDir.x * outgoingDir.y - incomingDir.y * outgoingDir.x

  if (Math.abs(det) < 1e-10) {
    // Tangents are parallel — can't satisfy both. Fall back to arc from start.
    return viaFromArc(start, end, incomingDir)
  }

  const k = (rx * outgoingDir.y - ry * outgoingDir.x) / det
  // const m = (incomingDir.x * ry - incomingDir.y * rx) / det  // not needed

  return {
    x: start.x + k * incomingDir.x,
    y: start.y + k * incomingDir.y,
  }
}

/**
 * Find the rail tangent direction at a given point in the network.
 * Checks for a nearby node with connected tracks, or a nearby segment.
 * Returns the unit tangent vector of the rail, the actual point on the track, and metadata.
 */
export function getTrackTangentAt(
  net: Network,
  point: Point,
  tol: number,
  excludeNodeId?: NodeId | null,
): { tangent: Point; pointOnTrack: Point; segId?: SegmentId; nodeId?: NodeId } | null {
  // Priority 1: near an existing node (excluding excludeNodeId) that has connected segments
  let bestNode: RailNode | null = null
  let bestDist = tol
  for (const node of net.nodes.values()) {
    if (excludeNodeId && node.id === excludeNodeId) continue
    const adj = net.adjacency.get(node.id)
    if (!adj || adj.length === 0) continue
    const d = Math.hypot(node.pos.x - point.x, node.pos.y - point.y)
    if (d < bestDist) {
      bestDist = d
      bestNode = node
    }
  }

  if (bestNode) {
    const adj = net.adjacency.get(bestNode.id)!
    const seg = net.segments.get(adj[0])
    if (seg) {
      const tan = segmentTangentAt(net, seg, bestNode.id)
      if (tan) {
        return {
          tangent: tan,
          pointOnTrack: { ...bestNode.pos },
          nodeId: bestNode.id,
        }
      }
    }
  }

  // Priority 2: near an existing segment (excluding segments connected to excludeNodeId)
  let bestSeg: { id: SegmentId; seg: any } | null = null
  let bestSegDist = tol

  for (const [id, seg] of net.segments.entries()) {
    if (excludeNodeId && (seg.from === excludeNodeId || seg.to === excludeNodeId)) {
      continue
    }
    const nodeA = net.nodes.get(seg.from)
    const nodeB = net.nodes.get(seg.to)
    if (!nodeA || !nodeB) continue

    if (seg.kind === 'straight') {
      const dx = nodeB.pos.x - nodeA.pos.x
      const dy = nodeB.pos.y - nodeA.pos.y
      const lenSq = dx * dx + dy * dy
      if (lenSq > 0.001) {
        const t = Math.max(0, Math.min(1, ((point.x - nodeA.pos.x) * dx + (point.y - nodeA.pos.y) * dy) / lenSq))
        const projX = nodeA.pos.x + t * dx
        const projY = nodeA.pos.y + t * dy
        const d = Math.hypot(projX - point.x, projY - point.y)
        if (d < bestSegDist) {
          bestSegDist = d
          bestSeg = { id, seg }
        }
      }
    } else if (seg.kind === 'curve' && seg.via) {
      const p0 = nodeA.pos
      const p1 = seg.via
      const p2 = nodeB.pos
      const SAMPLES = 32
      for (let i = 0; i <= SAMPLES; i++) {
        const s = i / SAMPLES
        const pt = bezierPoint(s, p0, p1, p2)
        const d = Math.hypot(pt.x - point.x, pt.y - point.y)
        if (d < bestSegDist) {
          bestSegDist = d
          bestSeg = { id, seg }
        }
      }
    }
  }

  if (bestSeg) {
    const seg = bestSeg.seg
    const nodeA = net.nodes.get(seg.from)!
    const nodeB = net.nodes.get(seg.to)!
    if (seg.kind === 'straight') {
      const dx = nodeB.pos.x - nodeA.pos.x
      const dy = nodeB.pos.y - nodeA.pos.y
      const len = Math.hypot(dx, dy)
      if (len > 0.001) {
        const ux = dx / len
        const uy = dy / len
        const t = Math.max(0, Math.min(1, ((point.x - nodeA.pos.x) * dx + (point.y - nodeA.pos.y) * dy) / (len * len)))
        return {
          tangent: { x: ux, y: uy },
          pointOnTrack: { x: nodeA.pos.x + t * dx, y: nodeA.pos.y + t * dy },
          segId: bestSeg.id,
        }
      }
    } else if (seg.kind === 'curve' && seg.via) {
      const p0 = nodeA.pos
      const p1 = seg.via
      const p2 = nodeB.pos
      let bestT = 0.5
      let bestDistSq = Infinity
      const SAMPLES = 32
      for (let i = 0; i <= SAMPLES; i++) {
        const s = i / SAMPLES
        const pt = bezierPoint(s, p0, p1, p2)
        const dSq = (pt.x - point.x) ** 2 + (pt.y - point.y) ** 2
        if (dSq < bestDistSq) {
          bestDistSq = dSq
          bestT = s
        }
      }
      const d1 = bezierDerivative1(bestT, p0, p1, p2)
      const dLen = Math.hypot(d1.x, d1.y)
      if (dLen > 0.001) {
        const pt = bezierPoint(bestT, p0, p1, p2)
        return {
          tangent: { x: d1.x / dLen, y: d1.y / dLen },
          pointOnTrack: pt,
          segId: bestSeg.id,
        }
      }
    }
  }

  return null
}

/** World-space limits of the tangent lock functions (metres). Defaults are the 1:1 values. */
export interface LockLimits {
  minLockAdvance?: number
  minLockPerp?: number
  minRadius?: number
  minReverseLockRadius?: number
  cursorDeadband?: number
}

/**
 * Compute the exact mathematical intersection and tangent locking point
 * when connecting a track from startNode (with tangent startTan) to a target rail (with tangent railTan).
 * At the lock point, the circular arc has G1 continuity at BOTH ends:
 * 0° angle with startNode's track, and 0° angle with target rail.
 */
export function computeTurnoutIntersectionLock(
  startPos: Point,
  startTan: Point,
  railPoint: Point,
  railTan: Point,
  limits: LockLimits = {},
): { lockPoint: Point; via: Point; radius: number; angleDeg: number; valid: boolean } | null {
  const { minLockAdvance = 0.5, minRadius = 15, cursorDeadband = 1 } = limits
  const tLen = Math.hypot(startTan.x, startTan.y)
  const rLen = Math.hypot(railTan.x, railTan.y)
  if (tLen < 1e-4 || rLen < 1e-4) return null

  const t0 = { x: startTan.x / tLen, y: startTan.y / tLen }
  const tr = { x: railTan.x / rLen, y: railTan.y / rLen }

  // Vector from startPos to railPoint
  const dx = railPoint.x - startPos.x
  const dy = railPoint.y - startPos.y

  // Determinant between t0 and tr
  const det = t0.y * tr.x - t0.x * tr.y
  if (Math.abs(det) < 1e-4) {
    // Parallel tracks: cannot connect with a single circular arc without counter-curve
    return null
  }

  // Parameter along startTan to intersection point V
  const t = (dx * (-tr.y) - dy * (-tr.x)) / det
  if (t < minLockAdvance) {
    // Intersection is behind startPos or too close
    return null
  }

  const V = {
    x: startPos.x + t * t0.x,
    y: startPos.y + t * t0.y,
  }

  const d0 = t // Distance from startPos to V

  // Determine effective forward direction along the rail
  // If cursor is to one side of V along the rail line, follow cursor; otherwise follow forward deflection
  const dotCursor = (railPoint.x - V.x) * tr.x + (railPoint.y - V.y) * tr.y
  const dotForward = (V.x - startPos.x) * tr.x + (V.y - startPos.y) * tr.y
  const trEff = Math.abs(dotCursor) > cursorDeadband ? (dotCursor >= 0 ? tr : { x: -tr.x, y: -tr.y }) : (dotForward >= 0 ? tr : { x: -tr.x, y: -tr.y })

  // In any circular arc tangent to both lines, the distance from V to both tangency points is equal
  const lockPoint = {
    x: V.x + d0 * trEff.x,
    y: V.y + d0 * trEff.y,
  }

  // Deflection angle between t0 and trEff
  const cosTheta = Math.max(-1, Math.min(1, t0.x * trEff.x + t0.y * trEff.y))
  const theta = Math.acos(cosTheta)
  const angleDeg = (theta * 180) / Math.PI

  if (theta < 0.01 || theta > (150 * Math.PI) / 180) {
    return null
  }

  const halfTan = Math.tan(theta / 2)
  const radius = halfTan > 1e-4 ? d0 / halfTan : Infinity

  return {
    lockPoint,
    via: V,
    radius,
    angleDeg,
    valid: radius >= minRadius && angleDeg <= 120,
  }
}

/**
 * Compute the tangent lock point when connecting a free canvas point (no incoming tangent)
 * into a target rail line with a desired radius R.
 * Returns the lockPoint on the rail, the via apex, deflection angle, and radius.
 */
export function computeReverseFreeNodeLock(
  startPos: Point,
  railPoint: Point,
  railTan: Point,
  preferredRadius = 300,
  limits: LockLimits = {},
): { lockPoint: Point; via: Point; radius: number; angleDeg: number; valid: boolean } | null {
  const { minLockPerp = 0.2, minReverseLockRadius = 20 } = limits
  const rLen = Math.hypot(railTan.x, railTan.y)
  if (rLen < 1e-4) return null
  const u = { x: railTan.x / rLen, y: railTan.y / rLen }
  const n = { x: -u.y, y: u.x }

  // Vector from railPoint to startPos
  const dx = startPos.x - railPoint.x
  const dy = startPos.y - railPoint.y

  // Perpendicular signed distance from startPos to rail line
  const h = dx * n.x + dy * n.y
  const dPerp = Math.abs(h)

  if (dPerp < minLockPerp) return null

  // Clamp radius so that dPerp <= 1.9 * R
  const R = Math.max(preferredRadius, dPerp / 1.8, minReverseLockRadius)

  // Projection of startPos onto the rail line
  const pProj = {
    x: startPos.x - h * n.x,
    y: startPos.y - h * n.y,
  }

  // Distance along the rail from pProj to tangency point
  const deltaS = Math.sqrt(Math.max(0, dPerp * (2 * R - dPerp)))

  // Determine direction along the rail toward railPoint (cursor)
  const dotCursor = (railPoint.x - pProj.x) * u.x + (railPoint.y - pProj.y) * u.y
  const dirAlong = dotCursor >= 0 ? 1 : -1
  const uEff = { x: dirAlong * u.x, y: dirAlong * u.y }

  const lockPoint = {
    x: pProj.x + dirAlong * deltaS * u.x,
    y: pProj.y + dirAlong * deltaS * u.y,
  }

  const cosAlpha = Math.max(-1, Math.min(1, 1 - dPerp / R))
  const alpha = Math.acos(cosAlpha)
  const angleDeg = (alpha * 180) / Math.PI

  const halfTan = Math.tan(alpha / 2)
  const d0 = halfTan > 1e-4 ? R * halfTan : deltaS

  // Apex V is back along uEff from lockPoint
  const V = {
    x: lockPoint.x - d0 * uEff.x,
    y: lockPoint.y - d0 * uEff.y,
  }

  return {
    lockPoint,
    via: V,
    radius: R,
    angleDeg,
    valid: angleDeg <= 120,
  }
}



