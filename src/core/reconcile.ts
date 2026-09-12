import type { Network, NodeId, Point, Segment, SegmentId } from './types'
import { bezierPoint, discretizeCurve } from './curve'
import { intersectSegments } from './crossing'
import { autoDetectJunctions, weldNodes } from './junction'
import { addNode, addSegment, addCurveSegment, removeSegment } from './network'

/**
 * Split an existing segment at an existing node that lies on it.
 * Snaps node position precisely onto the segment to eliminate geometric kinks,
 * and maintains quadratic Bézier continuity via De Casteljau subdivision.
 */
export function splitSegmentAtNode(
  net: Network,
  segmentId: SegmentId,
  nodeId: NodeId,
): { seg1: Segment; seg2: Segment } | null {
  const seg = net.segments.get(segmentId)
  const node = net.nodes.get(nodeId)
  if (!seg || !node) return null
  if (seg.from === nodeId || seg.to === nodeId) return null

  const nodeA = net.nodes.get(seg.from)
  const nodeB = net.nodes.get(seg.to)
  if (!nodeA || !nodeB) return null

  if (seg.kind === 'straight') {
    const dx = nodeB.pos.x - nodeA.pos.x
    const dy = nodeB.pos.y - nodeA.pos.y
    const lenSq = dx * dx + dy * dy
    if (lenSq > 0) {
      const t = Math.max(0.005, Math.min(0.995, ((node.pos.x - nodeA.pos.x) * dx + (node.pos.y - nodeA.pos.y) * dy) / lenSq))
      node.pos = { x: nodeA.pos.x + t * dx, y: nodeA.pos.y + t * dy }
    }
    removeSegment(net, segmentId, false)
    const seg1 = addSegment(net, nodeA.id, node.id)!
    const seg2 = addSegment(net, node.id, nodeB.id)!
    return { seg1, seg2 }
  } else if (seg.kind === 'curve' && seg.via) {
    const p0 = nodeA.pos
    const p1 = seg.via
    const p2 = nodeB.pos

    let bestT = 0.5
    let bestDistSq = Infinity
    const SAMPLES = 32
    for (let i = 1; i < SAMPLES; i++) {
      const s = i / SAMPLES
      const pt = bezierPoint(s, p0, p1, p2)
      const dSq = (pt.x - node.pos.x) ** 2 + (pt.y - node.pos.y) ** 2
      if (dSq < bestDistSq) {
        bestDistSq = dSq
        bestT = s
      }
    }
    const t = Math.max(0.01, Math.min(0.99, bestT))
    const q0 = {
      x: (1 - t) * p0.x + t * p1.x,
      y: (1 - t) * p0.y + t * p1.y,
    }
    const q1 = {
      x: (1 - t) * p1.x + t * p2.x,
      y: (1 - t) * p1.y + t * p2.y,
    }
    const bt = {
      x: (1 - t) * q0.x + t * q1.x,
      y: (1 - t) * q0.y + t * q1.y,
    }
    node.pos = bt

    removeSegment(net, segmentId, false)
    const seg1 = addCurveSegment(net, nodeA.id, node.id, q0)!
    const seg2 = addCurveSegment(net, node.id, nodeB.id, q1)!
    return { seg1, seg2 }
  }
  return null
}

function areNodesConnected(net: Network, nodeA: NodeId, nodeB: NodeId): boolean {
  if (nodeA === nodeB) return true
  const adjA = net.adjacency.get(nodeA) ?? []
  for (const segId of adjA) {
    const s = net.segments.get(segId)
    if (!s) continue
    if (s.from === nodeB || s.to === nodeB) return true
  }
  return false
}

interface ReconcileCandidate {
  type: 'weld' | 'split' | 'cross'
  nodeId?: NodeId
  segId?: SegmentId
  seg2Id?: SegmentId
  crossPoint?: Point
  weldNodeId?: NodeId
  dist: number
}

/**
 * Reconcile network topology (squelette logique de jonctions et intersections).
 * 1. Checks all nodes in the network: if a node lies within tolerance distance
 *    of an existing segment not connected to it, splits the segment at that node
 *    to wire it directly into the running track.
 * 2. If a node is within tolerance of an existing node, welds them together.
 * 3. Checks segment-segment geometric crossings to create diamond crossing nodes.
 * 4. Uses a greedy lowest-distance strategy so exact geometric alignments
 *    (e.g. dist = 0) are resolved before divergent track clearances.
 * 5. Automatically detects all turnouts (degree 3) and crossings (degree 4).
 */
export function reconcileNetworkIntersections(
  net: Network,
  tolerance = 3.5,
): { splitCount: number; weldedCount: number } {
  let splitCount = 0
  let weldedCount = 0
  let iterations = 0

  while (iterations < 40) {
    iterations++
    const candidates: ReconcileCandidate[] = []

    const nodeList = Array.from(net.nodes.values())
    const segList = Array.from(net.segments.values())

    for (const node of nodeList) {
      if (!net.nodes.has(node.id)) continue

      for (const seg of segList) {
        if (!net.segments.has(seg.id)) continue
        if (seg.from === node.id || seg.to === node.id) continue
        // Sibling/adjacent branches of the same node diverge slowly near apex, do not split each other
        if (areNodesConnected(net, node.id, seg.from) || areNodesConnected(net, node.id, seg.to)) continue

        const nodeA = net.nodes.get(seg.from)
        const nodeB = net.nodes.get(seg.to)
        if (!nodeA || !nodeB) continue

        // Distance to endpoints
        const distA = Math.hypot(node.pos.x - nodeA.pos.x, node.pos.y - nodeA.pos.y)
        const distB = Math.hypot(node.pos.x - nodeB.pos.x, node.pos.y - nodeB.pos.y)

        if (distA <= tolerance) {
          candidates.push({
            type: 'weld',
            nodeId: node.id,
            weldNodeId: nodeA.id,
            dist: distA,
          })
          continue
        }
        if (distB <= tolerance) {
          candidates.push({
            type: 'weld',
            nodeId: node.id,
            weldNodeId: nodeB.id,
            dist: distB,
          })
          continue
        }

        // Distance to segment interior
        if (seg.kind === 'straight') {
          const dx = nodeB.pos.x - nodeA.pos.x
          const dy = nodeB.pos.y - nodeA.pos.y
          const lenSq = dx * dx + dy * dy
          if (lenSq < 1e-4) continue

          const t = ((node.pos.x - nodeA.pos.x) * dx + (node.pos.y - nodeA.pos.y) * dy) / lenSq
          if (t > 0.005 && t < 0.995) {
            const projX = nodeA.pos.x + t * dx
            const projY = nodeA.pos.y + t * dy
            const dist = Math.hypot(node.pos.x - projX, node.pos.y - projY)
            if (dist <= tolerance) {
              candidates.push({
                type: 'split',
                nodeId: node.id,
                segId: seg.id,
                dist,
              })
            }
          }
        } else if (seg.kind === 'curve' && seg.via) {
          const p0 = nodeA.pos
          const p1 = seg.via
          const p2 = nodeB.pos

          let bestT = 0.5
          let bestDistSq = Infinity
          const SAMPLES = 32
          for (let i = 1; i < SAMPLES; i++) {
            const s = i / SAMPLES
            const pt = bezierPoint(s, p0, p1, p2)
            const dSq = (pt.x - node.pos.x) ** 2 + (pt.y - node.pos.y) ** 2
            if (dSq < bestDistSq) {
              bestDistSq = dSq
              bestT = s
            }
          }

          const dist = Math.sqrt(bestDistSq)
          if (bestT > 0.01 && bestT < 0.99 && dist <= tolerance) {
            candidates.push({
              type: 'split',
              nodeId: node.id,
              segId: seg.id,
              dist,
            })
          }
        }
      }
    }

    // Check segment-segment geometric crossings (e.g. tracks placed across each other)
    for (let i = 0; i < segList.length; i++) {
      for (let j = i + 1; j < segList.length; j++) {
        const s1 = segList[i]
        const s2 = segList[j]
        if (!net.segments.has(s1.id) || !net.segments.has(s2.id)) continue
        if (s1.from === s2.from || s1.from === s2.to || s1.to === s2.from || s1.to === s2.to) continue

        const n1A = net.nodes.get(s1.from)
        const n1B = net.nodes.get(s1.to)
        const n2A = net.nodes.get(s2.from)
        const n2B = net.nodes.get(s2.to)
        if (!n1A || !n1B || !n2A || !n2B) continue

        // Fast AABB pre-check
        const s1MinX = Math.min(n1A.pos.x, n1B.pos.x, s1.via ? s1.via.x : Infinity)
        const s1MaxX = Math.max(n1A.pos.x, n1B.pos.x, s1.via ? s1.via.x : -Infinity)
        const s1MinY = Math.min(n1A.pos.y, n1B.pos.y, s1.via ? s1.via.y : Infinity)
        const s1MaxY = Math.max(n1A.pos.y, n1B.pos.y, s1.via ? s1.via.y : -Infinity)

        const s2MinX = Math.min(n2A.pos.x, n2B.pos.x, s2.via ? s2.via.x : Infinity)
        const s2MaxX = Math.max(n2A.pos.x, n2B.pos.x, s2.via ? s2.via.x : -Infinity)
        const s2MinY = Math.min(n2A.pos.y, n2B.pos.y, s2.via ? s2.via.y : Infinity)
        const s2MaxY = Math.max(n2A.pos.y, n2B.pos.y, s2.via ? s2.via.y : -Infinity)

        if (s1MaxX < s2MinX || s1MinX > s2MaxX || s1MaxY < s2MinY || s1MinY > s2MaxY) {
          continue
        }

        const pts1 = s1.kind === 'curve' && s1.via ? discretizeCurve(n1A.pos, s1.via, n1B.pos, 16) : [n1A.pos, n1B.pos]
        const pts2 = s2.kind === 'curve' && s2.via ? discretizeCurve(n2A.pos, s2.via, n2B.pos, 16) : [n2A.pos, n2B.pos]

        let crossed = false
        for (let a = 0; a < pts1.length - 1 && !crossed; a++) {
          for (let b = 0; b < pts2.length - 1 && !crossed; b++) {
            const res = intersectSegments(pts1[a], pts1[a + 1], pts2[b], pts2[b + 1])
            if (res) {
              const d1A = Math.hypot(res.point.x - n1A.pos.x, res.point.y - n1A.pos.y)
              const d1B = Math.hypot(res.point.x - n1B.pos.x, res.point.y - n1B.pos.y)
              const d2A = Math.hypot(res.point.x - n2A.pos.x, res.point.y - n2A.pos.y)
              const d2B = Math.hypot(res.point.x - n2B.pos.x, res.point.y - n2B.pos.y)
              if (d1A > tolerance && d1B > tolerance && d2A > tolerance && d2B > tolerance) {
                candidates.push({
                  type: 'cross',
                  segId: s1.id,
                  seg2Id: s2.id,
                  crossPoint: res.point,
                  dist: 0.001,
                })
                crossed = true
              }
            }
          }
        }
      }
    }

    if (candidates.length === 0) break

    // Sort candidates by ascending distance (closest/exact first)
    candidates.sort((a, b) => a.dist - b.dist)
    const best = candidates[0]

    if (best.type === 'weld' && best.weldNodeId && best.nodeId) {
      weldNodes(net, best.weldNodeId, best.nodeId)
      weldedCount++
    } else if (best.type === 'split' && best.segId && best.nodeId) {
      splitSegmentAtNode(net, best.segId, best.nodeId)
      splitCount++
    } else if (best.type === 'cross' && best.segId && best.seg2Id && best.crossPoint) {
      const crossNode = addNode(net, best.crossPoint)
      splitSegmentAtNode(net, best.segId, crossNode.id)
      splitSegmentAtNode(net, best.seg2Id, crossNode.id)
      splitCount += 2
    }
  }

  // Re-detect all junctions in the reconciled network
  autoDetectJunctions(net)

  return { splitCount, weldedCount }
}
