import type { Network, NodeId, SegmentId, Segment, Point } from './types'
import { railMeasures, type RailMeasures } from '../geometry/railMeasures'
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

/** A chain of rails between two boundaries, before it is named: what the track alone decides */
export interface RawSection {
  segmentIds: SegmentId[]
  /** The nodes from one tip to the other, one more than the rails */
  orderedNodes: NodeId[]
  totalLength: number
  /** Rail ids sorted and joined: the id of the section */
  sortedSegKey: string
  hasDeadEnd: boolean
  crossingNodeIds?: NodeId[]
  /** The rail the chain was walked from: the first of its rails in the order of the network */
  startSegId: SegmentId
}

/**
 * A node of degree 4 or more without three-way or double slip: the chain goes on through it along
 * the straightest rail, which need not lead back the same way — which chain gets a rail there
 * depends on which is walked first.
 */
export function isThroughCrossing(net: Network, nodeId: NodeId): boolean {
  const deg = net.adjacency.get(nodeId)?.length ?? 0
  if (deg < 4) return false
  const junc = findJunctionAtNode(net, nodeId)
  return !junc || (junc.kind !== 'three_way' && junc.kind !== 'double_slip')
}

/**
 * Find the through-route continuation of prevSegId across currNode, if one exists.
 * - At degree 2: continues if the two segments form a smooth through-route (dot < -0.7).
 * - At degree 4 (diamond crossing): continues along the opposite aligned through-segment (dot < -0.7).
 * - At switches, forks, dead-ends, or sharp kinks: returns null (boundary).
 */
function getNextThroughSegment(net: Network, currNode: NodeId, prevSegId: SegmentId): SegmentId | null {
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
  let bestCand: SegmentId | null = null
  let minDot = 0

  for (const cid of adj) {
    if (cid === prevSegId) continue
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

/**
 * The chain of rails through `startSeg`, both ways, as far as the track continues through nodes
 * not walked yet. `pool`: the only rails the walk may step onto — null when it would step outside.
 */
export function walkSectionChain(
  net: Network,
  startSeg: Segment,
  visitedSegments: Set<SegmentId>,
  measures: RailMeasures,
  pool?: ReadonlySet<SegmentId>,
): RawSection | null {
  const segId = startSeg.id
  let sectionSegIds: SegmentId[] = [segId]
  visitedSegments.add(segId)

  // Expand forwards from startSeg.to
  let currNode = startSeg.to
  let prevSegId = segId
  while (true) {
    const nextSegId = getNextThroughSegment(net, currNode, prevSegId)
    if (!nextSegId || visitedSegments.has(nextSegId)) break
    if (pool && !pool.has(nextSegId)) return null

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
    const nextSegId = getNextThroughSegment(net, currNode, prevSegId)
    if (!nextSegId || visitedSegments.has(nextSegId)) break
    if (pool && !pool.has(nextSegId)) return null

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

  // Total length
  let totalLen = 0
  for (const sid of sectionSegIds) {
    const seg = net.segments.get(sid)
    if (seg) totalLen += measures.shapeLength(seg)
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

  return {
    segmentIds: sectionSegIds,
    orderedNodes,
    totalLength: totalLen,
    sortedSegKey,
    hasDeadEnd,
    crossingNodeIds: crossingNodeIds.length > 0 ? crossingNodeIds : undefined,
    startSegId: segId,
  }
}

/**
 * The chains of rails of the network, each walked from the first of its rails in the order of
 * the network: what the track alone decides of the sections.
 */
export function findSectionChains(net: Network, measures: RailMeasures = railMeasures(net)): RawSection[] {
  const visitedSegments = new Set<SegmentId>()
  const rawSections: RawSection[] = []
  for (const [segId, startSeg] of net.segments) {
    if (visitedSegments.has(segId)) continue
    rawSections.push(walkSectionChain(net, startSeg, visitedSegments, measures)!)
  }
  return rawSections
}

/** True when two entries of the section settings say the same */
function sameMetadata(a: SectionMetadata | undefined, b: SectionMetadata): boolean {
  return !!a && a.name === b.name && a.type === b.type && a.color === b.color && a.direction === b.direction && a.isCustomName === b.isCustomName
}

/**
 * What `nameSections` reads of the settings as a whole: their keys by the name they hold, in the
 * order of the settings, and the compound keys (several rails) by each rail they name. The
 * settings hold an entry per rail: this is built once and kept up to date by whoever writes into
 * them (`SectionTracker`), instead of read from end to end at each naming.
 */
export interface SectionMetaIndex {
  keysByName: Map<string, Set<string>>
  /** The name each key held when it was last noted */
  nameOfKey: Map<string, string>
  compoundKeysOfRail: Map<string, string[]>
}

export function indexSectionMeta(customMeta: Record<string, SectionMetadata>): SectionMetaIndex {
  const index: SectionMetaIndex = { keysByName: new Map(), nameOfKey: new Map(), compoundKeysOfRail: new Map() }
  for (const key in customMeta) noteMetaKey(index, customMeta, key)
  return index
}

/** The index told of `key` as it stands in the settings now: named otherwise, taken out, or new */
export function noteMetaKey(index: SectionMetaIndex, customMeta: Record<string, SectionMetadata>, key: string): void {
  const name = customMeta[key]?.name
  const before = index.nameOfKey.get(key)
  if (before !== name) {
    if (before) index.keysByName.get(before)?.delete(key)
    if (name) {
      const keys = index.keysByName.get(name)
      if (keys) keys.add(key)
      else index.keysByName.set(name, new Set([key]))
      index.nameOfKey.set(key, name)
    } else {
      index.nameOfKey.delete(key)
    }
  }
  if (!key.includes('-')) return
  // A compound key is noted once; one taken out of the settings is read as holding nothing
  const rails = key.split('-')
  const first = index.compoundKeysOfRail.get(rails[0])
  if (first?.includes(key)) return
  for (const sid of rails) {
    const keys = index.compoundKeysOfRail.get(sid)
    if (keys) keys.push(key)
    else index.compoundKeysOfRail.set(sid, [key])
  }
}

/** Writes an entry into the settings, and the index with it */
function writeMeta(index: SectionMetaIndex, customMeta: Record<string, SectionMetadata>, key: string, entry: SectionMetadata): void {
  customMeta[key] = entry
  noteMetaKey(index, customMeta, key)
}

/**
 * Names, kinds, colours and directions of the chains from the settings kept in `customMeta`
 * (see `computeTrackSections`), written back into them. `previous`: the sections last made from
 * these chains — a chain that reads the same keeps its section object, and when `settled` (no
 * one wrote into the settings since) nothing is written for it either, unless it is among the
 * `unsettled` (its own entries were written). `metaIndex`: the index of the settings when the
 * caller keeps one; built here otherwise.
 */
export function nameSections(
  net: Network,
  rawSections: RawSection[],
  customMeta?: Record<string, SectionMetadata>,
  previous?: ReadonlyMap<RawSection, TrackSection>,
  settled = false,
  metaIndex?: SectionMetaIndex,
  unsettled?: ReadonlySet<RawSection>,
): TrackSection[] {
  const matchedMeta = new Map<RawSection, SectionMetadata>()
  const claimedNames = new Set<string>()

  const index = customMeta ? (metaIndex ?? indexSectionMeta(customMeta)) : { keysByName: new Map<string, Set<string>>(), nameOfKey: new Map<string, string>(), compoundKeysOfRail: new Map<string, string[]>() }
  const { compoundKeysOfRail, keysByName } = index

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
    for (const [name, keys] of keysByName) {
      if (claimedNames.has(name)) continue // already claimed by exact intact match
      let prior: PriorRecord | undefined
      for (const key of keys) {
        const meta = customMeta[key]
        if (!meta || meta.name !== name) continue
        if (!prior) {
          prior = { name, meta: { ...meta }, segmentIds: new Set() }
          priorRecordsByName.set(name, prior)
        }
        const segs = key.includes('-') ? key.split('-') : [key]
        for (const s of segs) prior.segmentIds.add(s)
      }
    }
  }

  // Pass 2: Overlap and ancestor heritage (when a line is cut or bifurcated)
  // Each unclaimed prior section gets assigned to AT MOST ONE candidate raw section (the primary piece).
  if (priorRecordsByName.size > 0) {
    // Ancestors of a rail: itself and its `parentSegmentId` chain; the sections descending from a
    // rail are those of the rail and of the rails descending from it
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
    const ancestorsOf = (rawSec: RawSection): Set<SegmentId> => {
      let all = sectionAncestors.get(rawSec)
      if (!all) {
        all = new Set()
        for (const sid of rawSec.segmentIds) for (const anc of getAncestors(sid)) all.add(anc)
        sectionAncestors.set(rawSec, all)
      }
      return all
    }
    const indexOf = new Map<RawSection, number>()
    const sectionOfRail = new Map<SegmentId, number>()
    rawSections.forEach((rawSec, index) => {
      indexOf.set(rawSec, index)
      for (const sid of rawSec.segmentIds) sectionOfRail.set(sid, index)
    })
    const childrenOf = new Map<SegmentId, SegmentId[]>()
    for (const seg of net.segments.values()) {
      if (!seg.parentSegmentId) continue
      const children = childrenOf.get(seg.parentSegmentId)
      if (children) children.push(seg.id)
      else childrenOf.set(seg.parentSegmentId, [seg.id])
    }
    const sectionsDescendingFrom = (sid: SegmentId, into: Set<number>): void => {
      const own = sectionOfRail.get(sid)
      if (own !== undefined) into.add(own)
      for (const child of childrenOf.get(sid) ?? []) sectionsDescendingFrom(child, into)
    }

    for (const prior of priorRecordsByName.values()) {
      if (claimedNames.has(prior.name)) continue

      // In the order of `rawSections`: the first of two equal candidates wins
      const overlapping = new Set<number>()
      for (const sid of prior.segmentIds) sectionsDescendingFrom(sid, overlapping)
      const candidates = [...overlapping]
        .sort((a, b) => a - b)
        .map((index) => rawSections[index])
        .filter((rawSec) => !matchedMeta.has(rawSec))

      if (candidates.length > 0) {
        let bestCandidate = candidates[0]
        let bestScore = -1
        for (const cand of candidates) {
          const ancSet = ancestorsOf(cand)
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
  }

  // Pass 3: Stable fallback name allocation for new or unassigned sections
  const allUsedNames = new Set<string>(claimedNames)
  for (const [name, keys] of keysByName) if (keys.size > 0) allUsedNames.add(name)

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
    const name = meta.name || getNextAvailableName()
    const type = meta.type || 'circulation'
    const direction = meta.direction || 'two_way'
    const color = meta.color || (meta.type === 'station_stop' ? '#06b6d4' : fallbackColor)
    // The section made last time from this chain, when it reads the same
    const kept = previous?.get(rawSec)
    const same = !!kept && kept.name === name && kept.type === type && kept.direction === direction && kept.color === color && kept.isCustomName === isCustom
    const finalSection: TrackSection = same
      ? kept
      : {
          id: rawSec.sortedSegKey,
          name,
          type,
          direction,
          segmentIds: rawSec.segmentIds,
          orderedNodeIds: rawSec.orderedNodes,
          nodeIds: Array.from(new Set(rawSec.orderedNodes)),
          totalLength: rawSec.totalLength,
          color,
          hasDeadEnd: rawSec.hasDeadEnd,
          crossingNodeIds: rawSec.crossingNodeIds?.length ? rawSec.crossingNodeIds : undefined,
          isCustomName: isCustom,
        }

    // Persist assigned names and associations to customMeta: one entry per section and per rail,
    // written only where it does not read the same already (never changed in place)
    if (customMeta && !(same && settled && !unsettled?.has(rawSec))) {
      const entry: SectionMetadata = {
        name: finalSection.name,
        type: finalSection.type,
        color: finalSection.color,
        direction: finalSection.direction,
        isCustomName: finalSection.isCustomName,
      }
      if (!sameMetadata(customMeta[finalSection.id], entry)) writeMeta(index, customMeta, finalSection.id, entry)
      for (const sid of finalSection.segmentIds) {
        if (!sameMetadata(customMeta[sid], entry)) writeMeta(index, customMeta, sid, { ...entry })
      }
    }

    sections.push(finalSection)
  }

  return sections
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
  return nameSections(net, findSectionChains(net), customMeta)
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

export interface SectionEndpoint {
  section: TrackSection
  segmentId: SegmentId
  ray: Point
  canInflow: boolean
  canOutflow: boolean
}

/** The two ends of a section at their nodes: the ray leaving the node along it, and what way trains may go */
function sectionEndpoints(net: Network, sec: TrackSection): [NodeId, SectionEndpoint][] {
  const own: [NodeId, SectionEndpoint][] = []
  if (sec.orderedNodeIds.length < 2 || sec.segmentIds.length === 0) return own
  const startNode = sec.orderedNodeIds[0]
  const endNode = sec.orderedNodeIds[sec.orderedNodeIds.length - 1]

  const firstSeg = net.segments.get(sec.segmentIds[0])
  const lastSeg = net.segments.get(sec.segmentIds[sec.segmentIds.length - 1])

  if (firstSeg) {
    const ray = getRayFromNode(net, firstSeg, startNode)
    const canInflow = sec.direction === 'two_way' || sec.direction === 'backward'
    const canOutflow = sec.direction === 'two_way' || sec.direction === 'forward'
    own.push([startNode, { section: sec, segmentId: firstSeg.id, ray, canInflow, canOutflow }])
  }

  if (lastSeg && endNode !== startNode) {
    const ray = getRayFromNode(net, lastSeg, endNode)
    const canInflow = sec.direction === 'two_way' || sec.direction === 'forward'
    const canOutflow = sec.direction === 'two_way' || sec.direction === 'backward'
    own.push([endNode, { section: sec, segmentId: lastSeg.id, ray, canInflow, canOutflow }])
  }
  return own
}

/** What `detectDirectionConflicts` keeps of a section from one call to the next */
export type SectionEndpointCache = WeakMap<TrackSection, [NodeId, SectionEndpoint][]>

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
 * `endpoints`: kept from one call to the next, a section object seen before is not read again.
 */
export function detectDirectionConflicts(net: Network, sections: TrackSection[], endpoints?: SectionEndpointCache): DirectionConflict[] {
  const conflicts: DirectionConflict[] = []
  const reportedPairs = new Set<string>()

  // Map each boundary node to its incident section endpoints
  const nodeEndpoints = new Map<NodeId, SectionEndpoint[]>()

  for (const sec of sections) {
    // A section kept from the last time has the same rails and the same direction: its endpoints stand
    let own = endpoints?.get(sec)
    if (!own) {
      own = sectionEndpoints(net, sec)
      endpoints?.set(sec, own)
    }
    for (const [nodeId, endpoint] of own) {
      const at = nodeEndpoints.get(nodeId)
      if (at) at.push(endpoint)
      else nodeEndpoints.set(nodeId, [endpoint])
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
