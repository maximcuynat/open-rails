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
