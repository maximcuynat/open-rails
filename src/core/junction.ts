import { generateId, addNode, addSegment, addCurveSegment, removeSegment } from './network'
import { computeCurvePiece, computeStraightPiece } from './profiles'
import { bezierPoint } from './curve'
import { segmentTangentAt } from './tangent'
import type { Junction, JunctionId, Network, NodeId, Point, RailNode, Segment, SegmentId } from './types'

export interface TurnoutSpec {
  frogNumber: 4 | 6
  straightLength: number
  divergingRadius: number
  divergingAngle: number
  label: string
}

export const TURNOUT_SPECS: Record<4 | 6, TurnoutSpec> = {
  6: {
    frogNumber: 6,
    straightLength: 246,
    divergingRadius: 867,
    divergingAngle: 10,
    label: '#6 (246mm / R867 10°)',
  },
  4: {
    frogNumber: 4,
    straightLength: 123,
    divergingRadius: 490,
    divergingAngle: 15,
    label: '#4 (123mm / R490 15°)',
  },
}

/** Register a junction in the network. */
export function addJunction(
  net: Network,
  params: {
    nodeId: NodeId
    stemNodeId?: NodeId
    straightNodeId: NodeId
    divergingNodeId: NodeId
    straightSegmentId: SegmentId
    divergingSegmentId: SegmentId
    hand: 'left' | 'right'
    frogNumber?: number
    activeBranch?: 'straight' | 'diverging'
  },
): Junction {
  const junc: Junction = {
    id: generateId('j'),
    nodeId: params.nodeId,
    stemNodeId: params.stemNodeId,
    straightNodeId: params.straightNodeId,
    divergingNodeId: params.divergingNodeId,
    straightSegmentId: params.straightSegmentId,
    divergingSegmentId: params.divergingSegmentId,
    hand: params.hand,
    frogNumber: params.frogNumber,
    activeBranch: params.activeBranch ?? 'straight',
  }
  net.junctions.set(junc.id, junc)
  return junc
}

/** Remove a junction definition from the network (does not remove the rails unless specified). */
export function removeJunction(net: Network, id: JunctionId): void {
  net.junctions.delete(id)
}

/** Toggle active branch of a junction. */
export function toggleJunction(junction: Junction): 'straight' | 'diverging' {
  junction.activeBranch = junction.activeBranch === 'straight' ? 'diverging' : 'straight'
  return junction.activeBranch
}

/** Set active branch of a junction. */
export function setJunctionBranch(junction: Junction, branch: 'straight' | 'diverging'): void {
  junction.activeBranch = branch
}

/** Find if a node is the apex of a junction. */
export function findJunctionAtNode(net: Network, nodeId: NodeId): Junction | undefined {
  for (const junc of net.junctions.values()) {
    if (junc.nodeId === nodeId) return junc
  }
  return undefined
}

/** Find if a segment belongs to any junction. */
export function findJunctionBySegment(net: Network, segId: SegmentId): Junction | undefined {
  for (const junc of net.junctions.values()) {
    if (junc.straightSegmentId === segId || junc.divergingSegmentId === segId) {
      return junc
    }
  }
  return undefined
}

/**
 * Automatically inspect all nodes in the network.
 * Any node with 3 connected segments is auto-detected as a railway turnout.
 * Automatically classifies stem, straight route, diverging route, hand, and frog number.
 */
export function autoDetectJunctions(net: Network): Junction[] {
  const detected: Junction[] = []

  for (const node of net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length === 3) {
      const s0 = net.segments.get(adj[0])
      const s1 = net.segments.get(adj[1])
      const s2 = net.segments.get(adj[2])
      if (!s0 || !s1 || !s2) continue

      // Compute normalized tangent directions entering each segment from node.pos
      const getDir = (seg: Segment): Point => {
        const otherId = seg.from === node.id ? seg.to : seg.from
        const other = net.nodes.get(otherId)
        const tan = segmentTangentAt(net, seg, node.id)
        if (tan) {
          return seg.to === node.id ? { x: -tan.x, y: -tan.y } : tan
        }
        if (other) {
          const dx = other.pos.x - node.pos.x
          const dy = other.pos.y - node.pos.y
          const len = Math.hypot(dx, dy)
          return len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 }
        }
        return { x: 1, y: 0 }
      }

      const u = [getDir(s0), getDir(s1), getDir(s2)]
      const segs = [s0, s1, s2]

      // Find pair with minimal dot product (closest to -1, through route)
      const dot01 = u[0].x * u[1].x + u[0].y * u[1].y
      const dot02 = u[0].x * u[2].x + u[0].y * u[2].y
      const dot12 = u[1].x * u[2].x + u[1].y * u[2].y

      let throughA = 0
      let throughB = 1
      let divIdx = 2
      let minDot = dot01

      if (dot02 < minDot) {
        minDot = dot02
        throughA = 0
        throughB = 2
        divIdx = 1
      }
      if (dot12 < minDot) {
        minDot = dot12
        throughA = 1
        throughB = 2
        divIdx = 0
      }

      // Between throughA and throughB: the diverging route branches forward from stem.
      // u_div . u_straight > 0, u_div . u_stem < 0.
      const dotA_div = u[throughA].x * u[divIdx].x + u[throughA].y * u[divIdx].y
      const dotB_div = u[throughB].x * u[divIdx].x + u[throughB].y * u[divIdx].y

      const stemIdx = dotA_div < dotB_div ? throughA : throughB
      const straightIdx = dotA_div < dotB_div ? throughB : throughA

      const stemSeg = segs[stemIdx]
      const straightSeg = segs[straightIdx]
      const divSeg = segs[divIdx]

      const stemNodeId = stemSeg.from === node.id ? stemSeg.to : stemSeg.from
      const straightNodeId = straightSeg.from === node.id ? straightSeg.to : straightSeg.from
      const divNodeId = divSeg.from === node.id ? divSeg.to : divSeg.from

      // Hand: cross product of approach vector (-u_stem) and diverging vector (u_div)
      const approachX = -u[stemIdx].x
      const approachY = -u[stemIdx].y
      const cross = approachX * u[divIdx].y - approachY * u[divIdx].x
      const hand: 'left' | 'right' = cross >= 0 ? 'left' : 'right'

      // Angle of divergence
      const straightDotDiv = Math.max(-1, Math.min(1, u[straightIdx].x * u[divIdx].x + u[straightIdx].y * u[divIdx].y))
      const angleDeg = (Math.acos(straightDotDiv) * 180) / Math.PI
      const frogNumber: 4 | 6 = angleDeg <= 12.5 ? 6 : 4

      let junc = findJunctionAtNode(net, node.id)
      if (junc) {
        junc.stemNodeId = stemNodeId
        junc.straightNodeId = straightNodeId
        junc.divergingNodeId = divNodeId
        junc.straightSegmentId = straightSeg.id
        junc.divergingSegmentId = divSeg.id
        junc.hand = hand
        junc.frogNumber = frogNumber
      } else {
        junc = addJunction(net, {
          nodeId: node.id,
          stemNodeId,
          straightNodeId,
          divergingNodeId: divNodeId,
          straightSegmentId: straightSeg.id,
          divergingSegmentId: divSeg.id,
          hand,
          frogNumber,
          activeBranch: 'straight',
        })
      }
      detected.push(junc)
    } else {
      // If node is no longer degree 3, remove any registered junction
      const junc = findJunctionAtNode(net, node.id)
      if (junc) {
        removeJunction(net, junc.id)
      }
    }
  }

  return detected
}

/**
 * Place a complete Kato turnout starting from apex node along a direction.
 * Creates the straight branch and curved diverging branch according to frog spec.
 */
export function placeTurnout(
  net: Network,
  options: {
    startPos: Point
    direction: Point
    frogNumber: 4 | 6
    hand: 'left' | 'right'
    stemNodeId?: NodeId
  },
): {
  junction: Junction
  apexNode: RailNode
  straightNode: RailNode
  divergingNode: RailNode
} {
  const spec = TURNOUT_SPECS[options.frogNumber]
  const dirLen = Math.hypot(options.direction.x, options.direction.y)
  const dir = dirLen > 0 ? { x: options.direction.x / dirLen, y: options.direction.y / dirLen } : { x: 1, y: 0 }

  // 1. Apex node (where tracks branch)
  let apexNode: RailNode
  if (options.stemNodeId) {
    apexNode = net.nodes.get(options.stemNodeId) ?? addNode(net, options.startPos)
  } else {
    apexNode = addNode(net, options.startPos)
  }

  // 2. Straight branch
  const straightEnd = computeStraightPiece(apexNode.pos, dir, spec.straightLength)
  const straightNode = addNode(net, straightEnd)
  const straightSeg = addSegment(net, apexNode.id, straightNode.id)!

  // 3. Diverging branch
  const side: 1 | -1 = options.hand === 'left' ? 1 : -1
  const { end: divEnd, via: divVia } = computeCurvePiece(
    apexNode.pos,
    dir,
    spec.divergingRadius,
    side,
    spec.divergingAngle,
  )
  const divergingNode = addNode(net, divEnd)
  const divergingSeg = addCurveSegment(net, apexNode.id, divergingNode.id, divVia)!

  // 4. Register Junction
  const junction = addJunction(net, {
    nodeId: apexNode.id,
    stemNodeId: options.stemNodeId,
    straightNodeId: straightNode.id,
    divergingNodeId: divergingNode.id,
    straightSegmentId: straightSeg.id,
    divergingSegmentId: divergingSeg.id,
    hand: options.hand,
    frogNumber: options.frogNumber,
    activeBranch: 'straight',
  })

  return { junction, apexNode, straightNode, divergingNode }
}

/**
 * Split an existing segment into two connected segments at a given split position.
 * Preserves curvature and G1 tangency if segment is curved.
 */
export function splitSegment(
  net: Network,
  segmentId: SegmentId,
  splitPoint: Point,
): { midNode: RailNode; seg1: Segment; seg2: Segment } | null {
  const seg = net.segments.get(segmentId)
  if (!seg) return null
  const nodeA = net.nodes.get(seg.from)
  const nodeB = net.nodes.get(seg.to)
  if (!nodeA || !nodeB) return null

  // Create intermediate node at split point
  const midNode = addNode(net, splitPoint)

  if (seg.kind === 'straight') {
    const dx = nodeB.pos.x - nodeA.pos.x
    const dy = nodeB.pos.y - nodeA.pos.y
    const lenSq = dx * dx + dy * dy
    if (lenSq > 0) {
      const t = Math.max(0.005, Math.min(0.995, ((splitPoint.x - nodeA.pos.x) * dx + (splitPoint.y - nodeA.pos.y) * dy) / lenSq))
      midNode.pos = { x: nodeA.pos.x + t * dx, y: nodeA.pos.y + t * dy }
    }
    // Replace straight A-B with A-mid and mid-B
    removeSegment(net, segmentId, false)
    const seg1 = addSegment(net, nodeA.id, midNode.id)!
    const seg2 = addSegment(net, midNode.id, nodeB.id)!
    return { midNode, seg1, seg2 }
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
      const dSq = (pt.x - splitPoint.x) ** 2 + (pt.y - splitPoint.y) ** 2
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
    midNode.pos = bt

    removeSegment(net, segmentId, false)
    const seg1 = addCurveSegment(net, nodeA.id, midNode.id, q0)!
    const seg2 = addCurveSegment(net, midNode.id, nodeB.id, q1)!
    return { midNode, seg1, seg2 }
  }

  return null
}

/**
 * Fuse two nodes together (weld nodeB into nodeA).
 * Moves all connections of nodeB to nodeA and deletes nodeB.
 */
export function weldNodes(net: Network, keepNodeId: NodeId, removeNodeId: NodeId): boolean {
  if (keepNodeId === removeNodeId) return false
  const keepNode = net.nodes.get(keepNodeId)
  const removeNode = net.nodes.get(removeNodeId)
  if (!keepNode || !removeNode) return false

  const removeSegIds = [...(net.adjacency.get(removeNodeId) ?? [])]
  const keepSegIds = net.adjacency.get(keepNodeId) ?? []

  for (const sid of removeSegIds) {
    const seg = net.segments.get(sid)
    if (!seg) continue

    // If this segment directly connects keepNode and removeNode, remove it
    if ((seg.from === keepNodeId && seg.to === removeNodeId) || (seg.from === removeNodeId && seg.to === keepNodeId)) {
      net.segments.delete(sid)
      const idx = keepSegIds.indexOf(sid)
      if (idx >= 0) keepSegIds.splice(idx, 1)
      continue
    }

    // Re-route segment to keepNode
    if (seg.from === removeNodeId) seg.from = keepNodeId
    if (seg.to === removeNodeId) seg.to = keepNodeId

    if (!keepSegIds.includes(sid)) {
      keepSegIds.push(sid)
    }
  }

  // Update any junction node references
  for (const junc of net.junctions.values()) {
    if (junc.nodeId === removeNodeId) junc.nodeId = keepNodeId
    if (junc.stemNodeId === removeNodeId) junc.stemNodeId = keepNodeId
    if (junc.straightNodeId === removeNodeId) junc.straightNodeId = keepNodeId
    if (junc.divergingNodeId === removeNodeId) junc.divergingNodeId = keepNodeId
  }

  net.nodes.delete(removeNodeId)
  net.adjacency.delete(removeNodeId)
  return true
}

/**
 * Toggle the hand (left <-> right) of a turnout, mirroring the diverging branch
 * across the straight axis.
 */
export function toggleTurnoutHand(net: Network, junctionId: JunctionId): boolean {
  const junc = net.junctions.get(junctionId)
  if (!junc) return false

  const apex = net.nodes.get(junc.nodeId)
  const straightNode = net.nodes.get(junc.straightNodeId)
  const divNode = net.nodes.get(junc.divergingNodeId)
  const divSeg = net.segments.get(junc.divergingSegmentId)

  if (!apex || !straightNode || !divNode) return false

  // Straight axis vector A -> B
  const ax = straightNode.pos.x - apex.pos.x
  const ay = straightNode.pos.y - apex.pos.y
  const aLen = Math.hypot(ax, ay)
  if (aLen === 0) return false

  const ux = ax / aLen
  const uy = ay / aLen
  // Normal vector
  const nx = -uy
  const ny = ux

  const apexPos = apex.pos

  // Reflect function across axis
  function reflectPoint(p: Point): Point {
    const rx = p.x - apexPos.x
    const ry = p.y - apexPos.y
    const t = rx * ux + ry * uy
    const d = rx * nx + ry * ny
    return {
      x: apexPos.x + t * ux - d * nx,
      y: apexPos.y + t * uy - d * ny,
    }
  }

  divNode.pos = reflectPoint(divNode.pos)
  if (divSeg && divSeg.via) {
    divSeg.via = reflectPoint(divSeg.via)
  }

  junc.hand = junc.hand === 'left' ? 'right' : 'left'
  return true
}
