import type { Network, NodeId, SegmentId, Segment, Point } from './types'
import { curveLength } from '../geometry/curve'
import { segmentTangentAt } from '../geometry/tangent'

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
  /** Whether this section ends at an open dead-end (heurtoir / fin de voie) */
  hasDeadEnd?: boolean
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

    const startNodeId = orderedNodes[0]
    const endNodeId = orderedNodes[orderedNodes.length - 1]
    const hasDeadEnd = isEndOfTrackNode(net, startNodeId) || isEndOfTrackNode(net, endNodeId)

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
      hasDeadEnd,
    })
  }

  return sections
}

/** Determine if a node is an open end of track (dead end / heurtoir / cul-de-sac). */
export function isEndOfTrackNode(net: Network, nodeId: NodeId): boolean {
  const adj = net.adjacency.get(nodeId) ?? []
  return adj.length <= 1
}

/** Find the section containing a specific segment */
export function findSectionBySegment(sections: TrackSection[], segId: SegmentId): TrackSection | null {
  for (const sec of sections) {
    if (sec.segmentIds.includes(segId)) return sec
  }
  return null
}

/** Helper to compute a normalized ray pointing away from a node into a connected segment */
function getRayFromNode(net: Network, seg: Segment, nodeId: NodeId): Point {
  const tan = segmentTangentAt(net, seg, nodeId)
  if (tan) {
    const isFrom = seg.from === nodeId
    const ray = isFrom ? tan : { x: -tan.x, y: -tan.y }
    const len = Math.hypot(ray.x, ray.y)
    if (len > 1e-5) return { x: ray.x / len, y: ray.y / len }
  }
  const otherId = seg.from === nodeId ? seg.to : seg.from
  const node = net.nodes.get(nodeId)
  const other = net.nodes.get(otherId)
  if (node && other) {
    const dx = other.pos.x - node.pos.x
    const dy = other.pos.y - node.pos.y
    const len = Math.hypot(dx, dy)
    if (len > 1e-5) return { x: dx / len, y: dy / len }
  }
  return { x: 1, y: 0 }
}

interface SectionEndpoint {
  section: TrackSection
  segmentId: SegmentId
  ray: Point
  canInflow: boolean
  canOutflow: boolean
}

/**
 * Detect directional circulation conflicts between connected sections using graph theory.
 *
 * Each junction or intersection node in the rail network acts as a routing vertex:
 * - A train arriving on section A can only proceed into section B if:
 *   1. Track geometry allows transit through the node without hairpin reversal (dot(rayA, rayB) < -0.2).
 *   2. Section B allows outflow away from the node (two-way or directed away).
 *
 * When two tracks converge into a common stem (e.g. an aiguillage / merge):
 * - If both converging branches flow into the node, and the stem allows outflow,
 *   traffic safely merges into the stem — THIS IS VALID (no conflict).
 * - A conflict occurs when arriving trains face a Sens Interdit on ALL physically possible exit paths,
 *   or when two opposite sections are directly pointing head-on into each other (-> <-) with no exit.
 */
export function detectDirectionConflicts(net: Network, sections: TrackSection[]): DirectionConflict[] {
  const conflicts: DirectionConflict[] = []
  const reportedPairs = new Set<string>()

  // Map each boundary node to its incident section endpoints
  const nodeEndpoints = new Map<NodeId, SectionEndpoint[]>()

  for (const sec of sections) {
    if (sec.orderedNodeIds.length < 2 || sec.segmentIds.length === 0) continue
    const startNode = sec.orderedNodeIds[0]
    const endNode = sec.orderedNodeIds[sec.orderedNodeIds.length - 1]

    const firstSeg = net.segments.get(sec.segmentIds[0])
    const lastSeg = net.segments.get(sec.segmentIds[sec.segmentIds.length - 1])

    if (firstSeg) {
      const ray = getRayFromNode(net, firstSeg, startNode)
      const canInflow = sec.direction === 'two_way' || sec.direction === 'backward'
      const canOutflow = sec.direction === 'two_way' || sec.direction === 'forward'
      if (!nodeEndpoints.has(startNode)) nodeEndpoints.set(startNode, [])
      nodeEndpoints.get(startNode)!.push({
        section: sec,
        segmentId: firstSeg.id,
        ray,
        canInflow,
        canOutflow,
      })
    }

    if (lastSeg && endNode !== startNode) {
      const ray = getRayFromNode(net, lastSeg, endNode)
      const canInflow = sec.direction === 'two_way' || sec.direction === 'forward'
      const canOutflow = sec.direction === 'two_way' || sec.direction === 'backward'
      if (!nodeEndpoints.has(endNode)) nodeEndpoints.set(endNode, [])
      nodeEndpoints.get(endNode)!.push({
        section: sec,
        segmentId: lastSeg.id,
        ray,
        canInflow,
        canOutflow,
      })
    }
  }

  // Evaluate routability at every connection/junction node
  for (const [nodeId, eps] of nodeEndpoints.entries()) {
    const node = net.nodes.get(nodeId)
    if (!node || eps.length < 2) continue

    // For each endpoint with one-way inflow towards this node:
    for (const epIn of eps) {
      // Only one-way inflows can face a blocked route / head-on collision
      if (!epIn.canInflow || epIn.canOutflow) continue

      // Find all physically candidate continuation routes through the node
      // Candidate routes face opposite sides of the node (dot < -0.2)
      const candidates = eps.filter(
        (other) => other !== epIn && (epIn.ray.x * other.ray.x + epIn.ray.y * other.ray.y) < -0.2,
      )

      if (candidates.length === 0) {
        // No geometrically valid through route exists at this multi-track node
        const pairKey = `${nodeId}:${epIn.section.id}`
        if (!reportedPairs.has(pairKey)) {
          reportedPairs.add(pairKey)
          conflicts.push({
            nodeId,
            pos: node.pos,
            sectionA: epIn.section,
            sectionB: eps.find((o) => o !== epIn)?.section ?? epIn.section,
            type: 'head_on',
          })
        }
        continue
      }

      // Check if at least one candidate continuation allows trains to proceed out
      const hasValidExit = candidates.some((cand) => cand.canOutflow)

      if (!hasValidExit) {
        // Every geometrically possible continuation is strictly one-way towards this node!
        // Arriving trains face a direct head-on / Sens Interdit collision.
        for (const cand of candidates) {
          const idA = epIn.section.id < cand.section.id ? epIn.section.id : cand.section.id
          const idB = epIn.section.id < cand.section.id ? cand.section.id : epIn.section.id
          const pairKey = `${nodeId}:${idA}:${idB}`
          if (!reportedPairs.has(pairKey)) {
            reportedPairs.add(pairKey)
            conflicts.push({
              nodeId,
              pos: node.pos,
              sectionA: epIn.section,
              sectionB: cand.section,
              type: 'head_on',
            })
          }
        }
      }
    }
  }

  return conflicts
}
