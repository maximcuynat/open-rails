import type { Network, NodeId, Point, Segment, SegmentId } from '../models/types'
import { bezierPoint, closestCurveParam } from '../geometry/curve'
import { findSegmentCrossings, isSiblingBranch, splitSegmentAtNode } from '../geometry/reconcile'
import { weldNodes } from '../models/junction'
import { addNode, isRamp, levelsMeet, nodeLevel, segmentHeightAt } from '../models/network'
import { Grid } from './osmCrossings'

// What the editor would do to a network when it opens it (`reconcileNetworkIntersections`), found
// the same way but through a grid, so that a network of thousands of rails is checked in a pass:
// two tracks crossing at the same height (it would cut both and make a level crossing), a node
// lying on a rail it does not belong to (it would cut the rail there), two nodes at one place (it
// would weld them). An imported network must give it none of these. The crossings of two tracks at
// different heights are counted on the way: those are the bridges and the tunnels.

/** Side (m) of the cells the rails are sorted into */
const CELL = 20

export type Contact =
  | { kind: 'cross'; point: Point; segA: SegmentId; segB: SegmentId; tA: number; tB: number }
  | { kind: 'split'; point: Point; nodeId: NodeId; segId: SegmentId; dist: number }
  | { kind: 'weld'; point: Point; nodeId: NodeId; otherNodeId: NodeId; dist: number }

export interface NetworkCheck {
  /** Crossings of two rails that share no node and pass at different heights */
  stacked: number
  contacts: Contact[]
}

interface Boxed {
  seg: Segment
  a: Point
  b: Point
  /** The points the rail lies between: its two ends, and its control point when it is a curve */
  hull: Point[]
  index: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * True when a line separates two rails, each given by the points it lies between: they cannot
 * cross. Most rails that share a cell run side by side, and are set aside here.
 */
function hullsApart(one: Point[], two: Point[]): boolean {
  for (const [hull, other] of [[one, two], [two, one]]) {
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i]
      const q = hull[(i + 1) % hull.length]
      const nx = q.y - p.y
      const ny = p.x - q.x
      // On which side of this edge the rest of the hull lies (none for a straight rail)
      let own = 0
      for (const r of hull) {
        const side = (r.x - p.x) * nx + (r.y - p.y) * ny
        if (Math.abs(side) > Math.abs(own)) own = side
      }
      const eps = 1e-9
      let below = true
      let above = true
      for (const r of other) {
        const side = (r.x - p.x) * nx + (r.y - p.y) * ny
        if (side >= -eps) below = false
        if (side <= eps) above = false
      }
      if ((below && own >= -eps) || (above && own <= eps)) return true
    }
  }
  return false
}

/**
 * True when two rails out of a shared node lie on either side of a line through that node: they
 * meet there and nowhere else. This is every pair of rails that follow each other along a track.
 */
function partAtSharedNode(s1: Segment, hull1: Point[], s2: Segment, hull2: Point[]): boolean {
  const shared = s1.from === s2.from || s1.from === s2.to ? hull1[0] : hull1[hull1.length - 1]
  const away = (hull: Point[]): Point[] => hull.filter((p) => p !== shared && (p.x !== shared.x || p.y !== shared.y)).map((p) => ({ x: p.x - shared.x, y: p.y - shared.y }))
  const one = away(hull1)
  const two = away(hull2)
  // A rail that comes back to the shared node (a loop of two rails) is not judged here
  if (one.length !== hull1.length - 1 || two.length !== hull2.length - 1) return false
  for (const d of [...one, ...two]) {
    for (const n of [d, { x: -d.y, y: d.x }]) {
      const sides = (points: Point[]): number => {
        let low = Infinity
        let high = -Infinity
        for (const p of points) {
          const side = p.x * n.x + p.y * n.y
          low = Math.min(low, side)
          high = Math.max(high, side)
        }
        return low > 0 ? 1 : high < 0 ? -1 : 0
      }
      const side = sides(one)
      if (side !== 0 && sides(two) === -side) return true
    }
  }
  return false
}

/**
 * Check a network with the tolerance of the editor (`tolerance`, m). A larger one finds the places
 * that are only close to being one of the three cases.
 */
export function checkNetwork(net: Network, tolerance = 0.1): NetworkCheck {
  const grid = new Grid<Boxed>(CELL)
  const boxes: Boxed[] = []
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)?.pos
    const b = net.nodes.get(seg.to)?.pos
    if (!a || !b) continue
    // A curve lies inside the box of its control points
    const xs = seg.via ? [a.x, b.x, seg.via.x] : [a.x, b.x]
    const ys = seg.via ? [a.y, b.y, seg.via.y] : [a.y, b.y]
    const box: Boxed = { seg, a, b, hull: seg.via ? [a, seg.via, b] : [a, b], index: boxes.length, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    boxes.push(box)
    // A long rail is entered piece by piece, so that it does not fill the cells of its whole box
    const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / CELL))
    const bulge = seg.via ? Math.hypot(seg.via.x - (a.x + b.x) / 2, seg.via.y - (a.y + b.y) / 2) / pieces : 0
    const margin = tolerance + bulge
    let from = a
    for (let i = 1; i <= pieces; i++) {
      const to = i === pieces ? b : seg.via ? bezierPoint(i / pieces, a, seg.via, b) : { x: a.x + ((b.x - a.x) * i) / pieces, y: a.y + ((b.y - a.y) * i) / pieces }
      grid.insert(Math.min(from.x, to.x) - margin, Math.min(from.y, to.y) - margin, Math.max(from.x, to.x) + margin, Math.max(from.y, to.y) + margin, box)
      from = to
    }
  }

  let stacked = 0
  const contacts: Contact[] = []

  for (const node of net.nodes.values()) {
    const lone = (net.adjacency.get(node.id) ?? []).length === 0
    const height = nodeLevel(node)
    const meets = (other: number): boolean => lone || levelsMeet(height, other)
    const welded = new Set<NodeId>()
    for (const { seg, a, b, minX, minY, maxX, maxY } of grid.at(node.pos.x, node.pos.y)) {
      if (node.pos.x < minX - tolerance || node.pos.x > maxX + tolerance || node.pos.y < minY - tolerance || node.pos.y > maxY + tolerance) continue
      if (seg.from === node.id || seg.to === node.id) continue
      // Branches out of a shared node do not cut or weld each other: asked last, it is the dearest test
      const sibling = (): boolean => isSiblingBranch(net, node, seg)
      const ends: [NodeId, Point][] = [[seg.from, a], [seg.to, b]]
      let atEnd = false
      for (const [endId, end] of ends) {
        const dist = Math.hypot(node.pos.x - end.x, node.pos.y - end.y)
        if (dist > tolerance) continue
        atEnd = true
        // Each pair of nodes once, whichever of the two finds the other
        if (meets(nodeLevel(net.nodes.get(endId))) && node.id < endId && !welded.has(endId) && !sibling()) {
          welded.add(endId)
          contacts.push({ kind: 'weld', point: node.pos, nodeId: node.id, otherNodeId: endId, dist })
        }
        break
      }
      if (atEnd) continue

      const dx = b.x - a.x
      const dy = b.y - a.y
      const lenSq = dx * dx + dy * dy
      if (seg.kind === 'curve' && seg.via) {
        // The curve lies between its chord and its control point: a node further than that from the chord is clear of it
        if (lenSq > 1e-12) {
          const chord = Math.sqrt(lenSq)
          const off = Math.abs(dx * (node.pos.y - a.y) - dy * (node.pos.x - a.x)) / chord
          const bulge = Math.abs(dx * (seg.via.y - a.y) - dy * (seg.via.x - a.x)) / chord
          if (off > bulge + tolerance) continue
        }
        const t = closestCurveParam(node.pos, a, seg.via, b)
        const on = bezierPoint(t, a, seg.via, b)
        const dist = Math.hypot(on.x - node.pos.x, on.y - node.pos.y)
        if (t > 0.01 && t < 0.99 && dist <= tolerance && meets(segmentHeightAt(net, seg, t)) && !sibling()) {
          contacts.push({ kind: 'split', point: node.pos, nodeId: node.id, segId: seg.id, dist })
        }
      } else {
        if (lenSq < 1e-4) continue
        const t = ((node.pos.x - a.x) * dx + (node.pos.y - a.y) * dy) / lenSq
        if (t <= 0.005 || t >= 0.995) continue
        const dist = Math.hypot(node.pos.x - (a.x + t * dx), node.pos.y - (a.y + t * dy))
        if (dist <= tolerance && meets(segmentHeightAt(net, seg, t)) && !sibling()) {
          contacts.push({ kind: 'split', point: node.pos, nodeId: node.id, segId: seg.id, dist })
        }
      }
    }
  }

  for (const one of boxes) {
    for (const two of grid.query(one.minX, one.minY, one.maxX, one.maxY)) {
      if (two.index <= one.index) continue
      if (one.maxX < two.minX || one.minX > two.maxX || one.maxY < two.minY || one.minY > two.maxY) continue
      const s1 = one.seg
      const s2 = two.seg
      const shareNode = s1.from === s2.from || s1.from === s2.to || s1.to === s2.from || s1.to === s2.to
      // Two straights out of a shared node cannot meet again; a curve can
      if (shareNode && s1.kind === 'straight' && s2.kind === 'straight') continue
      if (shareNode ? partAtSharedNode(s1, one.hull, s2, two.hull) : hullsApart(one.hull, two.hull)) continue
      for (const hit of findSegmentCrossings(s1, one.a, one.b, s2, two.a, two.b, shareNode)) {
        const meet = levelsMeet(segmentHeightAt(net, s1, hit.t1!), segmentHeightAt(net, s2, hit.t2!))
        if (!meet) {
          if (!shareNode) stacked++
          continue
        }
        // A crossing at a rail end is a node on a rail, found above
        const clear = [one.a, one.b, two.a, two.b].every((end) => Math.hypot(hit.point.x - end.x, hit.point.y - end.y) > tolerance)
        if (clear) {
          contacts.push({ kind: 'cross', point: hit.point, segA: s1.id, segB: s2.id, tA: hit.t1!, tB: hit.t2! })
          break
        }
      }
    }
  }

  return { stacked, contacts }
}

/**
 * Do to the network what the editor would do at each of these places: cut two tracks that cross
 * and give them a common node, cut a rail at a node lying on it, weld two nodes. A contact whose
 * rails or nodes were changed by an earlier one of the list is left for the next check.
 * Returns the contacts settled.
 */
export function settleContacts(net: Network, contacts: Contact[]): Contact[] {
  const touched = new Set<string>()
  const free = (...ids: string[]): boolean => ids.every((id) => !touched.has(id))
  const settled: Contact[] = []
  for (const contact of [...contacts].sort((p, q) => (p.kind === 'cross' ? 0.001 : p.dist) - (q.kind === 'cross' ? 0.001 : q.dist))) {
    if (contact.kind === 'cross') {
      const first = net.segments.get(contact.segA)
      const second = net.segments.get(contact.segB)
      if (!first || !second || !free(first.id, second.id, first.from, first.to, second.from, second.to)) continue
      // A flat track is cut first, so that it stays flat and a ramp crossing it gives way
      const cuts: [SegmentId, number][] = [[first.id, contact.tA], [second.id, contact.tB]]
      if (isRamp(net, first) && !isRamp(net, second)) cuts.reverse()
      ;[first.id, second.id, first.from, first.to, second.from, second.to].forEach((id) => touched.add(id))
      const node = addNode(net, contact.point)
      for (const [segId, at] of cuts) splitSegmentAtNode(net, segId, node.id, at)
      settled.push(contact)
    } else if (contact.kind === 'split') {
      const seg = net.segments.get(contact.segId)
      if (!seg || !net.nodes.has(contact.nodeId) || !free(seg.id, seg.from, seg.to, contact.nodeId)) continue
      ;[seg.id, seg.from, seg.to, contact.nodeId].forEach((id) => touched.add(id))
      if (splitSegmentAtNode(net, seg.id, contact.nodeId)) settled.push(contact)
    } else {
      if (!net.nodes.has(contact.nodeId) || !net.nodes.has(contact.otherNodeId) || !free(contact.nodeId, contact.otherNodeId)) continue
      touched.add(contact.nodeId).add(contact.otherNodeId)
      for (const id of [contact.nodeId, contact.otherNodeId]) for (const sid of net.adjacency.get(id) ?? []) touched.add(sid)
      if (weldNodes(net, contact.otherNodeId, contact.nodeId)) settled.push(contact)
    }
  }
  return settled
}
