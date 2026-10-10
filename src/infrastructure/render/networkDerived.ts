import type { Network, NodeId, Segment, SegmentId } from '@domain/models/types'
import { networkCheckToken, verifyingNetworkRevisions } from '@domain/models/networkWatch'
import { gradientRamps, type GradientRamp, type RampRail } from '@domain/models/network'
import { bezierPoint } from '@domain/geometry/curve'
import { anyChange, networkChangesSince, type NetworkChanges, type NetworkFollower } from '@domain/geometry/networkFollower'
import { railMeasures, type RailMeasures } from '@domain/geometry/railMeasures'
import { SectionTracker } from '@domain/models/sectionTracker'
import { pointOnShape, reversedShape, segmentEnds, shapeChordCount, shapePolyline } from '@domain/geometry/segmentGeometry'
import { detectCrossings, type DiamondCrossing } from '@domain/models/crossing'
import {
  detectDirectionConflicts,
  type DirectionConflict,
  type SectionEndpointCache,
  type SectionMetadata,
  type TrackSection,
} from '@domain/models/sections'
import type { GradientLimits, KinematicIssue } from '@domain/services/kinematicDiagnostics'
import { KinematicTracker } from '@domain/services/kinematicTracker'
import { detectConnectedComponents, detectDeadEnds, detectLoops } from '@domain/services/pathfinding'

/** A part of the network no rail joins to the rest */
export type NetworkComponent = ReturnType<typeof detectConnectedComponents>[number]

/** A section as one line, in world coordinates: what the zoomed-out drawing traces (see `lodTracks.ts`) */
export interface SectionPolyline {
  section: TrackSection
  /** x, y pairs from one end of the section to the other */
  points: Float64Array
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** Every node of the section is below ground */
  tunnel: boolean
}

/** The ramps of the network and, for each rail of one, the ramp it belongs to */
export interface RampIndex {
  ramps: readonly GradientRamp[]
  ofSegment: ReadonlyMap<SegmentId, { ramp: GradientRamp; rail: RampRail }>
}

/** What the drawing reads from the network besides its geometry. Recomputed only when the network changes. */
export interface NetworkDerived {
  sections: TrackSection[]
  sectionOfSegment: ReadonlyMap<SegmentId, TrackSection>
  conflicts: DirectionConflict[]
  kinematicIssues(gauge?: number, gradient?: GradientLimits): KinematicIssue[]
  /** One polyline per section, built on first use: only the schematic drawing reads them */
  sectionPolylines(): SectionPolyline[]
  /**
   * Where the badge of each section stands: the middle of its middle rail, as `x, y` per section in
   * the order of `sections` (NaN for a section whose middle rail is not whole). Built on first use.
   */
  sectionBadgeAnchors(): Float64Array
  /** The ramps (`gradientRamps`) for this height of one level, built on first use */
  ramps(levelHeight: number): RampIndex
  /** Rails the diagnostics report as steeper than the limit: the ones `kinematicIssues` names, built on first use */
  steepRails(gauge?: number, gradient?: GradientLimits): ReadonlySet<SegmentId>
  /**
   * The graph analyses the inspector shows, each worked out on first use and kept. They are shared
   * with every other reader: not to be modified.
   */
  deadEnds(): readonly NodeId[]
  loops(): readonly (readonly NodeId[])[]
  components(): readonly NetworkComponent[]
  /** Length of all the rails (m) and how many of them are curved, straight */
  trackTotals(): TrackTotals
  /** The diamond crossings of the network (`detectCrossings`) */
  crossings(): readonly DiamondCrossing[]
}

/**
 * How far, in metres, the flattened line of a curve may stray from it. The polylines are only drawn
 * where a pixel covers several metres, so this stays well under a pixel.
 */
export const POLYLINE_TOLERANCE = 0.5
/** Most chords one curved rail is flattened into */
export const POLYLINE_MAX_CHORDS = 8

function sectionPolyline(net: Network, section: TrackSection): SectionPolyline | null {
  const pts: number[] = []
  let tunnel = true
  let current = section.orderedNodeIds[0]
  for (const sid of section.segmentIds) {
    const seg = net.segments.get(sid)
    if (!seg) continue
    // The rails of a section follow one another: each is walked from the node the last one ended at
    const reversed = seg.to === current && seg.from !== current
    const start = net.nodes.get(reversed ? seg.to : seg.from)
    const end = net.nodes.get(reversed ? seg.from : seg.to)
    const shape = segmentEnds(net, seg)
    if (!start || !end || !shape) continue
    if ((start.level ?? 0) >= 0 || (end.level ?? 0) >= 0) tunnel = false
    if (pts.length === 0) pts.push(start.pos.x, start.pos.y)
    // The points between the two ends: as many chords as keep the line within POLYLINE_TOLERANCE
    const walked = reversed ? reversedShape(shape) : shape
    const line = shapePolyline(walked, Math.min(POLYLINE_MAX_CHORDS, shapeChordCount(walked, POLYLINE_TOLERANCE)))
    for (let i = 1; i < line.length - 1; i++) pts.push(line[i].x, line[i].y)
    pts.push(end.pos.x, end.pos.y)
    current = end.id
  }
  if (pts.length < 4) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < minX) minX = pts[i]
    if (pts[i] > maxX) maxX = pts[i]
    if (pts[i + 1] < minY) minY = pts[i + 1]
    if (pts[i + 1] > maxY) maxY = pts[i + 1]
  }
  return { section, points: Float64Array.from(pts), minX, maxX, minY, maxY, tunnel }
}

/**
 * One state of the settings of the sections (names, kinds, colours). Those of a network that has a
 * revision are told apart the same way: by the object and a counter moved by `sectionMetaChanged`
 * whenever something is written into it. Otherwise by their whole content, as text.
 */
interface MetaStamp {
  ref: Record<string, SectionMetadata> | undefined
  revision: number
  text: string
}

/** The count of writes into one settings object, and which keys the last ones wrote (null: not known) */
interface MetaWrites {
  revision: number
  /** Keys written at each count, the last `META_WRITES_KEPT` counts only */
  log: { revision: number; keys: Set<string> | null }[]
}

const META_WRITES_KEPT = 64
const metaRevisions = new WeakMap<object, MetaWrites>()

function metaWrites(meta: object): MetaWrites {
  let writes = metaRevisions.get(meta)
  if (!writes) {
    writes = { revision: 0, log: [] }
    metaRevisions.set(meta, writes)
  }
  return writes
}

/**
 * Names or settings of sections were written into `meta`: what is kept of them is worked out
 * again. `keys`: the entries written, when the writer knows them — only the sections they belong
 * to are then read again.
 */
export function sectionMetaChanged(meta: Record<string, SectionMetadata>, keys?: Iterable<string>): void {
  const writes = metaWrites(meta)
  writes.revision++
  writes.log.push({ revision: writes.revision, keys: keys ? new Set(keys) : null })
  if (writes.log.length > META_WRITES_KEPT) writes.log.shift()
}

/** The keys written into `meta` since count `since`, or null when some write did not say */
function metaKeysWrittenSince(meta: object, since: number): Set<string> | null {
  const writes = metaWrites(meta)
  if (writes.log.length === 0 || writes.log[0].revision > since + 1) return null
  const keys = new Set<string>()
  for (const entry of writes.log) {
    if (entry.revision <= since) continue
    if (!entry.keys) return null
    for (const key of entry.keys) keys.add(key)
  }
  return keys
}

/**
 * Brings the settings of the sections to those saved (a step of the undo history), in place:
 * the entries that differ are put back, the others left as they are, and only the keys that
 * changed are told to `sectionMetaChanged`.
 */
export function applySectionMeta(live: Record<string, SectionMetadata>, saved: Record<string, SectionMetadata>): void {
  const changed: string[] = []
  for (const key in saved) {
    if (live[key] === saved[key]) continue
    live[key] = saved[key]
    changed.push(key)
  }
  for (const key in live) {
    if (key in saved) continue
    delete live[key]
    changed.push(key)
  }
  if (changed.length > 0) sectionMetaChanged(live, changed)
}

function metaStamp(counted: boolean, meta: Record<string, SectionMetadata> | undefined): MetaStamp {
  if (!counted) return { ref: undefined, revision: 0, text: meta ? JSON.stringify(meta) : '' }
  return {
    ref: meta,
    revision: meta ? (metaRevisions.get(meta)?.revision ?? 0) : 0,
    // The tests check the counter against the content, as they do for the network
    text: meta && verifyingNetworkRevisions() ? JSON.stringify(meta) : '',
  }
}

function sameMeta(a: MetaStamp, b: MetaStamp): boolean {
  if (a.ref !== b.ref || a.revision !== b.revision) return false
  if (a.text !== b.text) {
    if (a.ref) throw new Error('The settings of the sections were changed in place without sectionMetaChanged')
    return false
  }
  return true
}

/** What is kept of the graph while its structure holds: a node moved changes none of it */
interface GraphCache {
  deadEnds?: NodeId[]
  loops?: NodeId[][]
  components?: NetworkComponent[]
}

/** What is kept of the geometry while the network holds: the settings of the sections change none of it */
interface GeometryCache {
  rampIndexes: Map<number, RampIndex>
  steep: Map<string, Set<SegmentId>>
  crossings?: DiamondCrossing[]
}

export interface TrackTotals {
  length: number
  curves: number
  straights: number
}

/** What a rail adds to the totals */
interface RailShare {
  length: number
  curved: boolean
}

/**
 * The totals of the track, kept from one edit to the next: what a rail that changed added is
 * taken off and what it adds now put on. The sum is the one a loop over the rails makes, give or
 * take the last digits.
 */
class TotalsTracker {
  private readonly shares = new Map<SegmentId, RailShare>()
  private totals: TrackTotals | null = null
  private sum = { length: 0, curves: 0, straights: 0 }

  update(net: Network, changes: NetworkChanges | null): void {
    this.totals = null
    const measures = railMeasures(net)
    if (!changes) {
      this.shares.clear()
      this.sum = { length: 0, curves: 0, straights: 0 }
      for (const seg of net.segments.values()) this.add(net, seg, measures)
      return
    }
    for (const sid of changes.removedRails) this.drop(sid)
    for (const sid of changes.changedRails) {
      this.drop(sid)
      const seg = net.segments.get(sid)
      if (seg) this.add(net, seg, measures)
    }
  }

  get(): TrackTotals {
    return (this.totals ??= { ...this.sum })
  }

  private drop(sid: SegmentId): void {
    const share = this.shares.get(sid)
    if (!share) return
    this.shares.delete(sid)
    this.sum.length -= share.length
    if (share.curved) this.sum.curves--
    else this.sum.straights--
  }

  private add(net: Network, seg: Segment, measures: RailMeasures): void {
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) return
    const curved = seg.kind === 'curve' && !!seg.via
    // The length of the shape of a curve is `curveLength` over its whole parameter
    const length = curved ? measures.shapeLength(seg) : Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y)
    this.shares.set(seg.id, { length, curved })
    this.sum.length += length
    if (curved) this.sum.curves++
    else this.sum.straights++
  }
}

interface CacheEntry {
  /** Where this reader is in the feed of changes of the network */
  cursor: number | undefined
  /** `networkCheckToken` of the last reading */
  checkedAt: number | undefined
  index: NetworkFollower
  tracker: SectionTracker
  endpoints: SectionEndpointCache
  totals: TotalsTracker | null
  /** The issues per gauge and gradient limits asked for, each following the network */
  kinematics: Map<string, KinematicTracker>
  graph: GraphCache
  geometry: GeometryCache
  /** The settings of the sections as `compute` left them: it writes the names it gives into them */
  meta: MetaStamp
  derived: NetworkDerived
}

const cache = new WeakMap<Network, CacheEntry>()

const issueKey = (gauge?: number, gradient?: GradientLimits): string => `${gauge}|${gradient?.levelHeight}|${gradient?.maxGradient}`

function compute(
  net: Network,
  sectionMeta: Record<string, SectionMetadata> | undefined,
  entry: Omit<CacheEntry, 'derived' | 'meta'>,
  settled: boolean,
  changedKeys: Set<string> | null = null,
): NetworkDerived {
  const sections = entry.tracker.sections(net, sectionMeta, settled, changedKeys)
  const sectionOfSegment = entry.tracker.sectionOfSegment
  const { graph, geometry, kinematics, index } = entry
  const { rampIndexes, steep } = geometry
  let polylines: SectionPolyline[] | undefined
  let badgeAnchors: Float64Array | undefined
  return {
    sections,
    sectionOfSegment,
    conflicts: detectDirectionConflicts(net, sections, entry.endpoints),
    kinematicIssues(gauge, gradient) {
      const key = issueKey(gauge, gradient)
      let tracker = kinematics.get(key)
      if (!tracker) {
        tracker = new KinematicTracker(gauge, gradient)
        tracker.update(net, null, index)
        kinematics.set(key, tracker)
      }
      return tracker.issues(net, index)
    },
    sectionPolylines() {
      if (!polylines) {
        polylines = []
        for (const sec of sections) {
          const line = sectionPolyline(net, sec)
          if (line) polylines.push(line)
        }
      }
      return polylines
    },
    sectionBadgeAnchors() {
      if (!badgeAnchors) {
        badgeAnchors = new Float64Array(sections.length * 2).fill(NaN)
        sections.forEach((sec, i) => {
          const mid = net.segments.get(sec.segmentIds[Math.floor(sec.segmentIds.length / 2)])
          const a = mid && net.nodes.get(mid.from)
          const b = mid && net.nodes.get(mid.to)
          if (!mid || !a || !b) return
          const midShape = mid.kind === 'path' ? segmentEnds(net, mid) : null
          const at = midShape
            ? pointOnShape(midShape, 0.5)
            : mid.kind === 'curve' && mid.via
              ? bezierPoint(0.5, a.pos, mid.via, b.pos)
              : { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 }
          badgeAnchors![2 * i] = at.x
          badgeAnchors![2 * i + 1] = at.y
        })
      }
      return badgeAnchors
    },
    ramps(levelHeight) {
      let index = rampIndexes.get(levelHeight)
      if (!index) {
        const ramps = gradientRamps(net, levelHeight)
        const ofSegment = new Map<SegmentId, { ramp: GradientRamp; rail: RampRail }>()
        for (const ramp of ramps) for (const rail of ramp.rails) ofSegment.set(rail.segId, { ramp, rail })
        index = { ramps, ofSegment }
        rampIndexes.set(levelHeight, index)
      }
      return index
    },
    steepRails(gauge, gradient) {
      const key = issueKey(gauge, gradient)
      let rails = steep.get(key)
      if (!rails) {
        rails = new Set()
        for (const issue of this.kinematicIssues(gauge, gradient)) {
          if (issue.kind !== 'steep_gradient') continue
          for (const id of issue.involvedSegmentIds ?? []) rails.add(id)
        }
        steep.set(key, rails)
      }
      return rails
    },
    deadEnds: () => (graph.deadEnds ??= detectDeadEnds(net)),
    loops: () => (graph.loops ??= detectLoops(net)),
    components: () => (graph.components ??= detectConnectedComponents(net)),
    trackTotals() {
      if (!entry.totals) {
        entry.totals = new TotalsTracker()
        entry.totals.update(net, null)
      }
      return entry.totals.get()
    },
    crossings: () => (geometry.crossings ??= detectCrossings(net)),
  }
}

/**
 * Sections, direction conflicts and diagnostics of the network, kept from one frame to the next
 * and, after an edit, worked out again only where the network changed (see `SectionTracker`).
 */
export function networkDerived(net: Network, sectionMeta?: Record<string, SectionMetadata>): NetworkDerived {
  const token = networkCheckToken(net)
  const counted = token !== undefined
  let entry = cache.get(net)
  if (!entry) {
    const reading = networkChangesSince(net, undefined)
    const tracker = new SectionTracker()
    tracker.update(net, null, reading.index)
    const partial = { cursor: reading.cursor, checkedAt: token, index: reading.index, tracker, endpoints: new WeakMap(), totals: null, kinematics: new Map(), graph: {}, geometry: { rampIndexes: new Map(), steep: new Map() } }
    // The settings are stamped once the names given are written into them
    const derived = compute(net, sectionMeta, partial, false)
    entry = { ...partial, meta: metaStamp(counted, sectionMeta), derived }
    cache.set(net, entry)
    return entry.derived
  }
  // The same revision: the network is what it was. Otherwise what changed since is read from the feed
  let changed = false
  if (!counted || entry.checkedAt !== token) {
    const reading = networkChangesSince(net, entry.cursor)
    const changes = reading.changes
    entry.cursor = reading.cursor
    entry.checkedAt = token
    if (!changes || anyChange(changes)) {
      changed = true
      entry.index = reading.index
      entry.tracker.update(net, changes, reading.index)
      for (const tracker of entry.kinematics.values()) tracker.update(net, changes, reading.index)
      entry.totals?.update(net, changes)
      if (!changes || changes.structure) entry.graph = {}
      entry.geometry = { ...entry.geometry, rampIndexes: new Map(), steep: new Map(), crossings: undefined }
    }
  }
  const stamp = metaStamp(counted, sectionMeta)
  const settled = sameMeta(entry.meta, stamp)
  if (changed || !settled) {
    // The settings as they were left are trusted when they are the same object at the same count;
    // the same object written into since: the keys written, when every writer said
    const sameObject = !!stamp.ref && stamp.ref === entry.meta.ref
    const changedKeys = sameObject && !settled ? metaKeysWrittenSince(stamp.ref!, entry.meta.revision) : null
    entry.derived = compute(net, sectionMeta, entry, settled && sameObject, changedKeys)
    entry.meta = metaStamp(counted, sectionMeta)
  }
  return entry.derived
}
