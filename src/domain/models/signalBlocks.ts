/**
 * Blocks and routes read from the signals: what a signal guards, and where the track leads from it.
 *
 * Nothing here is stored. The block of each signal only depends on the track, on the route tables
 * (which rails a device can join, not the position it is in) and on the signals: all of it is
 * worked out once and kept until one of them changes, see `signalTopology`. The route from a
 * signal follows the points as they are set and is kept until one of the devices it meets is thrown.
 * It stops short of points set against it: see `SignalRoute.blockedAt`.
 *
 * This module must not import `train.ts` nor `trainDynamics.ts`.
 */

import type { JunctionId, Network, NodeId, SegmentId, Signal, SignalId, TrackSpan } from './types'
import { segmentArcLength, segmentPartialLength } from './locomotive'
import { exitsOf, leaveDirection } from './routing'
import { isSwitchNode, signalsOnRail, signalsRevision } from './signals'
import { TRACK_T_EPSILON } from './trackObjects'
import { nextRail, trackGeometryRevision } from './trackSpeed'
import { isTraversableDeflection } from '../geometry/tangent'

// ─────────────────── What the blocks are read from ───────────────────

/**
 * Copy of the route tables as far as the blocks read them (the rails each one joins, its
 * positions), compared value by value like the track itself (`trackGeometryRevision`). The
 * position a device is in is not part of it: throwing points does not change a block.
 */
class TableSnapshot {
  private strs: string[] = []
  private nums: number[] = []
  revision = 0

  update(net: Network): number {
    const strs = this.strs
    const nums = this.nums
    let si = 0
    let ni = 0
    let changed = false
    const str = (value: string): void => {
      if (strs[si] !== value) { strs[si] = value; changed = true }
      si++
    }
    const num = (value: number): void => {
      if (nums[ni] !== value) { nums[ni] = value; changed = true }
      ni++
    }
    for (const junction of net.junctions.values()) {
      str(junction.id)
      str(junction.nodeId)
      num(junction.passages.length)
      for (const passage of junction.passages) {
        str(passage.a)
        str(passage.b)
      }
      num(junction.positions.length)
      for (const position of junction.positions) {
        num(position.length)
        for (const index of position) num(index)
      }
    }
    if (strs.length !== si) { strs.length = si; changed = true }
    if (nums.length !== ni) { nums.length = ni; changed = true }
    if (changed) this.revision++
    return this.revision
  }
}

const tableSnapshots = new WeakMap<Network, TableSnapshot>()

function routeTablesRevision(net: Network): number {
  let snapshot = tableSnapshots.get(net)
  if (!snapshot) {
    snapshot = new TableSnapshot()
    tableSnapshots.set(net, snapshot)
  }
  return snapshot.update(net)
}

// ─────────────────── Blocks ───────────────────

/** A place inside a block where two routes can meet with no path signal before it */
export interface BlockConflictPoint {
  nodeId: NodeId
  /** `facing`: points met by their toe (the track parts there). `crossing`: two tracks cross there */
  kind: 'facing' | 'crossing'
  /** Table of the node, when it has one */
  junctionId: JunctionId | null
  /** The rail the block reaches the node by */
  segId: SegmentId
  /** Parameter of the node on that rail: 0 or 1 */
  t: number
}

/**
 * The block of a signal: all the track reached from the signal in its direction, every branch
 * taken, as far as the next signals of the same direction or the ends of the track.
 */
export interface SignalBlock {
  signalId: SignalId
  /** The track of the block, in the order and the direction it is reached from the signal */
  spans: TrackSpan[]
  /** The points and crossings inside the block (nodes with three rails or more), each once */
  nodes: NodeId[]
  /** The route tables of those nodes */
  junctions: JunctionId[]
  /** The signals of the same direction the block ends on */
  boundingSignals: SignalId[]
  /** Number of ends of track the block runs to (buffer stops, or points no table leads through) */
  trackEnds: number
  /** Length of track in the block, every branch counted once, m */
  length: number
  /** Distance from the signal to the nearest end of the block (a bounding signal or an end of track), m */
  minLength: number
  /** Distance from the signal to the farthest end of the block, m */
  maxLength: number
  /** Points met by their toe and crossings inside the block */
  conflictPoints: BlockConflictPoint[]
  /** True when the walk gave up before reaching every end (`MAX_BLOCK_RAILS`) */
  truncated: boolean
}

/** Part of a rail inside a block: parameters `lo` ≤ `hi` */
export interface BlockStretch {
  block: SignalBlock
  lo: number
  hi: number
}

/** The route from a signal with the points as they are set */
export interface SignalRoute {
  signalId: SignalId
  /** The track from the signal to the next signal of the same direction, or to where the route ends */
  spans: TrackSpan[]
  /** The points and crossings passed on the way (nodes with three rails or more), in order */
  nodes: NodeId[]
  /** The next signal of the same direction on the route, null when it ends before any */
  next: SignalId | null
  /** True when the route stops at an end of track: a buffer stop, an open end, a one-way signal met from behind */
  endsOnTrackEnd: boolean
  /**
   * The points the route stops on because they are set against it, null otherwise: the track goes
   * on beyond them, in another position of the device. Such a route leads nowhere — it is not a
   * route to an end of track, and those points are not part of it (they are not in `nodes`).
   */
  blockedAt: NodeId | null
  /** Length of the route, m */
  length: number
  /**
   * The plain track that carries on beyond `next`, as far as the next points or crossing: a train
   * let onto the route is bound to run it, so it must not meet a train coming the other way there.
   */
  beyond: { segId: SegmentId; ascending: boolean }[]
  /** Devices met on the way and the position each one was in */
  met: { junctionId: JunctionId; active: number }[]
  /**
   * Turnouts the route takes on a diverging route, in order: the device and the two rails the route
   * passes between (their speed is `turnoutPassageSpeed`, which depends on the line settings).
   */
  diverging: { junctionId: JunctionId; a: SegmentId; b: SegmentId }[]
  /**
   * The one-way path signal the route runs into from behind, null when there is none: the route
   * ends there as it would on an end of track (`endsOnTrackEnd` is true too).
   */
  wall: SignalId | null
}

/** Everything read from the track and the signals that the signalling needs */
export interface SignalTopology {
  blocks: ReadonlyMap<SignalId, SignalBlock>
  /** For each rail, the blocks it is part of */
  railBlocks: ReadonlyMap<SegmentId, readonly BlockStretch[]>
  /** For each node with three rails or more, the blocks it is part of */
  nodeBlocks: ReadonlyMap<NodeId, readonly SignalBlock[]>
  /** The route table of each node that has one */
  junctionAt: ReadonlyMap<NodeId, JunctionId>
  /** Rails a rail leads to at its end, whatever the position of the device; filled as asked for */
  continuations: Map<string, readonly SegmentId[]>
  /** Lengths of the rails, filled as they are asked for */
  lengths: Map<SegmentId, number>
  /** Routes from the signals, filled as they are asked for and checked against the points */
  routes: Map<SignalId, SignalRoute>
}

/** A block is not followed over more rails than this */
const MAX_BLOCK_RAILS = 50_000
/** A route from a signal is not followed over more rails than this */
const MAX_ROUTE_RAILS = 20_000
/** The plain track beyond a route is not followed over more rails than this */
const MAX_BEYOND_RAILS = 5_000

/** Counters for the tests that check what is kept */
export const signalBlockStats = { topologyBuilds: 0, routeWalks: 0 }

const NO_RAIL: readonly SegmentId[] = []

export function railLengthIn(net: Network, topology: SignalTopology, segId: SegmentId): number {
  let length = topology.lengths.get(segId)
  if (length === undefined) {
    length = segmentArcLength(net, segId)
    topology.lengths.set(segId, length)
  }
  return length
}

/** True for a node the track simply runs through: two rails at most and no route table */
function isPlainNode(net: Network, topology: SignalTopology, nodeId: NodeId): boolean {
  return !topology.junctionAt.has(nodeId) && (net.adjacency.get(nodeId)?.length ?? 0) <= 2
}

/** The node a rail run `ascending` (from its `from` node to its `to` node) or not ends on */
function exitNodeOf(net: Network, segId: SegmentId, ascending: boolean): NodeId | null {
  const seg = net.segments.get(segId)
  return seg ? (ascending ? seg.to : seg.from) : null
}

/**
 * Rails the rail `segId`, run `ascending` or not, leads to at its end, whatever the position of the
 * device there (every branch of a turnout met by its toe). Kept in the topology.
 */
export function continuationsOf(net: Network, topology: SignalTopology, segId: SegmentId, ascending: boolean): readonly SegmentId[] {
  const key = segId + (ascending ? '>' : '<')
  const kept = topology.continuations.get(key)
  if (kept) return kept
  let exits: readonly SegmentId[] = NO_RAIL
  const nodeId = exitNodeOf(net, segId, ascending)
  if (nodeId !== null) {
    if (isPlainNode(net, topology, nodeId)) {
      // Same answer as `exitsOf`, without looking for a table of the node
      const seg = net.segments.get(segId)!
      const otherId = (net.adjacency.get(nodeId) ?? []).find((sid) => sid !== segId)
      const other = otherId ? net.segments.get(otherId) : undefined
      if (other && isTraversableDeflection(leaveDirection(net, seg, nodeId), leaveDirection(net, other, nodeId))) exits = [other.id]
    } else {
      exits = exitsOf(net, nodeId, segId, { anyPosition: true })
    }
  }
  topology.continuations.set(key, exits)
  return exits
}

/**
 * The rail a route goes on by at the end of rail `segId`, with the points as they are set, the way
 * a train takes it: head first (`direction` 1) or tail first (-1). Null where the route ends.
 */
export function routeExitOf(
  net: Network,
  topology: SignalTopology,
  segId: SegmentId,
  ascending: boolean,
  direction: 1 | -1 = 1,
): SegmentId | null {
  const nodeId = exitNodeOf(net, segId, ascending)
  if (nodeId === null) return null
  if (isPlainNode(net, topology, nodeId)) return continuationsOf(net, topology, segId, ascending)[0] ?? null
  return nextRail(net, nodeId, segId, direction)
}

/**
 * True when the track stops, for a train reaching the end of rail `segId` run `ascending` or not,
 * only because the device there is set against it: no rail leads on as the points are, one would in
 * another position. Trailing points set for the other branch, a double slip whose near points are
 * set for the other rail. False at a genuine end of track.
 */
export function isSetAgainst(net: Network, topology: SignalTopology, segId: SegmentId, ascending: boolean, direction: 1 | -1 = 1): boolean {
  return routeExitOf(net, topology, segId, ascending, direction) === null && continuationsOf(net, topology, segId, ascending).length > 0
}

/** The nearest signal of direction `ascending` met on a rail run from `t`, null when there is none */
function nextSignalOnRail(
  net: Network,
  segId: SegmentId,
  t: number,
  ascending: boolean,
  strict: boolean,
): Signal | null {
  const signals = signalsOnRail(net, segId)
  if (signals.length === 0) return null
  const margin = strict ? TRACK_T_EPSILON : -TRACK_T_EPSILON
  if (ascending) {
    for (const signal of signals) {
      if (signal.forward && signal.t > t + margin) return signal
    }
    return null
  }
  for (let i = signals.length - 1; i >= 0; i--) {
    const signal = signals[i]
    if (!signal.forward && signal.t < t - margin) return signal
  }
  return null
}

/**
 * True for a signal that stops the trains running against it: a path signal flagged `oneWay`, for
 * a train running the rail `ascending` or not. Such a train may not pass it, whatever it shows.
 */
export function isOneWayWall(signal: Signal, ascending: boolean): boolean {
  return signal.oneWay === true && signal.role === 'protection' && signal.forward !== ascending
}

/**
 * The nearest one-way path signal met from behind on a rail run from `t` (see `isOneWayWall`), one
 * standing at `t` itself included; null when there is none.
 */
function nextWallOnRail(net: Network, segId: SegmentId, t: number, ascending: boolean): Signal | null {
  const signals = signalsOnRail(net, segId)
  if (signals.length === 0) return null
  if (ascending) {
    for (const signal of signals) {
      if (isOneWayWall(signal, ascending) && signal.t >= t - TRACK_T_EPSILON) return signal
    }
    return null
  }
  for (let i = signals.length - 1; i >= 0; i--) {
    const signal = signals[i]
    if (isOneWayWall(signal, ascending) && signal.t <= t + TRACK_T_EPSILON) return signal
  }
  return null
}

function buildBlock(net: Network, topology: SignalTopology, signal: Signal): SignalBlock {
  const block: SignalBlock = {
    signalId: signal.id,
    spans: [],
    nodes: [],
    junctions: [],
    boundingSignals: [],
    trackEnds: 0,
    length: 0,
    minLength: Infinity,
    maxLength: 0,
    conflictPoints: [],
    truncated: false,
  }
  const nodes = new Set<NodeId>()
  const bounds = new Set<SignalId>()
  const entered = new Set<string>()
  const reachEnd = (distance: number): void => {
    block.minLength = Math.min(block.minLength, distance)
    block.maxLength = Math.max(block.maxLength, distance)
  }

  interface Entry { segId: SegmentId; ascending: boolean; t: number; distance: number; first: boolean }
  const queue: Entry[] = [{ segId: signal.segId, ascending: signal.forward, t: signal.t, distance: 0, first: true }]
  for (let head = 0; head < queue.length; head++) {
    const entry = queue[head]
    const seg = net.segments.get(entry.segId)
    if (!seg) continue
    if (!entry.first) {
      // A rail entered twice the same way leads to nothing new: this is what ends the walk on a loop
      const key = entry.segId + (entry.ascending ? '>' : '<')
      if (entered.has(key)) continue
      entered.add(key)
      if (entered.size > MAX_BLOCK_RAILS) {
        block.truncated = true
        break
      }
    }
    const bound = nextSignalOnRail(net, entry.segId, entry.t, entry.ascending, entry.first)
    if (bound) {
      block.spans.push({ segId: entry.segId, t0: entry.t, t1: bound.t })
      bounds.add(bound.id)
      reachEnd(entry.distance + segmentPartialLength(net, entry.segId, entry.t, bound.t))
      continue
    }
    const exitT = entry.ascending ? 1 : 0
    block.spans.push({ segId: entry.segId, t0: entry.t, t1: exitT })
    const distance = entry.distance + (entry.first
      ? segmentPartialLength(net, entry.segId, entry.t, exitT)
      : railLengthIn(net, topology, entry.segId))
    const nodeId = entry.ascending ? seg.to : seg.from
    const exits = continuationsOf(net, topology, entry.segId, entry.ascending)
    if (isSwitchNode(net, nodeId)) {
      const junctionId = topology.junctionAt.get(nodeId) ?? null
      const junction = junctionId ? net.junctions.get(junctionId) : undefined
      const crossing = junction ? junction.kind === 'crossing' || junction.kind === 'double_slip' : (net.adjacency.get(nodeId)?.length ?? 0) >= 4
      const kind = crossing ? 'crossing' : exits.length >= 2 ? 'facing' : null
      if (kind && !block.conflictPoints.some((point) => point.nodeId === nodeId)) {
        block.conflictPoints.push({ nodeId, kind, junctionId, segId: entry.segId, t: exitT })
      }
      nodes.add(nodeId)
    }
    if (exits.length === 0) {
      block.trackEnds++
      reachEnd(distance)
      continue
    }
    for (const exitId of exits) {
      const exit = net.segments.get(exitId)
      if (!exit) continue
      const ascending = exit.from === nodeId
      queue.push({ segId: exitId, ascending, t: ascending ? 0 : 1, distance, first: false })
    }
  }
  if (!Number.isFinite(block.minLength)) block.minLength = block.maxLength
  block.nodes = [...nodes]
  block.boundingSignals = [...bounds]
  for (const nodeId of nodes) {
    const junctionId = topology.junctionAt.get(nodeId)
    if (junctionId) block.junctions.push(junctionId)
  }
  return block
}

/** The parts of each rail a block covers, overlapping stretches made one */
function blockCoverage(block: SignalBlock): Map<SegmentId, { lo: number; hi: number }[]> {
  const byRail = new Map<SegmentId, { lo: number; hi: number }[]>()
  for (const span of block.spans) {
    const part = { lo: Math.min(span.t0, span.t1), hi: Math.max(span.t0, span.t1) }
    const list = byRail.get(span.segId)
    if (list) list.push(part)
    else byRail.set(span.segId, [part])
  }
  for (const [segId, parts] of byRail) {
    if (parts.length < 2) continue
    parts.sort((a, b) => a.lo - b.lo)
    const merged = [parts[0]]
    for (const part of parts.slice(1)) {
      const last = merged[merged.length - 1]
      if (part.lo <= last.hi + TRACK_T_EPSILON) last.hi = Math.max(last.hi, part.hi)
      else merged.push(part)
    }
    byRail.set(segId, merged)
  }
  return byRail
}

function buildTopology(net: Network): SignalTopology {
  const junctionAt = new Map<NodeId, JunctionId>()
  for (const junction of net.junctions.values()) {
    if (!junctionAt.has(junction.nodeId)) junctionAt.set(junction.nodeId, junction.id)
  }
  const blocks = new Map<SignalId, SignalBlock>()
  const railBlocks = new Map<SegmentId, BlockStretch[]>()
  const nodeBlocks = new Map<NodeId, SignalBlock[]>()
  const topology: SignalTopology = {
    blocks,
    railBlocks,
    nodeBlocks,
    junctionAt,
    continuations: new Map(),
    lengths: new Map(),
    routes: new Map(),
  }
  for (const signal of net.signals.values()) {
    if (!net.segments.has(signal.segId)) continue
    const block = buildBlock(net, topology, signal)
    blocks.set(signal.id, block)
    for (const [segId, parts] of blockCoverage(block)) {
      let list = railBlocks.get(segId)
      if (!list) railBlocks.set(segId, (list = []))
      for (const part of parts) {
        list.push({ block, lo: part.lo, hi: part.hi })
        const whole = part.lo <= TRACK_T_EPSILON && part.hi >= 1 - TRACK_T_EPSILON
        block.length += whole ? railLengthIn(net, topology, segId) : segmentPartialLength(net, segId, part.lo, part.hi)
      }
    }
    for (const nodeId of block.nodes) {
      const list = nodeBlocks.get(nodeId)
      if (list) list.push(block)
      else nodeBlocks.set(nodeId, [block])
    }
  }
  return topology
}

interface TopologyEntry {
  geometry: number
  tables: number
  signals: number
  topology: SignalTopology
}

const topologies = new WeakMap<Network, TopologyEntry>()

/**
 * Blocks of every signal of the network, with the indexes that tell which blocks a rail or a node
 * belongs to. Kept from one call to the next and built again only when the track
 * (`trackGeometryRevision`), a route table or a signal has changed; a call that finds nothing
 * changed costs the comparison of the network with its last known state. Trains and the position
 * of the points play no part.
 */
export function signalTopology(net: Network): SignalTopology {
  const geometry = trackGeometryRevision(net)
  const tables = routeTablesRevision(net)
  const signals = signalsRevision(net)
  const entry = topologies.get(net)
  if (entry && entry.geometry === geometry && entry.tables === tables && entry.signals === signals) return entry.topology
  const topology = buildTopology(net)
  signalBlockStats.topologyBuilds++
  topologies.set(net, { geometry, tables, signals, topology })
  return topology
}

/** The blocks of the network, by signal (see `SignalBlock`). */
export function signalBlocks(net: Network): ReadonlyMap<SignalId, SignalBlock> {
  return signalTopology(net).blocks
}

/** The block of one signal, null when there is no such signal. */
export function signalBlock(net: Network, id: SignalId): SignalBlock | null {
  if (!net.signals.has(id)) return null
  return signalTopology(net).blocks.get(id) ?? null
}

// ─────────────────── Route from a signal ───────────────────

function walkSignalRoute(net: Network, topology: SignalTopology, signal: Signal): SignalRoute {
  signalBlockStats.routeWalks++
  const route: SignalRoute = {
    signalId: signal.id,
    spans: [],
    nodes: [],
    next: null,
    endsOnTrackEnd: false,
    blockedAt: null,
    length: 0,
    beyond: [],
    met: [],
    diverging: [],
    wall: null,
  }
  let segId = signal.segId
  let ascending = signal.forward
  let t = signal.t
  const entered = new Set<string>()
  for (let i = 0; ; i++) {
    const seg = net.segments.get(segId)
    if (!seg || i > MAX_ROUTE_RAILS) {
      route.endsOnTrackEnd = true
      break
    }
    const next = nextSignalOnRail(net, segId, t, ascending, i === 0)
    const wall = nextWallOnRail(net, segId, t, ascending)
    if (wall && (!next || (ascending ? wall.t <= next.t : wall.t >= next.t))) {
      // A one-way signal met from behind: no train goes further this way
      route.spans.push({ segId, t0: t, t1: wall.t })
      route.length += segmentPartialLength(net, segId, t, wall.t)
      route.wall = wall.id
      route.endsOnTrackEnd = true
      break
    }
    if (next) {
      route.spans.push({ segId, t0: t, t1: next.t })
      route.length += segmentPartialLength(net, segId, t, next.t)
      route.next = next.id
      break
    }
    const exitT = ascending ? 1 : 0
    route.spans.push({ segId, t0: t, t1: exitT })
    route.length += i === 0 ? segmentPartialLength(net, segId, t, exitT) : railLengthIn(net, topology, segId)
    const nodeId = ascending ? seg.to : seg.from
    const junctionId = topology.junctionAt.get(nodeId)
    const junction = junctionId ? net.junctions.get(junctionId) : undefined
    if (junction) route.met.push({ junctionId: junction.id, active: junction.active })
    const exitId = routeExitOf(net, topology, segId, ascending)
    const exit = exitId ? net.segments.get(exitId) : undefined
    if (!exit) {
      // Points set against the route are not an end of track, and the route does not take them
      if (isSetAgainst(net, topology, segId, ascending)) route.blockedAt = nodeId
      else {
        if (isSwitchNode(net, nodeId)) route.nodes.push(nodeId)
        route.endsOnTrackEnd = true
      }
      break
    }
    if (isSwitchNode(net, nodeId)) route.nodes.push(nodeId)
    if (junction && (junction.kind === 'turnout' || junction.kind === 'three_way')) {
      const passage = junction.passages.findIndex((p) => (p.a === segId && p.b === exit.id) || (p.a === exit.id && p.b === segId))
      if (passage > 0) route.diverging.push({ junctionId: junction.id, a: segId, b: exit.id })
    }
    segId = exit.id
    ascending = exit.from === nodeId
    t = ascending ? 0 : 1
    const key = segId + (ascending ? '>' : '<')
    if (entered.has(key)) {
      // A loop with no signal of this direction but the one the route started from, already past
      route.endsOnTrackEnd = true
      break
    }
    entered.add(key)
  }

  if (route.next) {
    // The plain track beyond the next signal: the rail it stands on, then on to the next points
    const seen = new Set<string>()
    for (let i = 0; i < MAX_BEYOND_RAILS; i++) {
      const key = segId + (ascending ? '>' : '<')
      if (seen.has(key)) break
      seen.add(key)
      route.beyond.push({ segId, ascending })
      const nodeId = exitNodeOf(net, segId, ascending)
      if (nodeId === null || isSwitchNode(net, nodeId)) break
      const exitId = continuationsOf(net, topology, segId, ascending)[0]
      const exit = exitId ? net.segments.get(exitId) : undefined
      if (!exit) break
      segId = exit.id
      ascending = exit.from === nodeId
    }
  }
  return route
}

/**
 * The route from a signal in its direction, with the points as they are set: the track as far as
 * the next signal of the same direction, or to where the route ends. Kept until a device met on
 * the way is thrown, or the track or the signals change.
 */
export function signalRouteIn(net: Network, topology: SignalTopology, id: SignalId): SignalRoute | null {
  const signal = net.signals.get(id)
  if (!signal) return null
  const kept = topology.routes.get(id)
  if (kept && kept.met.every((met) => net.junctions.get(met.junctionId)?.active === met.active)) return kept
  const route = walkSignalRoute(net, topology, signal)
  topology.routes.set(id, route)
  return route
}

/** `signalRouteIn` on the kept topology of the network */
export function signalRoute(net: Network, id: SignalId): SignalRoute | null {
  return signalRouteIn(net, signalTopology(net), id)
}
