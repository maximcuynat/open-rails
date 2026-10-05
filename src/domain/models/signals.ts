import { generateId } from './ids'
import type { Network, NodeId, Segment, SegmentId, Signal, SignalId, SignalRole } from './types'
import type { TrackPosition } from './locomotive'
import { remapTrackPosition, TRACK_T_EPSILON, type RailReplacement } from './trackObjects'
import { bezierPoint } from '../geometry/curve'

// ─────────────────── Signals ───────────────────
//
// A signal lives in `Network.signals` and names the rail it stands on, so `replaceRail` keeps it in
// place whenever that rail is cut or merged and removes it with the rail, wherever the edit comes
// from. Its place is a parameter on the rail: a rail that is moved or reshaped takes it along.
//
// Only the signals are stored. Blocks (`signalBlocks.ts`), what each signal shows and the routes
// reserved for the trains (`signalling.ts`) are computed from them and from the trains.
//
// `net.signals` and the fields of a signal are only changed by the functions of this file, which
// keep the rail → signals index in step. Code that must write them directly calls
// `invalidateSignals` afterwards.
//
// This file must not import `network.ts` (which imports it) nor anything that does.

/** The two signalling levels of a project: the same stored signals read by two sets of rules */
export type SignallingLevel = 'standard' | 'pro'

/** Signalling settings of a project */
export interface SignallingSettings {
  /** `standard`: block and path signals, three colours. `pro`: French signals and their driving rules */
  level: SignallingLevel
  /** Passing a closed signal applies the emergency brake */
  stopEnforced: boolean
}

export const DEFAULT_SIGNALLING_SETTINGS: SignallingSettings = { level: 'standard', stopEnforced: true }

export function isSignallingLevel(value: unknown): value is SignallingLevel {
  return value === 'standard' || value === 'pro'
}

export function isSignalRole(value: unknown): value is SignalRole {
  return value === 'spacing' || value === 'protection'
}

/** A place on the track */
export interface SignalPlace {
  segId: SegmentId
  t: number
}

/** Options a signal carries besides its place, its direction and its role */
export interface SignalOptions {
  cabMarker?: boolean
  oneWay?: boolean
}

/** Why a signal cannot stand somewhere */
export type SignalRefusal = 'off-track' | 'on-switch' | 'duplicate'

/** What to tell the user for each refusal */
export const SIGNAL_REFUSAL_TEXT: Record<SignalRefusal, string> = {
  'off-track': 'Pose impossible ici : approchez le curseur d’un rail',
  'on-switch': 'Pose impossible sur un aiguillage ou un croisement : éloignez le signal',
  duplicate: 'Un signal de même sens se trouve déjà à cet endroit',
}

export type SignalResult = { ok: true; signal: Signal } | { ok: false; reason: SignalRefusal }
export type SignalPairResult = { ok: true; signals: [Signal, Signal] } | { ok: false; reason: SignalRefusal }

/** Standard gauge (m): the clearances below are given for it */
const REFERENCE_GAUGE = 1.435
/** A signal stands at least this far (m, at standard gauge) from points or a crossing */
export const SIGNAL_SWITCH_CLEARANCE = 2
/** Two signals of the same direction stand at least this far apart (m, at standard gauge) */
export const SIGNAL_MIN_SPACING = 0.5

export interface SignalPlacementOptions {
  /** Rail gauge of the project in metres: the clearances shrink with it on a model scale. Standard gauge when absent */
  gauge?: number
  /** A signal to leave out of the `duplicate` check: the one being moved or turned */
  ignoreId?: SignalId
}

function clearanceScale(options: SignalPlacementOptions): number {
  const gauge = options.gauge
  return typeof gauge === 'number' && gauge > 0 ? gauge / REFERENCE_GAUGE : 1
}

/** Length of the stretch `t0`…`t1` of a rail, m (the curve is measured on 16 chords) */
function stretchLength(net: Network, seg: Segment, t0: number, t1: number): number {
  const from = net.nodes.get(seg.from)
  const to = net.nodes.get(seg.to)
  if (!from || !to) return 0
  if (seg.kind === 'straight' || !seg.via) {
    return Math.abs(t1 - t0) * Math.hypot(to.pos.x - from.pos.x, to.pos.y - from.pos.y)
  }
  const steps = 16
  let length = 0
  let prev = bezierPoint(t0, from.pos, seg.via, to.pos)
  for (let i = 1; i <= steps; i++) {
    const p = bezierPoint(t0 + ((t1 - t0) * i) / steps, from.pos, seg.via, to.pos)
    length += Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  return length
}

/** True for a node where tracks part, meet or cross: three rails or more */
export function isSwitchNode(net: Network, nodeId: NodeId): boolean {
  return (net.adjacency.get(nodeId)?.length ?? 0) >= 3
}

/**
 * Why a signal for the direction `forward` cannot stand at `place`, null when it can: off the
 * track, within `SIGNAL_SWITCH_CLEARANCE` of points or of a crossing (a node with three rails or
 * more), or where a signal of the same direction already stands.
 */
export function checkSignalPlacement(
  net: Network,
  place: SignalPlace,
  forward: boolean,
  options: SignalPlacementOptions = {},
): SignalRefusal | null {
  const seg = place ? net.segments.get(place.segId) : undefined
  if (!seg || typeof place.t !== 'number' || !Number.isFinite(place.t) || place.t < 0 || place.t > 1) return 'off-track'
  const scale = clearanceScale(options)
  const clearance = SIGNAL_SWITCH_CLEARANCE * scale
  if (isSwitchNode(net, seg.from) && stretchLength(net, seg, 0, place.t) < clearance) return 'on-switch'
  if (isSwitchNode(net, seg.to) && stretchLength(net, seg, place.t, 1) < clearance) return 'on-switch'
  for (const other of signalsOnRail(net, seg.id)) {
    if (other.id === options.ignoreId || other.forward !== forward) continue
    if (stretchLength(net, seg, other.t, place.t) < SIGNAL_MIN_SPACING * scale) return 'duplicate'
  }
  return null
}

// ─────────────────── Index ───────────────────

export type SignalIndex = ReadonlyMap<SegmentId, readonly Signal[]>

interface SignalsState {
  revision: number
  index: Map<SegmentId, Signal[]> | null
}

const states = new WeakMap<Network, SignalsState>()
const NO_SIGNAL: readonly Signal[] = []

function stateOf(net: Network): SignalsState {
  let state = states.get(net)
  if (!state) {
    state = { revision: 0, index: null }
    states.set(net, state)
  }
  return state
}

/** To call after writing `net.signals` or a signal by hand: the index is rebuilt at the next read. */
export function invalidateSignals(net: Network): void {
  const state = stateOf(net)
  state.revision++
  state.index = null
}

/**
 * Counter that changes whenever a signal of the network is added, removed, moved, turned or given
 * another role or option: what is computed from the signals can be kept as long as it stays the same.
 */
export function signalsRevision(net: Network): number {
  return stateOf(net).revision
}

/**
 * For each rail, the signals standing on it, by growing `t`. Built once and kept until a signal
 * changes: reading it at every frame costs one lookup. A rail without signal has no entry.
 */
export function signalIndex(net: Network): SignalIndex {
  const state = stateOf(net)
  if (!state.index) {
    const index = new Map<SegmentId, Signal[]>()
    for (const signal of net.signals.values()) {
      const list = index.get(signal.segId)
      if (list) list.push(signal)
      else index.set(signal.segId, [signal])
    }
    for (const list of index.values()) list.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1))
    state.index = index
  }
  return state.index
}

/** The signals standing on rail `segId`, by growing `t` (empty for a rail without signal). */
export function signalsOnRail(net: Network, segId: SegmentId): readonly Signal[] {
  if (net.signals.size === 0) return NO_SIGNAL
  return signalIndex(net).get(segId) ?? NO_SIGNAL
}

/** Where a signal stands, as a position facing the trains it speaks to run */
export function signalTrackPosition(signal: Signal): TrackPosition {
  return { segId: signal.segId, t: signal.t, forward: signal.forward }
}

// ─────────────────── Editing ───────────────────

function applyOptions(signal: Signal, options: SignalOptions): void {
  if (options.cabMarker) signal.cabMarker = true
  else delete signal.cabMarker
  if (options.oneWay) signal.oneWay = true
  else delete signal.oneWay
}

/**
 * Lay a signal at `place` for the direction `forward` (see `Signal.forward`). Refused, with the
 * reason, where `checkSignalPlacement` says so.
 */
export function addSignal(
  net: Network,
  place: SignalPlace,
  forward: boolean,
  role: SignalRole,
  options: SignalOptions & SignalPlacementOptions = {},
): SignalResult {
  const reason = checkSignalPlacement(net, place, forward, options)
  if (reason) return { ok: false, reason }
  const signal: Signal = { id: generateId('sig'), segId: place.segId, t: place.t, forward, role }
  applyOptions(signal, options)
  net.signals.set(signal.id, signal)
  invalidateSignals(net)
  return { ok: true, signal }
}

/**
 * Lay two signals back to back at `place`, one for each direction (a track run both ways). They
 * are two independent signals from then on. Both are laid or none: the first is the one for the
 * `forward` direction.
 */
export function addSignalPair(
  net: Network,
  place: SignalPlace,
  role: SignalRole,
  options: SignalOptions & SignalPlacementOptions = {},
): SignalPairResult {
  const reason = checkSignalPlacement(net, place, true, options) ?? checkSignalPlacement(net, place, false, options)
  if (reason) return { ok: false, reason }
  const first = addSignal(net, place, true, role, options)
  const second = addSignal(net, place, false, role, options)
  if (!first.ok || !second.ok) {
    // Cannot happen after the checks above; nothing is left half laid
    if (first.ok) net.signals.delete(first.signal.id)
    if (second.ok) net.signals.delete(second.signal.id)
    invalidateSignals(net)
    return { ok: false, reason: !first.ok ? first.reason : !second.ok ? second.reason : 'off-track' }
  }
  return { ok: true, signals: [first.signal, second.signal] }
}

/**
 * Move a signal to another place of the track. `forward` is the direction it speaks to there; left
 * out, the signal keeps its own, which is only right on the same rail (see `slideSignal` in
 * `services/signalLayout.ts` for a move along the track). Refused like a new signal would be.
 */
export function moveSignal(
  net: Network,
  id: SignalId,
  place: SignalPlace,
  forward?: boolean,
  options: SignalPlacementOptions = {},
): SignalResult {
  const signal = net.signals.get(id)
  if (!signal) return { ok: false, reason: 'off-track' }
  const facing = forward ?? signal.forward
  const reason = checkSignalPlacement(net, place, facing, { ...options, ignoreId: id })
  if (reason) return { ok: false, reason }
  if (signal.segId !== place.segId || signal.t !== place.t || signal.forward !== facing) {
    signal.segId = place.segId
    signal.t = place.t
    signal.forward = facing
    invalidateSignals(net)
  }
  return { ok: true, signal }
}

/** Turn a signal round: it speaks to the other direction of travel, at the same place. */
export function flipSignal(net: Network, id: SignalId, options: SignalPlacementOptions = {}): SignalResult {
  const signal = net.signals.get(id)
  if (!signal) return { ok: false, reason: 'off-track' }
  return moveSignal(net, id, signal, !signal.forward, options)
}

/** Make a signal a block signal or a path signal. False when there is no such signal. */
export function setSignalRole(net: Network, id: SignalId, role: SignalRole): boolean {
  const signal = net.signals.get(id)
  if (!signal || !isSignalRole(role)) return false
  if (signal.role !== role) {
    signal.role = role
    invalidateSignals(net)
  }
  return true
}

/** Set the options named in `options` (the others stay as they are). False when there is no such signal. */
export function setSignalOptions(net: Network, id: SignalId, options: SignalOptions): boolean {
  const signal = net.signals.get(id)
  if (!signal) return false
  const next: SignalOptions = {
    cabMarker: 'cabMarker' in options ? options.cabMarker : signal.cabMarker,
    oneWay: 'oneWay' in options ? options.oneWay : signal.oneWay,
  }
  if (!!next.cabMarker !== !!signal.cabMarker || !!next.oneWay !== !!signal.oneWay) {
    applyOptions(signal, next)
    invalidateSignals(net)
  }
  return true
}

/** Remove a signal. False when there is no such signal. */
export function removeSignal(net: Network, id: SignalId): boolean {
  if (!net.signals.delete(id)) return false
  invalidateSignals(net)
  return true
}

// ─────────────────── Saves and track edits ───────────────────

/** A signal as a save holds it; anything may be missing or wrong in a file */
export interface StoredSignal {
  id?: unknown
  segId?: unknown
  t?: unknown
  forward?: unknown
  role?: unknown
  cabMarker?: unknown
  oneWay?: unknown
}

/**
 * Put back a signal read from a save, under its own id and where it was written. Nothing is checked
 * against the track here (`cleanSignals` drops what is not on it once every rail is back), nor
 * against the placement rules: a save is taken as it is. Returns false, and adds nothing, when the
 * record does not hold together or the id is taken.
 */
export function restoreSignal(net: Network, raw: StoredSignal | null | undefined): boolean {
  if (!raw || typeof raw.id !== 'string' || typeof raw.segId !== 'string' || net.signals.has(raw.id)) return false
  if (typeof raw.t !== 'number' || !Number.isFinite(raw.t) || typeof raw.forward !== 'boolean') return false
  const signal: Signal = {
    id: raw.id,
    segId: raw.segId,
    t: raw.t,
    forward: raw.forward,
    role: isSignalRole(raw.role) ? raw.role : 'spacing',
  }
  applyOptions(signal, { cabMarker: raw.cabMarker === true, oneWay: raw.oneWay === true })
  net.signals.set(signal.id, signal)
  invalidateSignals(net)
  return true
}

/**
 * Bring the signals in line with the track: one on a rail that is gone, or out of 0…1, is removed.
 * Does nothing, at the cost of one pass over the signals, when they are in order. Returns true when
 * anything changed.
 */
export function cleanSignals(net: Network): boolean {
  if (net.signals.size === 0) return false
  let changed = false
  for (const signal of [...net.signals.values()]) {
    if (net.segments.has(signal.segId) && signal.t >= -TRACK_T_EPSILON && signal.t <= 1 + TRACK_T_EPSILON) continue
    net.signals.delete(signal.id)
    changed = true
  }
  if (changed) invalidateSignals(net)
  return changed
}

/**
 * Move the signals off a replaced rail and onto its pieces (called by `replaceRail`): each one
 * stays at the same place of the world and speaks to the same direction of travel (`forward` is
 * flipped on a piece that runs the other way). A signal whose rail is removed goes with it.
 */
export function remapSignals(net: Network, replacement: RailReplacement): void {
  if (net.signals.size === 0) return
  let changed = false
  for (const signal of [...net.signals.values()]) {
    if (signal.segId !== replacement.oldId) continue
    const moved = remapTrackPosition(signalTrackPosition(signal), replacement)
    changed = true
    if (!moved) {
      net.signals.delete(signal.id)
      continue
    }
    signal.segId = moved.segId
    signal.t = moved.t
    signal.forward = moved.forward
  }
  if (changed) invalidateSignals(net)
}
