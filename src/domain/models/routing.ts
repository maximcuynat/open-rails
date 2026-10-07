import type { Junction, Network, NodeId, Point, Segment, SegmentId } from './types'
import { touchNetwork } from './networkWatch'
import { segmentTangentAt, isTraversableDeflection, transitionDeflectionDeg } from '../geometry/tangent'

/**
 * Routing through a node. Everything that moves along the track (trains, route previews, path
 * search) and everything that draws a turnout asks its questions here, so they cannot disagree.
 *
 * Two rails of a node are joined by a passage when:
 * - the route table of the node (`Junction`) lists the pair — the passage is open in the positions
 *   that include it;
 * - or neither rail is named by the table and one continues the other: a train leaving a rail the
 *   table does not name takes the straightest of the other unnamed rails. This makes a plain joint
 *   of a node with two rails and a fixed crossing of two tracks sharing a node.
 * Whatever the table says, a train cannot take a corner: both rails must also meet within
 * `MAX_TRANSITION_DEFLECTION_DEG`.
 */

export interface PassageQuery {
  /** Accept a passage of the table whatever the current position (default: only open passages) */
  anyPosition?: boolean
  /** Let a rail the table does not name lead to any rail it meets within the deflection limit, not only the straightest */
  anyContinuation?: boolean
}

/** Unit direction in which a rail leaves a node */
export function leaveDirection(net: Network, seg: Segment, nodeId: NodeId): Point {
  const tan = segmentTangentAt(net, seg, nodeId)
  if (tan) {
    const isFrom = seg.from === nodeId
    const rx = isFrom ? tan.x : -tan.x
    const ry = isFrom ? tan.y : -tan.y
    const len = Math.hypot(rx, ry)
    if (len > 1e-5) return { x: rx / len, y: ry / len }
  }
  const otherId = seg.from === nodeId ? seg.to : seg.from
  const nA = net.nodes.get(nodeId)
  const nB = net.nodes.get(otherId)
  if (nA && nB) {
    const dx = nB.pos.x - nA.pos.x
    const dy = nB.pos.y - nA.pos.y
    const len = Math.hypot(dx, dy)
    if (len > 1e-5) return { x: dx / len, y: dy / len }
  }
  return { x: 1, y: 0 }
}

/** The tables of a network by the node they sit on, as they were when the index was built */
interface JunctionIndex {
  junctions: Network['junctions']
  size: number
  byNode: Map<NodeId, Junction>
}

const junctionIndexes = new WeakMap<Network, JunctionIndex>()

function buildJunctionIndex(net: Network): JunctionIndex {
  const byNode = new Map<NodeId, Junction>()
  for (const junc of net.junctions.values()) {
    // The first table of a node wins, as when the tables are read in order
    if (!byNode.has(junc.nodeId)) byNode.set(junc.nodeId, junc)
  }
  const index = { junctions: net.junctions, size: net.junctions.size, byNode }
  junctionIndexes.set(net, index)
  return index
}

/**
 * Forget the index `findJunctionAtNode` answers from. To be called by whatever adds a table,
 * removes one or moves one to another node: the index is also rebuilt when the number of tables
 * changed and when the table it finds is no longer the one of that node, but a table that appears
 * on a node while another goes cannot be seen from there.
 */
export function invalidateJunctionIndex(net: Network): void {
  junctionIndexes.delete(net)
  // A table moved to another node was changed in place: the network itself is told too
  touchNetwork(net, null)
}

/**
 * A table was put into `net.junctions`, under a new id or in place of the one it had: the index
 * takes it in when that is all that happened since it was built, and is forgotten otherwise. Laying
 * the tables of a large network one after the other then costs one index, not one per table.
 */
export function junctionAdded(net: Network, junction: Junction): void {
  const index = junctionIndexes.get(net)
  if (index && index.junctions === net.junctions && index.size === net.junctions.size - 1) {
    // A new table comes last: the first table of a node wins, as when the index is built
    if (!index.byNode.has(junction.nodeId)) index.byNode.set(junction.nodeId, junction)
    index.size++
    return
  }
  junctionIndexes.delete(net)
}

/**
 * The route table of a node, if it has one. Asked for every rail end at every frame and at every
 * step of a train, so it is answered from an index by node instead of reading all the tables.
 */
export function findJunctionAtNode(net: Network, nodeId: NodeId): Junction | undefined {
  let index = junctionIndexes.get(net)
  if (!index || index.junctions !== net.junctions || index.size !== net.junctions.size) {
    index = buildJunctionIndex(net)
  }
  const found = index.byNode.get(nodeId)
  if (found && (found.nodeId !== nodeId || net.junctions.get(found.id) !== found)) {
    return buildJunctionIndex(net).byNode.get(nodeId)
  }
  return found
}

/** Every rail the table names */
export function junctionRails(junction: Junction): SegmentId[] {
  const rails = new Set<SegmentId>()
  for (const p of junction.passages) {
    rails.add(p.a)
    rails.add(p.b)
  }
  return [...rails]
}

function namesRail(junction: Junction, segId: SegmentId): boolean {
  return junction.passages.some((p) => p.a === segId || p.b === segId)
}

function isOpenIndex(junction: Junction, index: number): boolean {
  return junction.positions[junction.active]?.includes(index) ?? false
}

/** Rails of the node that still exist */
function railsAt(net: Network, nodeId: NodeId): Segment[] {
  const rails: Segment[] = []
  for (const sid of net.adjacency.get(nodeId) ?? []) {
    const seg = net.segments.get(sid)
    if (seg) rails.push(seg)
  }
  return rails
}

/** A rail of a node seen from another one of its rails */
interface Candidate {
  id: SegmentId
  deflection: number
  bearing: number
  curved: boolean
}

function candidate(net: Network, nodeId: NodeId, seg: Segment, rayFrom: Point): Candidate {
  const ray = leaveDirection(net, seg, nodeId)
  return {
    id: seg.id,
    deflection: transitionDeflectionDeg(rayFrom, ray),
    bearing: Math.atan2(ray.y, ray.x),
    curved: seg.kind === 'curve' && !!seg.via,
  }
}

/**
 * Straightest first. Equal deflections are settled by what the rails are — their compass direction,
 * a straight rail before a curve leaving tangent to it, their id — never by the order in which they
 * are listed at the node, which changes when a rail is cut, undone or loaded.
 */
function straightestFirst(a: Candidate, b: Candidate): number {
  if (Math.abs(a.deflection - b.deflection) > 1e-9) return a.deflection - b.deflection
  if (Math.abs(a.bearing - b.bearing) > 1e-9) return a.bearing - b.bearing
  if (a.curved !== b.curved) return a.curved ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The rail that continues `inSeg` among those the table of the node does not name: the one it
 * meets with the smallest deflection, within the limit (see `straightestFirst` for equal ones).
 */
function straightestContinuation(
  net: Network,
  nodeId: NodeId,
  inSeg: Segment,
  junction: Junction | undefined,
): SegmentId | null {
  const rayIn = leaveDirection(net, inSeg, nodeId)
  const candidates = railsAt(net, nodeId)
    .filter((seg) => seg.id !== inSeg.id && !(junction && namesRail(junction, seg.id)))
    .filter((seg) => isTraversableDeflection(rayIn, leaveDirection(net, seg, nodeId)))
    .map((seg) => candidate(net, nodeId, seg, rayIn))
    .sort(straightestFirst)
  return candidates[0]?.id ?? null
}

/** Can a train arriving at the node on `inSegId` leave it on `outSegId`? */
export function isPassageOpen(
  net: Network,
  nodeId: NodeId,
  inSegId: SegmentId,
  outSegId: SegmentId,
  query: PassageQuery = {},
): boolean {
  if (inSegId === outSegId) return false
  const inSeg = net.segments.get(inSegId)
  const outSeg = net.segments.get(outSegId)
  if (!inSeg || !outSeg) return false
  if (!isTraversableDeflection(leaveDirection(net, inSeg, nodeId), leaveDirection(net, outSeg, nodeId))) return false

  const junction = findJunctionAtNode(net, nodeId)
  if (junction) {
    const index = junction.passages.findIndex(
      (p) => (p.a === inSegId && p.b === outSegId) || (p.a === outSegId && p.b === inSegId),
    )
    if (index >= 0) return query.anyPosition === true || isOpenIndex(junction, index)
    if (namesRail(junction, inSegId) || namesRail(junction, outSegId)) return false
  }
  return query.anyContinuation === true || straightestContinuation(net, nodeId, inSeg, junction) === outSegId
}

/**
 * Rails a train arriving on `inSegId` can leave the node on, straightest first. With
 * `anyPosition`, every rail the device could send it to, whatever its current position.
 */
export function exitsOf(net: Network, nodeId: NodeId, inSegId: SegmentId, query: PassageQuery = {}): SegmentId[] {
  const inSeg = net.segments.get(inSegId)
  if (!inSeg) return []
  const rayIn = leaveDirection(net, inSeg, nodeId)
  return railsAt(net, nodeId)
    .filter((seg) => isPassageOpen(net, nodeId, inSegId, seg.id, query))
    .map((seg) => candidate(net, nodeId, seg, rayIn))
    .sort(straightestFirst)
    .map((exit) => exit.id)
}

/** The rail a train arriving on `inSegId` leaves the node on, or null when the track ends there for it */
export function openExit(net: Network, nodeId: NodeId, inSegId: SegmentId): SegmentId | null {
  return exitsOf(net, nodeId, inSegId)[0] ?? null
}

/** True when the table of the node names the rail and no open passage leads to it: its points are set against it */
export function isRailClosedAt(net: Network, segId: SegmentId, nodeId: NodeId): boolean {
  const junction = findJunctionAtNode(net, nodeId)
  if (!junction || !namesRail(junction, segId)) return false
  return !junction.passages.some((p, i) => (p.a === segId || p.b === segId) && isOpenIndex(junction, i))
}

/**
 * Rails a train now leaving the node on `outSegId` can have arrived by, straightest first: where
 * the rest of the train lies behind it, and where it goes when it backs up.
 */
export function entriesOf(net: Network, nodeId: NodeId, outSegId: SegmentId, query: PassageQuery = {}): SegmentId[] {
  const outSeg = net.segments.get(outSegId)
  if (!outSeg) return []
  const rayOut = leaveDirection(net, outSeg, nodeId)
  return railsAt(net, nodeId)
    .filter((seg) => isPassageOpen(net, nodeId, seg.id, outSegId, query))
    .map((seg) => candidate(net, nodeId, seg, rayOut))
    .sort(straightestFirst)
    .map((entry) => entry.id)
}
