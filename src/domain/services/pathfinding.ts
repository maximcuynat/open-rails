import type { Network, NodeId, Segment, SegmentId } from '../models/types'
import { segmentShapeLength } from '../geometry/segmentGeometry'
import { isPassageOpen, isRailClosedAt } from '../models/routing'
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

/** Length of a rail along its track, in world metres */
export function segmentLength(net: Network, seg: Segment): number {
  return segmentShapeLength(net, seg)
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

/** The rails a transition runs on, for callers that know them (two rails may join the same two nodes). */
export interface TransitionRails {
  inSegId?: SegmentId
  outSegId?: SegmentId
}

/**
 * Check if transition prev -> curr -> next is allowed under junction switch, crossing and traffic settings.
 * `rails` names the segment arrived on and the segment left on; without it they are looked up by
 * node pair, which is ambiguous when two rails join the same two nodes (a curve crossing a track twice).
 */
export function isTransitionAllowed(
  net: Network,
  prevNodeId: NodeId | null,
  currNodeId: NodeId,
  nextNodeId: NodeId,
  options: PathfindingOptions = {},
  rails: TransitionRails = {},
): boolean {
  const respectSwitches = options.respectSwitches ?? true
  const enforceCrossings = options.enforceCrossings ?? true
  const inSeg = rails.inSegId
    ? net.segments.get(rails.inSegId)
    : prevNodeId !== null
      ? getSegmentBetween(net, prevNodeId, currNodeId)
      : undefined
  const outSeg = rails.outSegId ? net.segments.get(rails.outSegId) : getSegmentBetween(net, currNodeId, nextNodeId)

  // 1. Passage through the node: route table, straightest continuation, deflection limit
  if (inSeg && outSeg) {
    const query = { anyPosition: !respectSwitches, anyContinuation: !enforceCrossings }
    if (!isPassageOpen(net, currNodeId, inSeg.id, outSeg.id, query)) return false
  } else if (outSeg && respectSwitches && isRailClosedAt(net, outSeg.id, currNodeId)) {
    // Starting from the node itself: a rail its points are set against cannot be taken
    return false
  }

  // 2. Traffic direction constraints (Sens unique / circulation)
  if (options.sectionMeta) {
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

  // Search state: a node and the rail it was reached by (two rails may join the same two nodes)
  interface PQItem {
    node: NodeId
    prev: NodeId | null
    inSeg: SegmentId | null
    dist: number
  }

  const distMap = new Map<string, number>()
  const parentMap = new Map<string, PQItem>()
  const pq: PQItem[] = [{ node: startNodeId, prev: null, inSeg: null, dist: 0 }]
  const key = (node: NodeId, inSeg: SegmentId | null) => `${inSeg ?? 'START'}->${node}`
  distMap.set(key(startNodeId, null), 0)

  let bestTargetState: PQItem | null = null

  while (pq.length > 0) {
    // Pop min
    pq.sort((a, b) => a.dist - b.dist)
    const current = pq.shift()!

    if (current.dist > (distMap.get(key(current.node, current.inSeg)) ?? Infinity)) {
      continue
    }

    if (current.node === targetNodeId) {
      bestTargetState = current
      break // First target arrival in Dijkstra is optimal
    }

    const segIds = net.adjacency.get(current.node) ?? []
    for (const sid of segIds) {
      const seg = net.segments.get(sid)
      if (!seg) continue
      if (sid === current.inSeg) continue // Don't instantly reverse along same track
      const nextNodeId = seg.from === current.node ? seg.to : seg.from

      const rails = { inSegId: current.inSeg ?? undefined, outSegId: sid }
      if (!isTransitionAllowed(net, current.prev, current.node, nextNodeId, options, rails)) {
        continue
      }

      const nextDist = current.dist + segmentLength(net, seg)
      const nextKey = key(nextNodeId, sid)

      if (nextDist < (distMap.get(nextKey) ?? Infinity)) {
        distMap.set(nextKey, nextDist)
        parentMap.set(nextKey, current)
        pq.push({ node: nextNodeId, prev: current.node, inSeg: sid, dist: nextDist })
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

  while (currState.inSeg !== null) {
    const parent = parentMap.get(key(currState.node, currState.inSeg))
    if (!parent) break
    nodes.unshift(parent.node)
    segments.unshift(currState.inSeg)
    currState = parent
  }

  return {
    found: true,
    nodes,
    segments,
    totalDistance: bestTargetState.dist,
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

  // Queue of states: a node and the rail it was reached by
  const queue: Array<{ node: NodeId; prev: NodeId | null; inSeg: SegmentId | null }> = [
    { node: startNodeId, prev: null, inSeg: null },
  ]
  const visitedStates = new Set<string>()
  const stateKey = (node: NodeId, inSeg: SegmentId | null) => `${inSeg ?? 'START'}->${node}`

  visitedNodes.add(startNodeId)
  visitedStates.add(stateKey(startNodeId, null))

  while (queue.length > 0) {
    const { node, prev, inSeg } = queue.shift()!
    const segIds = net.adjacency.get(node) ?? []

    for (const sid of segIds) {
      const seg = net.segments.get(sid)
      if (!seg) continue
      if (sid === inSeg) continue
      const nextNodeId = seg.from === node ? seg.to : seg.from

      if (!isTransitionAllowed(net, prev, node, nextNodeId, options, { inSegId: inSeg ?? undefined, outSegId: sid })) {
        continue
      }

      visitedSegments.add(sid)
      visitedNodes.add(nextNodeId)

      const nKey = stateKey(nextNodeId, sid)
      if (!visitedStates.has(nKey)) {
        visitedStates.add(nKey)
        queue.push({ node: nextNodeId, prev: node, inSeg: sid })
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
