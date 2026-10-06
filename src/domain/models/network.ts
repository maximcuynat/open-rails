import type { Network, NodeId, Point, RailNode, Segment, SegmentId } from './types'
import { segmentShapeLength } from '../geometry/segmentGeometry'
import { closestCurveParam, curveLength, distToCurve, splitCurveIntoArcPieces, type CurvePiece } from '../geometry/curve'
import { generateId, resetIdCounter } from './ids'
import { remapSignals } from './signals'
import { remapSpeedZones } from './speedZones'
import { duplicateReplacement, mergeReplacements, notifyRailReplaced, removalReplacement, type RailReplacement } from './trackObjects'

export { generateId, resetIdCounter }

/**
 * Scan all node, segment, junction, speed zone and signal IDs in the network and update
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
  for (const id of net.speedZones.keys()) scan(id)
  for (const id of net.signals.keys()) scan(id)
  resetIdCounter(max)
}

export function createNetwork(): Network {
  return { nodes: new Map(), segments: new Map(), adjacency: new Map(), junctions: new Map(), speedZones: new Map(), signals: new Map() }
}

/** Add a node at `pos`, at height `level` (in levels, 0 = ground; see `RailNode.level`). */
export function addNode(net: Network, pos: Point, level = 0): RailNode {
  const node: RailNode = { id: generateId('n'), pos: { ...pos } }
  if (level !== 0) node.level = clampLevel(level)
  net.nodes.set(node.id, node)
  net.adjacency.set(node.id, [])
  return node
}

/** Via points closer than this (meters) describe the same curve between two given nodes */
const SAME_RAIL_EPSILON = 1e-9

/**
 * The rail that already joins two nodes with the same geometry, in either orientation:
 * a straight when `via` is omitted, otherwise a curve whose control point is within `viaTolerance`.
 * A straight and a curve, or two different curves, between the same nodes are different rails.
 */
export function findSameRail(
  net: Network,
  a: NodeId,
  b: NodeId,
  via?: Point,
  viaTolerance = SAME_RAIL_EPSILON,
): Segment | undefined {
  for (const sid of net.adjacency.get(a) ?? []) {
    const s = net.segments.get(sid)
    if (!s || !((s.from === a && s.to === b) || (s.from === b && s.to === a))) continue
    if (!via) {
      if (s.kind === 'straight' || !s.via) return s
    } else if (s.kind === 'curve' && s.via && Math.hypot(s.via.x - via.x, s.via.y - via.y) <= viaTolerance) {
      return s
    }
  }
  return undefined
}

/**
 * Join two nodes with a straight rail. There is never more than one straight between two nodes:
 * when one exists already (in either orientation) it is returned instead of a second one.
 * The rail runs from the height of `from` to the height of `to` (see `segmentEndLevels`).
 */
export function addSegment(net: Network, from: NodeId, to: NodeId): Segment | null {
  if (from === to) return null
  if (!net.nodes.has(from) || !net.nodes.has(to)) return null
  const existing = findSameRail(net, from, to)
  if (existing) return existing
  const seg: Segment = { id: generateId('s'), from, to, kind: 'straight' }
  net.segments.set(seg.id, seg)
  net.adjacency.get(from)!.push(seg.id)
  net.adjacency.get(to)!.push(seg.id)
  return seg
}

// ─────────────────── Heights (bridges, tunnels and ramps) ───────────────────
//
// The height of the track is a property of the nodes (`RailNode.level`, in levels, decimals
// allowed). A rail runs from the height of its `from` node to the height of its `to` node: flat
// when they are equal, a ramp otherwise. Nothing is stored on the rail itself.

export const MIN_LEVEL = -5
export const MAX_LEVEL = 5

/**
 * Two tracks interact (crossing, weld, split, duplicate) only where their heights differ by less
 * than this. For flat tracks on whole levels this is "they are on the same level".
 */
export const LEVEL_CLEARANCE = 0.5

/** True when two heights are close enough for the tracks to meet (see LEVEL_CLEARANCE). */
export function levelsMeet(h1: number, h2: number): boolean {
  return Math.abs(h1 - h2) < LEVEL_CLEARANCE
}

function clampLevel(level: number): number {
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level))
}

/** Height of a node: 0 on the ground, above for a bridge, below for a tunnel. */
export function nodeLevel(node: RailNode | undefined): number {
  return node?.level ?? 0
}

/** Heights of the two ends of a rail. */
export function segmentEndLevels(net: Network, seg: Segment): { from: number; to: number } {
  return { from: nodeLevel(net.nodes.get(seg.from)), to: nodeLevel(net.nodes.get(seg.to)) }
}

/**
 * Height of a rail at parameter `t` (0 at `from`, 1 at `to`): linear in `t`, which is exact when a
 * rail is cut at `t` and an accepted approximation of the arc length along a curve.
 */
export function segmentHeightAt(net: Network, seg: Segment, t: number): number {
  const ends = segmentEndLevels(net, seg)
  return ends.from + (ends.to - ends.from) * t
}

/** True when the two ends of a rail are at different heights. */
export function isRamp(net: Network, seg: Segment): boolean {
  const ends = segmentEndLevels(net, seg)
  return ends.from !== ends.to
}

/**
 * Whole level a rail is drawn and sorted with: the level its upper end reaches when that is above
 * ground, otherwise the level its lower end goes down to. 0 for a ground rail, 1 for a bridge or a
 * 0 → 1 ramp, −1 for a tunnel or a 0 → −1 ramp.
 */
export function segmentBand(net: Network, seg: Segment): number {
  const ends = segmentEndLevels(net, seg)
  const high = Math.max(ends.from, ends.to)
  if (high > 0) return Math.ceil(high)
  // `+ 0` turns the −0 of Math.floor(-0) into 0
  return Math.floor(Math.min(ends.from, ends.to)) + 0
}

/**
 * Put nodes at height `level` (clamped to MIN_LEVEL…MAX_LEVEL, not rounded). The ground is stored
 * as no field at all, so that a network without bridges serializes as it always did.
 * Returns the number of nodes whose height changed.
 */
export function setNodesLevel(net: Network, nodeIds: Iterable<NodeId>, level: number): number {
  const target = clampLevel(level)
  let changed = 0
  for (const id of nodeIds) {
    const node = net.nodes.get(id)
    if (!node || nodeLevel(node) === target) continue
    if (target === 0) delete node.level
    else node.level = target
    changed++
  }
  return changed
}

/**
 * Lay a rail that replaces (part of) `parent`, which was cut or merged: straight, or curved with
 * `via`. It hands down the ancestry of the rail (`ancestorId`, by default the parent's own
 * ancestor) and, to its curved pieces, the cant set by hand on it; heights need no handing down,
 * they are on the nodes. When the same rail already lies
 * there it is returned as it is, with its own ancestry.
 */
export function addChildSegment(
  net: Network,
  parent: Segment,
  from: NodeId,
  to: NodeId,
  via?: Point,
  ancestorId: SegmentId = parent.parentSegmentId ?? parent.id,
): Segment | null {
  const before = net.segments.size
  const seg = via ? addCurveSegment(net, from, to, via) : addSegment(net, from, to)
  if (seg && net.segments.size > before) {
    seg.parentSegmentId = ancestorId
    // A cant set by hand goes with the curve: each curved piece of the rail keeps it
    if (seg.kind === 'curve' && parent.cant !== undefined) seg.cant = parent.cant
  }
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
  // Same rule as addSegment: the identical curve is not laid a second time
  const existing = findSameRail(net, from, to, via)
  if (existing) return existing
  const seg: Segment = { id: generateId('s'), from, to, kind: 'curve', via: { ...via } }
  net.segments.set(seg.id, seg)
  net.adjacency.get(from)!.push(seg.id)
  net.adjacency.get(to)!.push(seg.id)
  return seg
}

/**
 * Drop the rails laid on top of another one between the same two nodes: a second straight, or a
 * curve whose control point is within `tolerance` of an earlier curve (and within 1 % of the chord,
 * so that a loose tolerance does not merge two genuinely different curves). The older rail is kept,
 * since trains may stand on it. (Two rails between the same two nodes are at the same height.)
 * Returns the number of rails removed.
 */
export function removeDuplicateSegments(net: Network, tolerance: number): number {
  let removed = 0
  for (const seg of Array.from(net.segments.values())) {
    if (!net.segments.has(seg.id)) continue
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) continue
    const isCurve = seg.kind === 'curve' && !!seg.via
    const viaTolerance = Math.min(2 * tolerance, 0.01 * Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y))
    // `seg` is the older one: the map iterates in insertion order
    for (const sid of [...(net.adjacency.get(seg.from) ?? [])]) {
      const other = net.segments.get(sid)
      if (!other || other.id === seg.id) continue
      if (!((other.from === seg.from && other.to === seg.to) || (other.from === seg.to && other.to === seg.from))) continue
      const otherIsCurve = other.kind === 'curve' && !!other.via
      if (isCurve !== otherIsCurve) continue
      if (isCurve && Math.hypot(other.via!.x - seg.via!.x, other.via!.y - seg.via!.y) > viaTolerance) continue
      replaceRail(net, duplicateReplacement(other, seg))
      detachSegment(net, other.id)
      removed++
    }
  }
  return removed
}

/**
 * Insert a chain of curve pieces between two existing nodes, creating one intermediate node
 * per joint. The first piece starts at `from`, the last one ends at `to`. The joints climb evenly
 * (by length) from the height of `from` to the height of `to`: all at that height when both agree.
 */
export function addCurveChain(
  net: Network,
  from: NodeId,
  to: NodeId,
  pieces: CurvePiece[],
): { segments: Segment[]; nodes: RailNode[] } | null {
  if (from === to || pieces.length === 0) return null
  if (!net.nodes.has(from) || !net.nodes.has(to)) return null
  const startLevel = nodeLevel(net.nodes.get(from))
  const rise = nodeLevel(net.nodes.get(to)) - startLevel
  const lengths = rise === 0 ? [] : pieces.map((p) => curveLength(p.start, p.via, p.end))
  const total = lengths.reduce((sum, len) => sum + len, 0)
  let run = 0
  const segments: Segment[] = []
  const nodes: RailNode[] = []
  let prevId = from
  for (let i = 0; i < pieces.length; i++) {
    const isLast = i === pieces.length - 1
    if (total > 0) run += lengths[i]
    const nextId = isLast ? to : addNode(net, pieces[i].end, startLevel + (total > 0 ? (rise * run) / total : 0)).id
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
      if (seg) replaceRail(net, removalReplacement(sid))
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
 * Returns the newly created segment if dissolved, or null if the node cannot be dissolved
 * (a node whose height is not the one the merged rail would have there is kept: removing it would
 * change the slope of the track without saying so).
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

  // The node must sit on the straight slope between its two neighbours
  const h1 = nodeLevel(node1)
  const h2 = nodeLevel(node2)
  if (Math.abs(nodeLevel(node) - (h1 + ((h2 - h1) * len1) / (len1 + len2))) > 1e-6) return null

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
  detachSegment(net, s1.id)
  detachSegment(net, s2.id)

  // Remove the intermediate node
  net.nodes.delete(id)
  net.adjacency.delete(id)

  // Connect node1 and node2 directly with a straight segment. When a straight already joins them
  // it takes over as it is: its own heritage is not overwritten.
  const newSeg = addChildSegment(net, s1, otherId1, otherId2, undefined, parentId)
  // What stood on the two rails stands on the merged one, each on its share of the length
  const replacements = newSeg
    ? mergeReplacements(s1, len1, s2, len2, id, newSeg)
    : [removalReplacement(s1.id), removalReplacement(s2.id)]
  for (const replacement of replacements) replaceRail(net, replacement)

  return newSeg
}

/**
 * The one place a rail replacement goes through: "rail `oldId` is replaced by these pieces" (cut in
 * two, merged with its neighbour, dropped as a duplicate of another rail, or — no piece — removed).
 * Everything attached to the track is moved from here: the route tables, the speed zones, the signals, and
 * whoever listens (`onRailReplaced`). Every function that makes a rail disappear must call it,
 * while the pieces are in the network; `models/trackObjects.ts` builds the replacement for each
 * case. A new kind of object held by `Network` is moved by one more line here.
 */
export function replaceRail(net: Network, replacement: RailReplacement): void {
  const pieces: Segment[] = []
  for (const piece of replacement.pieces) {
    const seg = net.segments.get(piece.segId)
    if (seg) pieces.push(seg)
  }
  replaceJunctionRail(net, replacement.oldId, pieces)
  remapSpeedZones(net, replacement)
  remapSignals(net, replacement)
  notifyRailReplaced(net, replacement)
}

/**
 * Tell the route tables that a rail was replaced by other rails (cut in pieces, or merged with its
 * neighbour): each table naming it now names the piece that touches its own node.
 */
function replaceJunctionRail(net: Network, oldSegId: SegmentId, pieces: Segment[]): void {
  for (const junc of net.junctions.values()) {
    const heir = pieces.find((seg) => seg.from === junc.nodeId || seg.to === junc.nodeId)
    if (!heir) continue
    for (const p of junc.passages) {
      if (p.a === oldSegId) p.a = heir.id
      if (p.b === oldSegId) p.b = heir.id
    }
  }
}

/**
 * Take a rail out of the graph and nothing else: its nodes stay and nobody is told. For the
 * operations that replace the rail and say so themselves through `replaceRail`; a rail that simply
 * goes away is removed with `removeSegment`.
 */
export function detachSegment(net: Network, id: SegmentId): void {
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

/** Remove a rail for good: what stood on it (see `replaceRail`) goes with it. */
export function removeSegment(net: Network, id: SegmentId, cleanOrphans = true): void {
  const seg = net.segments.get(id)
  if (!seg) return
  const fromId = seg.from
  const toId = seg.to

  replaceRail(net, removalReplacement(id))
  detachSegment(net, id)

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

/**
 * Distances closer than this (meters) are a tie when picking what is under the pointer: of two
 * stacked rails or nodes, the one that is higher at that place — the one that is seen — is picked.
 */
export const LEVEL_TIE_EPSILON = 1e-6

/** True when a candidate at distance `d` on `level` beats the best one so far */
export function isCloserOrAbove(d: number, level: number, bestD: number, bestLevel: number): boolean {
  if (level === bestLevel) return d < bestD
  return level > bestLevel ? d <= bestD + LEVEL_TIE_EPSILON : d < bestD - LEVEL_TIE_EPSILON
}

/**
 * Find the closest node to a point within a max radius (the upper one of two stacked nodes).
 * With `accept`, only among the nodes it lets through.
 */
export function hitNode(
  net: Network,
  pos: Point,
  maxDist: number,
  accept?: (node: RailNode) => boolean,
): NodeId | null {
  let best: NodeId | null = null
  let bestD = maxDist
  let bestLevel = 0
  for (const node of net.nodes.values()) {
    const d = dist(pos, node.pos)
    if (d >= maxDist) continue
    if (accept && !accept(node)) continue
    const level = nodeLevel(node)
    if (best === null || isCloserOrAbove(d, level, bestD, bestLevel)) {
      bestD = d
      bestLevel = level
      best = node.id
    }
  }
  return best
}

/**
 * Slope of a rail in ‰, positive when it climbs from `from` to `to`: its rise (in levels, times
 * the height of one level in world metres) over its length. 0 for a flat rail.
 */
export function segmentGradient(net: Network, seg: Segment, levelHeight: number): number {
  const ends = segmentEndLevels(net, seg)
  const rise = (ends.to - ends.from) * levelHeight
  if (rise === 0) return 0
  const length = segmentRunLength(net, seg)
  return length > 0 ? (rise / length) * 1000 : 0
}

/** Length of a rail on the plan (world metres), the run its slope is measured over. 0 when an end is missing. */
export function segmentRunLength(net: Network, seg: Segment): number {
  return segmentShapeLength(net, seg)
}

/**
 * The rails `segmentIds` as one run laid end to end, or null when they are not one: fewer than two
 * rails, a fork or a loop among them, or several separate stretches. Rails outside the list do not
 * count: a turnout along the run is fine as long as its branch is not part of it.
 * `nodeIds` are in order from one end to the other (one more than `lengths`, the length of the rail
 * between each node and the next); which end comes first follows the order of the network, so the
 * result is stable for a given set of rails.
 */
export function gradientRun(
  net: Network,
  segmentIds: Iterable<SegmentId>,
): { nodeIds: NodeId[]; lengths: number[] } | null {
  const rails = new Map<SegmentId, Segment>()
  for (const id of segmentIds) {
    const seg = net.segments.get(id)
    if (seg) rails.set(id, seg)
  }
  if (rails.size < 2) return null

  // Rails of the run at each node: one at the two ends, two everywhere else
  const atNode = new Map<NodeId, Segment[]>()
  for (const seg of rails.values()) {
    if (seg.from === seg.to) return null
    for (const nid of [seg.from, seg.to]) {
      const list = atNode.get(nid)
      if (list) list.push(seg)
      else atNode.set(nid, [seg])
    }
  }
  const ends: NodeId[] = []
  for (const [nid, list] of atNode) {
    if (list.length > 2) return null
    if (list.length === 1) ends.push(nid)
  }
  if (ends.length !== 2) return null

  const nodeIds: NodeId[] = [ends[0]]
  const lengths: number[] = []
  let previous: Segment | undefined
  let current = ends[0]
  while (current !== ends[1]) {
    const next: Segment | undefined = atNode.get(current)!.find((seg) => seg !== previous)
    if (!next) return null
    current = next.from === current ? next.to : next.from
    nodeIds.push(current)
    lengths.push(segmentRunLength(net, next))
    previous = next
  }
  // Two ends and every rail walked: one stretch, no loop left aside
  return lengths.length === rails.size ? { nodeIds, lengths } : null
}

/** One rail of a ramp, as the ramp is climbed */
export interface RampRail {
  segId: SegmentId
  /** True when the rail climbs from its `from` node to its `to` node */
  climbsForward: boolean
  /** Distance from the foot of the ramp to the low end of the rail, m */
  offset: number
  /** Length of the rail on the plan, m */
  length: number
}

/** Rails that follow each other on one slope, from the foot of the ramp to its top */
export interface GradientRamp {
  rails: RampRail[]
  footNode: NodeId
  topNode: NodeId
  /** Length on the plan, m */
  length: number
  /** Slope in ‰, always positive: the rise of the whole ramp over its length */
  gradient: number
}

/** Two rails that follow each other are one ramp when their slopes differ by no more than this (‰) */
const SAME_RAMP_TOLERANCE = 0.5

/**
 * The ramps of the network: every rail that is not level, grouped with the rails that carry the
 * same slope on (`segmentGradient`, within `SAME_RAMP_TOLERANCE`) through the nodes that join two
 * rails only, and put in order from the foot to the top (`gradientRun`). A change of slope, a
 * summit, a dip or a fork ends a ramp. Slopes are a matter of every scale.
 */
export function gradientRamps(net: Network, levelHeight: number): GradientRamp[] {
  /** Signed slope of each rail that is not level */
  const slopes = new Map<SegmentId, number>()
  for (const seg of net.segments.values()) {
    const slope = segmentGradient(net, seg, levelHeight)
    if (slope !== 0 && Number.isFinite(slope)) slopes.set(seg.id, slope)
  }
  if (slopes.size === 0) return []

  // Rails of one ramp share a group; a node joins its two rails when one climbs to it and the
  // other climbs on from it, at the same rate
  const group = new Map<SegmentId, SegmentId>()
  const find = (id: SegmentId): SegmentId => {
    let root = id
    while (group.get(root) !== root) root = group.get(root)!
    group.set(id, root)
    return root
  }
  for (const id of slopes.keys()) group.set(id, id)
  for (const [nodeId, railIds] of net.adjacency) {
    if (railIds.length !== 2 || railIds[0] === railIds[1]) continue
    const a = net.segments.get(railIds[0])
    const b = net.segments.get(railIds[1])
    const slopeA = a && slopes.get(a.id)
    const slopeB = b && slopes.get(b.id)
    if (!a || !b || slopeA === undefined || slopeB === undefined) continue
    const arrivesClimbing = (seg: Segment, slope: number): boolean => (seg.to === nodeId) === slope > 0
    if (arrivesClimbing(a, slopeA) === arrivesClimbing(b, slopeB)) continue
    if (Math.abs(Math.abs(slopeA) - Math.abs(slopeB)) > SAME_RAMP_TOLERANCE) continue
    group.set(find(a.id), find(b.id))
  }
  const members = new Map<SegmentId, SegmentId[]>()
  for (const id of slopes.keys()) {
    const root = find(id)
    const list = members.get(root)
    if (list) list.push(id)
    else members.set(root, [id])
  }

  const ramps: GradientRamp[] = []
  const build = (orderedNodes: NodeId[], lengths: number[], railAt: (i: number) => Segment): void => {
    const climbing = nodeLevel(net.nodes.get(orderedNodes[0])) <= nodeLevel(net.nodes.get(orderedNodes[orderedNodes.length - 1]))
    const count = lengths.length
    const rails: RampRail[] = []
    let offset = 0
    for (let k = 0; k < count; k++) {
      const i = climbing ? k : count - 1 - k
      const seg = railAt(i)
      const low = climbing ? orderedNodes[i] : orderedNodes[i + 1]
      rails.push({ segId: seg.id, climbsForward: seg.from === low, offset, length: lengths[i] })
      offset += lengths[i]
    }
    const footNode = climbing ? orderedNodes[0] : orderedNodes[count]
    const topNode = climbing ? orderedNodes[count] : orderedNodes[0]
    const rise = (nodeLevel(net.nodes.get(topNode)) - nodeLevel(net.nodes.get(footNode))) * levelHeight
    if (offset > 0) ramps.push({ rails, footNode, topNode, length: offset, gradient: (rise / offset) * 1000 })
  }
  for (const ids of members.values()) {
    const run = ids.length > 1 ? gradientRun(net, ids) : null
    if (run) {
      // The rail between each node of the run and the next
      const between = (i: number): Segment =>
        ids.map((id) => net.segments.get(id)!).find((seg) =>
          (seg.from === run.nodeIds[i] && seg.to === run.nodeIds[i + 1]) || (seg.to === run.nodeIds[i] && seg.from === run.nodeIds[i + 1]))!
      build(run.nodeIds, run.lengths, between)
      continue
    }
    // A rail on its own (or rails that are not one run, which cannot be): one ramp each
    for (const id of ids) {
      const seg = net.segments.get(id)!
      build([seg.from, seg.to], [segmentRunLength(net, seg)], () => seg)
    }
  }
  return ramps
}

/** Heights closer than this (levels) are the same height when a slope is evened out. */
const GRADIENT_EPSILON = 1e-9

/** Inner nodes of the run `segmentIds` with the height an even slope between its two ends gives them. */
function evenGradientLevels(net: Network, segmentIds: Iterable<SegmentId>): Map<NodeId, number> | null {
  const run = gradientRun(net, segmentIds)
  if (!run) return null
  const total = run.lengths.reduce((sum, len) => sum + len, 0)
  if (!(total > 0)) return null
  const start = nodeLevel(net.nodes.get(run.nodeIds[0]))
  const rise = nodeLevel(net.nodes.get(run.nodeIds[run.nodeIds.length - 1])) - start
  const levels = new Map<NodeId, number>()
  let covered = 0
  for (let i = 1; i < run.nodeIds.length - 1; i++) {
    covered += run.lengths[i - 1]
    levels.set(run.nodeIds[i], rise === 0 ? start : start + (rise * covered) / total)
  }
  return levels
}

/**
 * True when `spreadGradient` would move a node: the rails are one run (see `gradientRun`) and at
 * least one of its inner nodes is not on the even slope between its two ends. This covers a run
 * whose slope is uneven as well as a hump or a dip between two ends at the same height.
 */
export function canSpreadGradient(net: Network, segmentIds: Iterable<SegmentId>): boolean {
  const levels = evenGradientLevels(net, segmentIds)
  if (!levels) return false
  for (const [nid, level] of levels) {
    if (Math.abs(nodeLevel(net.nodes.get(nid)) - level) > GRADIENT_EPSILON) return true
  }
  return false
}

/**
 * Even out the slope along a run of rails laid end to end: its two ends keep their height and every
 * node in between is put on the straight slope from one to the other, by length, so that all the
 * rails climb at the same rate. Does nothing when the rails are not one run (see `gradientRun`).
 * Returns the number of nodes whose height changed.
 */
export function spreadGradient(net: Network, segmentIds: Iterable<SegmentId>): number {
  const levels = evenGradientLevels(net, segmentIds)
  if (!levels) return 0
  let changed = 0
  for (const [nid, level] of levels) {
    if (Math.abs(nodeLevel(net.nodes.get(nid)) - level) <= GRADIENT_EPSILON) continue
    changed += setNodesLevel(net, [nid], level)
  }
  return changed
}

/** Height of a rail at its point closest to `pos` (the height of its ends when it is flat). */
export function segmentHeightNear(net: Network, seg: Segment, pos: Point): number {
  const ends = segmentEndLevels(net, seg)
  if (ends.from === ends.to) return ends.from
  const a = net.nodes.get(seg.from)
  const b = net.nodes.get(seg.to)
  if (!a || !b) return ends.from
  let t: number
  if (seg.kind === 'curve' && seg.via) {
    t = closestCurveParam(pos, a.pos, seg.via, b.pos)
  } else {
    const dx = b.pos.x - a.pos.x
    const dy = b.pos.y - a.pos.y
    const len2 = dx * dx + dy * dy
    t = len2 === 0 ? 0 : ((pos.x - a.pos.x) * dx + (pos.y - a.pos.y) * dy) / len2
  }
  return ends.from + (ends.to - ends.from) * Math.max(0, Math.min(1, t))
}

/** Find the closest segment to a point within a max distance (the upper one of two stacked rails). */
export function hitSegment(net: Network, pos: Point, maxDist: number): SegmentId | null {
  let best: SegmentId | null = null
  let bestD = maxDist
  let bestLevel = 0
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) continue
    const d =
      seg.kind === 'curve' && seg.via
        ? distToCurve(pos, a.pos, seg.via, b.pos)
        : distToSegment(pos, a.pos, b.pos)
    if (d >= maxDist) continue
    const level = segmentHeightNear(net, seg, pos)
    if (best === null || isCloserOrAbove(d, level, bestD, bestLevel)) {
      bestD = d
      bestLevel = level
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
