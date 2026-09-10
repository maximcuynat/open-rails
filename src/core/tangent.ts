import type { Point, Network, Segment, NodeId } from './types'

/** Outgoing tangent direction (normalized) at the end of a straight segment. */
function straightTangent(from: Point, to: Point): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: 1, y: 0 }
  return { x: dx / len, y: dy / len }
}

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

/** Get the outgoing tangent direction at a node, coming FROM a specific segment.
 *  Returns the direction the track is heading as it leaves that node.
 *  If nodeId is the "from" end of seg, tangent is start->to direction.
 *  If nodeId is the "to" end of seg, tangent is the curve's end tangent. */
export function segmentTangentAt(
  net: Network,
  seg: Segment,
  nodeId: NodeId,
): Point | null {
  const fromNode = net.nodes.get(seg.from)
  const toNode = net.nodes.get(seg.to)
  if (!fromNode || !toNode) return null

  if (nodeId === seg.from) {
    // Leaving from the "from" end — direction is towards "to"
    if (seg.kind === 'curve' && seg.via) {
      return bezierStartTangent(fromNode.pos, seg.via)
    }
    return straightTangent(fromNode.pos, toNode.pos)
  } else if (nodeId === seg.to) {
    // Leaving from the "to" end — direction is the end tangent of the curve/straight
    if (seg.kind === 'curve' && seg.via) {
      return bezierEndTangent(seg.via, toNode.pos)
    }
    return straightTangent(fromNode.pos, toNode.pos)
  }
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

/** Compute a via point for a curve that starts at `start` with a given
 *  incoming tangent direction, and ends at `end`.
 *
 *  G1 continuity: the tangent at the start of the Bezier must match
 *  the incoming direction. For a quadratic Bezier B(t) with control
 *  points P0, P1, P2:
 *    B'(0) = 2(P1 - P0)  →  P1 = P0 + k * dir  (for some k > 0)
 *    B'(1) = 2(P2 - P1)  →  P1 = P2 - m * dir2 (end tangent is free)
 *
 *  We place P1 along the incoming tangent direction from P0.
 *  The distance k determines how "flat" or "sharp" the curve is.
 *  We compute k so that the curve passes through the midpoint region
 *  between start and end, projected onto the tangent line.
 *
 *  This gives a DYNAMIC curve: small k = tight turn, large k = gentle curve.
 *  The user controls the geometry by where they place the end point.
 */
export function viaFromTangent(
  start: Point,
  end: Point,
  incomingDir: Point,
): Point {
  // Project the chord midpoint onto the tangent line from start.
  // The via should be placed along the tangent direction, at a distance
  // that makes the curve naturally connect start to end.
  //
  // For a quadratic Bezier: P1 = P0 + k * dir
  // The curve at t=0.5 is: 0.25*P0 + 0.5*P1 + 0.25*P2
  // We want this to be roughly at the midpoint of start->end, offset
  // perpendicular by the natural sagitta.
  //
  // Simpler approach: P1 is the intersection of:
  //   Line 1: start + k * incomingDir  (tangent line from start)
  //   Line 2: end + m * (end - via_guess)  (but we don't know end tangent)
  //
  // Instead, use: P1 is the projection of the chord midpoint onto the
  // tangent line from start, scaled by 2 (because B(0.5) = 0.25*P0 + 0.5*P1 + 0.25*P2,
  // so P1 = 2*midpoint - 0.5*P0 - 0.5*P2 = 2*midpoint - midpoint = midpoint... no)
  //
  // Actually: B(0.5) = 0.25*P0 + 0.5*P1 + 0.25*P2
  // If we want B(0.5) = midpoint(P0,P2) = (P0+P2)/2:
  //   (P0+P2)/2 = 0.25*P0 + 0.5*P1 + 0.25*P2
  //   0.5*P0 + 0.5*P2 = 0.25*P0 + 0.5*P1 + 0.25*P2
  //   0.25*P0 + 0.25*P2 = 0.5*P1
  //   P1 = (P0 + P2) / 2  ← midpoint, but this gives straight line!
  //
  // So we can't force B(0.5) to the chord midpoint. Instead:
  // Place P1 along the tangent line from start. The distance k is chosen
  // as the projection of (end - start) onto the tangent direction.
  // This ensures the curve starts in the right direction and reaches end.

  const dx = end.x - start.x
  const dy = end.y - start.y
  // Project chord onto tangent direction
  const k = dx * incomingDir.x + dy * incomingDir.y

  // The via is at start + k * dir, but we scale by 2 because
  // the control point has twice the influence (B'(0) = 2(P1-P0))
  // k can be negative if end is behind the tangent direction,
  // which means the curve doubles back.
  return {
    x: start.x + k * incomingDir.x,
    y: start.y + k * incomingDir.y,
  }
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
    // Tangents are parallel — can't satisfy both. Fall back to start tangent only.
    return viaFromTangent(start, end, incomingDir)
  }

  const k = (rx * outgoingDir.y - ry * outgoingDir.x) / det
  // const m = (incomingDir.x * ry - incomingDir.y * rx) / det  // not needed

  return {
    x: start.x + k * incomingDir.x,
    y: start.y + k * incomingDir.y,
  }
}
