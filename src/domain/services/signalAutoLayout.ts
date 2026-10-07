import type { Network, NodeId, Segment, SegmentId, Signal, SignalRole } from '../models/types'
import { segmentArcLength } from '../models/locomotive'
import { MAX_BLOCK_LENGTH } from '../models/signalReport'
import { SIGNAL_DECELERATION } from '../models/signalling'
import { addSignal, addSignalPair, isSwitchNode, signalsOnRail, type SignalPlacementOptions } from '../models/signals'
import { DEFAULT_LINE_SETTINGS, type LineSettings } from '../models/speedLimits'
import { speedZonesOnRail } from '../models/speedZones'
import { trackProfile, type TrackProfile } from '../models/trackSpeed'

// Automatic signalling of a whole network, for a network that comes without signals (an import).
// It is the row tool of `signalLayout.ts` applied to every stretch of plain track, with a path
// signal before the points at each end. Signals are laid through `addSignal` / `addSignalPair`:
// the placement rules of the engine hold here as they do under the pointer.
//
// The rule, for each stretch of plain track (from points, a crossing or an end of track to the
// next), every stretch being signalled for both directions of travel:
// - shorter than `MIN_SIGNALLED_STRETCH`: nothing — it is part of a group of points, and the path
//   signals around the group guard it;
// - a path signal `PROTECTION_SETBACK` before the points or the crossing at each end, for the
//   trains that run towards them; none before an end of track;
// - between them, block signals in pairs (one for each direction, back to back) that cut the
//   stretch into equal blocks: as long as the distance needed to stop from the highest speed limit
//   of the stretch and never under `DEFAULT_BLOCK_LENGTH`, as far as that keeps them under
//   `LONGEST_BLOCK` — beyond, shorter blocks win over longer ones. Where the signals are the marker
//   boards of a cab-signalled line the blocks are `DEFAULT_BLOCK_LENGTH` long: the cab brings a
//   train to a stand over several of them.
// So no block signal ever has points in its block, and block signals always go in pairs.

/** Standard gauge (m): the distances below are given for it */
const REFERENCE_GAUGE = 1.435
/** A path signal stands this far (m, at standard gauge) before the points it guards */
export const PROTECTION_SETBACK = 30
/** A stretch of plain track shorter than this (m, at standard gauge) gets no signal */
export const MIN_SIGNALLED_STRETCH = 100
/** Blocks are at least this long (m, at standard gauge): the default spacing of the row tool */
export const DEFAULT_BLOCK_LENGTH = 1500
/**
 * No block of plain track is made longer than this (m, at standard gauge): the longest block of
 * the signalling report, less the points a block runs through before it reaches the plain track
 */
export const LONGEST_BLOCK = MAX_BLOCK_LENGTH * 0.85

export interface AutoSignalOptions extends SignalPlacementOptions {
  /** Line settings the speed limits are read under */
  line?: LineSettings
  /** True for a rail whose signals are the marker boards of a cab-signalled line */
  cabMarker?: (segId: SegmentId) => boolean
  /** A stretch that already carries a signal, of either direction, is left as it is */
  keepSignalled?: boolean
}

export interface AutoSignalResult {
  /** The signals laid, in the order they were */
  signals: Signal[]
  /** Places where the engine refused a signal */
  refused: number
  /** Stretches of plain track of the network */
  stretches: number
  /** Stretches too short to be signalled */
  shortStretches: number
  /** Stretches left alone because they already carried a signal (`keepSignalled`) */
  keptStretches: number
}

/** A rail of a stretch: where it starts along the stretch, and whether the stretch runs it `from` → `to` */
export interface StretchRail {
  segId: SegmentId
  ascending: boolean
  start: number
  length: number
}

/** Plain track from points, a crossing or an end of track to the next */
export interface PlainStretch {
  rails: StretchRail[]
  length: number
  /** Points or a crossing (three rails or more) at the start, at the end */
  startsOnSwitch: boolean
  endsOnSwitch: boolean
  /** A loop no points lead to: it has no end */
  closed: boolean
}

const farEnd = (seg: Segment, nodeId: NodeId): NodeId => (seg.from === nodeId ? seg.to : seg.from)

/** The rail that carries on from `seg` through a node that joins two rails, null at anything else */
function railBeyond(net: Network, nodeId: NodeId, seg: Segment): Segment | null {
  const rails = net.adjacency.get(nodeId) ?? []
  if (rails.length !== 2) return null
  const nextId = rails[0] === seg.id ? rails[1] : rails[0]
  return nextId === seg.id ? null : net.segments.get(nextId) ?? null
}

/** Every stretch of plain track of the network, each rail in exactly one */
export function plainStretches(net: Network): PlainStretch[] {
  const stretches: PlainStretch[] = []
  const seen = new Set<SegmentId>()
  for (const first of net.segments.values()) {
    if (seen.has(first.id)) continue
    // Back to where the stretch starts
    let seg = first
    let node = first.from
    let closed = false
    for (let guard = net.segments.size; guard > 0; guard--) {
      const before = railBeyond(net, node, seg)
      if (!before) break
      if (before.id === first.id) {
        closed = true
        break
      }
      seg = before
      node = farEnd(before, node)
    }
    if (closed) {
      seg = first
      node = first.from
    }
    const startNode = node
    const rails: StretchRail[] = []
    let at = 0
    for (;;) {
      seen.add(seg.id)
      const length = segmentArcLength(net, seg.id)
      rails.push({ segId: seg.id, ascending: seg.from === node, start: at, length })
      at += length
      node = farEnd(seg, node)
      const next = railBeyond(net, node, seg)
      if (!next || seen.has(next.id)) break
      seg = next
    }
    stretches.push({
      rails,
      length: at,
      startsOnSwitch: !closed && isSwitchNode(net, startNode),
      endsOnSwitch: !closed && isSwitchNode(net, node),
      closed,
    })
  }
  return stretches
}

/** The place `dist` metres along a stretch. Spread by parameter within a rail, as the row tool does */
function placeAlong(stretch: PlainStretch, dist: number): { segId: SegmentId; t: number; ascending: boolean } {
  const { rails } = stretch
  let lo = 0
  let hi = rails.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (rails[mid].start <= dist) lo = mid
    else hi = mid - 1
  }
  const rail = rails[lo]
  const share = rail.length > 0 ? Math.max(0, Math.min(1, (dist - rail.start) / rail.length)) : 0
  return { segId: rail.segId, t: rail.ascending ? share : 1 - share, ascending: rail.ascending }
}

/** Highest speed limit (km/h) met along a stretch, read at the middle of each rail */
function topSpeed(net: Network, profile: TrackProfile, stretch: PlainStretch): number {
  let top = 0
  for (const rail of stretch.rails) {
    let limit = Math.min(profile.line.lineSpeed, profile.rails.get(rail.segId)?.maxSpeed ?? Infinity)
    for (const zone of speedZonesOnRail(net, rail.segId)) if (zone.lo <= 0.5 && zone.hi >= 0.5) limit = Math.min(limit, zone.zone.speed)
    if (limit > top) top = limit
  }
  return top
}

/**
 * Number of equal blocks a length of plain track is cut into (see the rule at the top): `speed` is
 * the highest limit met on it, km/h; `cab` is true where the signals are marker boards.
 */
export function blockCount(length: number, speed: number, cab: boolean = false, scale: number = 1): number {
  const v = speed / 3.6
  const stopping = (v * v) / (2 * SIGNAL_DECELERATION)
  const wanted = cab || !Number.isFinite(stopping) ? DEFAULT_BLOCK_LENGTH : Math.max(DEFAULT_BLOCK_LENGTH, stopping)
  const count = Math.max(1, Math.floor(length / (wanted * scale)))
  return length / count > LONGEST_BLOCK * scale ? Math.ceil(length / (LONGEST_BLOCK * scale)) : count
}

/**
 * Signal the whole network (see the rule at the top). Signals already there are kept; with
 * `keepSignalled`, so is every stretch that carries one. Changes nothing but `net.signals`.
 */
export function layAutomaticSignals(net: Network, options: AutoSignalOptions = {}): AutoSignalResult {
  const result: AutoSignalResult = { signals: [], refused: 0, stretches: 0, shortStretches: 0, keptStretches: 0 }
  const line = options.line ?? DEFAULT_LINE_SETTINGS
  const gauge = options.gauge
  const scale = typeof gauge === 'number' && gauge > 0 ? gauge / REFERENCE_GAUGE : 1
  const setback = PROTECTION_SETBACK * scale
  const placement: SignalPlacementOptions = { gauge }
  const profile = trackProfile(net, line)

  const lay = (stretch: PlainStretch, dist: number, role: SignalRole, towards: 'end' | 'start' | 'both'): void => {
    const place = placeAlong(stretch, dist)
    const signalOptions = { ...placement, cabMarker: options.cabMarker?.(place.segId) === true }
    if (towards === 'both') {
      const laid = addSignalPair(net, place, role, signalOptions)
      if (laid.ok) result.signals.push(...laid.signals)
      else result.refused++
      return
    }
    const laid = addSignal(net, place, towards === 'end' ? place.ascending : !place.ascending, role, signalOptions)
    if (laid.ok) result.signals.push(laid.signal)
    else result.refused++
  }

  for (const stretch of plainStretches(net)) {
    result.stretches++
    if (stretch.length < MIN_SIGNALLED_STRETCH * scale) {
      result.shortStretches++
      continue
    }
    if (options.keepSignalled && stretch.rails.some((rail) => signalsOnRail(net, rail.segId).length > 0)) {
      result.keptStretches++
      continue
    }
    const speed = topSpeed(net, profile, stretch)
    const cab = stretch.rails.some((rail) => options.cabMarker?.(rail.segId) === true)
    if (stretch.closed) {
      const count = blockCount(stretch.length, speed, cab, scale)
      for (let k = 0; k < count; k++) lay(stretch, (k * stretch.length) / count, 'spacing', 'both')
      continue
    }
    const first = stretch.startsOnSwitch ? setback : 0
    const last = stretch.endsOnSwitch ? stretch.length - setback : stretch.length
    if (stretch.endsOnSwitch) lay(stretch, last, 'protection', 'end')
    if (stretch.startsOnSwitch) lay(stretch, first, 'protection', 'start')
    const count = blockCount(last - first, speed, cab, scale)
    for (let k = 1; k < count; k++) lay(stretch, first + (k * (last - first)) / count, 'spacing', 'both')
  }
  return result
}
