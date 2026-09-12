import type { Network, NodeId, Point, Segment, SegmentId } from './types'

export interface PathResult {
  found: boolean
  nodes: NodeId[]
  segments: SegmentId[]
  totalDistance: number
}

export interface PathfindingOptions {
  /** Respect switch directions (default: true). If false, all branches can be traversed. */
  respectSwitches?: boolean
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

/** Check if transition prev -> curr -> next is allowed under junction switch settings. */
export function isTransitionAllowed(
  net: Network,
  prevNodeId: NodeId | null,
  currNodeId: NodeId,
  nextNodeId: NodeId,
  respectSwitches = true,
): boolean {
  if (!respectSwitches) return true

  // Check if currNode is apex of any junction
  for (const junc of net.junctions.values()) {
    if (junc.nodeId === currNodeId) {
      const activeBranchNode = junc.activeBranch === 'straight' ? junc.straightNodeId : junc.divergingNodeId
      const inactiveBranchNode = junc.activeBranch === 'straight' ? junc.divergingNodeId : junc.straightNodeId

      // 1. Cannot exit toward inactive branch
      if (nextNodeId === inactiveBranchNode) {
        return false
      }

      // 2. Cannot enter from inactive branch into apex (trailing point set against)
      if (prevNodeId === inactiveBranchNode) {
        return false
      }

      // 3. If entering from stem, must exit via active branch
      if (junc.stemNodeId && prevNodeId === junc.stemNodeId) {
        if (nextNodeId !== activeBranchNode) {
          return false
        }
      }

      // 4. If entering from active branch, must exit toward stem if defined
      if (junc.stemNodeId && prevNodeId === activeBranchNode) {
        if (nextNodeId !== junc.stemNodeId) {
          return false
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
  const respect = options.respectSwitches ?? true

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

      if (!isTransitionAllowed(net, current.prev, current.node, nextNodeId, respect)) {
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
  const respect = options.respectSwitches ?? true
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

      if (!isTransitionAllowed(net, prev, node, nextNodeId, respect)) {
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
