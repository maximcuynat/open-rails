import type { Network, NodeId, SegmentId, Segment } from './types'
import { curveLength } from './curve'

export type SectionType = 'circulation' | 'station_stop' | 'siding' | 'yard'

export interface SectionMetadata {
  name?: string
  type?: SectionType
  color?: string
}

export interface TrackSection {
  id: string
  name: string
  type: SectionType
  segmentIds: SegmentId[]
  nodeIds: NodeId[]
  totalLength: number
  color: string
}

/** Distinct elegant rail canton colors (pastel / railway signaling palette) */
export const SECTION_COLORS = [
  '#3b82f6', // Bleu signalisation / Voie 1
  '#10b981', // Émeraude / Voie 2
  '#f59e0b', // Ambre / Évitement
  '#8b5cf6', // Violet / Voie directe
  '#ec4899', // Rose / Dépôt
  '#06b6d4', // Cyan / Raccordement
  '#f97316', // Orange / Voie de service
  '#14b8a6', // Teal / Manœuvre
]

export const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  circulation: 'Voie de circulation directe (passage)',
  station_stop: "Voie à quai / d'arrêt (gare)",
  siding: "Voie d'évitement / garage",
  yard: 'Voie de manœuvre / triage',
}

/**
 * Computes connected track sections (cantons / tronçons continus).
 * A section boundary occurs at:
 * - Dead ends / endpoints (degree <= 1)
 * - Switch / junction nodes (degree >= 3)
 *
 * Intermediate nodes (degree 2) continue the same track section.
 * Merges user-customized metadata (names, types, colors) persisted in customMeta.
 */
export function computeTrackSections(
  net: Network,
  customMeta?: Record<string, SectionMetadata>,
): TrackSection[] {
  const sections: TrackSection[] = []
  const visitedSegments = new Set<SegmentId>()

  // Helper to compute length of a segment
  const getSegLength = (seg: Segment): number => {
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) return 0
    if (seg.kind === 'curve' && seg.via) {
      return curveLength(a.pos, seg.via, b.pos)
    }
    return Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y)
  }

  // Helper: is this node a section boundary?
  const isBoundaryNode = (nodeId: NodeId): boolean => {
    const deg = net.adjacency.get(nodeId)?.length ?? 0
    return deg !== 2
  }

  // Iterate over all segments
  for (const [segId, startSeg] of net.segments) {
    if (visitedSegments.has(segId)) continue

    const sectionSegIds: SegmentId[] = [segId]
    visitedSegments.add(segId)

    // Expand forwards from startSeg.to
    let currNode = startSeg.to
    let prevSegId = segId
    while (!isBoundaryNode(currNode)) {
      const adjacent = net.adjacency.get(currNode) ?? []
      const nextSegId = adjacent.find((id) => id !== prevSegId)
      if (!nextSegId || visitedSegments.has(nextSegId)) break

      const nextSeg = net.segments.get(nextSegId)
      if (!nextSeg) break

      sectionSegIds.push(nextSegId)
      visitedSegments.add(nextSegId)
      currNode = nextSeg.from === currNode ? nextSeg.to : nextSeg.from
      prevSegId = nextSegId
    }

    // Expand backwards from startSeg.from
    currNode = startSeg.from
    prevSegId = segId
    while (!isBoundaryNode(currNode)) {
      const adjacent = net.adjacency.get(currNode) ?? []
      const nextSegId = adjacent.find((id) => id !== prevSegId)
      if (!nextSegId || visitedSegments.has(nextSegId)) break

      const nextSeg = net.segments.get(nextSegId)
      if (!nextSeg) break

      sectionSegIds.unshift(nextSegId)
      visitedSegments.add(nextSegId)
      currNode = nextSeg.from === currNode ? nextSeg.to : nextSeg.from
      prevSegId = nextSegId
    }

    // Gather ordered nodes and total length
    const nodeSet = new Set<NodeId>()
    let totalLen = 0
    for (const sid of sectionSegIds) {
      const seg = net.segments.get(sid)
      if (seg) {
        nodeSet.add(seg.from)
        nodeSet.add(seg.to)
        totalLen += getSegLength(seg)
      }
    }

    // Stable ID based on sorted segment IDs so renaming is preserved
    const sortedSegKey = [...sectionSegIds].sort().join('-')
    const index = sections.length
    const fallbackColor = SECTION_COLORS[index % SECTION_COLORS.length]
    const fallbackName = `Section ${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ''}`

    // Check user custom metadata
    const userMeta = customMeta?.[sortedSegKey] || customMeta?.[sectionSegIds[0]]

    sections.push({
      id: sortedSegKey,
      name: userMeta?.name || fallbackName,
      type: userMeta?.type || 'circulation',
      segmentIds: sectionSegIds,
      nodeIds: Array.from(nodeSet),
      totalLength: totalLen,
      color: userMeta?.color || (userMeta?.type === 'station_stop' ? '#06b6d4' : fallbackColor),
    })
  }

  return sections
}

/** Find the section containing a specific segment */
export function findSectionBySegment(sections: TrackSection[], segId: SegmentId): TrackSection | null {
  for (const sec of sections) {
    if (sec.segmentIds.includes(segId)) return sec
  }
  return null
}
