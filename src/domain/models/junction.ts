import { generateId, addNode, addSegment, addCurveSegment, addChildSegment, removeSegment, replaceJunctionRail } from './network'
import { computeCurvePiece, computeStraightPiece } from '../profiles/profiles'
import { bezierPoint } from '../geometry/curve'
import { isTraversableDeflection } from '../geometry/tangent'
import { findJunctionAtNode, junctionRails, leaveDirection } from './routing'
import type { Junction, JunctionId, Network, NodeId, Passage, Point, RailNode, Segment, SegmentId } from './types'

export { findJunctionAtNode, junctionRails }

export interface TurnoutSpec {
  frogNumber: 4 | 6
  straightLength: number
  divergingRadius: number
  divergingAngle: number
  label: string
}

export const TURNOUT_SPECS: Record<4 | 6, TurnoutSpec> = {
  6: {
    frogNumber: 6,
    straightLength: 246,
    divergingRadius: 867,
    divergingAngle: 10,
    label: '#6 (246mm / R867 10°)',
  },
  4: {
    frogNumber: 4,
    straightLength: 123,
    divergingRadius: 490,
    divergingAngle: 15,
    label: '#4 (123mm / R490 15°)',
  },
}

/** Name of a branch of a turnout: `diverging` on a 2-way, `left` / `right` on a 3-way */
export type TurnoutBranch = 'straight' | 'diverging' | 'left' | 'right'

/** Branch names of a turnout, in the order of its passages */
function branchNames(junction: Junction): TurnoutBranch[] {
  return junction.kind === 'three_way' ? ['straight', 'left', 'right'] : ['straight', 'diverging']
}

function isTurnoutKind(junction: Junction): boolean {
  return junction.kind === 'turnout' || junction.kind === 'three_way'
}

/**
 * Declare a turnout at a node: the stem and its two branches, or three with `divergingRightSegmentId`
 * (then `divergingSegmentId` is the left one). Replaces the table the node already had, keeping its id.
 */
export function declareTurnout(
  net: Network,
  params: {
    nodeId: NodeId
    stemSegmentId: SegmentId
    straightSegmentId: SegmentId
    divergingSegmentId: SegmentId
    divergingRightSegmentId?: SegmentId
    activeBranch?: TurnoutBranch
    frogNumber?: number
    /** Id to give the table when the node has none yet (a table read from a file); a new one by default */
    id?: JunctionId
  },
): Junction {
  const branches = [params.straightSegmentId, params.divergingSegmentId]
  if (params.divergingRightSegmentId) branches.push(params.divergingRightSegmentId)
  const existing = findJunctionAtNode(net, params.nodeId)
  const junc: Junction = {
    id: existing?.id ?? params.id ?? generateId('j'),
    nodeId: params.nodeId,
    kind: branches.length === 3 ? 'three_way' : 'turnout',
    passages: branches.map((b) => ({ a: params.stemSegmentId, b })),
    positions: branches.map((_, i) => [i]),
    active: 0,
  }
  if (params.frogNumber !== undefined) junc.frogNumber = params.frogNumber
  if (params.activeBranch) setJunctionBranch(junc, params.activeBranch)
  net.junctions.set(junc.id, junc)
  return junc
}

/**
 * The rail of a node that can be the stem of a turnout with the given branches: one that is not a
 * branch — the one ending at `stemNodeId` when several qualify.
 */
export function stemRailFor(
  net: Network,
  nodeId: NodeId,
  branchSegIds: (SegmentId | undefined)[],
  stemNodeId?: NodeId,
): SegmentId | undefined {
  const candidates = (net.adjacency.get(nodeId) ?? [])
    .map((sid) => net.segments.get(sid))
    .filter((seg): seg is Segment => !!seg && !branchSegIds.includes(seg.id))
  const stem = candidates.find((seg) => (seg.from === nodeId ? seg.to : seg.from) === stemNodeId) ?? candidates[0]
  return stem?.id
}

/**
 * Declare a turnout from its node and branch rails; the stem is found with `stemRailFor`.
 * Throws when the node has no rail to be the stem: use `declareTurnout` when that can happen.
 */
export function addJunction(
  net: Network,
  params: {
    nodeId: NodeId
    stemNodeId?: NodeId
    straightNodeId?: NodeId
    divergingNodeId?: NodeId
    divergingRightNodeId?: NodeId
    straightSegmentId: SegmentId
    divergingSegmentId: SegmentId
    divergingRightSegmentId?: SegmentId
    hand?: 'left' | 'right' | 'three_way'
    frogNumber?: number
    activeBranch?: TurnoutBranch
  },
): Junction {
  const stemSegmentId = stemRailFor(
    net,
    params.nodeId,
    [params.straightSegmentId, params.divergingSegmentId, params.divergingRightSegmentId],
    params.stemNodeId,
  )
  if (!stemSegmentId) throw new Error(`addJunction: node ${params.nodeId} has no rail to be the stem`)
  return declareTurnout(net, {
    nodeId: params.nodeId,
    stemSegmentId,
    straightSegmentId: params.straightSegmentId,
    divergingSegmentId: params.divergingSegmentId,
    divergingRightSegmentId: params.divergingRightSegmentId,
    activeBranch: params.activeBranch,
    frogNumber: params.frogNumber,
  })
}

/**
 * Declare the turnout made by laying `branchSegId` out of a node of an existing track: the stem is
 * the rail of `railsBefore` (what the node had before) that the new branch continues, the straight
 * branch the rail that already continued that stem. Declares nothing — and returns null — when the
 * node is not on a through track (a dead end the branch merely prolongs, a free node), or when it
 * already has a table: `syncJunctions` then decides what the extra rail is.
 */
export function declareBranchOff(
  net: Network,
  nodeId: NodeId,
  railsBefore: SegmentId[],
  branchSegId: SegmentId,
): Junction | null {
  const branch = net.segments.get(branchSegId)
  if (!branch || findJunctionAtNode(net, nodeId)) return null
  const rays = new Map<SegmentId, Point>()
  for (const sid of railsBefore) {
    const seg = net.segments.get(sid)
    if (seg) rays.set(sid, leaveDirection(net, seg, nodeId))
  }
  const branchRay = leaveDirection(net, branch, nodeId)
  const stems = [...rays].filter(([, ray]) => isTraversableDeflection(ray, branchRay))
  if (stems.length !== 1) return null
  const [stemSegmentId, stemRay] = stems[0]
  const straights = [...rays].filter(([sid, ray]) => sid !== stemSegmentId && isTraversableDeflection(stemRay, ray))
  if (straights.length !== 1) return null
  return declareTurnout(net, { nodeId, stemSegmentId, straightSegmentId: straights[0][0], divergingSegmentId: branchSegId })
}

/** Remove a junction definition from the network (does not remove the rails unless specified). */
export function removeJunction(net: Network, id: JunctionId): void {
  net.junctions.delete(id)
}

/** Put a device in one of its positions. Every change of position goes through here. */
export function setJunctionPosition(junction: Junction, index: number): void {
  if (index >= 0 && index < junction.positions.length) junction.active = index
}

/** The branch a turnout is set to */
export function activeBranchOf(junction: Junction): TurnoutBranch {
  return branchNames(junction)[junction.active] ?? 'straight'
}

/** Throw a device to its next position (straight → left → right on a 3-way). Returns the branch now set. */
export function toggleJunction(junction: Junction): TurnoutBranch {
  if (junction.positions.length > 0) setJunctionPosition(junction, (junction.active + 1) % junction.positions.length)
  return activeBranchOf(junction)
}

/** Set a turnout to a branch. `diverging` and `left` name the same branch. */
export function setJunctionBranch(junction: Junction, branch: TurnoutBranch): void {
  const index = branch === 'straight' ? 0 : branch === 'right' && junction.kind === 'three_way' ? 2 : 1
  setJunctionPosition(junction, index)
}

/** Find the turnout a rail is a branch of (its stem does not count). */
export function findJunctionBySegment(net: Network, segId: SegmentId): Junction | undefined {
  for (const junc of net.junctions.values()) {
    if (isTurnoutKind(junc) && junc.passages.some((p) => p.b === segId)) return junc
  }
  return undefined
}

// ─── Geometry of a turnout ────────────────────────────────────────────────────

const RAIL_SAMPLES = 24

/** Points along a rail, starting from one of its end nodes */
function railPolyline(net: Network, seg: Segment, fromNodeId: NodeId): Point[] {
  const a = net.nodes.get(seg.from)
  const b = net.nodes.get(seg.to)
  if (!a || !b) return []
  const pts: Point[] = seg.kind === 'curve' && seg.via
    ? Array.from({ length: RAIL_SAMPLES + 1 }, (_, i) => bezierPoint(i / RAIL_SAMPLES, a.pos, seg.via!, b.pos))
    : [a.pos, b.pos]
  return seg.from === fromNodeId ? pts : pts.reverse()
}

function polylineLength(pts: Point[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return len
}

function pointAlong(pts: Point[], distance: number): Point {
  let remaining = distance
  for (let i = 1; i < pts.length; i++) {
    const step = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (remaining <= step && step > 0) {
      const k = remaining / step
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k }
    }
    remaining -= step
  }
  return pts[pts.length - 1]
}

/** Where a branch of a turnout lies relative to the axis of its stem */
export interface BranchSide {
  segId: SegmentId
  /** Lateral offset (meters) from the stem axis, at the same track distance on every branch; positive on the `left` hand */
  offset: number
  /** Angle (degrees) between the stem axis and the chord to that point */
  angle: number
  kind: Segment['kind']
}

/**
 * Side of each branch of a turnout, measured at the same distance from the points on every branch
 * (the length of the shortest one). The tangents at the points cannot tell the branches apart on a
 * turnout whose diverging rail leaves tangent to the stem, which is how the tools lay them.
 * Returns null when a rail is missing or does not touch the node.
 */
export function branchSides(
  net: Network,
  nodeId: NodeId,
  stemSegId: SegmentId,
  branchSegIds: SegmentId[],
): BranchSide[] | null {
  const apex = net.nodes.get(nodeId)
  const stem = net.segments.get(stemSegId)
  if (!apex || !stem || (stem.from !== nodeId && stem.to !== nodeId)) return null
  const stemLeave = leaveDirection(net, stem, nodeId)
  const axis = { x: -stemLeave.x, y: -stemLeave.y }

  const lines: { seg: Segment; pts: Point[] }[] = []
  for (const sid of branchSegIds) {
    const seg = net.segments.get(sid)
    if (!seg || (seg.from !== nodeId && seg.to !== nodeId)) return null
    lines.push({ seg, pts: railPolyline(net, seg, nodeId) })
  }
  const reach = Math.min(...lines.map((line) => polylineLength(line.pts)))
  return lines.map(({ seg, pts }) => {
    const p = pointAlong(pts, reach)
    const dx = p.x - apex.pos.x
    const dy = p.y - apex.pos.y
    const offset = axis.x * dy - axis.y * dx
    return { segId: seg.id, offset, angle: (Math.atan2(Math.abs(offset), axis.x * dx + axis.y * dy) * 180) / Math.PI, kind: seg.kind }
  })
}

/** A turnout read with the names of its parts. Everything but the rails and the position is derived from the geometry. */
export interface TurnoutView {
  stemSegmentId: SegmentId
  stemNodeId: NodeId
  straightSegmentId: SegmentId
  straightNodeId: NodeId
  /** The diverging branch; the left one on a 3-way */
  divergingSegmentId: SegmentId
  divergingNodeId: NodeId
  divergingRightSegmentId?: SegmentId
  divergingRightNodeId?: NodeId
  hand: 'left' | 'right' | 'three_way'
  frogNumber: number
  activeBranch: TurnoutBranch
  /** The branch rail the points are set to */
  activeSegmentId: SegmentId
}

/** Read a turnout or a 3-way. Returns null for another kind of device, or when one of its rails is gone. */
export function turnoutView(net: Network, junction: Junction | null | undefined): TurnoutView | null {
  if (!junction || !isTurnoutKind(junction) || junction.passages.length < 2) return null
  const farNode = (segId: SegmentId): NodeId | null => {
    const seg = net.segments.get(segId)
    if (!seg) return null
    return seg.from === junction.nodeId ? seg.to : seg.to === junction.nodeId ? seg.from : null
  }
  const stemSegmentId = junction.passages[0].a
  const branchIds = junction.passages.map((p) => p.b)
  const stemNodeId = farNode(stemSegmentId)
  const branchNodeIds = branchIds.map(farNode)
  if (!stemNodeId || branchNodeIds.some((id) => !id)) return null

  const sides = branchSides(net, junction.nodeId, stemSegmentId, branchIds)
  const threeWay = junction.kind === 'three_way' && branchIds.length >= 3
  const hand = threeWay ? 'three_way' : !sides || sides[1].offset - sides[0].offset >= 0 ? 'left' : 'right'
  // Divergence between the branches (the widest one from the stem axis on a 3-way)
  const divergence = !sides ? 0 : threeWay ? Math.max(sides[1].angle, sides[2].angle) : branchDivergence(sides[0], sides[1])
  const view: TurnoutView = {
    stemSegmentId,
    stemNodeId,
    straightSegmentId: branchIds[0],
    straightNodeId: branchNodeIds[0]!,
    divergingSegmentId: branchIds[1],
    divergingNodeId: branchNodeIds[1]!,
    hand,
    frogNumber: junction.frogNumber ?? (divergence <= 12.5 ? 6 : 4),
    activeBranch: activeBranchOf(junction),
    activeSegmentId: branchIds[junction.active] ?? branchIds[0],
  }
  if (threeWay) {
    view.divergingRightSegmentId = branchIds[2]
    view.divergingRightNodeId = branchNodeIds[2]!
  }
  return view
}

/** Angle (degrees) between two branches, from their side of the stem axis */
function branchDivergence(a: BranchSide, b: BranchSide): number {
  return Math.abs(Math.sign(a.offset || 1) * a.angle - Math.sign(b.offset || 1) * b.angle)
}

/**
 * Propose the route table of a node from its geometry: a turnout when one rail (the stem) can be
 * left for each of two others, a 3-way for three. Rails that only cross the node are left out of
 * the table. The roles do not depend on the order in which the rails were laid. Returns null when
 * the node is not a fork — no stem, or several.
 */
export function proposeJunction(net: Network, nodeId: NodeId): Junction | null {
  const rails = (net.adjacency.get(nodeId) ?? [])
    .map((sid) => net.segments.get(sid))
    .filter((seg): seg is Segment => !!seg)
  if (rails.length < 3) return null

  const rays = rails.map((seg) => leaveDirection(net, seg, nodeId))
  // A stem is a rail that two or more others continue. Two of them at one node are two tracks
  // meeting (a crossing, a converging line): only a single stem makes a fork.
  const continuations = rails.map((_, i) => rails.filter((__, k) => k !== i && isTraversableDeflection(rays[i], rays[k])))
  const stems = rails.filter((_, i) => continuations[i].length >= 2)
  if (stems.length !== 1) return null
  const stem = stems[0]
  const branches = continuations[rails.indexOf(stem)]
  if (branches.length > 3) return null

  const sides = branchSides(net, nodeId, stem.id, branches.map((seg) => seg.id))
  if (!sides) return null

  const [straightSegmentId, divergingSegmentId, divergingRightSegmentId] = orderBranches(sides)
  return declareTurnout(net, { nodeId, stemSegmentId: stem.id, straightSegmentId, divergingSegmentId, divergingRightSegmentId })
}

/**
 * Branches of a turnout in the order of its passages, from where they lie: straight then diverging
 * for two branches; the middle one, the left one, the right one for three.
 */
function orderBranches(sides: BranchSide[]): SegmentId[] {
  if (sides.length === 3) {
    const [left, straight, right] = [...sides].sort((a, b) => b.offset - a.offset || a.segId.localeCompare(b.segId))
    return [straight.segId, left.segId, right.segId]
  }
  return orderStraightFirst(sides[0], sides[1]).map((side) => side.segId)
}

/**
 * Re-read the roles of a turnout from its geometry, leaving it open on the same rail. For tables
 * that come from outside (an older save file, whose roles were settled by the order of the rails).
 */
export function normalizeTurnoutRoles(net: Network, junc: Junction): void {
  if (!isTurnoutKind(junc) || junc.passages.length < 2) return
  const stemId = junc.passages[0].a
  const sides = branchSides(net, junc.nodeId, stemId, junc.passages.map((p) => p.b))
  if (!sides) return
  const openRail = junc.passages[junc.active]?.b
  const branches = orderBranches(sides)
  junc.passages = branches.map((b) => ({ a: stemId, b }))
  junc.active = Math.max(0, branches.indexOf(openRail))
}

/**
 * Of two branches, the straight one first: the one closer to the stem axis; when they are as close
 * (a symmetric Y), a straight rail before a curve, then the branch on the right hand.
 */
function orderStraightFirst(a: BranchSide, b: BranchSide): [BranchSide, BranchSide] {
  const gap = Math.abs(a.offset) - Math.abs(b.offset)
  const tolerance = 1e-6 * Math.max(1, Math.abs(a.offset), Math.abs(b.offset))
  if (Math.abs(gap) > tolerance) return gap < 0 ? [a, b] : [b, a]
  if (a.kind !== b.kind) return a.kind === 'straight' ? [a, b] : [b, a]
  return a.offset <= b.offset ? [a, b] : [b, a]
}

/**
 * Bring the route tables in line with the track after it was edited. A table is declared once and
 * then only follows its rails: nothing here re-derives the roles of a turnout that still has the
 * rails it names, so calling it again changes nothing and the order of the rails at a node never matters.
 * - a table whose node is gone is removed, and so is a second table on the same node;
 * - a rail that disappeared, or a branch bent into a corner no train can take, takes its passages
 *   with it; the device stays on the rail that was open when it survives, a 3-way becomes a
 *   turnout, and a turnout left with one branch is removed;
 * - a turnout whose stem gets a third branch becomes a 3-way, open on the same rail;
 * - a turnout one of whose branches is prolonged back through the points is two tracks crossing:
 *   its table is removed, and each track runs straight through;
 * - any other extra rail leaves the table alone and follows the default rule;
 * - a fork that has no table gets the one `proposeJunction` reads from its geometry.
 * Returns the tables of the network.
 */
export function syncJunctions(net: Network): Junction[] {
  const seen = new Set<NodeId>()
  for (const junc of [...net.junctions.values()]) {
    if (!net.nodes.has(junc.nodeId) || seen.has(junc.nodeId)) {
      net.junctions.delete(junc.id)
      continue
    }
    seen.add(junc.nodeId)
    const rails = new Set((net.adjacency.get(junc.nodeId) ?? []).filter((sid) => net.segments.has(sid)))

    if (!dropDeadPassages(net, junc, rails)) {
      net.junctions.delete(junc.id)
      continue
    }
    if (isTurnoutKind(junc)) {
      const named = new Set(junctionRails(junc))
      const extras = [...rails].filter((sid) => !named.has(sid))
      if (extras.some((sid) => continuesABranch(net, junc, sid))) {
        net.junctions.delete(junc.id)
        continue
      }
      if (junc.kind === 'turnout' && extras.length === 1) addThirdBranch(net, junc, extras[0])
    }
  }

  for (const [nodeId, adj] of net.adjacency) {
    if (adj.length >= 3 && !findJunctionAtNode(net, nodeId)) proposeJunction(net, nodeId)
  }
  return [...net.junctions.values()]
}

/** Former name of `syncJunctions` */
export const autoDetectJunctions = syncJunctions

/**
 * Remove from a table the passages that no longer exist: over a rail the node has lost, between a
 * rail and itself, listed twice (two rails that became one), or — on a turnout — bent into a corner
 * no train can take. The device stays on the rail that was open when it can. Returns false when it
 * is left without a choice to make (fewer than two positions) and should be removed.
 */
function dropDeadPassages(net: Network, junc: Junction, rails: Set<SegmentId>): boolean {
  const samePair = (p: Passage, q: Passage) => (p.a === q.a && p.b === q.b) || (p.a === q.b && p.b === q.a)
  const takable = (p: Passage): boolean => {
    if (!isTurnoutKind(junc)) return true
    const a = net.segments.get(p.a)
    const b = net.segments.get(p.b)
    return !!a && !!b && isTraversableDeflection(leaveDirection(net, a, junc.nodeId), leaveDirection(net, b, junc.nodeId))
  }
  // For each passage, its index among the ones kept (a repeated pair maps onto its first occurrence)
  const passages: Passage[] = []
  const mapped = junc.passages.map((p) => {
    if (p.a === p.b || !rails.has(p.a) || !rails.has(p.b) || !takable(p)) return -1
    const first = passages.findIndex((q) => samePair(p, q))
    return first >= 0 ? first : passages.push(p) - 1
  })
  const unchanged = passages.length === junc.passages.length
  if (unchanged) return junc.positions.length >= 2

  const openBefore = (junc.positions[junc.active] ?? []).map((i) => junc.passages[i])
  const positions: number[][] = []
  for (const position of junc.positions) {
    const kept = [...new Set(position.map((i) => mapped[i]).filter((i) => i >= 0))]
    if (kept.length > 0 && !positions.some((other) => other.join() === kept.join())) positions.push(kept)
  }
  if (positions.length < 2) return false

  const active = positions.findIndex((position) => position.some((i) => openBefore.some((p) => samePair(p, passages[i]))))
  const wasThreeWay = junc.kind === 'three_way'
  junc.passages = passages
  junc.positions = positions
  junc.active = Math.max(0, active)
  if (wasThreeWay && passages.length === 2) {
    // What is left is a plain turnout: which branch is the straight one is read again
    junc.kind = 'turnout'
    normalizeTurnoutRoles(net, junc)
  }
  return true
}

/** True when a rail the turnout does not name lines up with one of its branches: a second track through the points */
function continuesABranch(net: Network, junc: Junction, extraSegId: SegmentId): boolean {
  const extra = net.segments.get(extraSegId)
  if (!extra) return false
  const extraRay = leaveDirection(net, extra, junc.nodeId)
  return junc.passages.some((p) => {
    const branch = net.segments.get(p.b)
    return !!branch && isTraversableDeflection(extraRay, leaveDirection(net, branch, junc.nodeId))
  })
}

/** Turn a turnout into a 3-way when the extra rail of its node is a third branch of its stem */
function addThirdBranch(net: Network, junc: Junction, extraSegId: SegmentId): void {
  const stemId = junc.passages[0]?.a
  const stem = stemId ? net.segments.get(stemId) : undefined
  const extra = net.segments.get(extraSegId)
  if (!stemId || !stem || !extra || junc.passages.length !== 2) return
  if (!isTraversableDeflection(leaveDirection(net, stem, junc.nodeId), leaveDirection(net, extra, junc.nodeId))) return
  const sides = branchSides(net, junc.nodeId, stemId, [...junc.passages.map((p) => p.b), extraSegId])
  if (!sides) return

  const openRail = junc.passages[junc.active]?.b
  const branches = orderBranches(sides)
  junc.kind = 'three_way'
  junc.passages = branches.map((b) => ({ a: stemId, b }))
  junc.positions = branches.map((_, i) => [i])
  junc.active = Math.max(0, branches.indexOf(openRail))
}

/**
 * Place a complete Kato turnout starting from apex node along a direction.
 * Creates the straight branch and curved diverging branch according to frog spec.
 */
export function placeTurnout(
  net: Network,
  options: {
    startPos: Point
    direction: Point
    frogNumber: 4 | 6
    hand: 'left' | 'right'
    stemNodeId?: NodeId
  },
): {
  /** Null when the apex has no rail to be the stem: the two branches are laid but nothing chooses between them */
  junction: Junction | null
  apexNode: RailNode
  straightNode: RailNode
  divergingNode: RailNode
} {
  const spec = TURNOUT_SPECS[options.frogNumber]
  const dirLen = Math.hypot(options.direction.x, options.direction.y)
  const dir = dirLen > 0 ? { x: options.direction.x / dirLen, y: options.direction.y / dirLen } : { x: 1, y: 0 }

  // 1. Apex node (where tracks branch)
  let apexNode: RailNode
  if (options.stemNodeId) {
    apexNode = net.nodes.get(options.stemNodeId) ?? addNode(net, options.startPos)
  } else {
    apexNode = addNode(net, options.startPos)
  }
  const railsBefore = [...(net.adjacency.get(apexNode.id) ?? [])]

  // 2. Straight branch
  const straightEnd = computeStraightPiece(apexNode.pos, dir, spec.straightLength)
  const straightNode = addNode(net, straightEnd)
  const straightSeg = addSegment(net, apexNode.id, straightNode.id)!

  // 3. Diverging branch
  const side: 1 | -1 = options.hand === 'left' ? 1 : -1
  const { end: divEnd, via: divVia } = computeCurvePiece(
    apexNode.pos,
    dir,
    spec.divergingRadius,
    side,
    spec.divergingAngle,
  )
  const divergingNode = addNode(net, divEnd)
  const divergingSeg = addCurveSegment(net, apexNode.id, divergingNode.id, divVia)!

  // 4. Declare the turnout: its stem is the rail already at the apex that the straight branch continues
  const straightLeave = leaveDirection(net, straightSeg, apexNode.id)
  const stemSegId = railsBefore.find((sid) => {
    const seg = net.segments.get(sid)
    return !!seg && isTraversableDeflection(leaveDirection(net, seg, apexNode.id), straightLeave)
  })
  const junction = stemSegId
    ? declareTurnout(net, {
        nodeId: apexNode.id,
        stemSegmentId: stemSegId,
        straightSegmentId: straightSeg.id,
        divergingSegmentId: divergingSeg.id,
        frogNumber: options.frogNumber,
      })
    : null

  return { junction, apexNode, straightNode, divergingNode }
}

/**
 * Split an existing segment into two connected segments at a given split position.
 * Preserves curvature and G1 tangency if segment is curved.
 */
export function splitSegment(
  net: Network,
  segmentId: SegmentId,
  splitPoint: Point,
): { midNode: RailNode; seg1: Segment; seg2: Segment } | null {
  const seg = net.segments.get(segmentId)
  if (!seg) return null
  const nodeA = net.nodes.get(seg.from)
  const nodeB = net.nodes.get(seg.to)
  if (!nodeA || !nodeB) return null

  // Create intermediate node at split point
  const midNode = addNode(net, splitPoint)

  if (seg.kind === 'straight') {
    const dx = nodeB.pos.x - nodeA.pos.x
    const dy = nodeB.pos.y - nodeA.pos.y
    const lenSq = dx * dx + dy * dy
    if (lenSq > 0) {
      const t = Math.max(0.005, Math.min(0.995, ((splitPoint.x - nodeA.pos.x) * dx + (splitPoint.y - nodeA.pos.y) * dy) / lenSq))
      midNode.pos = { x: nodeA.pos.x + t * dx, y: nodeA.pos.y + t * dy }
    }
    // Replace straight A-B with A-mid and mid-B
    removeSegment(net, segmentId, false)
    const seg1 = addChildSegment(net, seg, nodeA.id, midNode.id)!
    const seg2 = addChildSegment(net, seg, midNode.id, nodeB.id)!
    replaceJunctionRail(net, segmentId, [seg1, seg2])
    return { midNode, seg1, seg2 }
  } else if (seg.kind === 'curve' && seg.via) {
    const p0 = nodeA.pos
    const p1 = seg.via
    const p2 = nodeB.pos

    let bestT = 0.5
    let bestDistSq = Infinity
    const SAMPLES = 32
    for (let i = 1; i < SAMPLES; i++) {
      const s = i / SAMPLES
      const pt = bezierPoint(s, p0, p1, p2)
      const dSq = (pt.x - splitPoint.x) ** 2 + (pt.y - splitPoint.y) ** 2
      if (dSq < bestDistSq) {
        bestDistSq = dSq
        bestT = s
      }
    }
    const t = Math.max(0.01, Math.min(0.99, bestT))

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
    midNode.pos = bt

    removeSegment(net, segmentId, false)
    const seg1 = addChildSegment(net, seg, nodeA.id, midNode.id, q0)!
    const seg2 = addChildSegment(net, seg, midNode.id, nodeB.id, q1)!
    replaceJunctionRail(net, segmentId, [seg1, seg2])
    return { midNode, seg1, seg2 }
  }

  return null
}

/**
 * Fuse two nodes together (weld nodeB into nodeA).
 * Moves all connections of nodeB to nodeA and deletes nodeB.
 */
export function weldNodes(net: Network, keepNodeId: NodeId, removeNodeId: NodeId): boolean {
  if (keepNodeId === removeNodeId) return false
  const keepNode = net.nodes.get(keepNodeId)
  const removeNode = net.nodes.get(removeNodeId)
  if (!keepNode || !removeNode) return false

  const removeSegIds = [...(net.adjacency.get(removeNodeId) ?? [])]
  const keepSegIds = net.adjacency.get(keepNodeId) ?? []

  for (const sid of removeSegIds) {
    const seg = net.segments.get(sid)
    if (!seg) continue

    // If this segment directly connects keepNode and removeNode, remove it
    if ((seg.from === keepNodeId && seg.to === removeNodeId) || (seg.from === removeNodeId && seg.to === keepNodeId)) {
      net.segments.delete(sid)
      const idx = keepSegIds.indexOf(sid)
      if (idx >= 0) keepSegIds.splice(idx, 1)
      continue
    }

    // Re-route segment to keepNode
    if (seg.from === removeNodeId) seg.from = keepNodeId
    if (seg.to === removeNodeId) seg.to = keepNodeId

    if (!keepSegIds.includes(sid)) {
      keepSegIds.push(sid)
    }
  }

  // The table of the removed node follows its rails to the kept node, unless that node has its own
  const moved = findJunctionAtNode(net, removeNodeId)
  if (moved) {
    if (findJunctionAtNode(net, keepNodeId)) net.junctions.delete(moved.id)
    else moved.nodeId = keepNodeId
  }

  net.nodes.delete(removeNodeId)
  net.adjacency.delete(removeNodeId)
  return true
}

/**
 * Track that toggleTurnoutHand relocates: it moves the end node of the diverging branch (and the
 * control point of that branch), so every rail attached to that node changes shape — the branch
 * itself and whatever continues it or hangs off its end. Nothing further away moves.
 */
export function turnoutHandFlipSegments(net: Network, junction: Junction): SegmentId[] {
  const view = turnoutView(net, junction)
  if (!view || view.hand === 'three_way') return []
  return [...new Set([view.divergingSegmentId, ...(net.adjacency.get(view.divergingNodeId) ?? [])])]
}

/**
 * Toggle the hand (left <-> right) of a turnout, mirroring the diverging branch
 * across the straight axis. See turnoutHandFlipSegments for the track this moves.
 */
export function toggleTurnoutHand(net: Network, junctionId: JunctionId): boolean {
  const junc = net.junctions.get(junctionId)
  const view = junc ? turnoutView(net, junc) : null
  if (!junc || !view || view.hand === 'three_way') return false

  const apex = net.nodes.get(junc.nodeId)
  const straightNode = net.nodes.get(view.straightNodeId)
  const divNode = net.nodes.get(view.divergingNodeId)
  const divSeg = net.segments.get(view.divergingSegmentId)

  if (!apex || !straightNode || !divNode) return false

  // Straight axis vector A -> B
  const ax = straightNode.pos.x - apex.pos.x
  const ay = straightNode.pos.y - apex.pos.y
  const aLen = Math.hypot(ax, ay)
  if (aLen === 0) return false

  const ux = ax / aLen
  const uy = ay / aLen
  // Normal vector
  const nx = -uy
  const ny = ux

  const apexPos = apex.pos

  // Reflect function across axis
  function reflectPoint(p: Point): Point {
    const rx = p.x - apexPos.x
    const ry = p.y - apexPos.y
    const t = rx * ux + ry * uy
    const d = rx * nx + ry * ny
    return {
      x: apexPos.x + t * ux - d * nx,
      y: apexPos.y + t * uy - d * ny,
    }
  }

  divNode.pos = reflectPoint(divNode.pos)
  if (divSeg && divSeg.via) {
    divSeg.via = reflectPoint(divSeg.via)
  }

  return true
}
