/**
 * The signalling engine: which track each train holds, and what each signal shows.
 *
 * One engine serves the two signalling levels of a project. It works on three states (`stop`,
 * `caution`, `clear`); each level only reads them its own way (`signalAspect`) and has its own
 * rule for passing a closed signal.
 *
 * Everything here is simulation state: it is worked out again from the trains and the signals by
 * `updateSignalling`, once per simulation step, and never saved. The rules:
 *
 * - Occupation. A stretch is occupied when a train stands over it, whichever way it faces.
 * - Route of a train. A train has no destination: its route is the track ahead of its leading end
 *   with the points as they are set.
 * - Reservation. An active train (moving, or stopped with its reverser off neutral) holds the
 *   track ahead of its leading end over its stopping distance and a margin (`reservationReach`),
 *   and, once it has been let past a signal, as far as the next one. Track is taken rail by rail
 *   and never from another train: what a train holds or stands on is refused to the others.
 *   Nothing is held behind the leading end: the track under a train is its occupation, and it is
 *   free again as soon as the tail has left it.
 * - Passing a signal. To be let past a signal a train needs the whole route from it to the next
 *   signal of the same direction (or to the end of the track). Past a block signal it is given when
 *   the block is free of any other train and of any other reservation, and asked for when the
 *   signal comes within the reservation reach. Past a path signal it is given when no stretch and
 *   no points of the route are occupied or held by another train and no train is running or routed
 *   the other way on the plain track that follows; it is asked for within `approachDistance`.
 *   A route given is kept until the train has passed the signal, as long as its own track stays
 *   free (what happens on another branch of the block does not take it back), and dropped when the
 *   train is further than `approachDistance` from the signal (so 300 m when it stops), turns
 *   back, or is parked.
 * - Points set against a route. A route that stops on points set against it (trailing points set
 *   for the other branch, a double slip set for another rail) leads nowhere: it is not a route to
 *   an end of track. It is never given, whichever the signal and the level, and a route given
 *   before the points were thrown is taken back; the signal is closed, and a train running up to
 *   such points holds the track as far as them but not the points themselves, which stay free for
 *   whoever they are set for — or to be thrown.
 * - Signals. A signal a train has been given the route past is open. Otherwise a path signal is at
 *   `stop`, and a block signal is at `stop` when its block is occupied or holds a reservation. An
 *   open signal shows `caution` when the next signal on its route is at `stop` or when the route
 *   runs to an end of track, `clear` otherwise. A signal only speaks to its own direction of travel.
 * - One-way path signal. A path signal flagged `oneWay` is a stop no train passes for the trains
 *   that meet it from behind, at both levels: no track is held beyond it for them, a route from
 *   another signal ends on it as on an end of track, and running past it is a fault.
 * - Diverging routes (pro level). An open path signal whose route takes points on a diverging route
 *   limited to 30 or 60 km/h shows the reminder (`SignalStatus.reminder`), and the signal before it
 *   on the route announces it instead of showing clear (`SignalStatus.slowdown`). Above 60 km/h
 *   nothing is shown: the limit alone applies (`rakeSpeedLimit`).
 *
 * This module only imports types from `train.ts`.
 */

import type { Network, NodeId, SegmentId, Signal, SignalId, TrackSpan } from './types'
import type { TrainSet, TrainSetId } from './train'
import type { LineSettings } from './speedLimits'
import { segmentPartialLength } from './locomotive'
import { rakeOccupancy } from './occupancy'
import { isSwitchNode, signalsOnRail, DEFAULT_SIGNALLING_SETTINGS, type SignallingLevel, type SignallingSettings } from './signals'
import {
  isOneWayWall,
  isSetAgainst,
  railLengthIn,
  routeExitOf,
  signalRouteIn,
  signalTopology,
  type SignalBlock,
  type SignalRoute,
  type SignalTopology,
} from './signalBlocks'
import { TRACK_T_EPSILON } from './trackObjects'
import { lookAheadReach, routeStart, trackProfile, turnoutPassageSpeedIn, type TrackProfile } from './trackSpeed'

// ─────────────────── Figures ───────────────────

/** Deceleration (m/s²) of the simple stopping distance used to hold track and to check block lengths */
export const SIGNAL_DECELERATION = 0.7
/** Seconds of run at the current speed added to it, for the brake to come on */
const BRAKE_DELAY = 2
/** Track is held ahead of a train over this many times its stopping distance… */
export const RESERVATION_MARGIN = 1.5
/** …plus this (m), so that a train starting from rest holds the track right ahead of it */
export const RESERVATION_PAD = 50
/** A route past a path signal is asked for, and any route kept, within this distance (m)… */
export const APPROACH_MIN = 300
/** …plus this many times the stopping distance */
export const APPROACH_STOPPING_FACTOR = 2
/** The driver is warned when the first closed signal is nearer than this many times the stopping distance */
export const SIGNAL_BRAKE_ALERT_MARGIN = 1.25
/** A train has stopped before a signal when it comes to rest within this distance (m) of it */
export const STOP_BEFORE_SIGNAL_DISTANCE = 200
/** Speed (km/h) not to exceed after passing a closed block signal on sight (pro level) */
export const ON_SIGHT_SPEED = 30

/** Gravity, m/s² */
const GRAVITY = 9.81
/** The simple stopping distance never counts on less than this deceleration (m/s²) on a falling gradient. ESTIMATED */
const MIN_SIGNAL_DECELERATION = 0.1
/** Blocks counted ahead of a train for the cab signalling: beyond, nothing restricts it */
export const CLEARANCE_BLOCKS = 6

const DISTANCE_EPSILON = 1e-6

/**
 * Simple stopping distance (m) from `speed` m/s: `v² / (2 × 0.7)` plus two seconds of run.
 * `slope` is the rise over run of the track in the direction of motion (positive uphill): gravity
 * adds to the deceleration uphill and takes from it downhill, where the distance grows — the
 * deceleration counted on is never under 0.1 m/s².
 */
export function estimatedStoppingDistance(speed: number, slope: number = 0): number {
  if (!(speed > 0)) return 0
  const gravity = Number.isFinite(slope) ? (GRAVITY * slope) / Math.hypot(1, slope) : 0
  const deceleration = Math.max(MIN_SIGNAL_DECELERATION, SIGNAL_DECELERATION + gravity)
  return (speed * speed) / (2 * deceleration) + speed * BRAKE_DELAY
}

/** Distance (m) ahead of its leading end over which a train running at `speed` m/s holds the track */
export function reservationReach(speed: number): number {
  return estimatedStoppingDistance(speed) * RESERVATION_MARGIN + RESERVATION_PAD
}

/** Distance (m) from a signal within which a train running at `speed` m/s asks for, and keeps, the route past it */
export function approachDistance(speed: number): number {
  return APPROACH_MIN + estimatedStoppingDistance(speed) * APPROACH_STOPPING_FACTOR
}

// ─────────────────── State ───────────────────

export type SignalState = 'stop' | 'caution' | 'clear'

/**
 * Why a signal shows what it shows. `occupied`: a train is in its block. `reserved`: its block
 * holds a route given through another signal. `no-route`: a path signal no train has a route from.
 * `next-stop`: the next signal on the route is closed. `track-end`: the route runs to an end of track.
 * `points-against`: a block signal whose route stops on points set against it.
 */
export type SignalCause = 'occupied' | 'reserved' | 'no-route' | 'next-stop' | 'track-end' | 'points-against'

export interface SignalStatus {
  state: SignalState
  /** Null for a signal at `clear` */
  cause: SignalCause | null
  /** The train that has been given the route past the signal and has not reached it yet */
  clearedFor: TrainSetId | null
  /**
   * Pro level, only there when it applies: an open path signal whose route takes points on a
   * diverging route limited to 30 or 60 km/h reminds of that speed (rappel de ralentissement)
   */
  reminder?: SlowdownSpeed
  /** Pro level, only there when it applies: a signal at `clear` whose next signal shows that reminder announces it (ralentissement) */
  slowdown?: SlowdownSpeed
}

/** The two speeds (km/h) the signals can announce for points taken on a diverging route */
export type SlowdownSpeed = 30 | 60

/** The speed the signals show for points limited to `speed` km/h on their diverging route; null above 60 km/h */
export function slowdownSpeedFor(speed: number): SlowdownSpeed | null {
  return speed <= 30 ? 30 : speed <= 60 ? 60 : null
}

/** A stretch of rail held by a train, in the direction it will run it (`t0` → `t1`) */
export interface RailReservation extends TrackSpan {
  trainId: TrainSetId
}

/** A signal ahead of a train */
export interface SignalAhead {
  id: SignalId
  /** Distance from the leading end of the train, m */
  distance: number
  state: SignalState
  /** Only there when true: a one-way path signal met from behind, a stop the train may not pass */
  against?: true
  /** Only there when the signal shows them (see `SignalStatus`) */
  reminder?: SlowdownSpeed
  slowdown?: SlowdownSpeed
}

/**
 * How much track is free ahead of a train, counted in blocks: what the cab signalling of a
 * high-speed line shows a speed for (`cabSignalling.ts`).
 */
export interface TrackClearance {
  /**
   * Blocks free ahead of the train as far as the obstacle, the block it is in being the first; 0
   * when its own block is not free between it and the next signal (a train came in by points, or
   * the train went past a closed signal); `Infinity` when nothing is met within `CLEARANCE_BLOCKS`.
   */
  blocks: number
  /**
   * What ends them. `occupied`: a block that is not free (a closed block signal). `absolute`: a
   * closed path signal, a one-way signal met from behind, the end of the track, or points set
   * against the route (met in the train's own block, or closing the block signal before them).
   * Null when nothing is met.
   */
  obstacle: 'occupied' | 'absolute' | null
  /** The signal ahead when this was counted, null when there is none in sight */
  markerId: SignalId | null
}

/** A train passing a signal */
export interface SignalPassing {
  trainId: TrainSetId
  signalId: SignalId
  /** Speed of the train, m/s */
  speed: number
  /** The signal was at `stop` */
  closed: boolean
  /** The signal was closed and the rules of the level did not allow passing it */
  fault: boolean
  /** Pro level: a closed block signal passed after a stop before it, to be followed on sight */
  onSight: boolean
  /** Only there when true: a one-way path signal passed from behind (always a fault) */
  against?: true
}

interface RouteSpan extends TrackSpan {
  ascending: boolean
  /** Distance from the origin of the route to the start and to the end of the stretch, m */
  d0: number
  d1: number
  /** The points or crossing the stretch ends on, if any */
  exitNode: NodeId | null
}

/** The route ahead of a train, walked once and kept while it stays true */
interface RouteAhead {
  topology: SignalTopology
  spans: RouteSpan[]
  /** Signals of the travel direction met on the way, nearest first, with their distance from the origin */
  signals: { signal: Signal; distance: number; spanIndex: number; against: boolean }[]
  met: { junctionId: string; active: number }[]
  /** How far from the origin the route was walked, m */
  walked: number
  /** True when the route stops there: end of track, or points set against the train */
  ended: boolean
  /** The points the route stops on because they are set against the train, null otherwise: it does not hold them */
  blockedAt: NodeId | null
  /** Distance from the origin to the bogie under the leading end of the train, m */
  offset: number
  /** Distance from that bogie to the leading end, m */
  overhang: number
  /** Index of the stretch the bogie stands on */
  spanIndex: number
}

/** What the signalling knows of one train */
export interface TrainSignalling {
  trainId: TrainSetId
  /** The next signal of its direction on its route, null when there is none within the look-ahead */
  nextSignal: SignalAhead | null
  /** The first closed signal on its route, however far within the look-ahead */
  closedSignal: { id: SignalId; distance: number } | null
  /** The track it holds ahead of its leading end */
  reservation: { spans: RailReservation[]; nodes: NodeId[] }
  /** The signals it has been given the route past and has not reached yet */
  grants: Set<SignalId>
  /** The path signal it has asked the route from without getting it */
  waitingAt: SignalId | null
  /** Pro level: it passed a closed block signal after a stop and runs on sight until the next signal */
  onSight: boolean
  /** The signal it came to a stand before, while that signal is still its next one */
  stoppedBefore: SignalId | null
  /** It was let past the last signal: it holds its route as far as the next one */
  holdsToNextSignal: boolean
  /** Free blocks ahead, counted when the update is asked for them (`SignallingOptions.clearance`), else null */
  clearance: TrackClearance | null
  /**
   * What its cab last showed of `clearance` (see `latchCabClearance` in `cabSignalling.ts`), kept
   * from one simulation step to the next by `tickSignalling`; null until then
   */
  cab: TrackClearance | null
  /** @internal */
  direction: 1 | -1
  /** @internal */
  route: RouteAhead | null
  /** @internal */
  occupancyKey: string
  /** @internal */
  occupancy: { spans: TrackSpan[]; nodes: NodeId[] }
}

/**
 * Simulation state of the signalling: kept next to the trains, brought up to date by
 * `updateSignalling` and read by the display. Not saved.
 */
export interface SignallingState {
  /** What each signal shows; empty until the first update and when the network has no signal */
  signals: Map<SignalId, SignalStatus>
  trains: Map<TrainSetId, TrainSignalling>
  /** Stretches held, by rail */
  railReservations: Map<SegmentId, RailReservation[]>
  /** Points and crossings held (nodes with three rails or more) and the train holding each */
  nodeReservations: Map<NodeId, TrainSetId>
  /** Counter that changes whenever an update changed anything */
  revision: number
  /** @internal */
  topology: SignalTopology | null
  /** @internal */
  signature: (string | number)[]
}

export function createSignallingState(): SignallingState {
  return {
    signals: new Map(),
    trains: new Map(),
    railReservations: new Map(),
    nodeReservations: new Map(),
    revision: 0,
    topology: null,
    signature: [],
  }
}

/** Forget everything: to call when the simulation stops or the network is replaced. */
export function resetSignalling(state: SignallingState): void {
  if (state.signals.size === 0 && state.trains.size === 0 && state.topology === null) return
  state.signals.clear()
  state.trains.clear()
  state.railReservations.clear()
  state.nodeReservations.clear()
  state.topology = null
  state.signature = []
  state.revision++
}

/** Counters for the tests that check what is kept */
export const signallingStats = { updates: 0, skipped: 0, routeWalks: 0, occupancyWalks: 0 }

// ─────────────────── Helpers ───────────────────

/** Do two stretches of one rail share track? Stretches that only touch do not, unless one is a point. */
function overlaps(aLo: number, aHi: number, bLo: number, bHi: number): boolean {
  const shared = Math.min(aHi, bHi) - Math.max(aLo, bLo)
  if (shared > TRACK_T_EPSILON) return true
  if (shared < -TRACK_T_EPSILON) return false
  return aHi - aLo <= TRACK_T_EPSILON || bHi - bLo <= TRACK_T_EPSILON
}

/** A train that may move: it holds track. A parked train (at rest, reverser on neutral) or a derailed one does not. */
function isActive(train: TrainSet): boolean {
  if (train.derailed) return false
  return train.currentSpeed > 0 || train.reverser !== 'neutral'
}

function newRecord(train: TrainSet): TrainSignalling {
  return {
    trainId: train.id,
    nextSignal: null,
    closedSignal: null,
    reservation: { spans: [], nodes: [] },
    grants: new Set(),
    waitingAt: null,
    onSight: false,
    stoppedBefore: null,
    holdsToNextSignal: false,
    clearance: null,
    cab: null,
    direction: train.direction,
    route: null,
    occupancyKey: '',
    occupancy: { spans: [], nodes: [] },
  }
}

interface TickContext {
  net: Network
  topology: SignalTopology
  state: SignallingState
  /** Track each train stands on, by rail */
  occupied: Map<SegmentId, { lo: number; hi: number; trainId: TrainSetId }[]>
  occupiedNodes: Map<NodeId, TrainSetId[]>
  /** Blocks with a train in them */
  occupiedBlocks: Set<SignalBlock>
  /** Rail under the leading bogie of each active train, and the way it runs it */
  leads: Map<SegmentId, { trainId: TrainSetId; ascending: boolean }[]>
}

function spanFree(ctx: TickContext, trainId: TrainSetId, segId: SegmentId, a: number, b: number): boolean {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const occupied = ctx.occupied.get(segId)
  if (occupied) {
    for (const occ of occupied) {
      if (occ.trainId !== trainId && overlaps(lo, hi, occ.lo, occ.hi)) return false
    }
  }
  const reserved = ctx.state.railReservations.get(segId)
  if (reserved) {
    for (const res of reserved) {
      if (res.trainId !== trainId && overlaps(lo, hi, Math.min(res.t0, res.t1), Math.max(res.t0, res.t1))) return false
    }
  }
  return true
}

function nodeFree(ctx: TickContext, trainId: TrainSetId, nodeId: NodeId): boolean {
  const holder = ctx.state.nodeReservations.get(nodeId)
  if (holder !== undefined && holder !== trainId) return false
  const standing = ctx.occupiedNodes.get(nodeId)
  return !standing || standing.every((id) => id === trainId)
}

function claimSpan(ctx: TickContext, record: TrainSignalling, segId: SegmentId, t0: number, t1: number): void {
  if (Math.abs(t1 - t0) <= TRACK_T_EPSILON) return
  const reservation: RailReservation = { trainId: record.trainId, segId, t0, t1 }
  record.reservation.spans.push(reservation)
  const list = ctx.state.railReservations.get(segId)
  if (list) list.push(reservation)
  else ctx.state.railReservations.set(segId, [reservation])
}

function claimNode(ctx: TickContext, record: TrainSignalling, nodeId: NodeId): void {
  if (ctx.state.nodeReservations.get(nodeId) === record.trainId) return
  ctx.state.nodeReservations.set(nodeId, record.trainId)
  record.reservation.nodes.push(nodeId)
}

/** Give back everything a train holds */
function release(state: SignallingState, record: TrainSignalling): void {
  for (const span of record.reservation.spans) {
    const list = state.railReservations.get(span.segId)
    if (!list) continue
    const kept = list.filter((res) => res.trainId !== record.trainId)
    if (kept.length > 0) state.railReservations.set(span.segId, kept)
    else state.railReservations.delete(span.segId)
  }
  for (const nodeId of record.reservation.nodes) {
    if (state.nodeReservations.get(nodeId) === record.trainId) state.nodeReservations.delete(nodeId)
  }
  record.reservation = { spans: [], nodes: [] }
}

/** Is any track or any points of the block held by another train? */
function blockHeldByOther(ctx: TickContext, block: SignalBlock, trainId: TrainSetId): boolean {
  for (const other of ctx.state.trains.values()) {
    if (other.trainId === trainId) continue
    for (const span of other.reservation.spans) {
      const stretches = ctx.topology.railBlocks.get(span.segId)
      if (!stretches) continue
      const lo = Math.min(span.t0, span.t1)
      const hi = Math.max(span.t0, span.t1)
      for (const stretch of stretches) {
        if (stretch.block === block && overlaps(lo, hi, stretch.lo, stretch.hi)) return true
      }
    }
    for (const nodeId of other.reservation.nodes) {
      if (ctx.topology.nodeBlocks.get(nodeId)?.includes(block)) return true
    }
  }
  return false
}

/** Is a train running, or routed, against the direction of the plain track that follows a route? */
function opposedBeyond(ctx: TickContext, route: SignalRoute, trainId: TrainSetId): boolean {
  for (const rail of route.beyond) {
    const leads = ctx.leads.get(rail.segId)
    if (leads && leads.some((lead) => lead.trainId !== trainId && lead.ascending !== rail.ascending)) return true
    const reserved = ctx.state.railReservations.get(rail.segId)
    if (reserved && reserved.some((res) => res.trainId !== trainId && res.t1 > res.t0 !== rail.ascending)) return true
  }
  return false
}

/**
 * May the train be given the route past this signal — or, when it `held` it already, keep it? (see
 * the rules at the top of the file). A route held is only lost when its own track is no longer
 * free, or no longer leads on (points thrown against it): what happens elsewhere in the block does
 * not close a signal in front of a train.
 */
function canGrant(ctx: TickContext, trainId: TrainSetId, signal: Signal, route: SignalRoute, held: boolean): boolean {
  // A route that stops on points set against it leads nowhere: never given, and taken back if it was
  if (route.blockedAt !== null) return false
  for (const span of route.spans) {
    if (!spanFree(ctx, trainId, span.segId, span.t0, span.t1)) return false
  }
  for (const nodeId of route.nodes) {
    if (!nodeFree(ctx, trainId, nodeId)) return false
  }
  if (held) return true
  if (signal.role === 'protection') return !opposedBeyond(ctx, route, trainId)
  const block = ctx.topology.blocks.get(signal.id)
  if (!block) return false
  return !ctx.occupiedBlocks.has(block) && !blockHeldByOther(ctx, block, trainId)
}

// ─────────────────── Route ahead of a train ───────────────────

/** Rails a route ahead of a train is followed over at most */
const MAX_ROUTE_RAILS = 20_000
/** Each walk goes this much further than asked, so that the next frames can reuse it */
const ROUTE_WALK_MARGIN = 1.25

function walkRouteAhead(
  net: Network,
  topology: SignalTopology,
  start: { segId: SegmentId; t: number; ascending: boolean; overhang: number },
  direction: 1 | -1,
  reach: number,
): RouteAhead {
  signallingStats.routeWalks++
  const route: RouteAhead = {
    topology,
    spans: [],
    signals: [],
    met: [],
    walked: 0,
    ended: false,
    blockedAt: null,
    offset: 0,
    overhang: start.overhang,
    spanIndex: 0,
  }
  let segId = start.segId
  let t = start.t
  let ascending = start.ascending
  let travelled = 0
  const end = start.overhang + reach
  for (let i = 0; i < MAX_ROUTE_RAILS; i++) {
    const seg = net.segments.get(segId)
    if (!seg) {
      route.ended = true
      break
    }
    const exitT = ascending ? 1 : 0
    const length = i === 0 ? segmentPartialLength(net, segId, t, exitT) : railLengthIn(net, topology, segId)
    const signals = signalsOnRail(net, segId)
    if (signals.length > 0) {
      // The signals of the travel direction, and the one-way path signals met from behind
      const met = signals
        .filter((signal) => signal.forward === ascending || isOneWayWall(signal, ascending))
        .filter((signal) => (ascending ? signal.t >= t - TRACK_T_EPSILON : signal.t <= t + TRACK_T_EPSILON))
        .map((signal) => ({ signal, distance: travelled + segmentPartialLength(net, segId, t, signal.t), spanIndex: i, against: signal.forward !== ascending }))
      // Nearest first; of two standing at the same place, the one that may not be passed
      met.sort((a, b) => a.distance - b.distance || Number(b.against) - Number(a.against))
      route.signals.push(...met)
    }
    const nodeId = ascending ? seg.to : seg.from
    route.spans.push({ segId, t0: t, t1: exitT, ascending, d0: travelled, d1: travelled + length, exitNode: isSwitchNode(net, nodeId) ? nodeId : null })
    travelled += length
    if (travelled > end) break
    const junctionId = topology.junctionAt.get(nodeId)
    const junction = junctionId ? net.junctions.get(junctionId) : undefined
    if (junction) route.met.push({ junctionId: junction.id, active: junction.active })
    const exitId = routeExitOf(net, topology, segId, ascending, direction)
    const exit = exitId ? net.segments.get(exitId) : undefined
    if (!exit) {
      route.ended = true
      if (isSetAgainst(net, topology, segId, ascending, direction)) route.blockedAt = nodeId
      break
    }
    segId = exit.id
    ascending = exit.from === nodeId
    t = ascending ? 0 : 1
  }
  route.walked = travelled
  return route
}

/** Where on a kept route the leading bogie now stands: the index of its stretch and its distance from the origin */
function locateOnRoute(
  net: Network,
  route: RouteAhead,
  start: { segId: SegmentId; t: number; ascending: boolean },
): { index: number; offset: number } | null {
  for (let i = route.spanIndex; i < route.spans.length; i++) {
    const span = route.spans[i]
    if (span.segId !== start.segId || span.ascending !== start.ascending) continue
    const within = span.ascending
      ? start.t >= span.t0 - TRACK_T_EPSILON && start.t <= span.t1 + TRACK_T_EPSILON
      : start.t <= span.t0 + TRACK_T_EPSILON && start.t >= span.t1 - TRACK_T_EPSILON
    if (!within) continue
    return { index: i, offset: span.d0 + (start.t === span.t0 ? 0 : segmentPartialLength(net, span.segId, span.t0, start.t)) }
  }
  return null
}

/**
 * Free blocks ahead of a train (see `TrackClearance`): its own block from its leading end to the
 * next signal, then the blocks that follow, signal after signal along the route from each one,
 * points as they are set.
 */
function clearanceAhead(
  ctx: TickContext,
  train: TrainSet,
  record: TrainSignalling,
  route: RouteAhead,
  statuses: ReadonlyMap<SignalId, SignalStatus>,
): TrackClearance {
  const { net, topology } = ctx
  const headAt = route.offset + route.overhang
  const first = route.signals.find((met) => met.distance > headAt + DISTANCE_EPSILON) ?? null
  const markerId = first ? first.signal.id : null
  // The block the train is in: nothing but itself between it and the signal ahead
  const last = first ? first.spanIndex : route.spans.length - 1
  const bogie = routeStart(train)
  for (let i = route.spanIndex; i <= last; i++) {
    const span = route.spans[i]
    // From the leading bogie on: what lies behind it is the train itself, then whatever follows it
    const from = i === route.spanIndex && bogie && bogie.segId === span.segId ? bogie.t : span.t0
    const to = first && i === first.spanIndex ? first.signal.t : span.t1
    if (!spanFree(ctx, record.trainId, span.segId, from, to)) return { blocks: 0, obstacle: 'occupied', markerId }
    if (i < last && span.exitNode !== null && !nodeFree(ctx, record.trainId, span.exitNode)) return { blocks: 0, obstacle: 'occupied', markerId }
  }
  if (!first) return route.ended ? { blocks: 1, obstacle: 'absolute', markerId } : { blocks: Infinity, obstacle: null, markerId }
  if (first.against) return { blocks: 1, obstacle: 'absolute', markerId }
  let id = first.signal.id
  for (let blocks = 1; blocks <= CLEARANCE_BLOCKS; blocks++) {
    const signal = net.signals.get(id)
    if (!signal) break
    const status = statuses.get(id)
    if (status?.state === 'stop') {
      // Points set against the route beyond a block signal are no train ahead: a stop like a path signal's
      const absolute = signal.role === 'protection' || status.cause === 'points-against'
      return { blocks, obstacle: absolute ? 'absolute' : 'occupied', markerId }
    }
    const beyond = signalRouteIn(net, topology, id)
    if (!beyond) break
    // The block beyond this signal runs to the end of the track, or into a one-way signal
    if (beyond.next === null) return { blocks: blocks + 1, obstacle: 'absolute', markerId }
    id = beyond.next
  }
  return { blocks: Infinity, obstacle: null, markerId }
}

// ─────────────────── Update ───────────────────

/** Stopping distance (m) of a train as the physics sees it now; 0 or nothing to keep the simple estimate */
export type StoppingDistanceOf = (train: TrainSet) => number | null | undefined

/** What an update of the signalling reads besides the trains, and what else it works out */
export interface SignallingOptions {
  /** Line settings of the project: the speed of points on their diverging route depends on them (pro level) */
  line?: LineSettings
  /** Count the free blocks ahead of each train (`TrainSignalling.clearance`): for the cab signalling */
  clearance?: boolean
}

/** The stopping distance track is held for: the longer of the simple estimate and what the physics says */
function stoppingOf(train: TrainSet, stoppingDistanceOf: StoppingDistanceOf | undefined): number {
  const estimate = estimatedStoppingDistance(train.currentSpeed)
  if (!stoppingDistanceOf || !(train.currentSpeed > 0)) return estimate
  const given = stoppingDistanceOf(train)
  // A train the brake cannot hold on its slope has no stopping distance: the estimate stands
  return typeof given === 'number' && Number.isFinite(given) && given > estimate ? given : estimate
}

function occupancyOf(net: Network, train: TrainSet, record: TrainSignalling): { spans: TrackSpan[]; nodes: NodeId[] } {
  const head = train.vehicles[0].front
  const tail = train.vehicles[train.vehicles.length - 1].rear
  const key = `${train.vehicles.length}|${head.segId}|${head.t}|${tail.segId}|${tail.t}`
  if (record.occupancyKey !== key) {
    signallingStats.occupancyWalks++
    record.occupancyKey = key
    record.occupancy = rakeOccupancy(net, train.vehicles)
  }
  return record.occupancy
}

/** Has anything the signalling reads changed since the last update? Compared value by value, kept in `state.signature`. */
function sameAsLastUpdate(
  net: Network,
  trains: readonly TrainSet[],
  state: SignallingState,
  topology: SignalTopology,
  rules: string,
): boolean {
  const signature = state.signature
  let i = 0
  let same = state.topology === topology
  const put = (value: string | number): void => {
    if (signature[i] !== value) {
      signature[i] = value
      same = false
    }
    i++
  }
  put(rules)
  for (const train of trains) {
    if (train.vehicles.length === 0) continue
    const head = train.vehicles[0].front
    const tail = train.vehicles[train.vehicles.length - 1].rear
    put(train.id)
    put(train.vehicles.length)
    put(head.segId)
    put(head.t)
    put(tail.segId)
    put(tail.t)
    put(train.direction)
    put(train.currentSpeed)
    put(train.reverser)
    put(train.derailed ? 1 : 0)
  }
  put('|')
  for (const junction of net.junctions.values()) put(junction.active)
  if (signature.length !== i) {
    signature.length = i
    same = false
  }
  return same
}

/** Take the track ahead of a train and ask for the routes past the signals it nears. */
function reserveAhead(
  ctx: TickContext,
  train: TrainSet,
  record: TrainSignalling,
  route: RouteAhead,
  bogieT: number,
  stopping: number,
): void {
  const { net, topology } = ctx
  const trainId = train.id
  const headAt = route.offset + route.overhang
  const reach = stopping * RESERVATION_MARGIN + RESERVATION_PAD
  const approach = APPROACH_MIN + stopping * APPROACH_STOPPING_FACTOR
  const limit = record.holdsToNextSignal ? Infinity : headAt + reach
  const ahead = route.signals.filter((met) => met.distance > headAt + DISTANCE_EPSILON)
  const granted = new Set<SignalId>()
  record.waitingAt = null

  const first = route.spanIndex

  let next = 0
  for (let i = first; i < route.spans.length; i++) {
    const span = route.spans[i]
    const from = i === first ? bogieT : span.t0
    if (i > first && span.d0 >= limit) break
    const met = next < ahead.length && ahead[next].spanIndex === i ? ahead[next] : null
    if (met) {
      if (!spanFree(ctx, trainId, span.segId, from, met.signal.t)) break
      claimSpan(ctx, record, span.segId, from, met.signal.t)
      // The signals follow each other for as long as the route past each one is given
      for (let k = next; k < ahead.length; k++) {
        // Nothing is given past a one-way signal met from behind
        if (ahead[k].against) break
        const signal = ahead[k].signal
        const distance = ahead[k].distance - headAt
        const held = record.grants.has(signal.id)
        const within = signal.role === 'protection' || held ? approach : reach
        if (distance > within) break
        const beyond = signalRouteIn(net, topology, signal.id)
        if (!beyond || !canGrant(ctx, trainId, signal, beyond, held)) {
          if (signal.role === 'protection') record.waitingAt = signal.id
          break
        }
        granted.add(signal.id)
        for (const part of beyond.spans) claimSpan(ctx, record, part.segId, part.t0, part.t1)
        for (const nodeId of beyond.nodes) claimNode(ctx, record, nodeId)
        if (ahead[k + 1]?.signal.id !== beyond.next) break
      }
      break
    }
    if (!spanFree(ctx, trainId, span.segId, from, span.t1)) break
    claimSpan(ctx, record, span.segId, from, span.t1)
    // Points set against the train are where its route stops: it does not hold them
    if (span.exitNode !== null && !(i === route.spans.length - 1 && span.exitNode === route.blockedAt)) {
      if (!nodeFree(ctx, trainId, span.exitNode)) break
      claimNode(ctx, record, span.exitNode)
    }
  }
  record.grants = granted
}

/**
 * Bring the signalling up to date with the trains, after they have moved: who holds what, what
 * each signal shows, what each train has ahead. Returns the signals passed since the last update,
 * with for each whether it was closed and whether passing it was a fault under `settings.level`
 * (standard: any closed signal; pro: a closed path signal always, a closed block signal unless the
 * train had come to a stand before it). Nothing is done to the trains here: see `tickSignalling`.
 *
 * `stoppingDistanceOf` gives the stopping distance the physics works out for a train (the driven
 * one, typically): the track is then held over the longer of that and the simple estimate.
 * `options`: the line settings and what else to work out (see `SignallingOptions`).
 *
 * A network without signal costs nothing. When neither the trains, nor the points, nor the track
 * nor the signals have changed since the last call, nothing is worked out again.
 */
export function updateSignalling(
  net: Network,
  trains: readonly TrainSet[],
  state: SignallingState,
  settings: Pick<SignallingSettings, 'level'> = DEFAULT_SIGNALLING_SETTINGS,
  stoppingDistanceOf?: StoppingDistanceOf,
  options: SignallingOptions = {},
): SignalPassing[] {
  if (net.signals.size === 0) {
    resetSignalling(state)
    return []
  }
  const topology = signalTopology(net)
  const pro = settings.level === 'pro'
  const line = options.line
  // What the pro level reads besides the trains and the points: nothing of it weighs on the standard level
  const rules = pro ? `pro|${line?.lineType ?? ''}|${line?.gauge ?? ''}|${line?.realScale ?? ''}|${options.clearance ? 1 : 0}` : 'standard'
  if (sameAsLastUpdate(net, trains, state, topology, rules)) {
    signallingStats.skipped++
    return []
  }
  signallingStats.updates++
  const passings: SignalPassing[] = []
  if (state.topology !== topology) {
    // Track or signals changed: what was held was held on the old ones
    for (const record of state.trains.values()) {
      release(state, record)
      record.route = null
      record.grants.clear()
    }
    state.railReservations.clear()
    state.nodeReservations.clear()
    state.topology = topology
  }

  const present = new Set<TrainSetId>()
  const rakes = trains.filter((train) => train.vehicles.length > 0)
  for (const train of rakes) present.add(train.id)
  for (const [id, record] of state.trains) {
    if (present.has(id)) continue
    release(state, record)
    state.trains.delete(id)
  }

  const ctx: TickContext = {
    net,
    topology,
    state,
    occupied: new Map(),
    occupiedNodes: new Map(),
    occupiedBlocks: new Set(),
    leads: new Map(),
  }

  // 1. Where every train stands, the signals it has passed and the route ahead of it
  const stoppings = new Map<TrainSetId, number>()
  for (const train of rakes) {
    let record = state.trains.get(train.id)
    if (!record) state.trains.set(train.id, (record = newRecord(train)))

    const occupancy = occupancyOf(net, train, record)
    for (const span of occupancy.spans) {
      const part = { lo: Math.min(span.t0, span.t1), hi: Math.max(span.t0, span.t1), trainId: train.id }
      const list = ctx.occupied.get(span.segId)
      if (list) list.push(part)
      else ctx.occupied.set(span.segId, [part])
      const stretches = topology.railBlocks.get(span.segId)
      if (stretches) {
        for (const stretch of stretches) {
          if (overlaps(part.lo, part.hi, stretch.lo, stretch.hi)) ctx.occupiedBlocks.add(stretch.block)
        }
      }
    }
    for (const nodeId of occupancy.nodes) {
      const list = ctx.occupiedNodes.get(nodeId)
      if (list) list.push(train.id)
      else ctx.occupiedNodes.set(nodeId, [train.id])
      for (const block of topology.nodeBlocks.get(nodeId) ?? []) ctx.occupiedBlocks.add(block)
    }

    const start = routeStart(train)
    if (!start) continue
    if (record.direction !== train.direction) {
      // Turned back: nothing it had been given the other way holds
      record.direction = train.direction
      record.route = null
      record.grants.clear()
      record.holdsToNextSignal = false
      record.stoppedBefore = null
      record.onSight = false
    }

    let route = record.route
    const found = route && route.topology === topology ? locateOnRoute(net, route, start) : null
    if (route && !found) {
      // Not where its route led (driven from the other cab, moved by hand): it starts afresh
      record.grants.clear()
      record.holdsToNextSignal = false
      record.stoppedBefore = null
      record.onSight = false
    }
    if (route && found) {
      const before = route.offset + route.overhang
      const now = found.offset + start.overhang
      for (const met of route.signals) {
        if (met.distance <= before + DISTANCE_EPSILON || met.distance > now + DISTANCE_EPSILON) continue
        const signal = met.signal
        const closed = met.against || state.signals.get(signal.id)?.state === 'stop'
        const onSight = closed && !met.against && pro && signal.role === 'spacing' && record.stoppedBefore === signal.id
        passings.push({
          trainId: train.id,
          signalId: signal.id,
          speed: train.currentSpeed,
          closed,
          fault: closed && !onSight,
          onSight,
          ...(met.against ? { against: true as const } : {}),
        })
        record.holdsToNextSignal = !closed && record.grants.has(signal.id)
        record.onSight = onSight
        record.grants.delete(signal.id)
        record.stoppedBefore = null
      }
      route.offset = found.offset
      route.overhang = start.overhang
      route.spanIndex = found.index
    }
    const stopping = stoppingOf(train, stoppingDistanceOf)
    stoppings.set(train.id, stopping)
    const reach = lookAheadReach(stopping)
    const usable =
      route &&
      found &&
      route.met.every((met) => net.junctions.get(met.junctionId)?.active === met.active) &&
      (route.ended || route.walked - route.offset - route.overhang >= reach)
    if (!usable) {
      route = walkRouteAhead(net, topology, start, train.direction, reach * ROUTE_WALK_MARGIN)
      record.route = route
    }

    if (isActive(train)) {
      const lead = { trainId: train.id, ascending: start.ascending }
      const list = ctx.leads.get(start.segId)
      if (list) list.push(lead)
      else ctx.leads.set(start.segId, [lead])
    }
  }

  // 2. What each train holds. A train keeps what it held before any other may take it: the
  // reservations of the trains still to come are those of the last update.
  for (const train of rakes) {
    const record = state.trains.get(train.id)!
    release(state, record)
    const start = record.route && isActive(train) ? routeStart(train) : null
    if (!record.route || !start) {
      record.grants.clear()
      record.waitingAt = null
      record.holdsToNextSignal = false
      continue
    }
    // The leading bogie stands at `start.t` on the first stretch: the track from there on is what lies ahead
    reserveAhead(ctx, train, record, record.route, start.t, stoppings.get(train.id) ?? 0)
  }

  // 3. What each signal shows
  const clearedFor = new Map<SignalId, TrainSetId>()
  const heldBlocks = new Map<SignalBlock, Set<TrainSetId>>()
  for (const record of state.trains.values()) {
    for (const id of record.grants) {
      if (!clearedFor.has(id)) clearedFor.set(id, record.trainId)
    }
    const hold = (block: SignalBlock): void => {
      const holders = heldBlocks.get(block)
      if (holders) holders.add(record.trainId)
      else heldBlocks.set(block, new Set([record.trainId]))
    }
    for (const span of record.reservation.spans) {
      const stretches = topology.railBlocks.get(span.segId)
      if (!stretches) continue
      const lo = Math.min(span.t0, span.t1)
      const hi = Math.max(span.t0, span.t1)
      for (const stretch of stretches) {
        if (overlaps(lo, hi, stretch.lo, stretch.hi)) hold(stretch.block)
      }
    }
    for (const nodeId of record.reservation.nodes) {
      for (const block of topology.nodeBlocks.get(nodeId) ?? []) hold(block)
    }
  }
  const statuses = new Map<SignalId, SignalStatus>()
  for (const signal of net.signals.values()) {
    const holder = clearedFor.get(signal.id) ?? null
    const status: SignalStatus = { state: 'clear', cause: null, clearedFor: holder }
    if (signal.role === 'protection') {
      if (holder === null) {
        status.state = 'stop'
        status.cause = 'no-route'
      }
    } else if (holder === null) {
      // A block signal a train has been let past stays open for it: its route is its own
      const block = topology.blocks.get(signal.id)
      if (block && ctx.occupiedBlocks.has(block)) {
        status.state = 'stop'
        status.cause = 'occupied'
      } else if (block && heldBlocks.has(block)) {
        status.state = 'stop'
        status.cause = 'reserved'
      } else if (signalRouteIn(net, topology, signal.id)?.blockedAt != null) {
        // Its route stops on points set against it: no train is let past
        status.state = 'stop'
        status.cause = 'points-against'
      }
    }
    statuses.set(signal.id, status)
  }
  for (const signal of net.signals.values()) {
    const status = statuses.get(signal.id)!
    if (status.state === 'stop') continue
    const route = signalRouteIn(net, topology, signal.id)
    if (!route) continue
    if (route.next === null) {
      status.state = 'caution'
      status.cause = 'track-end'
    } else if (statuses.get(route.next)?.state === 'stop') {
      status.state = 'caution'
      status.cause = 'next-stop'
    }
  }
  if (pro) {
    // Points taken on a diverging route: the reminder on the path signal before them, announced one signal back
    let profile: TrackProfile | null = null
    for (const signal of net.signals.values()) {
      if (signal.role !== 'protection') continue
      const status = statuses.get(signal.id)!
      if (status.state === 'stop') continue
      const route = signalRouteIn(net, topology, signal.id)
      if (!route || route.diverging.length === 0) continue
      profile ??= trackProfile(net, line)
      let speed = Infinity
      for (const taken of route.diverging) {
        const junction = net.junctions.get(taken.junctionId)
        if (junction) speed = Math.min(speed, turnoutPassageSpeedIn(net, profile, junction, taken.a, taken.b))
      }
      const shown = slowdownSpeedFor(speed)
      if (shown) status.reminder = shown
    }
    for (const signal of net.signals.values()) {
      const status = statuses.get(signal.id)!
      // The announcement takes the place of clear only: a stop ahead is announced first
      if (status.state !== 'clear') continue
      const next = signalRouteIn(net, topology, signal.id)?.next
      const reminder = next ? statuses.get(next)?.reminder : undefined
      if (reminder) status.slowdown = reminder
    }
  }
  state.signals = statuses

  // 4. What each train has ahead
  for (const train of rakes) {
    const record = state.trains.get(train.id)!
    record.nextSignal = null
    record.closedSignal = null
    record.clearance = null
    const route = record.route
    if (!route) continue
    const headAt = route.offset + route.overhang
    for (const met of route.signals) {
      const distance = met.distance - headAt
      if (distance <= DISTANCE_EPSILON) continue
      const status = met.against ? undefined : statuses.get(met.signal.id)
      const signalState = met.against ? 'stop' : status?.state ?? 'clear'
      if (!record.nextSignal) {
        record.nextSignal = { id: met.signal.id, distance, state: signalState }
        if (met.against) record.nextSignal.against = true
        if (status?.reminder) record.nextSignal.reminder = status.reminder
        if (status?.slowdown) record.nextSignal.slowdown = status.slowdown
      }
      if (signalState === 'stop') {
        record.closedSignal = { id: met.signal.id, distance }
        break
      }
    }
    const next = record.nextSignal
    if (record.stoppedBefore && record.stoppedBefore !== next?.id) record.stoppedBefore = null
    if (next && train.currentSpeed === 0 && next.distance <= STOP_BEFORE_SIGNAL_DISTANCE) record.stoppedBefore = next.id
    record.clearance = options.clearance ? clearanceAhead(ctx, train, record, route, statuses) : null
  }

  state.revision++
  return passings
}

// ─────────────────── Reading the state ───────────────────

/** What a signal shows when the simulation has not said: a block signal open, a path signal closed */
export function defaultSignalStatus(signal: Signal): SignalStatus {
  return signal.role === 'protection'
    ? { state: 'stop', cause: 'no-route', clearedFor: null }
    : { state: 'clear', cause: null, clearedFor: null }
}

/** What a signal shows now (see `defaultSignalStatus` outside the simulation). */
export function signalStatus(state: SignallingState, signal: Signal): SignalStatus {
  return state.signals.get(signal.id) ?? defaultSignalStatus(signal)
}

/** The train holding the points or crossing at a node, null when nobody does */
export function nodeReservedBy(state: SignallingState, nodeId: NodeId): TrainSetId | null {
  return state.nodeReservations.get(nodeId) ?? null
}

/**
 * True when the points or crossing at `nodeId` are held for a train: they must not be thrown.
 * `exceptTrainId` names a train whose own reservation does not count (the driver of a train may
 * still set the points ahead of it: its route is then asked for again along the new way).
 */
export function isNodeReserved(state: SignallingState, nodeId: NodeId, exceptTrainId?: TrainSetId | null): boolean {
  const holder = state.nodeReservations.get(nodeId)
  return holder !== undefined && holder !== exceptTrainId
}

/** What the signals say to the driver of a train */
export interface TrainSignalView {
  /** The next signal on the route */
  nextSignal: SignalAhead | null
  /** The first closed signal on the route, within the look-ahead */
  closedSignal: { id: SignalId; distance: number } | null
  /** The first closed signal is nearer than the stopping distance and its margin: brake now */
  brakeAlert: boolean
  /** The path signal the train is waiting at for a route it cannot have yet */
  waitingAt: SignalId | null
  /** Pro level: running on sight (30 km/h at most) after passing a closed block signal */
  onSight: boolean
}

const NO_VIEW: TrainSignalView = { nextSignal: null, closedSignal: null, brakeAlert: false, waitingAt: null, onSight: false }

/**
 * Speed (km/h) the signals impose on a train besides the limits of the track, `Infinity` when they
 * impose none: at the pro level, `ON_SIGHT_SPEED` while the train runs on sight — after a closed
 * block signal passed at a stand, until the next signal, or while its cab shows the red of an
 * occupied block (`TrainSignalling.cab`). Nothing at the standard level.
 */
export function signalSpeedCap(state: SignallingState, trainId: TrainSetId, level: SignallingLevel): number {
  if (level !== 'pro') return Infinity
  const record = state.trains.get(trainId)
  if (!record) return Infinity
  return record.onSight || isSightClearance(record.cab) ? ON_SIGHT_SPEED : Infinity
}

/**
 * True when the cab of a high-speed line shows red for this count: the train is in a block that is
 * not free, or in the buffer block kept free behind an occupied one.
 */
export function isSightClearance(clearance: TrackClearance | null): boolean {
  if (!clearance) return false
  return clearance.blocks <= 0 || (clearance.blocks === 1 && clearance.obstacle === 'occupied')
}

/**
 * What the signals say to the driver of a train, as of the last update: read it after the
 * simulation step. `stoppingDistance` is the current stopping distance of the train in metres
 * (`trainDynamics(...).stoppingDistance`); the alert is raised when the first closed signal is
 * nearer than `SIGNAL_BRAKE_ALERT_MARGIN` times that.
 */
export function trainSignalView(state: SignallingState, trainId: TrainSetId, stoppingDistance: number): TrainSignalView {
  const record = state.trains.get(trainId)
  if (!record) return NO_VIEW
  const closed = record.closedSignal
  return {
    nextSignal: record.nextSignal,
    closedSignal: closed,
    brakeAlert: !!closed && stoppingDistance > 0 && closed.distance < stoppingDistance * SIGNAL_BRAKE_ALERT_MARGIN,
    waitingAt: record.waitingAt,
    onSight: record.onSight,
  }
}

// ─────────────────── The two levels ───────────────────

export type SignalColor = 'green' | 'yellow' | 'red'

/**
 * French indications of the pro level. `ralentissement`: points ahead to be taken at 30 or 60 km/h
 * (two yellow lamps side by side). `rappel`: the same on the path signal before those points (two
 * yellow lamps one above the other), shown alone when the track beyond is clear and together with
 * `avertissement` otherwise (`SignalAspect.reminder`).
 */
export type SignalIndication = 'voie-libre' | 'avertissement' | 'semaphore' | 'carre' | 'ralentissement' | 'rappel'

/** What a signal shows besides its state (see `SignalStatus`) */
export interface SignalExtras {
  reminder?: SlowdownSpeed | null
  slowdown?: SlowdownSpeed | null
  /** A one-way path signal read by a train that meets it from behind */
  against?: boolean
}

/** A signal as one level shows it */
export interface SignalAspect {
  level: SignallingLevel
  state: SignalState
  /** The colour of the standard level; at the pro level, the colour of the lit lamp(s) */
  color: SignalColor
  /** Pro level only */
  indication: SignalIndication | null
  /** Pro level only: the speed (km/h) of the reminder lit (rappel), null when it is not; the lamps flash for 60 */
  reminder: SlowdownSpeed | null
  /** Pro level only: the speed (km/h) of the announcement lit (ralentissement), null when it is not; the lamps flash for 60 */
  slowdown: SlowdownSpeed | null
  /** Pro level only: `F` on a block signal (passable), `Nf` on a path signal (not passable) */
  plate: 'F' | 'Nf' | null
  /** False for a marker board of a cab-signalled line at the pro level: no lamp to light */
  lit: boolean
  /** May a train that has come to a stand before the closed signal pass it on its own? */
  passableAfterStop: boolean
  /** Speed (km/h) not to exceed after doing so, null when it may not be passed */
  onSightSpeed: number | null
  /** Short name of what is shown, in French */
  label: string
}

const STANDARD_COLORS: Record<SignalState, SignalColor> = { stop: 'red', caution: 'yellow', clear: 'green' }
const STANDARD_LABELS: Record<SignalState, string> = { stop: 'Arrêt', caution: 'Attention', clear: 'Voie libre' }
const INDICATION_LABELS: Record<SignalIndication, string> = {
  'voie-libre': 'Voie libre',
  avertissement: 'Avertissement',
  semaphore: 'Sémaphore',
  carre: 'Carré',
  ralentissement: 'Ralentissement',
  rappel: 'Rappel',
}
/** What a one-way path signal says to a train that meets it from behind, at both levels */
export const AGAINST_LABEL = 'Sens interdit'

/**
 * How a level shows a signal in a given state. Standard: green, yellow or red, and every red is a
 * stop that may not be passed. Pro: voie libre, avertissement, sémaphore (a closed block signal,
 * plate F: after a stop the driver may go on, on sight at 30 km/h) or carré (a closed path signal,
 * plate Nf: never passed). `extras` adds what the pro level shows for points taken on a diverging
 * route: the announcement (ralentissement 30 or 60) in the place of voie libre, the reminder
 * (rappel 30 or 60) alone or with the avertissement. A signal read `against` (a one-way path signal
 * met from behind) is a stop that is never passed, at both levels.
 */
export function signalAspect(signal: Signal, state: SignalState, level: SignallingLevel, extras: SignalExtras = {}): SignalAspect {
  if (extras.against) state = 'stop'
  if (level !== 'pro') {
    return {
      level: 'standard',
      state,
      color: STANDARD_COLORS[state],
      indication: null,
      reminder: null,
      slowdown: null,
      plate: null,
      lit: true,
      passableAfterStop: false,
      onSightSpeed: null,
      label: extras.against ? AGAINST_LABEL : STANDARD_LABELS[state],
    }
  }
  const spacing = signal.role === 'spacing' && !extras.against
  // A marker board has no lamp to show a speed with: the cab does it
  const lit = !signal.cabMarker
  const reminder = lit && state !== 'stop' ? extras.reminder ?? null : null
  const slowdown = lit && state === 'clear' && !reminder ? extras.slowdown ?? null : null
  const indication: SignalIndication =
    state === 'stop'
      ? spacing ? 'semaphore' : 'carre'
      : state === 'caution'
        ? 'avertissement'
        : reminder
          ? 'rappel'
          : slowdown
            ? 'ralentissement'
            : 'voie-libre'
  const label = extras.against
    ? AGAINST_LABEL
    : indication === 'rappel' || indication === 'ralentissement'
      ? `${INDICATION_LABELS[indication]} ${reminder ?? slowdown}`
      : reminder
        ? `${INDICATION_LABELS[indication]} · rappel ${reminder}`
        : INDICATION_LABELS[indication]
  return {
    level: 'pro',
    state,
    color: indication === 'rappel' || indication === 'ralentissement' ? 'yellow' : STANDARD_COLORS[state],
    indication,
    reminder,
    slowdown,
    plate: spacing ? 'F' : 'Nf',
    lit,
    passableAfterStop: spacing,
    onSightSpeed: spacing ? ON_SIGHT_SPEED : null,
    label,
  }
}
