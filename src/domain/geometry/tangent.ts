import type { Point, Network, Segment, NodeId, RailNode, SegmentId } from '../models/types'
import { hitSegment } from '../models/network'
import { bezierPoint, bezierDerivative1 } from './curve'

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

/**
 * Find the optimal tangent direction at a node aligned with the user's cursor drag.
 * Evaluates all connected segments at the node and picks the tangent vector (+ or -)
 * having the highest alignment (dot product) with the vector (cursor - node.pos).
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

    if (!userDir) {
      if (!bestTangent) bestTangent = tan
      continue
    }

    const dotPlus = userDir.x * tan.x + userDir.y * tan.y
    const dotMinus = -dotPlus

    if (dotPlus >= dotMinus) {
      if (dotPlus > bestDot) {
        bestDot = dotPlus
        bestTangent = tan
      }
    } else {
      if (dotMinus > bestDot) {
        bestDot = dotMinus
        bestTangent = { x: -tan.x, y: -tan.y }
      }
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

  // Priority 2: near an existing segment
  const segId = hitSegment(net, point, tol)
  if (segId) {
    const seg = net.segments.get(segId)
    if (seg) {
      const nodeA = net.nodes.get(seg.from)
      const nodeB = net.nodes.get(seg.to)
      if (nodeA && nodeB) {
        if (seg.kind === 'straight') {
          const dx = nodeB.pos.x - nodeA.pos.x
          const dy = nodeB.pos.y - nodeA.pos.y
          const lenSq = dx * dx + dy * dy
          if (lenSq > 0.001) {
            const len = Math.sqrt(lenSq)
            const ux = dx / len
            const uy = dy / len
            const t = Math.max(0, Math.min(1, ((point.x - nodeA.pos.x) * dx + (point.y - nodeA.pos.y) * dy) / lenSq))
            return {
              tangent: { x: ux, y: uy },
              pointOnTrack: { x: nodeA.pos.x + t * dx, y: nodeA.pos.y + t * dy },
              segId,
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
              segId,
            }
          }
        }
      }
    }
  }

  return null
}

