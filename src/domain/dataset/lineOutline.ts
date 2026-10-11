import { segmentShapeLength } from '../geometry/segmentGeometry'
import { positionOnSegment } from '../models/locomotive'
import type { Network, NodeId, Point, SegmentId } from '../models/types'

// ─────────────────── A line as a few strokes ───────────────────
//
// What is drawn of a line that is not loaded, and of every line on the mini-map: its course as a
// handful of polylines, one track standing for all those that run beside it. Worked out once,
// when the dataset is generated, and kept in the index.
//
// The longest way through the rails of the line is its trunk; the rails that run within reach of
// a stroke already drawn are covered by it (the other track, the sidings of a station); what is
// left is searched again for its own longest way — a branch — until nothing long enough remains.

export interface OutlineOptions {
  /** A stroke strays this far (m) at most from the track it follows */
  tolerance?: number
  /** Rails within this distance (m) of a stroke are covered by it */
  cover?: number
  /** A way shorter than this (m) is not worth a stroke */
  minLength?: number
  maxStrokes?: number
}

const DEFAULTS: Required<OutlineOptions> = { tolerance: 40, cover: 400, minLength: 3000, maxStrokes: 16 }
/** Distance (m) between two points taken along a rail before simplifying: a long rail curves */
const SAMPLE_STEP = 150

interface Edge {
  to: NodeId
  segId: SegmentId
  length: number
}

/** Farthest node from `start` over `graph`, with the way back to `start` */
function farthest(graph: ReadonlyMap<NodeId, Edge[]>, start: NodeId): { node: NodeId; dist: number; prev: Map<NodeId, { from: NodeId; segId: SegmentId }> } {
  const dist = new Map<NodeId, number>([[start, 0]])
  const prev = new Map<NodeId, { from: NodeId; segId: SegmentId }>()
  // A plain queue ordered at each pop would be quadratic: a binary heap on the distance
  const heap: [number, NodeId][] = [[0, start]]
  const push = (item: [number, NodeId]): void => {
    let i = heap.length
    heap.push(item)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent][0] <= item[0]) break
      heap[i] = heap[parent]
      i = parent
    }
    heap[i] = item
  }
  const pop = (): [number, NodeId] => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= heap.length) break
        if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++
        if (heap[child][0] >= last[0]) break
        heap[i] = heap[child]
        i = child
      }
      heap[i] = last
    }
    return top
  }
  let far = start
  let farDist = 0
  while (heap.length > 0) {
    const [d, node] = pop()
    if (d > (dist.get(node) ?? Infinity)) continue
    if (d > farDist) {
      far = node
      farDist = d
    }
    for (const edge of graph.get(node) ?? []) {
      const through = d + edge.length
      if (through < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, through)
        prev.set(edge.to, { from: node, segId: edge.segId })
        push([through, edge.to])
      }
    }
  }
  return { node: far, dist: farDist, prev }
}

/** Douglas–Peucker: the points of `pts` kept so that none left out is further than `tolerance` from the result */
export function simplifyPolyline(pts: readonly Point[], tolerance: number): Point[] {
  if (pts.length <= 2) return [...pts]
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    const ax = pts[a].x
    const ay = pts[a].y
    const dx = pts[b].x - ax
    const dy = pts[b].y - ay
    const span = dx * dx + dy * dy
    let worst = -1
    let worstDist = tolerance * tolerance
    for (let i = a + 1; i < b; i++) {
      const px = pts[i].x - ax
      const py = pts[i].y - ay
      const t = span > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / span)) : 0
      const ex = px - t * dx
      const ey = py - t * dy
      const d = ex * ex + ey * ey
      if (d > worstDist) {
        worst = i
        worstDist = d
      }
    }
    if (worst > 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return pts.filter((_, i) => keep[i] === 1)
}

/**
 * The course of the rails `segIds` of a network as strokes, the longest first: each one a flat
 * list of coordinates `[x0, y0, x1, y1, …]` in metres, rounded to the metre.
 */
export function lineOutline(net: Network, segIds: Iterable<SegmentId>, options: OutlineOptions = {}): number[][] {
  const { tolerance, cover, minLength, maxStrokes } = { ...DEFAULTS, ...options }
  const left = new Set<SegmentId>()
  for (const id of segIds) if (net.segments.has(id)) left.add(id)
  const strokes: number[][] = []

  // The points of the strokes drawn so far, on a grid of `cover`: what is near a stroke
  const cells = new Map<string, Point[]>()
  const cellOf = (v: number): number => Math.floor(v / cover)
  const mark = (p: Point): void => {
    const key = `${cellOf(p.x)},${cellOf(p.y)}`
    const cell = cells.get(key)
    if (cell) cell.push(p)
    else cells.set(key, [p])
  }
  const covered = (p: Point): boolean => {
    const cx = cellOf(p.x)
    const cy = cellOf(p.y)
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (const q of cells.get(`${i},${j}`) ?? []) if (Math.hypot(q.x - p.x, q.y - p.y) <= cover) return true
      }
    }
    return false
  }

  while (left.size > 0 && strokes.length < maxStrokes) {
    const graph = new Map<NodeId, Edge[]>()
    for (const segId of left) {
      const seg = net.segments.get(segId)!
      const length = segmentShapeLength(net, seg)
      for (const [from, to] of [[seg.from, seg.to], [seg.to, seg.from]] as const) {
        const edges = graph.get(from)
        if (edges) edges.push({ to, segId, length })
        else graph.set(from, [{ to, segId, length }])
      }
    }
    // The longest way of each piece (two sweeps: from anywhere to its far end, then from there)
    const seen = new Set<NodeId>()
    let best: { end: NodeId; dist: number; prev: Map<NodeId, { from: NodeId; segId: SegmentId }> } | null = null
    for (const start of graph.keys()) {
      if (seen.has(start)) continue
      const first = farthest(graph, start)
      for (const node of first.prev.keys()) seen.add(node)
      seen.add(start)
      const second = farthest(graph, first.node)
      if (!best || second.dist > best.dist) best = { end: second.node, dist: second.dist, prev: second.prev }
    }
    if (!best || best.dist < minLength) break

    // Its rails from one end to the other, and the points along them
    const way: { segId: SegmentId; from: NodeId }[] = []
    for (let node = best.end; best.prev.has(node); ) {
      const step = best.prev.get(node)!
      way.push({ segId: step.segId, from: step.from })
      node = step.from
    }
    way.reverse()
    const points: Point[] = []
    for (const { segId, from } of way) {
      const seg = net.segments.get(segId)!
      const forward = seg.from === from
      const steps = Math.max(1, Math.ceil(segmentShapeLength(net, seg) / SAMPLE_STEP))
      for (let k = points.length === 0 ? 0 : 1; k <= steps; k++) {
        const t = k / steps
        const p = positionOnSegment(net, segId, forward ? t : 1 - t)
        if (p) points.push(p)
      }
      left.delete(segId)
    }
    for (const p of points) mark(p)
    strokes.push(simplifyPolyline(points, tolerance).flatMap((p) => [Math.round(p.x), Math.round(p.y)]))

    // What runs beside it is drawn by it
    for (const segId of [...left]) {
      const seg = net.segments.get(segId)!
      const a = net.nodes.get(seg.from)?.pos
      const b = net.nodes.get(seg.to)?.pos
      if (a && b && covered(a) && covered(b)) left.delete(segId)
    }
  }
  return strokes
}

/** Strokes as an index holds them, or nothing when what is there is not that */
export function readOutline(raw: unknown): number[][] | undefined {
  if (!Array.isArray(raw)) return undefined
  const strokes: number[][] = []
  for (const stroke of raw as unknown[]) {
    if (!Array.isArray(stroke) || stroke.length < 4 || stroke.length % 2 !== 0 || !stroke.every((v) => typeof v === 'number' && Number.isFinite(v))) return undefined
    strokes.push(stroke as number[])
  }
  return strokes
}
