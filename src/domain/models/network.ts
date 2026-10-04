import type { Network, NodeId, Point, RailNode, Segment, SegmentId } from './types'
import { distToCurve, splitCurveIntoArcPieces, type CurvePiece } from '../geometry/curve'

let idCounter = 0

export function resetIdCounter(startFrom = 0): void {
  idCounter = startFrom
}

export function generateId(prefix: string): string {
  idCounter++
  return `${prefix}_${idCounter}`
}

/**
 * Scan all node, segment, and junction IDs in the network and update
 * idCounter so that any future generateId calls will not collide.
 */
export function syncIdCounter(net: Network): void {
  let max = 0
  const scan = (id: string) => {
    const match = id.match(/_(\d+)$/)
    if (match) {
      const n = parseInt(match[1], 10)
      if (!Number.isNaN(n) && n > max) max = n
    }
  }
  for (const id of net.nodes.keys()) scan(id)
  for (const id of net.segments.keys()) scan(id)
  for (const id of net.junctions.keys()) scan(id)
  resetIdCounter(max)
}

export function createNetwork(): Network {
  return { nodes: new Map(), segments: new Map(), adjacency: new Map(), junctions: new Map() }
}

export function addNode(net: Network, pos: Point): RailNode {
  const node: RailNode = { id: generateId('n'), pos: { ...pos } }
  net.nodes.set(node.id, node)
  net.adjacency.set(node.id, [])
  return node
}

export function addSegment(net: Network, from: NodeId, to: NodeId): Segment | null {
  if (from === to) return null
  if (!net.nodes.has(from) || !net.nodes.has(to)) return null
  const seg: Segment = { id: generateId('s'), from, to, kind: 'straight' }
  net.segments.set(seg.id, seg)
  net.adjacency.get(from)!.push(seg.id)
  net.adjacency.get(to)!.push(seg.id)
  return seg
}

export function addCurveSegment(
  net: Network,
  from: NodeId,
  to: NodeId,
  via: Point,
): Segment | null {
  if (from === to) return null
  if (!net.nodes.has(from) || !net.nodes.has(to)) return null
  const seg: Segment = { id: generateId('s'), from, to, kind: 'curve', via: { ...via } }
  net.segments.set(seg.id, seg)
  net.adjacency.get(from)!.push(seg.id)
  net.adjacency.get(to)!.push(seg.id)
  return seg
}

/**
 * Insert a chain of curve pieces between two existing nodes, creating one intermediate node
 * per joint. The first piece starts at `from`, the last one ends at `to`.
 */
export function addCurveChain(
  net: Network,
  from: NodeId,
  to: NodeId,
  pieces: CurvePiece[],
): { segments: Segment[]; nodes: RailNode[] } | null {
  if (from === to || pieces.length === 0) return null
  if (!net.nodes.has(from) || !net.nodes.has(to)) return null
  const segments: Segment[] = []
  const nodes: RailNode[] = []
  let prevId = from
  for (let i = 0; i < pieces.length; i++) {
    const isLast = i === pieces.length - 1
    const nextId = isLast ? to : addNode(net, pieces[i].end).id
    if (!isLast) nodes.push(net.nodes.get(nextId)!)
    const seg = addCurveSegment(net, prevId, nextId, pieces[i].via)
    if (seg) segments.push(seg)
    prevId = nextId
  }
  return { segments, nodes }
}

/**
 * Add a user-placed curve between two existing nodes as a true circular arc:
 * the curve is cut into pieces of bounded deflection (see splitCurveIntoArcPieces).
 */
export function addArcCurve(
  net: Network,
  from: NodeId,
  to: NodeId,
  via: Point,
): { segments: Segment[]; nodes: RailNode[] } | null {
  const a = net.nodes.get(from)
  const b = net.nodes.get(to)
  if (!a || !b) return null
  return addCurveChain(net, from, to, splitCurveIntoArcPieces(a.pos, via, b.pos))
}

export function removeNode(net: Network, id: NodeId): void {
  const segs = net.adjacency.get(id)
  if (segs) {
    for (const sid of segs) {
      const seg = net.segments.get(sid)
      net.segments.delete(sid)
      if (seg) {
        const otherId = seg.from === id ? seg.to : seg.from
        const adj = net.adjacency.get(otherId)
        if (adj) {
          const idx = adj.indexOf(sid)
          if (idx >= 0) adj.splice(idx, 1)
        }
      }
    }
  }
  net.nodes.delete(id)
  net.adjacency.delete(id)
}

/**
 * Dissolve an intermediate degree-2 node aligned between two straight segments.
 * Removes the intermediate node and replaces the two collinear straight segments
 * with a single continuous straight segment connecting the outer endpoints directly.
 * Returns the newly created segment if dissolved, or null if the node cannot be dissolved.
 */
export function dissolveNode(
  net: Network,
  id: NodeId,
  maxDeflectionDeg = 25,
): Segment | null {
  const node = net.nodes.get(id)
  if (!node) return null

  const adj = net.adjacency.get(id)
  if (!adj || adj.length !== 2) return null

  const s1 = net.segments.get(adj[0])
  const s2 = net.segments.get(adj[1])
  if (!s1 || !s2) return null

  // Both segments must be straight
  if (s1.kind !== 'straight' || s2.kind !== 'straight') return null

  const otherId1 = s1.from === id ? s1.to : s1.from
  const otherId2 = s2.from === id ? s2.to : s2.from
  if (otherId1 === otherId2) return null // No self-loops

  const node1 = net.nodes.get(otherId1)
  const node2 = net.nodes.get(otherId2)
  if (!node1 || !node2) return null

  // Direction vectors pointing away from id towards outer endpoints
  const v1x = node1.pos.x - node.pos.x
  const v1y = node1.pos.y - node.pos.y
  const len1 = Math.hypot(v1x, v1y)

  const v2x = node2.pos.x - node.pos.x
  const v2y = node2.pos.y - node.pos.y
  const len2 = Math.hypot(v2x, v2y)

  if (len1 < 1e-4 || len2 < 1e-4) return null

  // Normalized dot product
  const dot = (v1x * v2x + v1y * v2y) / (len1 * len2)

  // For aligned segments (straight line), v1 and v2 point in opposite directions (dot ≈ -1.0)
  // Max deflection threshold: -cos(maxDeflectionDeg)
  const threshold = -Math.cos((maxDeflectionDeg * Math.PI) / 180)
  if (dot > threshold) {
    // Segments are not aligned as a straight line
    return null
  }

  // Preserve parent segment heritage
  const parentId = s1.parentSegmentId ?? s2.parentSegmentId ?? s1.id

  // Remove the two segments without cleaning orphans
  removeSegment(net, s1.id, false)
  removeSegment(net, s2.id, false)

  // Remove the intermediate node
  net.nodes.delete(id)
  net.adjacency.delete(id)

  // Connect node1 and node2 directly with a straight segment
  const newSeg = addSegment(net, otherId1, otherId2)
  if (newSeg) {
    newSeg.parentSegmentId = parentId

    // Update any junctions that were referencing s1 or s2
    for (const junc of net.junctions.values()) {
      if (junc.straightSegmentId === s1.id || junc.straightSegmentId === s2.id) {
        junc.straightSegmentId = newSeg.id
        junc.straightNodeId = otherId1 === junc.nodeId ? otherId2 : otherId1
      }
      if (junc.divergingSegmentId === s1.id || junc.divergingSegmentId === s2.id) {
        junc.divergingSegmentId = newSeg.id
        junc.divergingNodeId = otherId1 === junc.nodeId ? otherId2 : otherId1
      }
      if (junc.stemNodeId === id) {
        junc.stemNodeId = otherId1 === junc.nodeId ? otherId2 : otherId1
      }
    }
  }

  return newSeg
}

export function removeSegment(net: Network, id: SegmentId, cleanOrphans = true): void {
  const seg = net.segments.get(id)
  if (!seg) return
  const fromId = seg.from
  const toId = seg.to

  const a = net.adjacency.get(fromId)
  if (a) {
    const idx = a.indexOf(id)
    if (idx >= 0) a.splice(idx, 1)
  }
  const b = net.adjacency.get(toId)
  if (b) {
    const idx = b.indexOf(id)
    if (idx >= 0) b.splice(idx, 1)
  }
  net.segments.delete(id)

  if (cleanOrphans) {
    const adjA = net.adjacency.get(fromId)
    if (adjA && adjA.length === 0) {
      net.nodes.delete(fromId)
      net.adjacency.delete(fromId)
    }
    const adjB = net.adjacency.get(toId)
    if (adjB && adjB.length === 0) {
      net.nodes.delete(toId)
      net.adjacency.delete(toId)
    }
  }
}

/**
 * Remove all orphan nodes (nodes with 0 connected segments) from the network.
 * Optionally preserve a whitelist of active node IDs.
 */
export function pruneOrphanNodes(
  net: Network,
  preserveNodeIds?: Set<NodeId> | Array<NodeId>,
): number {
  const preserve = preserveNodeIds ? new Set(preserveNodeIds) : null
  let pruned = 0
  for (const [nid, adj] of net.adjacency) {
    if (adj.length === 0 && (!preserve || !preserve.has(nid))) {
      net.nodes.delete(nid)
      net.adjacency.delete(nid)
      pruned++
    }
  }
  // Also clean up any node in net.nodes that has no adjacency entry
  for (const nid of net.nodes.keys()) {
    if (!net.adjacency.has(nid) && (!preserve || !preserve.has(nid))) {
      net.nodes.delete(nid)
      pruned++
    }
  }
  return pruned
}

/** Snap a point to the nearest grid intersection. */
export function snapToGrid(pos: Point, spacing: number): Point {
  if (spacing <= 0) return pos
  return {
    x: Math.round(pos.x / spacing) * spacing,
    y: Math.round(pos.y / spacing) * spacing,
  }
}

/** Euclidean distance between two points. */
export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Distance from point p to segment [a, b] (clamped to segment). */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

/** Find the closest node to a point within a max radius. */
export function hitNode(net: Network, pos: Point, maxDist: number): NodeId | null {
  let best: NodeId | null = null
  let bestD = maxDist
  for (const node of net.nodes.values()) {
    const d = dist(pos, node.pos)
    if (d < bestD) {
      bestD = d
      best = node.id
    }
  }
  return best
}

/** Find the closest segment to a point within a max distance. */
export function hitSegment(net: Network, pos: Point, maxDist: number): SegmentId | null {
  let best: SegmentId | null = null
  let bestD = maxDist
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) continue
    const d =
      seg.kind === 'curve' && seg.via
        ? distToCurve(pos, a.pos, seg.via, b.pos)
        : distToSegment(pos, a.pos, b.pos)
    if (d < bestD) {
      bestD = d
      best = seg.id
    }
  }
  return best
}

/**
 * Compute evenly-spaced step positions along a straight or curved segment
 * at the given spacing (metres). Returns the list of world-space points and
 * the closest one to the cursor, for snap-on-track interaction.
 */
export function getStepPointsAlongSegment(
  segId: SegmentId,
  net: Network,
  spacing: number,
  cursorPos: Point,
  margin = 0.2,
): { points: Point[]; nearest: Point | null; nearestT: number } {
  const seg = net.segments.get(segId)
  if (!seg || spacing <= 0) return { points: [], nearest: null, nearestT: 0 }
  const a = net.nodes.get(seg.from)
  const b = net.nodes.get(seg.to)
  if (!a || !b) return { points: [], nearest: null, nearestT: 0 }

  const points: Point[] = []
  const tSet = new Set<number>()

  if (seg.kind === 'straight') {
    const dx = b.pos.x - a.pos.x
    const dy = b.pos.y - a.pos.y
    const len = Math.hypot(dx, dy)
    if (len < margin) return { points: [], nearest: null, nearestT: 0 }

    // 1. Regular metric increments along the segment from Node A
    const count = Math.floor((len - margin) / spacing)
    for (let i = 1; i <= count; i++) {
      const t = (i * spacing) / len
      if (t > 0.01 && t < 0.99) tSet.add(t)
    }

    // 2. Regular metric increments along the segment from Node B
    for (let i = 1; i <= count; i++) {
      const t = 1 - (i * spacing) / len
      if (t > 0.01 && t < 0.99) tSet.add(t)
    }

    // 3. Grid line intersections (X coordinate = k * spacing)
    if (Math.abs(dx) > 1e-4) {
      const minX = Math.min(a.pos.x, b.pos.x)
      const maxX = Math.max(a.pos.x, b.pos.x)
      const kMin = Math.ceil((minX + margin / 2) / spacing)
      const kMax = Math.floor((maxX - margin / 2) / spacing)
      for (let k = kMin; k <= kMax; k++) {
        const gx = k * spacing
        const t = (gx - a.pos.x) / dx
        if (t > 0.01 && t < 0.99) tSet.add(t)
      }
    }

    // 4. Grid line intersections (Y coordinate = m * spacing)
    if (Math.abs(dy) > 1e-4) {
      const minY = Math.min(a.pos.y, b.pos.y)
      const maxY = Math.max(a.pos.y, b.pos.y)
      const mMin = Math.ceil((minY + margin / 2) / spacing)
      const mMax = Math.floor((maxY - margin / 2) / spacing)
      for (let m = mMin; m <= mMax; m++) {
        const gy = m * spacing
        const t = (gy - a.pos.y) / dy
        if (t > 0.01 && t < 0.99) tSet.add(t)
      }
    }

    // 5. Projected cursor position rounded to nearest spacing or integer
    const projT = ((cursorPos.x - a.pos.x) * dx + (cursorPos.y - a.pos.y) * dy) / (len * len)
    const projDist = projT * len
    const roundedDist = Math.round(projDist / spacing) * spacing
    const roundedT = roundedDist / len
    if (roundedT > 0.01 && roundedT < 0.99) tSet.add(roundedT)

    const sortedT = Array.from(tSet).sort((u, v) => u - v)
    for (const t of sortedT) {
      let px = a.pos.x + t * dx
      let py = a.pos.y + t * dy
      if (Math.abs(Math.round(px) - px) < 1e-3) px = Math.round(px)
      if (Math.abs(Math.round(py) - py) < 1e-3) py = Math.round(py)
      const pt = { x: px, y: py }
      if (!points.some((existing) => Math.hypot(existing.x - pt.x, existing.y - pt.y) < Math.min(margin, spacing * 0.1))) {
        points.push(pt)
      }
    }
  } else if (seg.kind === 'curve' && seg.via) {
    const p0 = a.pos
    const p1 = seg.via
    const p2 = b.pos
    const SUBDIV = 64
    const cumDist: number[] = [0]
    let totalLen = 0
    let prev = p0
    for (let i = 1; i <= SUBDIV; i++) {
      const t = i / SUBDIV
      const mt = 1 - t
      const px = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x
      const py = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
      totalLen += Math.hypot(px - prev.x, py - prev.y)
      cumDist.push(totalLen)
      prev = { x: px, y: py }
    }

    if (totalLen >= margin) {
      const count = Math.floor((totalLen - margin) / spacing)
      for (let s = 1; s <= count; s++) {
        const targetDist = s * spacing
        let idx = 0
        while (idx < SUBDIV && cumDist[idx + 1] < targetDist) idx++
        const segLen = cumDist[idx + 1] - cumDist[idx]
        const frac = segLen > 0 ? (targetDist - cumDist[idx]) / segLen : 0
        const t = (idx + frac) / SUBDIV
        if (t > 0.01 && t < 0.99) tSet.add(t)
      }

      const sortedT = Array.from(tSet).sort((u, v) => u - v)
      for (const t of sortedT) {
        const mt = 1 - t
        let px = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x
        let py = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
        if (Math.abs(Math.round(px) - px) < 1e-3) px = Math.round(px)
        if (Math.abs(Math.round(py) - py) < 1e-3) py = Math.round(py)
        const pt = { x: px, y: py }
        if (!points.some((existing) => Math.hypot(existing.x - pt.x, existing.y - pt.y) < Math.min(margin, spacing * 0.1))) {
          points.push(pt)
        }
      }
    }
  }

  let nearest: Point | null = null
  let nearestDist = Infinity
  let nearestT = 0.5

  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i].x - cursorPos.x, points[i].y - cursorPos.y)
    if (d < nearestDist) {
      nearestDist = d
      nearest = points[i]
    }
  }

  if (nearest) {
    if (seg.kind === 'straight') {
      const dx = b.pos.x - a.pos.x
      const dy = b.pos.y - a.pos.y
      const lenSq = dx * dx + dy * dy
      nearestT = lenSq > 0 ? ((nearest.x - a.pos.x) * dx + (nearest.y - a.pos.y) * dy) / lenSq : 0.5
    } else {
      const p0 = a.pos
      const p1 = seg.via!
      const p2 = b.pos
      let bestDist = Infinity
      for (let s = 1; s < 64; s++) {
        const t = s / 64
        const mt = 1 - t
        const px = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x
        const py = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
        const d = Math.hypot(px - nearest.x, py - nearest.y)
        if (d < bestDist) {
          bestDist = d
          nearestT = t
        }
      }
    }
  }

  return { points, nearest, nearestT }
}
