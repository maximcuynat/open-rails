import type { Network, NodeId, Point, Segment, SegmentId } from '../models/types'
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
 *
 * A depth-first walk of the track from each node not reached yet: a rail that leads back to a node
 * of the way come by closes a loop, which is that stretch of the way. The walk keeps its own stack
 * (a line can be thousands of nodes long) and the way as one list with the place of each node in
 * it, so that its cost follows the size of the network and of the loops it returns.
 */
export function detectLoops(net: Network): NodeId[][] {
  const visited = new Set<NodeId>()
  const cycles: NodeId[][] = []
  /** The way from the start of the walk to the node it is at, and where each of its nodes is in it */
  const path: NodeId[] = []
  const placeInPath = new Map<NodeId, number>()
  /**
   * Loops already found, by the two nodes their closing rail joins: the way between two nodes of
   * the walk is the only one, so two loops are the same exactly when they close between the same
   * two nodes (two rails laid between them).
   */
  const found = new Set<string>()

  interface Step {
    node: NodeId
    par: NodeId | null
    segIds: SegmentId[]
    next: number
  }
  const enter = (node: NodeId, par: NodeId | null): Step => {
    visited.add(node)
    placeInPath.set(node, path.length)
    path.push(node)
    return { node, par, segIds: net.adjacency.get(node) ?? [], next: 0 }
  }

  for (const startId of net.nodes.keys()) {
    if (visited.has(startId)) continue
    const stack: Step[] = [enter(startId, null)]
    while (stack.length > 0) {
      const step = stack[stack.length - 1]
      if (step.next >= step.segIds.length) {
        stack.pop()
        path.pop()
        placeInPath.delete(step.node)
        continue
      }
      const seg = net.segments.get(step.segIds[step.next++])
      if (!seg) continue
      const curr = step.node
      const neighbor = seg.from === curr ? seg.to : seg.from
      if (neighbor === step.par) continue

      if (!visited.has(neighbor)) {
        stack.push(enter(neighbor, curr))
        continue
      }
      // Cycle detected when the neighbor is on the way come by
      const cycleStartIndex = placeInPath.get(neighbor)
      if (cycleStartIndex === undefined) continue
      // Avoid duplicate cycles of length 2
      if (path.length - cycleStartIndex <= 2) continue
      const key = `${neighbor}>${curr}`
      if (found.has(key)) continue
      found.add(key)
      cycles.push(path.slice(cycleStartIndex))
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

    // Read in order without taking its head off: a component can be the whole network
    for (let head = 0; head < queue.length; head++) {
      const curr = queue[head]
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
