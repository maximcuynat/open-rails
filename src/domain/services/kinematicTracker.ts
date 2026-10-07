import type { Network, NodeId, Point, SegmentId } from '../models/types'
import { dirtyNodesOf, nodesInBox, type NetworkChanges, type NetworkFollower } from '../geometry/networkFollower'
import { placementThresholds } from '../geometry/scale'
import { MAX_TRANSITION_DEFLECTION_DEG } from '../geometry/tangent'
import { verifyingNetworkRevisions } from '../models/networkWatch'
import { analyzeKinematics, getOutgoingTangent, nodeIssues, steepGradientIssue, type GradientLimits, type KinematicIssue } from './kinematicDiagnostics'

/** An open end of track: where its rail would carry on */
interface TrackEnd {
  nodeId: NodeId
  pos: Point
  segId: SegmentId
  ahead: Point
}

/** Two ends facing across a gap, `a` before `b` in the network, and the issues reported on each */
interface Gap {
  a: NodeId
  b: NodeId
  issues: [KinematicIssue, KinematicIssue]
}

/**
 * The kinematic issues of a network (`analyzeKinematics`), kept from one edit to the next and
 * worked out again only where the track changed: an issue at a node is read from that node and
 * the tangents of its rails, a steep rail from its own ends, a gap from two open ends within the
 * heal tolerance of each other — found around the ends that changed. The list is given in the
 * order of `analyzeKinematics`: gaps by their first end, steep rails in the order of the rails,
 * then the nodes in their order.
 */
export class KinematicTracker {
  private readonly byNode = new Map<NodeId, KinematicIssue[]>()
  private readonly steepByRail = new Map<SegmentId, KinematicIssue>()
  private readonly ends = new Map<NodeId, TrackEnd>()
  private readonly gaps = new Map<string, Gap>()
  private readonly healTolerance: number
  private readonly minCos = Math.cos((MAX_TRANSITION_DEFLECTION_DEG * Math.PI) / 180)
  private list: KinematicIssue[] | null = null

  constructor(
    private readonly gauge: number | undefined,
    private readonly gradient: GradientLimits | undefined,
  ) {
    this.healTolerance = placementThresholds(gauge).healTolerance
  }

  /** Brings the issues up to date with the network: all of them when `changes` is null */
  update(net: Network, changes: NetworkChanges | null, index: NetworkFollower): void {
    this.list = null
    if (!changes) {
      this.byNode.clear()
      this.steepByRail.clear()
      this.ends.clear()
      this.gaps.clear()
      for (const node of net.nodes.values()) {
        this.nodeAgain(net, node.id)
        this.endAgain(net, node.id)
      }
      for (const end of this.ends.values()) this.gapsAround(net, end, index)
      if (this.gradient) for (const seg of net.segments.values()) this.railAgain(net, seg.id)
      return
    }
    const dirty = dirtyNodesOf(changes, index)
    for (const id of dirty) {
      this.nodeAgain(net, id)
      this.endAgain(net, id)
      for (const [key, gap] of this.gaps) if (gap.a === id || gap.b === id) this.gaps.delete(key)
    }
    for (const id of dirty) {
      const end = this.ends.get(id)
      if (end) this.gapsAround(net, end, index)
    }
    if (this.gradient) {
      for (const sid of changes.changedRails) this.railAgain(net, sid)
      for (const sid of changes.removedRails) this.steepByRail.delete(sid)
    }
  }

  /** The issues, in the order `analyzeKinematics` gives them */
  issues(net: Network, index: NetworkFollower): KinematicIssue[] {
    if (this.list) return this.list
    const nodeOrd = (id: NodeId): number => index.nodes.get(id)?.ord ?? -1
    const issues: KinematicIssue[] = []
    const gaps = [...this.gaps.values()].sort((g, h) => nodeOrd(g.a) - nodeOrd(h.a) || nodeOrd(g.b) - nodeOrd(h.b))
    for (const gap of gaps) issues.push(gap.issues[0], gap.issues[1])
    if (this.gradient) {
      const steep = [...this.steepByRail].sort(([a], [b]) => index.rails.get(a)!.ord - index.rails.get(b)!.ord)
      for (const [, issue] of steep) issues.push(issue)
    }
    const nodes = [...this.byNode].sort(([a], [b]) => nodeOrd(a) - nodeOrd(b))
    for (const [, own] of nodes) for (const issue of own) issues.push(issue)
    if (verifyingNetworkRevisions()) {
      const whole = analyzeKinematics(net, this.gauge, this.gradient)
      if (JSON.stringify(whole) !== JSON.stringify(issues)) throw new Error('The kinematic issues kept are not those of the network')
    }
    this.list = issues
    return issues
  }

  private nodeAgain(net: Network, id: NodeId): void {
    const node = net.nodes.get(id)
    const found: KinematicIssue[] = []
    if (node) nodeIssues(net, node, found)
    if (found.length > 0) this.byNode.set(id, found)
    else this.byNode.delete(id)
  }

  private railAgain(net: Network, sid: SegmentId): void {
    const seg = net.segments.get(sid)
    const issue = seg && steepGradientIssue(net, seg, this.gradient!)
    if (issue) this.steepByRail.set(sid, issue)
    else this.steepByRail.delete(sid)
  }

  /** The node as an open end of track, when it is one */
  private endAgain(net: Network, id: NodeId): void {
    const node = net.nodes.get(id)
    const segIds = node ? (net.adjacency.get(id) ?? []) : []
    const seg = segIds.length === 1 ? net.segments.get(segIds[0]) : undefined
    const into = seg && node && getOutgoingTangent(net, seg, id)
    if (!seg || !node || !into) this.ends.delete(id)
    else this.ends.set(id, { nodeId: id, pos: node.pos, segId: seg.id, ahead: { x: -into.x, y: -into.y } })
  }

  /** The gaps between this end and the ends within the heal tolerance of it */
  private gapsAround(net: Network, end: TrackEnd, index: NetworkFollower): void {
    const reach = this.healTolerance
    const box = { minX: end.pos.x - reach, minY: end.pos.y - reach, maxX: end.pos.x + reach, maxY: end.pos.y + reach }
    for (const node of nodesInBox(net, box)) {
      const other = this.ends.get(node.id)
      if (!other || other === end) continue
      const [a, b] = index.nodes.get(end.nodeId)!.ord < index.nodes.get(other.nodeId)!.ord ? [end, other] : [other, end]
      const key = `${a.nodeId}>${b.nodeId}`
      if (this.gaps.has(key)) continue
      const gap = this.gapBetween(a, b)
      if (gap) this.gaps.set(key, gap)
    }
  }

  /** The gap between two ends when they face each other across one (see `detectTrackGaps`) */
  private gapBetween(a: TrackEnd, b: TrackEnd): Gap | null {
    if (a.segId === b.segId) return null
    const dx = b.pos.x - a.pos.x
    const dy = b.pos.y - a.pos.y
    const gap = Math.hypot(dx, dy)
    if (gap <= 1e-9 || gap > this.healTolerance) return null
    // Facing: each end points at the other one, within the deflection a train could take
    const facingA = (a.ahead.x * dx + a.ahead.y * dy) / gap
    const facingB = -(b.ahead.x * dx + b.ahead.y * dy) / gap
    if (facingA < this.minCos || facingB < this.minCos) return null
    const issue = (from: TrackEnd, to: TrackEnd): KinematicIssue => ({
      id: `gap-${from.nodeId}-${to.nodeId}`,
      nodeId: from.nodeId,
      kind: 'track_gap',
      severity: 'warning',
      gapMeters: gap,
      message: `Voie interrompue : cette extrémité fait face à une autre sans y être raccordée, le train s'arrête ici (touche R pour raccorder)`,
      involvedSegmentIds: [from.segId, to.segId],
    })
    return { a: a.nodeId, b: b.nodeId, issues: [issue(a, b), issue(b, a)] }
  }
}
