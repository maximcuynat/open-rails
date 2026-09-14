import type { Network, NodeId, Point, Segment, SegmentId } from '../models/types'
import { segmentTangentAt } from '../geometry/tangent'
import type { SectionMetadata } from '../models/sections'

export interface PathResult {
  found: boolean
  nodes: NodeId[]
  segments: SegmentId[]
  totalDistance: number
}

export interface PathfindingOptions {
  /** Respect switch directions (default: true). If false, all branches can be traversed. */
  respectSwitches?: boolean
  /** Enforce physical geometry at diamond crossings (default: true, trains cannot turn at sharp crossings). */
  enforceCrossings?: boolean
  /** Section metadata to respect traffic flow directions (sens unique). */
  sectionMeta?: Record<string, SectionMetadata>
}

/** Compute the physical length of a segment in millimeters. */
export function segmentLength(net: Network, seg: Segment): number {
  const a = net.nodes.get(seg.from)
  const b = net.nodes.get(seg.to)
  if (!a || !b) return 0
  if (seg.kind === 'straight' || !seg.via) {
    return Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y)
  }
  // Numerical arc length of quadratic Bézier curve
  const N = 16
  let len = 0
  let prev = a.pos
  for (let i = 1; i <= N; i++) {
    const t = i / N
    const mt = 1 - t
    const cur: Point = {
      x: mt * mt * a.pos.x + 2 * mt * t * seg.via.x + t * t * b.pos.x,
      y: mt * mt * a.pos.y + 2 * mt * t * seg.via.y + t * t * b.pos.y,
    }
    len += Math.hypot(cur.x - prev.x, cur.y - prev.y)
    prev = cur
  }
  return len
}

/** Helper: compute outgoing ray direction from a node along a segment */
function getOutgoingRay(net: Network, seg: Segment, nodeId: NodeId): Point {
  const tan = segmentTangentAt(net, seg, nodeId)
  if (tan) {
    const isFrom = seg.from === nodeId
    const rx = isFrom ? tan.x : -tan.x
    const ry = isFrom ? tan.y : -tan.y
    const len = Math.hypot(rx, ry)
    if (len > 1e-5) return { x: rx / len, y: ry / len }
  }
  const otherId = seg.from === nodeId ? seg.to : seg.from
  const nA = net.nodes.get(nodeId)
  const nB = net.nodes.get(otherId)
  if (nA && nB) {
    const dx = nB.pos.x - nA.pos.x
    const dy = nB.pos.y - nA.pos.y
    const len = Math.hypot(dx, dy)
    if (len > 1e-5) return { x: dx / len, y: dy / len }
  }
  return { x: 1, y: 0 }
}

/** Find segment between two nodes if one exists. */
export function getSegmentBetween(net: Network, u: NodeId, v: NodeId): Segment | undefined {
  const segIds = net.adjacency.get(u)
  if (!segIds) return undefined
  for (const sid of segIds) {
    const s = net.segments.get(sid)
    if (s && ((s.from === u && s.to === v) || (s.from === v && s.to === u))) {
      return s
    }
  }
  return undefined
}

/** Check if transition prev -> curr -> next is allowed under junction switch, crossing and traffic settings. */
export function isTransitionAllowed(
  net: Network,
  prevNodeId: NodeId | null,
  currNodeId: NodeId,
  nextNodeId: NodeId,
  options: PathfindingOptions = {},
): boolean {
  const respectSwitches = options.respectSwitches ?? true
  const enforceCrossings = options.enforceCrossings ?? true

  // 1. Junction Switch Rules
  if (respectSwitches) {
    for (const junc of net.junctions.values()) {
      if (junc.nodeId === currNodeId) {
        const activeBranchNode = junc.activeBranch === 'straight' ? junc.straightNodeId : junc.divergingNodeId
        const inactiveBranchNode = junc.activeBranch === 'straight' ? junc.divergingNodeId : junc.straightNodeId

        // Cannot exit toward inactive branch
        if (nextNodeId === inactiveBranchNode) return false

        // Cannot enter from inactive branch into apex
        if (prevNodeId === inactiveBranchNode) return false

        // If entering from stem, must exit via active branch
        if (junc.stemNodeId && prevNodeId === junc.stemNodeId) {
          if (nextNodeId !== activeBranchNode) return false
        }

        // If entering from active branch, must exit toward stem if defined
        if (junc.stemNodeId && prevNodeId === activeBranchNode) {
          if (nextNodeId !== junc.stemNodeId) return false
        }
      }
    }
  }

  // 2. Diamond Crossing (X) Geometric Constraint
  // At a diamond crossing / grade intersection without movable blades (degree 4, not a junction),
  // trains arriving on line A MUST continue on line A (facing directly ahead, dot < -0.7).
  // A train CANNOT turn at sharp crossing angles onto line B.
  if (enforceCrossings && prevNodeId !== null) {
    const adj = net.adjacency.get(currNodeId) ?? []
    const isJunction = Array.from(net.junctions.values()).some((j) => j.nodeId === currNodeId)

    // A diamond crossing is typically a node with degree 4 that is NOT a movable switch
    if (adj.length === 4 && !isJunction) {
      const inSeg = getSegmentBetween(net, prevNodeId, currNodeId)
      const outSeg = getSegmentBetween(net, currNodeId, nextNodeId)
      if (inSeg && outSeg) {
        const rayIn = getOutgoingRay(net, inSeg, currNodeId)
        const rayOut = getOutgoingRay(net, outSeg, currNodeId)
        // rayIn points away from currNodeId towards prevNodeId.
        // rayOut points away from currNodeId towards nextNodeId.
        // A straight continuation through the crossing means rayIn and rayOut are opposite:
        // dot(rayIn, rayOut) must be close to -1 (e.g. < -0.65).
        const dot = rayIn.x * rayOut.x + rayIn.y * rayOut.y
        if (dot > -0.65) {
          // Sharp diversion at a fixed diamond crossing is physically impossible!
          return false
        }
      }
    }
  }

  // 3. Traffic direction constraints (Sens unique / circulation)
  if (options.sectionMeta) {
    const outSeg = getSegmentBetween(net, currNodeId, nextNodeId)
    if (outSeg) {
      const meta = options.sectionMeta[outSeg.id]
      if (meta && meta.direction && meta.direction !== 'two_way') {
        const isForwardTransit = outSeg.from === currNodeId && outSeg.to === nextNodeId
        if (meta.direction === 'forward' && !isForwardTransit) {
          return false // Sens interdit (trying to run backward on forward-only track)
        }
        if (meta.direction === 'backward' && isForwardTransit) {
          return false // Sens interdit (trying to run forward on backward-only track)
        }
      }
    }
  }

  return true
}

/**
 * Dijkstra shortest path between startNodeId and targetNodeId.
 * Respects junction active branches unless disabled via options.
 */
export function findPath(
  net: Network,
  startNodeId: NodeId,
  targetNodeId: NodeId,
  options: PathfindingOptions = {},
): PathResult {
  if (!net.nodes.has(startNodeId) || !net.nodes.has(targetNodeId)) {
    return { found: false, nodes: [], segments: [], totalDistance: 0 }
  }

  if (startNodeId === targetNodeId) {
    return { found: true, nodes: [startNodeId], segments: [], totalDistance: 0 }
  }

  // Priority queue item: { node, prev, dist }
  interface PQItem {
    node: NodeId
    prev: NodeId | null
    dist: number
  }

  const distMap = new Map<string, number>()
  const parentMap = new Map<string, { prev: NodeId | null; prevPrev: NodeId | null; segId: SegmentId }>()
  const pq: PQItem[] = [{ node: startNodeId, prev: null, dist: 0 }]
  const key = (node: NodeId, prev: NodeId | null) => `${prev ?? 'START'}->${node}`
  distMap.set(key(startNodeId, null), 0)

  let bestTargetState: { node: NodeId; prev: NodeId | null } | null = null
  let minTargetDist = Infinity

  while (pq.length > 0) {
    // Pop min
    pq.sort((a, b) => a.dist - b.dist)
    const current = pq.shift()!
    const currKey = key(current.node, current.prev)

    if (current.dist > (distMap.get(currKey) ?? Infinity)) {
      continue
    }

    if (current.node === targetNodeId) {
      if (current.dist < minTargetDist) {
        minTargetDist = current.dist
        bestTargetState = { node: current.node, prev: current.prev }
        break // First target arrival in Dijkstra is optimal
      }
    }

    const segIds = net.adjacency.get(current.node) ?? []
    for (const sid of segIds) {
      const seg = net.segments.get(sid)
      if (!seg) continue
      const nextNodeId = seg.from === current.node ? seg.to : seg.from
      if (nextNodeId === current.prev) continue // Don't instantly reverse along same track

      if (!isTransitionAllowed(net, current.prev, current.node, nextNodeId, options)) {
        continue
      }

      const weight = segmentLength(net, seg)
      const nextDist = current.dist + weight
      const nextKey = key(nextNodeId, current.node)

      if (nextDist < (distMap.get(nextKey) ?? Infinity)) {
        distMap.set(nextKey, nextDist)
        parentMap.set(nextKey, { prev: current.node, prevPrev: current.prev, segId: sid })
        pq.push({ node: nextNodeId, prev: current.node, dist: nextDist })
      }
    }
  }

  if (!bestTargetState) {
    return { found: false, nodes: [], segments: [], totalDistance: 0 }
  }

  // Reconstruct path
  const nodes: NodeId[] = [bestTargetState.node]
  const segments: SegmentId[] = []
  let currState = bestTargetState

  while (currState.prev !== null) {
    const parent = parentMap.get(key(currState.node, currState.prev))
    if (!parent) break
    nodes.unshift(currState.prev)
    segments.unshift(parent.segId)
    currState = { node: currState.prev, prev: parent.prevPrev }
  }

  return {
    found: true,
    nodes,
    segments,
    totalDistance: minTargetDist,
  }
}

/**
 * Explore all reachable nodes and segments from a start node.
 */
export function reachableFrom(
  net: Network,
  startNodeId: NodeId,
  options: PathfindingOptions = {},
): { nodes: Set<NodeId>; segments: Set<SegmentId> } {
  const visitedNodes = new Set<NodeId>()
  const visitedSegments = new Set<SegmentId>()

  if (!net.nodes.has(startNodeId)) {
    return { nodes: visitedNodes, segments: visitedSegments }
  }

  // Queue of { node, prev }
  const queue: Array<{ node: NodeId; prev: NodeId | null }> = [{ node: startNodeId, prev: null }]
  const visitedStates = new Set<string>()
  const stateKey = (node: NodeId, prev: NodeId | null) => `${prev ?? 'START'}->${node}`

  visitedNodes.add(startNodeId)
  visitedStates.add(stateKey(startNodeId, null))

  while (queue.length > 0) {
    const { node, prev } = queue.shift()!
    const segIds = net.adjacency.get(node) ?? []

    for (const sid of segIds) {
      const seg = net.segments.get(sid)
      if (!seg) continue
      const nextNodeId = seg.from === node ? seg.to : seg.from
      if (nextNodeId === prev) continue

      if (!isTransitionAllowed(net, prev, node, nextNodeId, options)) {
        continue
      }

      visitedSegments.add(sid)
      visitedNodes.add(nextNodeId)

      const nKey = stateKey(nextNodeId, node)
      if (!visitedStates.has(nKey)) {
        visitedStates.add(nKey)
        queue.push({ node: nextNodeId, prev: node })
      }
    }
  }

  return { nodes: visitedNodes, segments: visitedSegments }
}

/**
 * Detect all dead-end nodes (impasses / heurtoirs), i.e. nodes with exactly 1 connected segment.
 */
export function detectDeadEnds(net: Network): NodeId[] {
  const deadEnds: NodeId[] = []
  for (const [nodeId, segs] of net.adjacency.entries()) {
    if (segs.length === 1) {
      deadEnds.push(nodeId)
    }
  }
  return deadEnds
}

/**
 * Detect simple cycles / loops in the network.
 * Returns an array of node cycles.
 */
export function detectLoops(net: Network): NodeId[][] {
  const visited = new Set<NodeId>()
  const parent = new Map<NodeId, NodeId | null>()
  const cycles: NodeId[][] = []

  function dfs(curr: NodeId, par: NodeId | null, path: NodeId[]) {
    visited.add(curr)
    parent.set(curr, par)
    path.push(curr)

    const segIds = net.adjacency.get(curr) ?? []
    for (const sid of segIds) {
      const seg = net.segments.get(sid)
      if (!seg) continue
      const neighbor = seg.from === curr ? seg.to : seg.from
      if (neighbor === par) continue

      if (visited.has(neighbor)) {
        // Cycle detected: neighbor is in the current path
        const cycleStartIndex = path.indexOf(neighbor)
        if (cycleStartIndex >= 0) {
          const cycle = path.slice(cycleStartIndex)
          // Avoid duplicate cycles of length 2
          if (cycle.length > 2) {
            // Normalize cycle to avoid permutations
            const minIndex = cycle.indexOf([...cycle].sort()[0])
            const normalized = [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)]
            const key = normalized.join(',')
            const exists = cycles.some((c) => {
              const cMin = c.indexOf([...c].sort()[0])
              const cNorm = [...c.slice(cMin), ...c.slice(0, cMin)]
              return cNorm.join(',') === key
            })
            if (!exists) {
              cycles.push(cycle)
            }
          }
        }
      } else {
        dfs(neighbor, curr, [...path])
      }
    }
  }

  for (const nodeId of net.nodes.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId, null, [])
    }
  }

  return cycles
}

/**
 * Detect connected components (isolated track networks / orphan segments).
 */
export function detectConnectedComponents(
  net: Network,
): Array<{ nodes: Set<NodeId>; segments: Set<SegmentId> }> {
  const visited = new Set<NodeId>()
  const components: Array<{ nodes: Set<NodeId>; segments: Set<SegmentId> }> = []

  for (const startId of net.nodes.keys()) {
    if (visited.has(startId)) continue

    const compNodes = new Set<NodeId>()
    const compSegs = new Set<SegmentId>()
    const queue = [startId]
    visited.add(startId)

    while (queue.length > 0) {
      const curr = queue.shift()!
      compNodes.add(curr)

      const segIds = net.adjacency.get(curr) ?? []
      for (const sid of segIds) {
        compSegs.add(sid)
        const seg = net.segments.get(sid)
        if (!seg) continue
        const other = seg.from === curr ? seg.to : seg.from
        if (!visited.has(other)) {
          visited.add(other)
          queue.push(other)
        }
      }
    }

    components.push({ nodes: compNodes, segments: compSegs })
  }

  return components
}
