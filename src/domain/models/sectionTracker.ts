import type { Network, NodeId, Segment, SegmentId } from './types'
import { dirtyNodesOf, type NetworkChanges, type NetworkFollower } from '../geometry/networkFollower'
import { railMeasures } from '../geometry/railMeasures'
import { verifyingNetworkRevisions } from './networkWatch'
import { findSectionChains, indexSectionMeta, isThroughCrossing, nameSections, noteMetaKey, walkSectionChain, type RawSection, type SectionMetadata, type SectionMetaIndex, type TrackSection } from './sections'

/**
 * The sections of a network, kept from one edit to the next and worked out again only where the
 * track changed. Whether a chain goes on through a node or stops there is decided at that node
 * alone (its degree, its table, the rays of its rails): an edit only changes the decisions at the
 * nodes it touched, so only the chains through those nodes are walked again — from the rails they
 * held, in the order of the network, as `findSectionChains` walks every chain. The rest stay as
 * they are, and the whole is put back in the order of the network.
 *
 * A chain through a crossing (`isThroughCrossing`) may take a rail another chain would also take:
 * which one gets it depends on which is walked first, so every chain at such a node of a chain
 * walked again is walked again too.
 */
export class SectionTracker {
  private raws: RawSection[] = []
  private readonly ofSegment = new Map<SegmentId, RawSection>()
  private named = new Map<RawSection, TrackSection>()
  /** The section of each rail, as `sections` last named them */
  readonly sectionOfSegment = new Map<SegmentId, TrackSection>()
  /** The index of the settings last named from, kept up to date with what is written into them */
  private metaIndex: { meta: Record<string, SectionMetadata>; index: SectionMetaIndex } | null = null

  /** Brings the chains up to date with the network: all of them when `changes` is null */
  update(net: Network, changes: NetworkChanges | null, index: NetworkFollower): void {
    const measures = railMeasures(net)
    if (!changes || !this.walkAgain(net, changes, index)) {
      this.raws = findSectionChains(net, measures)
      this.ofSegment.clear()
      this.sectionOfSegment.clear()
      this.named.clear()
      for (const raw of this.raws) for (const sid of raw.segmentIds) this.ofSegment.set(sid, raw)
    }
  }

  /**
   * The sections of the chains, named from `customMeta` (see `computeTrackSections`). `settled`:
   * nothing was written into the settings by anyone else since the last call — what was written
   * then still stands, and need not be read again. Otherwise `changedKeys` says which entries
   * were written, or null when that is not known.
   */
  sections(net: Network, customMeta?: Record<string, SectionMetadata>, settled = false, changedKeys: Iterable<string> | null = null): TrackSection[] {
    let index: SectionMetaIndex | undefined
    let unsettled: Set<RawSection> | undefined
    if (customMeta) {
      const kept = this.metaIndex?.meta === customMeta ? this.metaIndex!.index : null
      if (kept && (settled || changedKeys)) {
        index = kept
        if (!settled) {
          // Only the chains whose own entries were written have anything to write again
          unsettled = new Set()
          for (const key of changedKeys!) {
            noteMetaKey(index, customMeta, key)
            const raw = this.ofSegment.get(key.includes('-') ? key.slice(0, key.indexOf('-')) : key)
            if (raw && (raw.sortedSegKey === key || !key.includes('-'))) unsettled.add(raw)
          }
          settled = true
        }
      } else {
        this.metaIndex = { meta: customMeta, index: indexSectionMeta(customMeta) }
        index = this.metaIndex.index
        settled = false
      }
    }
    const sections = nameSections(net, this.raws, customMeta, this.named, settled, index, unsettled)
    const named = new Map<RawSection, TrackSection>()
    this.raws.forEach((raw, i) => {
      const section = sections[i]
      named.set(raw, section)
      // Each rail is in one chain: the section of a chain named anew is that of all its rails
      if (this.named.get(raw) !== section) for (const sid of raw.segmentIds) this.sectionOfSegment.set(sid, section)
    })
    this.named = named
    return sections
  }

  /** Walks again the chains the changes touched; false when the whole network must be walked */
  private walkAgain(net: Network, changes: NetworkChanges, index: NetworkFollower): boolean {
    const affected = new Set<RawSection>()
    const touch = (sid: SegmentId): void => {
      const raw = this.ofSegment.get(sid)
      if (raw) affected.add(raw)
    }
    for (const sid of changes.changedRails) touch(sid)
    for (const sid of changes.removedRails) touch(sid)
    for (const sid of changes.reorderedRails) touch(sid)
    for (const id of dirtyNodesOf(changes, index)) for (const sid of net.adjacency.get(id) ?? []) touch(sid)

    // Through a crossing, every chain of the node goes with the one walked again
    const queue = [...affected]
    const seenNodes = new Set<NodeId>()
    while (queue.length > 0) {
      const raw = queue.pop()!
      for (const nid of raw.orderedNodes) {
        if (seenNodes.has(nid)) continue
        seenNodes.add(nid)
        if (!isThroughCrossing(net, nid)) continue
        for (const sid of net.adjacency.get(nid) ?? []) {
          const other = this.ofSegment.get(sid)
          if (other && !affected.has(other)) {
            affected.add(other)
            queue.push(other)
          }
        }
      }
    }

    // The rails to walk again: those of the chains touched, and the new ones, in the order of the network
    const pool = new Set<SegmentId>()
    for (const raw of affected) for (const sid of raw.segmentIds) if (net.segments.has(sid)) pool.add(sid)
    for (const sid of changes.changedRails) if (net.segments.has(sid)) pool.add(sid)
    const starts: Segment[] = []
    for (const sid of pool) starts.push(index.rails.get(sid)!.ref)
    starts.sort((a, b) => index.rails.get(a.id)!.ord - index.rails.get(b.id)!.ord)

    const measures = railMeasures(net)
    const visited = new Set<SegmentId>()
    const walked: RawSection[] = []
    for (const seg of starts) {
      if (visited.has(seg.id)) continue
      const raw = walkSectionChain(net, seg, visited, measures, pool)
      if (!raw) {
        if (verifyingNetworkRevisions()) throw new Error(`A section walked again from ${seg.id} left the rails that changed`)
        return false
      }
      walked.push(raw)
    }

    if (affected.size > 0 || walked.length > 0) {
      for (const raw of affected) {
        this.named.delete(raw)
        for (const sid of raw.segmentIds) {
          if (this.ofSegment.get(sid) !== raw) continue
          this.ofSegment.delete(sid)
          this.sectionOfSegment.delete(sid)
        }
      }
      const kept = affected.size > 0 ? this.raws.filter((raw) => !affected.has(raw)) : this.raws
      for (const raw of walked) for (const sid of raw.segmentIds) this.ofSegment.set(sid, raw)
      this.raws = kept.concat(walked)
      const rank = (raw: RawSection): number => index.rails.get(raw.startSegId)!.ord
      this.raws.sort((a, b) => rank(a) - rank(b))
    }
    if (verifyingNetworkRevisions()) this.verify(net, measures)
    return true
  }

  /** The chains kept against those of the whole network (tests) */
  private verify(net: Network, measures: ReturnType<typeof railMeasures>): void {
    const whole = findSectionChains(net, measures)
    const differs = (): string | null => {
      if (whole.length !== this.raws.length) return `${this.raws.length} sections kept, ${whole.length} in the network`
      for (let i = 0; i < whole.length; i++) {
        const a = whole[i]
        const b = this.raws[i]
        if (a.sortedSegKey !== b.sortedSegKey) return `section ${i}: ${b.sortedSegKey} kept, ${a.sortedSegKey} in the network`
        if (a.segmentIds.join() !== b.segmentIds.join()) return `section ${a.sortedSegKey}: rails in another order`
        if (a.orderedNodes.join() !== b.orderedNodes.join()) return `section ${a.sortedSegKey}: nodes in another order`
        if (a.startSegId !== b.startSegId || a.hasDeadEnd !== b.hasDeadEnd || a.totalLength !== b.totalLength) return `section ${a.sortedSegKey}: not the same`
        if ((a.crossingNodeIds ?? []).join() !== (b.crossingNodeIds ?? []).join()) return `section ${a.sortedSegKey}: crossings differ`
      }
      return null
    }
    const why = differs()
    if (why) throw new Error(`The sections kept are not those of the network: ${why}`)
  }
}
