import type { Network, NodeId, SegmentId, Segment, Point } from './types'
import { curveLength } from './curve'

export type SectionType = 'circulation' | 'station_stop' | 'siding' | 'yard'

/**
 * Traffic circulation direction:
 * - 'two_way': Bidirectionnel (<->) - trains can run both ways
 * - 'forward': Sens unique direct (start -> end selon l'ordre des rails)
 * - 'backward': Sens unique inverse (end -> start)
 */
export type SectionDirection = 'two_way' | 'forward' | 'backward'

export interface SectionMetadata {
  name?: string
  type?: SectionType
  color?: string
  direction?: SectionDirection
}

export interface TrackSection {
  id: string
  name: string
  type: SectionType
  direction: SectionDirection
  segmentIds: SegmentId[]
  /** Ordered node sequence from start to end of the section */
  orderedNodeIds: NodeId[]
  nodeIds: NodeId[]
  totalLength: number
  color: string
}

export interface DirectionConflict {
  nodeId: NodeId
  pos: Point
  sectionA: TrackSection
  sectionB: TrackSection
  type: 'head_on' | 'opposing_outflow' // head-on: -> <- (face-à-face)
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
 * Merges user-customized metadata (names, types, colors, directions) persisted in customMeta.
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

    // Reconstruct contiguous ordered sequence of nodes from one tip to the other
    const orderedNodes: NodeId[] = []
    if (sectionSegIds.length > 0) {
      const firstSeg = net.segments.get(sectionSegIds[0])!
      let currentChainNode: NodeId

      if (sectionSegIds.length === 1) {
        currentChainNode = firstSeg.from
        orderedNodes.push(firstSeg.from, firstSeg.to)
      } else {
        const secondSeg = net.segments.get(sectionSegIds[1])!
        // The shared node between segment 0 and 1 is the second node
        const sharedNode = (firstSeg.from === secondSeg.from || firstSeg.from === secondSeg.to)
          ? firstSeg.from
          : firstSeg.to
        const tipNode = firstSeg.from === sharedNode ? firstSeg.to : firstSeg.from
        orderedNodes.push(tipNode, sharedNode)
        currentChainNode = sharedNode

        for (let i = 1; i < sectionSegIds.length; i++) {
          const seg = net.segments.get(sectionSegIds[i])!
          const nextNode = seg.from === currentChainNode ? seg.to : seg.from
          orderedNodes.push(nextNode)
          currentChainNode = nextNode
        }
      }
    }

    // Total length
    let totalLen = 0
    for (const sid of sectionSegIds) {
      const seg = net.segments.get(sid)
      if (seg) totalLen += getSegLength(seg)
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
      direction: userMeta?.direction || 'two_way',
      segmentIds: sectionSegIds,
      orderedNodeIds: orderedNodes,
      nodeIds: Array.from(new Set(orderedNodes)),
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

/**
 * Detect directional circulation conflicts between connected sections.
 * For any junction or connection node shared between 2 or more sections:
 * If Section A sends trains TOWARDS the node, and Section B also sends trains TOWARDS the same node (head-on collision -> <-),
 * or opposing flows, a conflict is raised with the node location for rendering the prohibitory sign.
 */
export function detectDirectionConflicts(net: Network, sections: TrackSection[]): DirectionConflict[] {
  const conflicts: DirectionConflict[] = []

  // Map each boundary node to the sections meeting at that node and their flow direction relative to the node
  // flow: 'inflow' = traffic goes towards this node; 'outflow' = traffic goes away from this node; 'both' = bidirectional
  interface NodeFlow {
    section: TrackSection
    flow: 'inflow' | 'outflow' | 'both'
  }

  const nodeSectionFlows = new Map<NodeId, NodeFlow[]>()

  for (const sec of sections) {
    if (sec.orderedNodeIds.length < 2) continue
    const startNode = sec.orderedNodeIds[0]
    const endNode = sec.orderedNodeIds[sec.orderedNodeIds.length - 1]

    let startFlow: 'inflow' | 'outflow' | 'both' = 'both'
    let endFlow: 'inflow' | 'outflow' | 'both' = 'both'

    if (sec.direction === 'forward') {
      // Moves from startNode to endNode
      startFlow = 'outflow' // leaves startNode
      endFlow = 'inflow'    // enters endNode
    } else if (sec.direction === 'backward') {
      // Moves from endNode to startNode
      startFlow = 'inflow'   // enters startNode
      endFlow = 'outflow'  // leaves endNode
    }

    // Record at startNode
    if (!nodeSectionFlows.has(startNode)) nodeSectionFlows.set(startNode, [])
    nodeSectionFlows.get(startNode)!.push({ section: sec, flow: startFlow })

    // Record at endNode
    if (!nodeSectionFlows.has(endNode)) nodeSectionFlows.set(endNode, [])
    nodeSectionFlows.get(endNode)!.push({ section: sec, flow: endFlow })
  }

  // Detect head-on conflicts (two sections both flowing IN towards the same node: -> <-)
  for (const [nodeId, flows] of nodeSectionFlows.entries()) {
    const node = net.nodes.get(nodeId)
    if (!node) continue

    for (let i = 0; i < flows.length; i++) {
      for (let j = i + 1; j < flows.length; j++) {
        const f1 = flows[i]
        const f2 = flows[j]

        // Both sections have a designated one-way flow directly towards each other at this node
        if (f1.flow === 'inflow' && f2.flow === 'inflow') {
          conflicts.push({
            nodeId,
            pos: node.pos,
            sectionA: f1.section,
            sectionB: f2.section,
            type: 'head_on',
          })
        }
      }
    }
  }

  return conflicts
}
