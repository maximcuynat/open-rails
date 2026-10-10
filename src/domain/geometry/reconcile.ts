import type { Network, NodeId, Point, RailNode, Segment, SegmentId } from '../models/types'
import { pathSlice } from './railPath'
import { bezierPoint, bezierDerivative1, closestCurveParam } from './curve'
import { closestParamOnShape, distanceToShape, pointOnShape, segmentBounds, segmentEnds, shapePolyline } from './segmentGeometry'
import { isCrossingAngle } from '../models/crossing'
import { NetworkFollower, segmentBox } from './networkFollower'
import { autoDetectJunctions, weldNodes } from '../models/junction'
import { splitReplacement } from '../models/trackObjects'
import { addNode, addChildSegment, addPathSegment, detachSegment, removeDuplicateSegments, replaceRail, isRamp, levelsMeet, nodeLevel, LEVEL_CLEARANCE, segmentEndLevels, segmentHeightAt, setNodesLevel } from '../models/network'
import { touchNetwork } from '../models/networkWatch'

/**
 * Split an existing segment at an existing node that lies on it.
 * Snaps node position precisely onto the segment to eliminate geometric kinks,
 * and maintains quadratic Bézier continuity via De Casteljau subdivision.
 * `at` is the parameter of the node on the segment when the caller knows it exactly
 * (a computed intersection); otherwise the node is projected onto the segment.
 * A node that carries no rail yet takes the height of the segment at that place; a node that
 * already carries rails keeps its own, and the two halves run to it.
 */
export function splitSegmentAtNode(
  net: Network,
  segmentId: SegmentId,
  nodeId: NodeId,
  at?: number,
): { seg1: Segment; seg2: Segment } | null {
  const seg = net.segments.get(segmentId)
  const node = net.nodes.get(nodeId)
  if (!seg || !node) return null
  if (seg.from === nodeId || seg.to === nodeId) return null

  const nodeA = net.nodes.get(seg.from)
  const nodeB = net.nodes.get(seg.to)
  if (!nodeA || !nodeB) return null
  const adoptHeight = (t: number): void => {
    if ((net.adjacency.get(nodeId) ?? []).length === 0) setNodesLevel(net, [nodeId], segmentHeightAt(net, seg, t))
  }

  if (seg.kind === 'straight') {
    const dx = nodeB.pos.x - nodeA.pos.x
    const dy = nodeB.pos.y - nodeA.pos.y
    const lenSq = dx * dx + dy * dy
    // A rail of no length is cut "in the middle": both halves are the same place
    let t = 0.5
    if (lenSq > 0) {
      t = at ?? Math.max(0.005, Math.min(0.995, ((node.pos.x - nodeA.pos.x) * dx + (node.pos.y - nodeA.pos.y) * dy) / lenSq))
      node.pos = { x: nodeA.pos.x + t * dx, y: nodeA.pos.y + t * dy }
      touchNetwork(net, node.id)
      adoptHeight(t)
    } else {
      adoptHeight(0)
    }
    detachSegment(net, segmentId)
    // A half that already exists (the node sits on a superimposed rail) is reused as it is
    const seg1 = addChildSegment(net, seg, nodeA.id, node.id)!
    const seg2 = addChildSegment(net, seg, node.id, nodeB.id)!
    replaceRail(net, splitReplacement(seg, t, seg1, seg2))
    return { seg1, seg2 }
  } else if (seg.kind === 'curve' && seg.via) {
    const p0 = nodeA.pos
    const p1 = seg.via
    const p2 = nodeB.pos

    const t = at ?? Math.max(0.01, Math.min(0.99, closestCurveParam(node.pos, p0, p1, p2)))
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
    touchNetwork(net, node.id)
    adoptHeight(t)

    detachSegment(net, segmentId)
    const seg1 = addChildSegment(net, seg, nodeA.id, node.id, q0)!
    const seg2 = addChildSegment(net, seg, node.id, nodeB.id, q1)!
    replaceRail(net, splitReplacement(seg, t, seg1, seg2))
    return { seg1, seg2 }
  } else if (seg.kind === 'path') {
    // A long rail is cut where its path is: each half keeps its share of the pieces
    const ends = segmentEnds(net, seg)
    if (ends?.path && ends.path.length > 0) {
      const t = at ?? Math.max(0.005, Math.min(0.995, closestParamOnShape(ends, node.pos)))
      const cut = t * ends.path.length
      node.pos = pointOnShape(ends, t)
      touchNetwork(net, node.id)
      adoptHeight(t)
      const first = pathSlice(ends.path, 0, cut)
      const second = pathSlice(ends.path, cut, ends.path.length)
      detachSegment(net, segmentId)
      const seg1 = addPathSegment(net, nodeA.id, node.id, first, seg)!
      const seg2 = addPathSegment(net, node.id, nodeB.id, second, seg)!
      replaceRail(net, splitReplacement(seg, t, seg1, seg2))
      return { seg1, seg2 }
    }
  }
  return null
}

/**
 * True when `node` hangs off one end of `seg` through another rail, i.e. the two are branches out
 * of a shared node. Branches diverge slowly near their apex, so they must not split or weld each
 * other — unless they are superimposed: their far ends coincide, or both are straights running
 * along the same line. Those limits are relative to the rail lengths, not to the tolerance, so that
 * a loose (heal) tolerance cannot fold a real turnout branch back onto its main line.
 */
export function isSiblingBranch(net: Network, node: RailNode, seg: Segment): boolean {
  for (const sid of net.adjacency.get(node.id) ?? []) {
    const link = net.segments.get(sid)
    if (!link) continue
    const sharedId = link.from === node.id ? link.to : link.from
    if (sharedId !== seg.from && sharedId !== seg.to) continue
    const shared = net.nodes.get(sharedId)
    const far = net.nodes.get(sharedId === seg.from ? seg.to : seg.from)
    if (!shared || !far) return true

    const lx = node.pos.x - shared.pos.x
    const ly = node.pos.y - shared.pos.y
    const sx = far.pos.x - shared.pos.x
    const sy = far.pos.y - shared.pos.y
    const linkLen = Math.hypot(lx, ly)
    const segLen = Math.hypot(sx, sy)
    if (linkLen < 1e-12 || segLen < 1e-12) return true

    const endsCoincide = Math.hypot(node.pos.x - far.pos.x, node.pos.y - far.pos.y) <= 0.01 * Math.min(linkLen, segLen)
    const sameLine =
      link.kind === 'straight' &&
      seg.kind === 'straight' &&
      lx * sx + ly * sy > 0 &&
      Math.abs(lx * sy - ly * sx) <= 0.02 * linkLen * segLen
    if (!endsCoincide && !sameLine) return true
  }
  return false
}

/** Point and derivative of a segment at parameter t (straight or quadratic Bézier) */
function evalSegment(seg: Segment, a: Point, b: Point, t: number): { p: Point; d: Point } {
  if (seg.kind === 'curve' && seg.via) {
    return { p: bezierPoint(t, a, seg.via, b), d: bezierDerivative1(t, a, seg.via, b) }
  }
  return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, d: { x: b.x - a.x, y: b.y - a.y } }
}

interface SegmentCrossing {
  point: Point
  /** Parameters of the crossing point on each segment, when it has been solved exactly */
  t1?: number
  t2?: number
}

/** Crossings of a straight (a→b) with a quadratic Bézier, solved exactly: `t1` on the straight, `t2` on the curve */
function crossStraightCurve(a: Point, b: Point, p0: Point, via: Point, p2: Point): SegmentCrossing[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-18) return []
  // Signed distance of the curve to the line, as a quadratic in t
  const side = (p: Point) => (dx * (p.y - a.y) - dy * (p.x - a.x)) / Math.sqrt(lenSq)
  const c0 = side(p0)
  const c1 = side(via)
  const c2 = side(p2)
  const qa = c0 - 2 * c1 + c2
  const qb = 2 * (c1 - c0)
  const roots: number[] = []
  if (Math.abs(qa) < 1e-12) {
    if (Math.abs(qb) > 1e-12) roots.push(-c0 / qb)
  } else {
    const disc = qb * qb - 4 * qa * c0
    if (disc > 0) {
      const sq = Math.sqrt(disc)
      roots.push((-qb - sq) / (2 * qa), (-qb + sq) / (2 * qa))
    }
  }
  const found: SegmentCrossing[] = []
  for (const t of roots) {
    if (t < 0 || t > 1) continue
    const p = bezierPoint(t, p0, via, p2)
    const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
    if (u < 0 || u > 1) continue
    found.push({ point: { x: a.x + u * dx, y: a.y + u * dy }, t1: u, t2: t })
  }
  return found
}

/**
 * Points where two segments cross, at an angle of at least MIN_CROSSING_ANGLE_DEG (isCrossingAngle): a tangent touch
 * or a shallower graze is not a crossing and must not connect the two tracks.
 * Straight/curve pairs are solved exactly; two curves are searched on polylines, then each hit is
 * refined with Newton iterations on the true curves so that the point lies on both tracks.
 */
export function findSegmentCrossings(
  s1: Segment,
  a1: Point,
  b1: Point,
  s2: Segment,
  a2: Point,
  b2: Point,
  shareNode: boolean,
): SegmentCrossing[] {
  // A long rail comes with its nodes where it meets other tracks: it is not searched for crossings
  // (a track drawn across one is joined to it at its ends, by the node-on-rail pass)
  if (s1.kind === 'path' || s2.kind === 'path') return []
  const curve1 = s1.kind === 'curve' && !!s1.via
  const curve2 = s2.kind === 'curve' && !!s2.via

  let found: SegmentCrossing[] = []
  if (curve1 !== curve2) {
    found = curve2
      ? crossStraightCurve(a1, b1, a2, s2.via!, b2)
      : crossStraightCurve(a2, b2, a1, s1.via!, b1).map((c) => ({ point: c.point, t1: c.t2, t2: c.t1 }))
  } else {
    // Two curves out of a shared node meet again close to it: search on a finer polyline
    const n1 = curve1 ? (shareNode ? 32 : 16) : 1
    const n2 = curve2 ? (shareNode ? 32 : 16) : 1
    const pts1 = shapePolyline({ a: a1, b: b1, via: curve1 ? s1.via : undefined }, n1)
    const pts2 = shapePolyline({ a: a2, b: b2, via: curve2 ? s2.via : undefined }, n2)
    for (let i = 0; i < n1; i++) {
      for (let j = 0; j < n2; j++) {
        const d1x = pts1[i + 1].x - pts1[i].x
        const d1y = pts1[i + 1].y - pts1[i].y
        const d2x = pts2[j + 1].x - pts2[j].x
        const d2y = pts2[j + 1].y - pts2[j].y
        const det = d1x * d2y - d1y * d2x
        if (Math.abs(det) < 1e-12) continue
        const ox = pts2[j].x - pts1[i].x
        const oy = pts2[j].y - pts1[i].y
        const u = (ox * d2y - oy * d2x) / det
        const v = (ox * d1y - oy * d1x) / det
        if (u < 0 || u > 1 || v < 0 || v > 1) continue

        let t1 = (i + u) / n1
        let t2 = (j + v) / n2
        let residual = Infinity
        for (let iter = 0; iter < 12; iter++) {
          const e1 = evalSegment(s1, a1, b1, t1)
          const e2 = evalSegment(s2, a2, b2, t2)
          const rx = e2.p.x - e1.p.x
          const ry = e2.p.y - e1.p.y
          residual = Math.hypot(rx, ry)
          if (residual < 1e-10) break
          const jac = e1.d.x * e2.d.y - e1.d.y * e2.d.x
          if (Math.abs(jac) < 1e-12) break
          t1 = Math.max(0, Math.min(1, t1 + (rx * e2.d.y - ry * e2.d.x) / jac))
          t2 = Math.max(0, Math.min(1, t2 + (rx * e1.d.y - ry * e1.d.x) / jac))
        }
        // A hit that cannot be pinned down on both curves is a graze, not a crossing
        if (residual >= 1e-8) continue
        const point = evalSegment(s1, a1, b1, t1).p
        // A crossing on a polyline vertex is seen by both chords around it
        if (!found.some((f) => Math.hypot(f.point.x - point.x, f.point.y - point.y) < 1e-6)) {
          found.push({ point, t1, t2 })
        }
      }
    }
  }

  return found.filter((c) => isCrossingAngle(evalSegment(s1, a1, b1, c.t1!).d, evalSegment(s2, a2, b2, c.t2!).d))
}

/** True when two rails are nowhere within LEVEL_CLEARANCE of each other, whatever the place */
function heightsApart(net: Network, s1: Segment, s2: Segment): boolean {
  const e1 = segmentEndLevels(net, s1)
  const e2 = segmentEndLevels(net, s2)
  const gap = Math.max(
    Math.min(e1.from, e1.to) - Math.max(e2.from, e2.to),
    Math.min(e2.from, e2.to) - Math.max(e1.from, e1.to),
  )
  return gap >= LEVEL_CLEARANCE
}

interface ReconcileCandidate {
  type: 'weld' | 'split' | 'cross'
  nodeId?: NodeId
  /** The rail the node was found on (weld, split), or the first of the two rails that cross */
  segId?: SegmentId
  seg2Id?: SegmentId
  crossPoint?: Point
  crossT1?: number
  crossT2?: number
  weldNodeId?: NodeId
  dist: number
}

/**
 * What a node within `tolerance` of a rail it does not end calls for: welding it to the end of the
 * rail it sits on, wiring it into the rail (a split), or nothing. Only where the two are at the
 * same height; a lone node has none yet and meets any.
 */
function nodeRailCandidate(net: Network, node: RailNode, seg: Segment, tolerance: number): ReconcileCandidate | null {
  if (seg.from === node.id || seg.to === node.id) return null
  const nodeA = net.nodes.get(seg.from)
  const nodeB = net.nodes.get(seg.to)
  if (!nodeA || !nodeB) return null
  // The rail lies inside its box (ends and control point, or path): most nodes are clear of it
  const box = segmentBounds(net, seg)
  if (
    box &&
    (node.pos.x < box.minX - tolerance || node.pos.x > box.maxX + tolerance ||
      node.pos.y < box.minY - tolerance || node.pos.y > box.maxY + tolerance)
  ) {
    return null
  }
  // Sibling/adjacent branches of the same node diverge slowly near apex, do not split each other
  if (isSiblingBranch(net, node, seg)) return null

  const lone = (net.adjacency.get(node.id) ?? []).length === 0
  const height = nodeLevel(node)
  const meets = (other: number): boolean => lone || levelsMeet(height, other)

  // Distance to endpoints
  const distA = Math.hypot(node.pos.x - nodeA.pos.x, node.pos.y - nodeA.pos.y)
  const distB = Math.hypot(node.pos.x - nodeB.pos.x, node.pos.y - nodeB.pos.y)
  // Stacked on the rail end without being at its height: neither welded nor wired in
  if (distA <= tolerance) {
    return meets(nodeLevel(nodeA)) ? { type: 'weld', nodeId: node.id, segId: seg.id, weldNodeId: nodeA.id, dist: distA } : null
  }
  if (distB <= tolerance) {
    return meets(nodeLevel(nodeB)) ? { type: 'weld', nodeId: node.id, segId: seg.id, weldNodeId: nodeB.id, dist: distB } : null
  }

  // Distance to segment interior
  if (seg.kind === 'straight') {
    const dx = nodeB.pos.x - nodeA.pos.x
    const dy = nodeB.pos.y - nodeA.pos.y
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-4) return null

    const t = ((node.pos.x - nodeA.pos.x) * dx + (node.pos.y - nodeA.pos.y) * dy) / lenSq
    if (t > 0.005 && t < 0.995) {
      const projX = nodeA.pos.x + t * dx
      const projY = nodeA.pos.y + t * dy
      const dist = Math.hypot(node.pos.x - projX, node.pos.y - projY)
      if (dist <= tolerance && meets(segmentHeightAt(net, seg, t))) {
        return { type: 'split', nodeId: node.id, segId: seg.id, dist }
      }
    }
  } else if (seg.kind === 'curve' && seg.via) {
    const bestT = closestCurveParam(node.pos, nodeA.pos, seg.via, nodeB.pos)
    const onCurve = bezierPoint(bestT, nodeA.pos, seg.via, nodeB.pos)
    const dist = Math.hypot(onCurve.x - node.pos.x, onCurve.y - node.pos.y)
    if (bestT > 0.01 && bestT < 0.99 && dist <= tolerance && meets(segmentHeightAt(net, seg, bestT))) {
      return { type: 'split', nodeId: node.id, segId: seg.id, dist }
    }
  } else if (seg.kind === 'path') {
    const shape = segmentEnds(net, seg)
    if (!shape) return null
    const bestT = closestParamOnShape(shape, node.pos)
    const dist = distanceToShape(shape, node.pos)
    if (bestT > 0.005 && bestT < 0.995 && dist <= tolerance && meets(segmentHeightAt(net, seg, bestT))) {
      return { type: 'split', nodeId: node.id, segId: seg.id, dist }
    }
  }
  return null
}

/** The crossing of two rails that calls for a node on both (tracks placed across each other), if any */
function railPairCandidate(net: Network, s1: Segment, s2: Segment, tolerance: number): ReconcileCandidate | null {
  const n1A = net.nodes.get(s1.from)
  const n1B = net.nodes.get(s1.to)
  const n2A = net.nodes.get(s2.from)
  const n2B = net.nodes.get(s2.to)
  if (!n1A || !n1B || !n2A || !n2B) return null
  const box1 = segmentBox(net, s1)!
  const box2 = segmentBox(net, s2)!
  if (box1.maxX < box2.minX || box1.minX > box2.maxX || box1.maxY < box2.minY || box1.minY > box2.maxY) return null
  // One passes clear over the other along its whole length: a bridge, not a crossing
  if (heightsApart(net, s1, s2)) return null
  // Two straights out of a shared node cannot meet again; a curve can (it crosses a track twice)
  const shareNode = s1.from === s2.from || s1.from === s2.to || s1.to === s2.from || s1.to === s2.to
  if (shareNode && s1.kind === 'straight' && s2.kind === 'straight') return null

  for (const res of findSegmentCrossings(s1, n1A.pos, n1B.pos, s2, n2A.pos, n2B.pos, shareNode)) {
    // A crossing at a rail end is a node-on-segment case (weld or split), handled apart
    const d1A = Math.hypot(res.point.x - n1A.pos.x, res.point.y - n1A.pos.y)
    const d1B = Math.hypot(res.point.x - n1B.pos.x, res.point.y - n1B.pos.y)
    const d2A = Math.hypot(res.point.x - n2A.pos.x, res.point.y - n2A.pos.y)
    const d2B = Math.hypot(res.point.x - n2B.pos.x, res.point.y - n2B.pos.y)
    if (
      d1A > tolerance && d1B > tolerance && d2A > tolerance && d2B > tolerance &&
      // Decided where they cross: a ramp meets a ground track near its foot only
      levelsMeet(segmentHeightAt(net, s1, res.t1!), segmentHeightAt(net, s2, res.t2!))
    ) {
      return { type: 'cross', segId: s1.id, seg2Id: s2.id, crossPoint: res.point, crossT1: res.t1, crossT2: res.t2, dist: 0.001 }
    }
  }
  return null
}

/**
 * The next thing to mend, looking at every node against every rail, then at every pair of rails:
 * the closest first, and among equals the first met. What the kept state must agree with.
 */
function nextCandidateExhaustive(net: Network, tolerance: number): ReconcileCandidate | null {
  removeDuplicateSegments(net, tolerance)
  const candidates: ReconcileCandidate[] = []
  const nodeList = Array.from(net.nodes.values())
  const segList = Array.from(net.segments.values())
  for (const node of nodeList) {
    for (const seg of segList) {
      const found = nodeRailCandidate(net, node, seg, tolerance)
      if (found) candidates.push(found)
    }
  }
  for (let i = 0; i < segList.length; i++) {
    for (let j = i + 1; j < segList.length; j++) {
      const found = railPairCandidate(net, segList[i], segList[j], tolerance)
      if (found) candidates.push(found)
    }
  }
  // Sort candidates by ascending distance (closest/exact first)
  candidates.sort((a, b) => a.dist - b.dist)
  return candidates[0] ?? null
}

/**
 * What the last reconcile pass knew of a network: every node and rail as it was (`NetworkFollower`),
 * and what was still to mend. A pass over a network that changed a little since then only looks at
 * the nodes and rails that changed against their surroundings, found on a grid. Whatever did not
 * change meets the rest as it did before.
 *
 * A node counts as changed when it moved or changed height, and with it the rails that end on it;
 * a rail when its ends, kind or control point changed. The nodes at the ends of a changed, new or
 * removed rail are looked at again too: what they hang off decides what they may be wired into.
 */
class ReconcileState {
  /** The rails are found from any point within the tolerance of their box */
  private readonly follower: NetworkFollower
  private candidates: ReconcileCandidate[] = []
  /** Changed since the candidates were last brought up to date */
  private readonly dirtyNodes = new Set<NodeId>()
  private readonly dirtyRails = new Set<SegmentId>()
  /** Changed since the rails laid over each other were last dropped */
  private readonly unchecked = new Set<SegmentId>()
  /** Nodes at which something changed since the route tables were last checked (end of a pass) */
  readonly changedSinceSync = new Set<NodeId>()

  constructor(readonly tolerance: number) {
    this.follower = new NetworkFollower(tolerance)
  }

  /**
   * Takes the network as it stands for one that needs no mending (it was rebuilt from one that
   * needed none): its nodes and rails are noted, not looked into.
   */
  adopt(net: Network): Set<NodeId> {
    const changes = this.follower.follow(net)
    const dirty = new Set<NodeId>(changes.movedNodes)
    for (const id of changes.leftNodes) dirty.add(id)
    for (const id of changes.changedTables) dirty.add(id)
    for (const sid of changes.changedRails) {
      const rec = this.follower.rails.get(sid)!
      dirty.add(rec.from)
      dirty.add(rec.to)
    }
    for (const id of dirty) this.changedSinceSync.add(id)
    return dirty
  }

  /** Drops the duplicate rails, then gives the next thing to mend: the closest, and among equals the first of the network */
  next(net: Network): ReconcileCandidate | null {
    this.follow(net)
    this.updateCandidates(net)
    const { nodes, rails } = this.follower
    let best: ReconcileCandidate | null = null
    let bestPhase = 0
    let bestA = 0
    let bestB = 0
    for (const c of this.candidates) {
      // Nodes on rails come before rails across each other, each in the order of the network
      const phase = c.type === 'cross' ? 1 : 0
      const a = phase === 1 ? rails.get(c.segId!)!.ord : nodes.get(c.nodeId!)!.ord
      const b = phase === 1 ? rails.get(c.seg2Id!)!.ord : rails.get(c.segId!)!.ord
      if (
        !best || c.dist < best.dist ||
        (c.dist === best.dist && (phase < bestPhase || (phase === bestPhase && (a < bestA || (a === bestA && b < bestB)))))
      ) {
        best = c
        bestPhase = phase
        bestA = a
        bestB = b
      }
    }
    return best
  }

  /** Takes note of what changed in the network and drops the rails now laid over another one */
  follow(net: Network): void {
    do {
      this.noteChanges(net)
    } while (this.dropDuplicates(net) > 0)
  }

  /** Takes note of what changed in the network since it was last looked at, without touching it */
  private noteChanges(net: Network): void {
    const changes = this.follower.follow(net)
    for (const id of changes.movedNodes) this.dirtyNodes.add(id)
    for (const id of changes.leftNodes) this.dirtyNodes.add(id)
    for (const sid of changes.changedRails) {
      const rec = this.follower.rails.get(sid)!
      this.dirtyRails.add(sid)
      this.unchecked.add(sid)
      this.dirtyNodes.add(rec.from)
      this.dirtyNodes.add(rec.to)
    }
    for (const id of this.dirtyNodes) this.changedSinceSync.add(id)
    for (const id of changes.changedTables) this.changedSinceSync.add(id)
  }

  /** True when a pass now would leave the track as it is: nothing is left to mend and nothing changed since */
  isSettled(net: Network): boolean {
    this.noteChanges(net)
    return this.candidates.length === 0 && this.dirtyNodes.size === 0 && this.dirtyRails.size === 0 && this.unchecked.size === 0
  }

  /**
   * `removeDuplicateSegments` among the rails that join the same two nodes as a rail that changed,
   * in the order of the network: no other rail can have become the duplicate of one.
   */
  private dropDuplicates(net: Network): number {
    if (this.unchecked.size === 0) return 0
    const among = new Map<SegmentId, Segment>()
    for (const sid of this.unchecked) {
      const seg = net.segments.get(sid)
      if (!seg) continue
      for (const oid of net.adjacency.get(seg.from) ?? []) {
        const other = net.segments.get(oid)
        if (!other) continue
        if ((other.from === seg.from && other.to === seg.to) || (other.from === seg.to && other.to === seg.from)) among.set(oid, other)
      }
    }
    this.unchecked.clear()
    if (among.size < 2) return 0
    const rails = this.follower.rails
    const inOrder = [...among.values()].sort((a, b) => rails.get(a.id)!.ord - rails.get(b.id)!.ord)
    return removeDuplicateSegments(net, this.tolerance, inOrder)
  }

  /** Forgets what was to mend on a node or rail that changed or went, and looks at those again */
  private updateCandidates(net: Network): void {
    const { dirtyNodes, dirtyRails, tolerance } = this
    if (dirtyNodes.size === 0 && dirtyRails.size === 0) return
    const { rails, railGrid, nodeGrid } = this.follower
    this.candidates = this.candidates.filter((c) =>
      !(c.nodeId !== undefined && (dirtyNodes.has(c.nodeId) || !net.nodes.has(c.nodeId))) &&
      !(c.segId !== undefined && (dirtyRails.has(c.segId) || !net.segments.has(c.segId))) &&
      !(c.seg2Id !== undefined && (dirtyRails.has(c.seg2Id) || !net.segments.has(c.seg2Id))),
    )
    const keep = (found: ReconcileCandidate | null): void => {
      if (found) this.candidates.push(found)
    }

    // The grid answers by cell: the box of each rail, kept since it was placed, sets most aside
    for (const nid of dirtyNodes) {
      const node = net.nodes.get(nid)
      if (!node) continue
      const { x, y } = node.pos
      for (const sid of railGrid.atPoint(x, y)) {
        const rec = rails.get(sid)!
        const box = rec.box!
        if (x < box.minX - tolerance || x > box.maxX + tolerance || y < box.minY - tolerance || y > box.maxY + tolerance) continue
        keep(nodeRailCandidate(net, node, rec.ref, tolerance))
      }
    }
    for (const sid of dirtyRails) {
      const rec = rails.get(sid)
      if (!rec) continue
      const seg = rec.ref
      const box = rec.box
      if (!box) continue
      for (const nid of nodeGrid.inBox(box.minX - tolerance, box.minY - tolerance, box.maxX + tolerance, box.maxY + tolerance)) {
        // A changed node has met every rail above
        if (dirtyNodes.has(nid)) continue
        const node = net.nodes.get(nid)!
        const { x, y } = node.pos
        if (x < box.minX - tolerance || x > box.maxX + tolerance || y < box.minY - tolerance || y > box.maxY + tolerance) continue
        keep(nodeRailCandidate(net, node, seg, tolerance))
      }
      for (const oid of railGrid.inBox(box.minX, box.minY, box.maxX, box.maxY)) {
        if (oid === sid) continue
        const otherRec = rails.get(oid)!
        const otherBox = otherRec.box!
        if (box.maxX < otherBox.minX || box.minX > otherBox.maxX || box.maxY < otherBox.minY || box.minY > otherBox.maxY) continue
        // Two changed rails meet once, from the first of the two; the first of a pair is the older rail
        if (otherRec.ord < rec.ord) {
          if (!dirtyRails.has(oid)) keep(railPairCandidate(net, otherRec.ref, seg, tolerance))
        } else {
          keep(railPairCandidate(net, seg, otherRec.ref, tolerance))
        }
      }
    }
    dirtyNodes.clear()
    dirtyRails.clear()
  }
}

const states = new WeakMap<Network, ReconcileState>()

/**
 * True when `reconcileNetworkIntersections(net, tolerance)` is known to leave the track as it is:
 * the last pass at that tolerance found nothing more to mend, and no node or rail changed since.
 * The network is not touched.
 */
export function isNetworkReconciled(net: Network, tolerance: number): boolean {
  const state = states.get(net)
  return state !== undefined && state.tolerance === tolerance && state.isSettled(net)
}

/**
 * Take a network as reconciled at `tolerance` without looking into it: for one rebuilt, node for
 * node and rail for rail, from a network that was (a step of the undo history). The next pass
 * then only looks at what changed since. Ends, like a pass, by bringing the route tables in line.
 */
export function adoptReconciledNetwork(net: Network, tolerance: number): void {
  const known = states.get(net)
  if (known && known.tolerance === tolerance) {
    // A network that was already followed: only the tables where it changed since have anything to follow
    known.adopt(net)
    const scope = new Set(known.changedSinceSync)
    known.changedSinceSync.clear()
    autoDetectJunctions(net, scope)
    return
  }
  const state = new ReconcileState(tolerance)
  state.adopt(net)
  state.changedSinceSync.clear()
  states.set(net, state)
  autoDetectJunctions(net)
}

/**
 * Reconcile network topology (squelette logique de jonctions et intersections).
 * 1. Checks all nodes in the network: if a node lies within tolerance distance
 *    of an existing segment not connected to it, splits the segment at that node
 *    to wire it directly into the running track.
 * 2. If a node is within tolerance of an existing node, welds them together.
 * 3. Checks segment-segment geometric crossings to create diamond crossing nodes: every
 *    intersection of two tracks gets a node that lies on both of them.
 * 4. Uses a greedy lowest-distance strategy so exact geometric alignments
 *    (e.g. dist = 0) are resolved before divergent track clearances.
 * 5. Leaves a single rail over any stretch of track: superimposed rails split and weld each
 *    other like any other rail, and the duplicates this produces are dropped (older one kept).
 * 6. Automatically detects all turnouts (degree 3) and crossings (degree 4).
 *
 * All of the above only applies where the two tracks are at the same height, i.e. where their
 * heights differ by less than LEVEL_CLEARANCE at the place they meet (see `RailNode.level`): a rail
 * passing over or under another one is left alone, two nodes stacked at a bridge stay apart, and a
 * ramp crosses a ground track near its foot but passes over it near its top. A node without any
 * rail is compatible with everything and takes the height of what it joins.
 *
 * What a pass found is kept with the network (`ReconcileState`): the next one only looks at what
 * changed since. `exhaustive` keeps nothing and looks at every node against every rail and every
 * pair of rails: the same result, at a cost that grows with the square of the network. It is what
 * the tests check the kept state against.
 */
export function reconcileNetworkIntersections(
  net: Network,
  tolerance = 0.10,
  exhaustive = false,
): { splitCount: number; weldedCount: number } {
  let splitCount = 0
  let weldedCount = 0
  let iterations = 0

  let state: ReconcileState | null = null
  if (!exhaustive) {
    state = states.get(net) ?? null
    if (!state || state.tolerance !== tolerance) {
      state = new ReconcileState(tolerance)
      states.set(net, state)
    }
  }

  /** The nodes the mends touched: the only ones whose route tables may have something to follow */
  const touched = new Set<NodeId>()
  const endsOf = (segId: SegmentId): void => {
    const seg = net.segments.get(segId)
    if (!seg) return
    touched.add(seg.from)
    touched.add(seg.to)
  }
  let settled = false
  while (iterations < 40) {
    iterations++
    const best = state ? state.next(net) : nextCandidateExhaustive(net, tolerance)
    if (!best) {
      settled = true
      break
    }

    if (best.type === 'weld' && best.weldNodeId && best.nodeId) {
      touched.add(best.weldNodeId)
      touched.add(best.nodeId)
      weldNodes(net, best.weldNodeId, best.nodeId)
      weldedCount++
    } else if (best.type === 'split' && best.segId && best.nodeId) {
      touched.add(best.nodeId)
      endsOf(best.segId)
      splitSegmentAtNode(net, best.segId, best.nodeId)
      splitCount++
    } else if (best.type === 'cross' && best.segId && best.seg2Id && best.crossPoint) {
      // The crossing node takes the height of the first rail cut, and the other one bends to it:
      // a flat track is cut first, so that it stays flat and the ramp crossing it gives way
      const first = net.segments.get(best.segId)
      const second = net.segments.get(best.seg2Id)
      const cuts: [SegmentId, number | undefined][] = [[best.segId, best.crossT1], [best.seg2Id, best.crossT2]]
      if (first && second && isRamp(net, first) && !isRamp(net, second)) cuts.reverse()
      const crossNode = addNode(net, best.crossPoint)
      touched.add(crossNode.id)
      endsOf(best.segId)
      endsOf(best.seg2Id)
      for (const [segId, at] of cuts) splitSegmentAtNode(net, segId, crossNode.id, at)
      splitCount += 2
    }
  }
  // Stopped with something still to mend: the last mend may have laid a rail over another
  if (!settled) {
    if (state) state.follow(net)
    else removeDuplicateSegments(net, tolerance)
  }

  // The route tables follow the track where it changed since they were last checked and where it
  // was mended; `exhaustive` checks them all, as the reference
  if (state) {
    for (const id of state.changedSinceSync) touched.add(id)
    state.changedSinceSync.clear()
    autoDetectJunctions(net, touched)
  } else {
    autoDetectJunctions(net)
  }

  return { splitCount, weldedCount }
}
