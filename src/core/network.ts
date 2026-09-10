import type { Network, NodeId, Point, RailNode, Segment, SegmentId } from './types'
import { distToCurve } from './curve'

let idCounter = 0

export function generateId(prefix: string): string {
  idCounter++
  return `${prefix}_${idCounter}`
}

export function createNetwork(): Network {
  return { nodes: new Map(), segments: new Map(), adjacency: new Map() }
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

export function removeSegment(net: Network, id: SegmentId): void {
  const seg = net.segments.get(id)
  if (!seg) return
  const a = net.adjacency.get(seg.from)
  if (a) {
    const idx = a.indexOf(id)
    if (idx >= 0) a.splice(idx, 1)
  }
  const b = net.adjacency.get(seg.to)
  if (b) {
    const idx = b.indexOf(id)
    if (idx >= 0) b.splice(idx, 1)
  }
  net.segments.delete(id)
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
