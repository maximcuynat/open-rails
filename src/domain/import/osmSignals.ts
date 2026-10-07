import type { Network, Point, Segment, SegmentId, Signal, SignalRole } from '../models/types'
import type { OsmImportIssue, OsmSignalCount, OsmSignalIgnored, OsmSignalMode, OsmSignalReport, OsmSignalSkip } from './osmTypes'
import type { OsmRead } from './osmRead'
import type { Chain, TrackGraph } from './osmGraph'
import type { BuiltNetwork } from './osmBuild'
import { projectOnSegment, segmentArcLength } from '../models/locomotive'
import { signalBlock } from '../models/signalBlocks'
import { SIGNAL_SWITCH_CLEARANCE, addSignal, isSwitchNode, setSignalRole, type SignalRefusal } from '../models/signals'
import { DEFAULT_LINE_SETTINGS, LINE_SPEED_RANGE, type LineSettings } from '../models/speedLimits'
import { layAutomaticSignals } from '../services/signalAutoLayout'
import { signalForwardFor } from '../services/signalLayout'
import { trackAt } from './osmLevels'
import {
  CAB_MARKER_KIND_KEY,
  CAB_MARKER_PLATE_KEYS,
  CAB_MARKER_VALUE,
  CAB_SIGNAL_KEY,
  CAB_STOP_MARKER_KINDS,
  CARRE_STATES,
  DEACTIVATED_KEYS,
  IGNORED_CATEGORIES,
  IGNORED_ORDER,
  MAIN_PLATE_KEYS,
  MAIN_SIGNAL_KEY,
  MAIN_SIGNAL_VALUES,
  MAIN_STATES_KEY,
  OLD_CAB_MARKER_VALUES,
  PLATE_ROLES,
  SIGNAL_DIRECTION_KEY,
} from './osmSignalTable'

// The signals of an imported network: the real ones, read from the `railway=signal` nodes and laid
// where their node stands on the track, and the automatic signalling. What each tag value stands
// for is in `osmSignalTable.ts`; nothing here names a value.
//
// The signalling level of the project plays no part: a carré is stored as a path signal
// (`protection`), a sémaphore as a block signal (`spacing`), a marker board of a high-speed line
// as one of the two with `cabMarker`, and each level reads them its own way.

type Tags = Record<string, string>

/** What a `railway=signal` node is for the import */
export type OsmSignalReading =
  | {
      use: true
      role: SignalRole
      cabMarker: boolean
      /** The data does not say whether the marker may be passed: `spacing` unless points follow it */
      assumed: boolean
    }
  | { use: false; why: OsmSignalIgnored }

const own = <T>(table: Readonly<Record<string, T>>, key: string | undefined): T | undefined =>
  key !== undefined && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined

const listOf = (value: string | undefined): string[] =>
  (value ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')

function plateRole(tags: Tags, keys: readonly string[]): SignalRole | undefined {
  for (const key of keys) {
    for (const value of listOf(tags[key])) {
      const role = own(PLATE_ROLES, value)
      if (role) return role
    }
  }
  return undefined
}

/** A category key (`railway:signal:<category>`), as opposed to `direction`, `position` and the sub-keys */
const CATEGORY_KEY = /^railway:signal:([a-z_]+)$/
const NOT_A_CATEGORY: readonly string[] = ['direction', 'position']

/**
 * Read what a signal node is. Tolerant: a value in no table gives a signal left aside and counted
 * (`unknown`), never an error.
 */
export function readOsmSignal(tags: Tags | undefined): OsmSignalReading {
  if (!tags) return { use: false, why: 'untyped' }
  if (DEACTIVATED_KEYS.some((key) => tags[key] === 'yes')) return { use: false, why: 'deactivated' }

  const main = tags[MAIN_SIGNAL_KEY]?.trim()
  if (main) {
    const kind = own(MAIN_SIGNAL_VALUES, main)
    if (kind === 'shunting') return { use: false, why: 'shunting' }
    const showsCarre = listOf(tags[MAIN_STATES_KEY]).some((state) => CARRE_STATES.includes(state))
    const plate = plateRole(tags, MAIN_PLATE_KEYS)
    if (kind === 'carre') return { use: true, role: 'protection', cabMarker: false, assumed: false }
    // A sémaphore that can show the carré, or that carries the Nf plate, is a carré
    if (kind === 'semaphore') return { use: true, role: showsCarre || plate === 'protection' ? 'protection' : 'spacing', cabMarker: false, assumed: false }
    // A value the table does not know: its states or its plate may still say what it is
    if (showsCarre) return { use: true, role: 'protection', cabMarker: false, assumed: false }
    if (plate) return { use: true, role: plate, cabMarker: false, assumed: false }
    return { use: false, why: 'unknown' }
  }

  const cab = listOf(tags[CAB_SIGNAL_KEY])
  if (cab.length > 0) {
    const isMarker = cab.includes(CAB_MARKER_VALUE)
      ? CAB_STOP_MARKER_KINDS.includes(tags[CAB_MARKER_KIND_KEY] ?? '')
      : cab.some((value) => OLD_CAB_MARKER_VALUES.includes(value))
    if (!isMarker) return { use: false, why: 'other' }
    const plate = plateRole(tags, CAB_MARKER_PLATE_KEYS)
    return { use: true, role: plate ?? 'spacing', cabMarker: true, assumed: plate === undefined }
  }

  const kinds = new Set<OsmSignalIgnored>()
  for (const key of Object.keys(tags)) {
    const category = CATEGORY_KEY.exec(key)?.[1]
    if (category === undefined || NOT_A_CATEGORY.includes(category)) continue
    kinds.add(own(IGNORED_CATEGORIES, category) ?? 'other')
  }
  if (kinds.size === 0) return { use: false, why: 'untyped' }
  return { use: false, why: IGNORED_ORDER.find((kind) => kinds.has(kind)) ?? 'other' }
}

/** The direction of travel a signal speaks to, relative to the way it is on; null when the data does not settle it */
export function readSignalDirection(tags: Tags | undefined): 'forward' | 'backward' | null {
  const direction = tags?.[SIGNAL_DIRECTION_KEY]?.trim()
  return direction === 'forward' || direction === 'backward' ? direction : null
}

/** True for a signal node the import can lay as it is: a kind it reads, and a direction */
export function isUsableSignal(tags: Tags | undefined): boolean {
  return tags?.railway === 'signal' && readSignalDirection(tags) !== null && readOsmSignal(tags).use
}

/** Line settings of the imported network, as far as the automatic signalling reads them */
export function importLine(lineSpeed: number | undefined, highSpeed: boolean): LineSettings {
  const fallback = highSpeed ? 300 : DEFAULT_LINE_SETTINGS.lineSpeed
  const speed = typeof lineSpeed === 'number' && lineSpeed > 0 ? lineSpeed : fallback
  return { lineSpeed: Math.max(LINE_SPEED_RANGE.min, Math.min(LINE_SPEED_RANGE.max, speed)), lineType: highSpeed ? 'highSpeed' : 'classic' }
}

// ─────────────────── Where a node stands on the laid track ───────────────────

/** A signal node is looked for on the rails of its own track within this distance (m)… */
const OWN_TRACK_REACH = 5
/** …and, when those cannot be told (rails cut since they were laid), on any rail within this one */
const ANY_TRACK_REACH = 1.5
/** Side (m) of the cells the rails are sorted into */
const CELL = 100
/** A signal moved clear of points stands this much further than the clearance asks; tried in turn */
const CLEARANCE_MARGINS = [1.05, 1.5]

const SKIP_TEXT: Record<Exclude<OsmSignalSkip, 'track-not-imported'>, string> = {
  'no-direction': 'Signal sans sens de circulation dans les données : non posé.',
  'ambiguous-direction': 'Signal à la jonction de deux tracés de sens opposés : son sens ne peut pas être lu, non posé.',
  'off-track': 'Signal trop loin de la voie une fois tracée : non posé.',
  'on-switch': 'Signal sur un aiguillage ou un croisement, sans place pour l’en écarter : non posé.',
  duplicate: 'Un signal de même sens se trouve déjà à cet endroit : non posé.',
}

function railIndex(net: Network): Map<string, Segment[]> {
  const cells = new Map<string, Segment[]>()
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)?.pos
    const b = net.nodes.get(seg.to)?.pos
    if (!a || !b) continue
    const xs = seg.via ? [a.x, b.x, seg.via.x] : [a.x, b.x]
    const ys = seg.via ? [a.y, b.y, seg.via.y] : [a.y, b.y]
    const x0 = Math.floor((Math.min(...xs) - OWN_TRACK_REACH) / CELL)
    const x1 = Math.floor((Math.max(...xs) + OWN_TRACK_REACH) / CELL)
    const y0 = Math.floor((Math.min(...ys) - OWN_TRACK_REACH) / CELL)
    const y1 = Math.floor((Math.max(...ys) + OWN_TRACK_REACH) / CELL)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`
        const list = cells.get(key)
        if (list) list.push(seg)
        else cells.set(key, [seg])
      }
    }
  }
  return cells
}

/** The chain a rail was laid from; a rail cut since then answers for the one it was cut from */
function chainOfRail(built: BuiltNetwork, seg: Segment): Chain | undefined {
  return built.railChain.get(seg.id) ?? (seg.parentSegmentId ? built.railChain.get(seg.parentSegmentId) : undefined)
}

/** True for a rail laid from a high-speed track: its signals are marker boards */
function isHighSpeedRail(built: BuiltNetwork, seg: Segment | undefined): boolean {
  const chain = seg && chainOfRail(built, seg)
  if (!seg || !chain) return false
  const laid = built.railChain.has(seg.id) ? seg.id : seg.parentSegmentId
  const rail = built.chainRails[chain.index].find((r) => r.segId === laid)
  return rail ? trackAt(chain, (rail.s0 + rail.s1) / 2).highSpeed : chain.edges[0].track.highSpeed
}

/**
 * The direction the way is drawn in at a node, as a world vector: null where two ways drawn in
 * opposite directions meet (`forward` then means one thing on one side and the opposite on the other).
 */
function wayHeading(graph: TrackGraph, id: number): Point | null {
  const edges = graph.at.get(id) ?? []
  let x = 0
  let y = 0
  let arriving = 0
  for (const edge of edges) {
    const a = graph.pos.get(edge.a)
    const b = graph.pos.get(edge.b)
    if (!a || !b) continue
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
    x += (b.x - a.x) / length
    y += (b.y - a.y) / length
    if (edge.b === id) arriving++
  }
  if (edges.length === 2 && arriving !== 1) return null
  return x === 0 && y === 0 ? null : { x, y }
}

export interface SignalLayInput {
  net: Network
  read: OsmRead
  graph: TrackGraph
  chains: Chain[]
  built: BuiltNetwork
  /** World position of a place, for the nodes that are on no imported track */
  project: (lat: number, lon: number) => Point
  mode: OsmSignalMode
  line: LineSettings
}

/**
 * Lay the signals the mode asks for, and say what was done. The network keeps its nodes and rails:
 * only `net.signals` changes. To be called on the network as it will be handed over (route tables
 * in place: the blocks are read to tell what an untyped marker board guards).
 */
export function laySignals(input: SignalLayInput): { report: OsmSignalReport; issues: OsmImportIssue[] } {
  const { net, read, graph, chains, built, mode } = input
  const count = (): OsmSignalCount => ({ protection: 0, spacing: 0, cabMarkers: 0 })
  const report: OsmSignalReport = { mode, found: 0, real: count(), realMoved: 0, skipped: {}, ignored: {}, generated: count(), stretchesLeftToReal: 0 }
  const issues: OsmImportIssue[] = []

  const withReal = mode === 'real' || mode === 'mixed'
  const chainsAt = new Map<number, Set<Chain>>()
  let rails: Map<string, Segment[]> | null = null
  if (withReal) {
    for (const chain of chains) {
      for (const id of chain.nodes) {
        const set = chainsAt.get(id)
        if (set) set.add(chain)
        else chainsAt.set(id, new Set([chain]))
      }
    }
    rails = railIndex(net)
  }

  /** The place of a node on the laid track: the nearest rail of its own track, else any rail right under it */
  const placeOf = (id: number, at: Point): { segId: SegmentId; t: number } | null => {
    const mine = chainsAt.get(id)
    let own: { segId: SegmentId; t: number } | null = null
    let ownDist = OWN_TRACK_REACH
    let any: { segId: SegmentId; t: number } | null = null
    let anyDist = ANY_TRACK_REACH
    for (const seg of rails!.get(`${Math.floor(at.x / CELL)},${Math.floor(at.y / CELL)}`) ?? []) {
      const found = projectOnSegment(net, seg, at)
      if (!found) continue
      const dist = Math.hypot(found.point.x - at.x, found.point.y - at.y)
      const chain = chainOfRail(built, seg)
      if (chain && mine?.has(chain)) {
        if (dist < ownDist) {
          ownDist = dist
          own = { segId: seg.id, t: found.t }
        }
      } else if (!chain && dist < anyDist) {
        anyDist = dist
        any = { segId: seg.id, t: found.t }
      }
    }
    return own ?? any
  }

  /** Lay a signal, moved along its rail just clear of the points when it stands too near them */
  const layReal = (place: { segId: SegmentId; t: number }, forward: boolean, role: SignalRole, cabMarker: boolean): { signal: Signal; moved: boolean } | SignalRefusal => {
    const first = addSignal(net, place, forward, role, { cabMarker })
    if (first.ok) return { signal: first.signal, moved: false }
    if (first.reason !== 'on-switch') return first.reason
    const seg = net.segments.get(place.segId)!
    const length = segmentArcLength(net, seg.id)
    for (const margin of CLEARANCE_MARGINS) {
      const share = length > 0 ? (SIGNAL_SWITCH_CLEARANCE * margin) / length : Infinity
      const lo = isSwitchNode(net, seg.from) ? share : 0
      const hi = isSwitchNode(net, seg.to) ? 1 - share : 1
      if (lo > hi) break
      const moved = addSignal(net, { segId: seg.id, t: Math.max(lo, Math.min(hi, place.t)) }, forward, role, { cabMarker })
      if (moved.ok) return { signal: moved.signal, moved: true }
      if (moved.reason !== 'on-switch') return moved.reason
    }
    return 'on-switch'
  }

  const assumed: Signal[] = []
  for (const node of read.nodes.values()) {
    if (node.tags?.railway !== 'signal') continue
    report.found++
    if (!withReal) continue
    const reading = readOsmSignal(node.tags)
    if (!reading.use) {
      report.ignored[reading.why] = (report.ignored[reading.why] ?? 0) + 1
      continue
    }
    const at = graph.at.has(node.id) ? graph.pos.get(node.id) : undefined
    const skip = (why: OsmSignalSkip): void => {
      report.skipped[why] = (report.skipped[why] ?? 0) + 1
      // A signal on a track the options leave out is no surprise: counted, not listed
      if (why === 'track-not-imported') return
      const pos = at ?? input.project(node.lat, node.lon)
      issues.push({ kind: 'signal-not-placed', x: pos.x, y: pos.y, osmIds: [node.id], detail: SKIP_TEXT[why] })
    }
    if (!at) {
      skip('track-not-imported')
      continue
    }
    const direction = readSignalDirection(node.tags)
    if (!direction) {
      skip('no-direction')
      continue
    }
    // Where three tracks or more meet, nothing says which one the signal is on
    if ((graph.at.get(node.id)?.length ?? 0) >= 3) {
      skip('on-switch')
      continue
    }
    const drawn = wayHeading(graph, node.id)
    if (!drawn) {
      skip('ambiguous-direction')
      continue
    }
    const place = placeOf(node.id, at)
    if (!place) {
      skip('off-track')
      continue
    }
    const heading = direction === 'forward' ? drawn : { x: -drawn.x, y: -drawn.y }
    const laid = layReal(place, signalForwardFor(net, place, heading), reading.role, reading.cabMarker)
    if (typeof laid === 'string') {
      skip(laid)
      continue
    }
    report.real[reading.role]++
    if (reading.cabMarker) report.real.cabMarkers++
    if (laid.moved) report.realMoved++
    if (reading.assumed) assumed.push(laid.signal)
  }

  // A marker board the data does not type guards points when some lie in its block
  for (const signal of assumed) {
    if ((signalBlock(net, signal.id)?.conflictPoints.length ?? 0) === 0) continue
    setSignalRole(net, signal.id, 'protection')
    report.real.spacing--
    report.real.protection++
  }

  if (mode === 'generated' || mode === 'mixed') {
    const generated = layAutomaticSignals(net, {
      line: input.line,
      cabMarker: (segId) => isHighSpeedRail(built, net.segments.get(segId)),
      keepSignalled: mode === 'mixed',
    })
    for (const signal of generated.signals) {
      report.generated[signal.role]++
      if (signal.cabMarker) report.generated.cabMarkers++
    }
    report.stretchesLeftToReal = generated.keptStretches
  }
  return { report, issues }
}
