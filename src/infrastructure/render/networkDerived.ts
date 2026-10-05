import type { Network, SegmentId } from '@domain/models/types'
import {
  computeTrackSections,
  detectDirectionConflicts,
  type DirectionConflict,
  type SectionMetadata,
  type TrackSection,
} from '@domain/models/sections'
import { analyzeKinematics, type GradientLimits, type KinematicIssue } from '@domain/services/kinematicDiagnostics'

/** What the drawing reads from the network besides its geometry. Recomputed only when the network changes. */
export interface NetworkDerived {
  sections: TrackSection[]
  sectionOfSegment: ReadonlyMap<SegmentId, TrackSection>
  conflicts: DirectionConflict[]
  kinematicIssues(gauge?: number, gradient?: GradientLimits): KinematicIssue[]
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
  return {
    sections,
    sectionOfSegment,
    conflicts: detectDirectionConflicts(net, sections),
    kinematicIssues(gauge, gradient) {
      const key = `${gauge}|${gradient?.levelHeight}|${gradient?.maxGradient}`
      let found = issues.get(key)
      if (!found) {
        found = analyzeKinematics(net, gauge, gradient)
        issues.set(key, found)
      }
      return found
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
