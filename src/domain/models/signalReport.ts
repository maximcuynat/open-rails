/**
 * Checks of the signalling of a network, for the editor: nothing here blocks anything, the entries
 * are only shown. Pure: reads the network, the blocks (`signalBlocks.ts`) and the speed limits.
 */

import type { JunctionId, Network, NodeId, SegmentId, Signal, SignalId } from './types'
import type { LineSettings } from './speedLimits'
import { DEFAULT_LINE_SETTINGS } from './speedLimits'
import type { SignallingLevel } from './signals'
import { checkSignalPlacement, isSwitchNode, signalsOnRail } from './signals'
import { segmentArcLength, segmentPartialLength } from './locomotive'
import { signalTopology } from './signalBlocks'
import { SIGNAL_DECELERATION } from './signalling'
import { speedLimitAt } from './trackSpeed'

/** Longest block of a French automatic block line (m): checked at the pro level */
export const MAX_BLOCK_LENGTH = 2800
/**
 * On a track signalled for both directions, a block signal has its opposite number when a signal
 * of the other direction stands within this distance (m, at standard gauge). ESTIMATED: the source
 * only says the two stand « at about the same place » (`tasks/recherche-voie-unique.md`).
 */
export const LONE_SIGNAL_REACH = 100
/** Standard gauge (m): `LONE_SIGNAL_REACH` is given for it */
const REFERENCE_GAUGE = 1.435

export type SignalReportType = 'block-too-short' | 'block-too-long' | 'unprotected-switch' | 'signal-on-switch' | 'lone-signal'

/** One thing the signalling of the network should have a look at */
export interface SignalReportEntry {
  type: SignalReportType
  /** Where to show it on the track */
  segId: SegmentId
  t: number
  /** The signal concerned: the one whose block is too short, too long, or holds the unprotected points */
  signalId: SignalId
  /** The points or the crossing concerned (`unprotected-switch`) */
  nodeId?: NodeId
  junctionId?: JunctionId
  /** Length of the block, m (`block-too-short`: to its nearest end; `block-too-long`: to its farthest) */
  length?: number
  /** Stopping distance the block is compared with, m, and the speed it is worked out for, km/h (`block-too-short`) */
  stoppingDistance?: number
  speed?: number
  /** Short text in French */
  message: string
}

export interface SignalReportOptions {
  level?: SignallingLevel
  line?: LineSettings
}

const metres = (value: number): string => `${Math.round(value).toLocaleString('fr-FR')} m`

/**
 * What to check in the signalling of the network:
 * - `block-too-short`: the distance from a signal to the nearest end of its block is shorter than
 *   the distance needed to stop from the speed limit at the signal, taken as `v² / (2 × 0.7 m/s²)`;
 * - `block-too-long` (pro level only): the farthest end of a block is more than 2 800 m away;
 * - `unprotected-switch`: points met by their toe, or a crossing, lie in the block of a block
 *   signal — nothing but a path signal before them lets two trains use them one after the other;
 * - `signal-on-switch`: a signal stands nearer points or a crossing than a new one could be laid
 *   (they were built after it and it could not be pushed back, see `moveSignalsOffSwitches`);
 * - `lone-signal`: on plain track (between two sets of points, or ends of track) that carries
 *   signals for both directions, a block signal with no signal of the other direction within
 *   `LONE_SIGNAL_REACH` — where a track is run both ways the block signals go in pairs, so that it
 *   is cut into the same blocks for both directions. Only block signals are reported: the path
 *   signals at the ends of a passing loop stand alone by design. A track signalled for one
 *   direction only is never reported: nothing tells it is run both ways.
 * Entries come in the order of the signals. Empty for a network without signal.
 */
export function signalReport(net: Network, options: SignalReportOptions = {}): SignalReportEntry[] {
  if (net.signals.size === 0) return []
  const level = options.level ?? 'standard'
  const line = options.line ?? DEFAULT_LINE_SETTINGS
  const topology = signalTopology(net)
  const entries: SignalReportEntry[] = []
  const reported = new Set<NodeId>()
  const gauge = typeof line.gauge === 'number' && line.gauge > 0 ? line.gauge : REFERENCE_GAUGE
  const lone = loneSignals(net, (LONE_SIGNAL_REACH * gauge) / REFERENCE_GAUGE)
  for (const signal of net.signals.values()) {
    const block = topology.blocks.get(signal.id)
    if (!block) continue
    const at = { segId: signal.segId, t: signal.t, signalId: signal.id }

    if (checkSignalPlacement(net, signal, signal.forward, { gauge: line.gauge, ignoreId: signal.id }) === 'on-switch') {
      entries.push({
        ...at,
        type: 'signal-on-switch',
        message: 'Signal trop près d’un aiguillage ou d’un croisement construit après lui : déplacez-le',
      })
    }

    const speed = speedLimitAt(net, signal.segId, signal.t, line)
    const v = speed / 3.6
    const stoppingDistance = (v * v) / (2 * SIGNAL_DECELERATION)
    if (Number.isFinite(stoppingDistance) && block.minLength < stoppingDistance) {
      entries.push({
        ...at,
        type: 'block-too-short',
        length: block.minLength,
        stoppingDistance,
        speed,
        message: `Canton trop court : ${metres(block.minLength)} pour ${metres(stoppingDistance)} d’arrêt à ${Math.round(speed)} km/h`,
      })
    }
    if (level === 'pro' && block.maxLength > MAX_BLOCK_LENGTH) {
      entries.push({
        ...at,
        type: 'block-too-long',
        length: block.maxLength,
        message: `Canton trop long : ${metres(block.maxLength)} (2 800 m au plus)`,
      })
    }
    if (signal.role !== 'spacing') continue
    if (lone.has(signal.id)) {
      entries.push({
        ...at,
        type: 'lone-signal',
        message: 'Signal isolé sur une voie signalée dans les deux sens : aucun signal de l’autre sens à proximité (les signaux d’espacement y vont par paires)',
      })
    }
    for (const point of block.conflictPoints) {
      if (reported.has(point.nodeId)) continue
      reported.add(point.nodeId)
      entries.push({
        type: 'unprotected-switch',
        segId: point.segId,
        t: point.t,
        signalId: signal.id,
        nodeId: point.nodeId,
        ...(point.junctionId ? { junctionId: point.junctionId } : {}),
        message:
          point.kind === 'crossing'
            ? 'Croisement sans signal de protection en amont'
            : 'Aiguille abordée par la pointe sans signal de protection en amont',
      })
    }
  }
  return entries
}

/** A rail of a stretch of plain track: where it starts along the stretch and which way it is run */
interface StretchRail {
  segId: SegmentId
  /** Distance along the stretch of the end the stretch reaches the rail by, m */
  start: number
  /** True when the stretch runs the rail from its `from` node to its `to` node */
  ascending: boolean
}

/**
 * The plain track a rail is part of: the rails that follow each other through nodes joining two
 * rails, as far as points, a crossing or an end of track either way. Distances run along the
 * direction of `segId` from its `from` node (0) to its `to` node.
 */
function plainStretch(net: Network, segId: SegmentId): StretchRail[] {
  const first = net.segments.get(segId)
  if (!first) return []
  const rails: StretchRail[] = [{ segId, start: 0, ascending: true }]
  const seen = new Set<SegmentId>([segId])
  for (const forward of [true, false]) {
    let nodeId = forward ? first.to : first.from
    let railId = segId
    let at = forward ? segmentArcLength(net, segId) : 0
    while (!isSwitchNode(net, nodeId)) {
      const nextId = (net.adjacency.get(nodeId) ?? []).find((id) => id !== railId)
      const next = nextId ? net.segments.get(nextId) : undefined
      if (!next || seen.has(next.id)) break
      seen.add(next.id)
      const length = segmentArcLength(net, next.id)
      // Going on, the rail is entered at `nodeId`; going back, it is left there
      const ascending = forward ? next.from === nodeId : next.to === nodeId
      rails.push({ segId: next.id, start: forward ? at : at - length, ascending })
      at += forward ? length : -length
      railId = next.id
      nodeId = forward ? (ascending ? next.to : next.from) : (ascending ? next.from : next.to)
    }
  }
  return rails
}

/**
 * The block signals that stand alone on plain track signalled for both directions: no signal of
 * the other direction within `reach` metres along the track (see `signalReport`, `lone-signal`).
 */
function loneSignals(net: Network, reach: number): Set<SignalId> {
  const lone = new Set<SignalId>()
  const done = new Set<SegmentId>()
  for (const signal of net.signals.values()) {
    if (done.has(signal.segId)) continue
    const placed: { signal: Signal; at: number; along: boolean }[] = []
    for (const rail of plainStretch(net, signal.segId)) {
      done.add(rail.segId)
      for (const other of signalsOnRail(net, rail.segId)) {
        const offset = rail.ascending ? segmentPartialLength(net, rail.segId, 0, other.t) : segmentPartialLength(net, rail.segId, other.t, 1)
        placed.push({ signal: other, at: rail.start + offset, along: other.forward === rail.ascending })
      }
    }
    // Signalled for one direction only: nothing says the track is run both ways
    if (!placed.some((entry) => entry.along) || !placed.some((entry) => !entry.along)) continue
    for (const entry of placed) {
      if (entry.signal.role !== 'spacing') continue
      const paired = placed.some((other) => other.along !== entry.along && Math.abs(other.at - entry.at) <= reach)
      if (!paired) lone.add(entry.signal.id)
    }
  }
  return lone
}
