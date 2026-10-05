import type { Network, SegmentId } from '@domain/models/types'
import { gradientRamps, type GradientRamp, type RampRail } from '@domain/models/network'
import { bezierPoint } from '@domain/geometry/curve'
import {
  computeTrackSections,
  detectDirectionConflicts,
  type DirectionConflict,
  type SectionMetadata,
  type TrackSection,
} from '@domain/models/sections'
import { analyzeKinematics, type GradientLimits, type KinematicIssue } from '@domain/services/kinematicDiagnostics'

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
  /** The ramps (`gradientRamps`) for this height of one level, built on first use */
  ramps(levelHeight: number): RampIndex
  /** Rails the diagnostics report as steeper than the limit: the ones `kinematicIssues` names, built on first use */
  steepRails(gauge?: number, gradient?: GradientLimits): ReadonlySet<SegmentId>
}

/**
 * How far, in metres, the flattened line of a curve may stray from it. The polylines are only drawn
 * where a pixel covers several metres, so this stays well under a pixel.
 */
export const POLYLINE_TOLERANCE = 0.5
/** Most chords one curved rail is flattened into */
export const POLYLINE_MAX_CHORDS = 8

/** Number of chords that keep a quadratic curve within `POLYLINE_TOLERANCE`; 1 for a flat one */
function chordCount(ax: number, ay: number, vx: number, vy: number, bx: number, by: number): number {
  // The curve is at most half the distance from the control point to the middle of the chord away
  // from its chord, and cutting it in n divides that by n²
  const sagitta = Math.hypot(vx - (ax + bx) / 2, vy - (ay + by) / 2) / 2
  return Math.min(POLYLINE_MAX_CHORDS, Math.max(1, Math.ceil(Math.sqrt(sagitta / POLYLINE_TOLERANCE))))
}

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
    if (!start || !end) continue
    if ((start.level ?? 0) >= 0 || (end.level ?? 0) >= 0) tunnel = false
    if (pts.length === 0) pts.push(start.pos.x, start.pos.y)
    if (seg.kind === 'curve' && seg.via) {
      const n = chordCount(start.pos.x, start.pos.y, seg.via.x, seg.via.y, end.pos.x, end.pos.y)
      for (let i = 1; i < n; i++) {
        const p = bezierPoint(i / n, start.pos, seg.via, end.pos)
        pts.push(p.x, p.y)
      }
    }
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
 * Copy of everything the derived data depends on, compared value by value at each frame. The
 * network is mutated in place from many places (helpers, drags, panels), so there is no revision
 * to trust: the comparison is exact and costs one pass over the network.
 */
class NetworkSnapshot {
  private nums: number[] = []
  private strs: (string | undefined)[] = []

  /** Records the current state of the network; true when it differs from the last one recorded */
  update(net: Network): boolean {
    const nums = this.nums
    const strs = this.strs
    let ni = 0
    let si = 0
    let changed = false
    const num = (v: number): void => {
      if (nums[ni] !== v) {
        nums[ni] = v
        changed = true
      }
      ni++
    }
    const str = (v: string | undefined): void => {
      if (strs[si] !== v) {
        strs[si] = v
        changed = true
      }
      si++
    }

    for (const node of net.nodes.values()) {
      str(node.id)
      num(node.pos.x)
      num(node.pos.y)
      num(node.level ?? 0)
    }
    for (const seg of net.segments.values()) {
      str(seg.id)
      str(seg.from)
      str(seg.to)
      str(seg.kind)
      str(seg.parentSegmentId)
      num(seg.via ? 1 : 0)
      num(seg.via?.x ?? 0)
      num(seg.via?.y ?? 0)
    }
    for (const [nodeId, segIds] of net.adjacency) {
      str(nodeId)
      num(segIds.length)
      for (const sid of segIds) str(sid)
    }
    for (const junction of net.junctions.values()) {
      str(junction.id)
      str(junction.nodeId)
      str(junction.kind)
      num(junction.active)
      num(junction.frogNumber ?? -1)
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

    if (nums.length !== ni || strs.length !== si) {
      nums.length = ni
      strs.length = si
      changed = true
    }
    return changed
  }
}

interface CacheEntry {
  snapshot: NetworkSnapshot
  metaKey: string
  derived: NetworkDerived
}

const cache = new WeakMap<Network, CacheEntry>()

function compute(net: Network, sectionMeta: Record<string, SectionMetadata> | undefined): NetworkDerived {
  const sections = computeTrackSections(net, sectionMeta)
  const sectionOfSegment = new Map<SegmentId, TrackSection>()
  for (const sec of sections) {
    for (const sid of sec.segmentIds) {
      // First section wins, as with `findSectionBySegment`
      if (!sectionOfSegment.has(sid)) sectionOfSegment.set(sid, sec)
    }
  }
  const issues = new Map<string, KinematicIssue[]>()
  let polylines: SectionPolyline[] | undefined
  const rampIndexes = new Map<number, RampIndex>()
  const steep = new Map<string, Set<SegmentId>>()
  const issueKey = (gauge?: number, gradient?: GradientLimits): string => `${gauge}|${gradient?.levelHeight}|${gradient?.maxGradient}`
  return {
    sections,
    sectionOfSegment,
    conflicts: detectDirectionConflicts(net, sections),
    kinematicIssues(gauge, gradient) {
      const key = issueKey(gauge, gradient)
      let found = issues.get(key)
      if (!found) {
        found = analyzeKinematics(net, gauge, gradient)
        issues.set(key, found)
      }
      return found
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
  }
}

/** Sections, direction conflicts and diagnostics of the network, kept from one frame to the next */
export function networkDerived(net: Network, sectionMeta?: Record<string, SectionMetadata>): NetworkDerived {
  const metaKey = sectionMeta ? JSON.stringify(sectionMeta) : ''
  let entry = cache.get(net)
  if (!entry) {
    const snapshot = new NetworkSnapshot()
    snapshot.update(net)
    entry = { snapshot, metaKey, derived: compute(net, sectionMeta) }
    cache.set(net, entry)
    return entry.derived
  }
  // Always updated, even when the metadata alone changed: the snapshot must follow the network
  const changed = entry.snapshot.update(net)
  if (changed || entry.metaKey !== metaKey) {
    entry.metaKey = metaKey
    entry.derived = compute(net, sectionMeta)
  }
  return entry.derived
}
