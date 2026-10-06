import type { Network, NodeId, SegmentId, Segment, Point } from './types'
import { curveLength } from '../geometry/curve'
import { segmentTangentAt } from '../geometry/tangent'
import { findJunctionAtNode } from './junction'

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
  isCustomName?: boolean
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
  /** Any diamond crossing nodes traversed in through-route by this section */
  crossingNodeIds?: NodeId[]
  isCustomName?: boolean
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

/** Helper to compute a normalized ray pointing away from a node into a connected segment */
export function getRayFromNode(net: Network, seg: Segment, nodeId: NodeId): Point {
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

/**
 * Computes connected track sections (cantons / tronçons continus).
 * A section boundary occurs at:
 * - Dead ends / endpoints (degree <= 1)
 * - Switch / junction nodes (degree >= 3)
 * - Fork / bifurcation apex nodes (degree 2 where rails leave on the same side)
 *
 * Intermediate nodes (degree 2 with continuous through-route) continue the same track section.
 * Merges user-customized metadata (names, types, colors, directions) persisted in customMeta.
 */
export function computeTrackSections(
  net: Network,
  customMeta?: Record<string, SectionMetadata>,
): TrackSection[] {
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

  /**
   * Find the through-route continuation of prevSegId across currNode, if one exists.
   * - At degree 2: continues if the two segments form a smooth through-route (dot < -0.7).
   * - At degree 4 (diamond crossing): continues along the opposite aligned through-segment (dot < -0.7).
   * - At switches, forks, dead-ends, or sharp kinks: returns null (boundary).
   */
  const getNextThroughSegment = (currNode: NodeId, prevSegId: SegmentId): SegmentId | null => {
    const adj = net.adjacency.get(currNode) ?? []
    const prevSeg = net.segments.get(prevSegId)
    if (!prevSeg) return null

    // Dead end or single connection
    if (adj.length <= 1) return null

    // Turnouts with 3 branches are always routing decision junctions (boundaries)
    if (adj.length === 3) return null

    // A 3-way turnout or a double slip (degree 4) is also a routing decision junction (boundary)
    const junc = findJunctionAtNode(net, currNode)
    if (junc && (junc.kind === 'three_way' || junc.kind === 'double_slip')) return null

    const rPrev = getRayFromNode(net, prevSeg, currNode)

    // For degree 2 or degree 4: look for a segment continuing directly in the opposite direction
    const candidates = adj.filter((id) => id !== prevSegId)
    let bestCand: SegmentId | null = null
    let minDot = 0

    for (const cid of candidates) {
      const cSeg = net.segments.get(cid)
      if (!cSeg) continue
      const rCand = getRayFromNode(net, cSeg, currNode)
      const dot = rPrev.x * rCand.x + rPrev.y * rCand.y
      if (dot < minDot) {
        minDot = dot
        bestCand = cid
      }
    }

    // Must be a smooth through continuation (deflection < 45°, dot < -0.7)
    if (bestCand && minDot < -0.7) {
      return bestCand
    }

    return null
  }

  interface RawSection {
    segmentIds: SegmentId[]
    orderedNodes: NodeId[]
    nodeIds: NodeId[]
    totalLength: number
    sortedSegKey: string
    hasDeadEnd: boolean
    crossingNodeIds?: NodeId[]
  }
  const rawSections: RawSection[] = []

  // Iterate over all segments
  for (const [segId, startSeg] of net.segments) {
    if (visitedSegments.has(segId)) continue

    let sectionSegIds: SegmentId[] = [segId]
    visitedSegments.add(segId)

    // Expand forwards from startSeg.to
    let currNode = startSeg.to
    let prevSegId = segId
    while (true) {
      const nextSegId = getNextThroughSegment(currNode, prevSegId)
      if (!nextSegId || visitedSegments.has(nextSegId)) break

      const nextSeg = net.segments.get(nextSegId)
      if (!nextSeg) break

      sectionSegIds.push(nextSegId)
      visitedSegments.add(nextSegId)
      currNode = nextSeg.from === currNode ? nextSeg.to : nextSeg.from
      prevSegId = nextSegId
    }

    // Expand backwards from startSeg.from: gathered nearest first, then put in front in one go
    // (a section can be thousands of rails long)
    const before: SegmentId[] = []
    currNode = startSeg.from
    prevSegId = segId
    while (true) {
      const nextSegId = getNextThroughSegment(currNode, prevSegId)
      if (!nextSegId || visitedSegments.has(nextSegId)) break

      const nextSeg = net.segments.get(nextSegId)
      if (!nextSeg) break

      before.push(nextSegId)
      visitedSegments.add(nextSegId)
      currNode = nextSeg.from === currNode ? nextSeg.to : nextSeg.from
      prevSegId = nextSegId
    }
    if (before.length > 0) sectionSegIds = before.reverse().concat(sectionSegIds)

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

    const sortedSegKey = [...sectionSegIds].sort().join('-')
    const startNodeId = orderedNodes[0]
    const endNodeId = orderedNodes[orderedNodes.length - 1]
    const hasDeadEnd = isEndOfTrackNode(net, startNodeId) || isEndOfTrackNode(net, endNodeId)

    // Identify any diamond crossing nodes traversed in through-route by this section
    const crossingNodeIds = orderedNodes.filter((nid, idx) => {
      if (idx === 0 || idx === orderedNodes.length - 1) return false
      const deg = net.adjacency.get(nid)?.length ?? 0
      const junc = findJunctionAtNode(net, nid)
      return deg === 4 && (!junc || (junc.kind !== 'three_way' && junc.kind !== 'double_slip'))
    })

    rawSections.push({
      segmentIds: sectionSegIds,
      orderedNodes,
      nodeIds: Array.from(new Set(orderedNodes)),
      totalLength: totalLen,
      sortedSegKey,
      hasDeadEnd,
      crossingNodeIds: crossingNodeIds.length > 0 ? crossingNodeIds : undefined,
    })
  }

  // Precompute segment ancestors (parentSegmentId chain)
  const getAncestors = (sid: SegmentId): Set<SegmentId> => {
    const ancestors = new Set<SegmentId>([sid])
    let curr = net.segments.get(sid)
    while (curr?.parentSegmentId) {
      ancestors.add(curr.parentSegmentId)
      curr = net.segments.get(curr.parentSegmentId)
    }
    return ancestors
  }

  const sectionAncestors = new Map<RawSection, Set<SegmentId>>()
  for (const rawSec of rawSections) {
    const allAncestors = new Set<SegmentId>()
    for (const sid of rawSec.segmentIds) {
      for (const anc of getAncestors(sid)) {
        allAncestors.add(anc)
      }
    }
    sectionAncestors.set(rawSec, allAncestors)
  }

  const matchedMeta = new Map<RawSection, SectionMetadata>()
  const claimedNames = new Set<string>()

  // Known compound keys of customMeta, by each of the rails they name, and every name it holds.
  // customMeta has an entry per rail: it is read in place, without a list of its keys or entries.
  const compoundKeysOfRail = new Map<string, string[]>()
  const metaNames = new Set<string>()
  if (customMeta) {
    for (const key in customMeta) {
      const name = customMeta[key]?.name
      if (name) metaNames.add(name)
      if (!key.includes('-')) continue
      for (const sid of key.split('-')) {
        const keys = compoundKeysOfRail.get(sid)
        if (keys) keys.push(key)
        else compoundKeysOfRail.set(sid, [key])
      }
    }
  }

  // Pass 1: Exact intact section matches
  // A raw section is considered an exact intact match if:
  // - its sortedSegKey exists in customMeta
  // - AND if it is a single-segment key, it wasn't part of an existing compound key with the same name
  // - AND its name has not already been claimed
  for (const rawSec of rawSections) {
    if (!customMeta) break
    const meta = customMeta[rawSec.sortedSegKey]
    if (!meta || !meta.name) continue

    // If this is a single segment, check if it was actually part of a multi-segment section
    if (!rawSec.sortedSegKey.includes('-')) {
      const wasPartOfCompound = (compoundKeysOfRail.get(rawSec.sortedSegKey) ?? []).some(
        (ck) => customMeta[ck]?.name === meta.name
      )
      if (wasPartOfCompound) {
        // This is a fragment from a split/bifurcation, delegate to Pass 2
        continue
      }
    }

    if (!claimedNames.has(meta.name)) {
      matchedMeta.set(rawSec, { ...meta })
      claimedNames.add(meta.name)
    }
  }

  // Group prior records by distinct section name
  interface PriorRecord {
    name: string
    meta: SectionMetadata
    segmentIds: Set<SegmentId>
  }
  const priorRecordsByName = new Map<string, PriorRecord>()
  if (customMeta) {
    for (const key in customMeta) {
      const meta = customMeta[key]
      if (!meta || !meta.name) continue
      if (claimedNames.has(meta.name)) continue // already claimed by exact intact match

      let prior = priorRecordsByName.get(meta.name)
      if (!prior) {
        prior = {
          name: meta.name,
          meta: { ...meta },
          segmentIds: new Set(),
        }
        priorRecordsByName.set(meta.name, prior)
      }
      const segs = key.includes('-') ? key.split('-') : [key]
      for (const s of segs) prior.segmentIds.add(s)
    }
  }

  // Raw sections by each rail they descend from, to find those a prior record overlaps without
  // looking at all of them
  const sectionsOfAncestor = new Map<SegmentId, number[]>()
  if (priorRecordsByName.size > 0) {
    rawSections.forEach((rawSec, index) => {
      for (const anc of sectionAncestors.get(rawSec)!) {
        const list = sectionsOfAncestor.get(anc)
        if (list) list.push(index)
        else sectionsOfAncestor.set(anc, [index])
      }
    })
  }

  // Pass 2: Overlap and ancestor heritage (when a line is cut or bifurcated)
  // Each unclaimed prior section gets assigned to AT MOST ONE candidate raw section (the primary piece).
  for (const prior of priorRecordsByName.values()) {
    if (claimedNames.has(prior.name)) continue

    // In the order of `rawSections`: the first of two equal candidates wins
    const overlapping = new Set<number>()
    for (const sid of prior.segmentIds) {
      for (const index of sectionsOfAncestor.get(sid) ?? []) overlapping.add(index)
    }
    const candidates = [...overlapping]
      .sort((a, b) => a - b)
      .map((index) => rawSections[index])
      .filter((rawSec) => !matchedMeta.has(rawSec))

    if (candidates.length > 0) {
      let bestCandidate = candidates[0]
      let bestScore = -1
      for (const cand of candidates) {
        const ancSet = sectionAncestors.get(cand)!
        let matchCount = 0
        for (const sid of prior.segmentIds) {
          if (ancSet.has(sid)) matchCount++
        }
        const score = matchCount * 1e9 + cand.totalLength
        if (score > bestScore) {
          bestScore = score
          bestCandidate = cand
        }
      }

      matchedMeta.set(bestCandidate, { ...prior.meta })
      claimedNames.add(prior.name)
    }
  }

  // Pass 3: Stable fallback name allocation for new or unassigned sections
  const allUsedNames = new Set<string>(claimedNames)
  for (const name of metaNames) allUsedNames.add(name)

  let letterIndex = 0
  const getNextAvailableName = (): string => {
    while (true) {
      const letter = String.fromCharCode(65 + (letterIndex % 26))
      const suffix = letterIndex >= 26 ? Math.floor(letterIndex / 26) : ''
      const name = `Section ${letter}${suffix}`
      letterIndex++
      if (!allUsedNames.has(name)) {
        allUsedNames.add(name)
        return name
      }
    }
  }

  const sections: TrackSection[] = []
  for (let i = 0; i < rawSections.length; i++) {
    const rawSec = rawSections[i]
    let meta = matchedMeta.get(rawSec)

    if (!meta) {
      const fallbackName = getNextAvailableName()
      const fallbackColor = SECTION_COLORS[i % SECTION_COLORS.length]
      meta = {
        name: fallbackName,
        type: 'circulation',
        direction: 'two_way',
        color: fallbackColor,
      }
      matchedMeta.set(rawSec, meta)
    }

    const fallbackColor = SECTION_COLORS[i % SECTION_COLORS.length]
    const isCustom = meta.isCustomName ?? (meta.name ? !/^Section [A-Z]\d*$/.test(meta.name) : false)
    const finalSection: TrackSection = {
      id: rawSec.sortedSegKey,
      name: meta.name || getNextAvailableName(),
      type: meta.type || 'circulation',
      direction: meta.direction || 'two_way',
      segmentIds: rawSec.segmentIds,
      orderedNodeIds: rawSec.orderedNodes,
      nodeIds: Array.from(new Set(rawSec.orderedNodes)),
      totalLength: rawSec.totalLength,
      color: meta.color || (meta.type === 'station_stop' ? '#06b6d4' : fallbackColor),
      hasDeadEnd: rawSec.hasDeadEnd,
      crossingNodeIds: rawSec.crossingNodeIds?.length ? rawSec.crossingNodeIds : undefined,
      isCustomName: isCustom,
    }

    // Persist assigned names and associations to customMeta
    if (customMeta) {
      customMeta[finalSection.id] = {
        name: finalSection.name,
        type: finalSection.type,
        color: finalSection.color,
        direction: finalSection.direction,
        isCustomName: finalSection.isCustomName,
      }
      for (const sid of finalSection.segmentIds) {
        customMeta[sid] = {
          name: finalSection.name,
          type: finalSection.type,
          color: finalSection.color,
          direction: finalSection.direction,
          isCustomName: finalSection.isCustomName,
        }
      }
    }

    sections.push(finalSection)
  }

  return sections
}

/** Determine if a track section has been customized/renamed by the user */
export function isRenamedSection(sec: TrackSection): boolean {
  if (sec.isCustomName) return true
  return !/^Section [A-Z]\d*$/.test(sec.name)
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
