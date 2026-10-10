import type { OsmImportResult, OverpassResponse } from '@domain/import/osmTypes'
import { segmentShapeLength } from '@domain/geometry/segmentGeometry'
import { findSectionChains } from '@domain/models/sections'
import type { Network, SegmentId } from '@domain/models/types'
import type { LineId } from '@domain/dataset/datasetIndex'
import type { DatasetManifest } from './manifest'

// Which line each rail belongs to. A way names its line through the relations it is a member of
// (`type=route`, `route=tracks|railway`): the manifest lists, for each line to publish, the ids of
// the relations that make it, in order of precedence (a way in two lines goes to the first). The
// other relations say nothing (Overpass returns every relation a way is in: cross-border routes,
// « voie 1 » of a classic line…). A way fetched for an approach belongs to the approach, unless
// it is a high-speed way. Then, so that a border always falls on a junction node or a track end,
// every section (a run of rails between two nodes of degree ≠ 2) takes the line that holds most
// of its length; a section no way of which says anything takes the line of a neighbouring
// section, and what is left is « autres ».

export type { LineId }

export interface LineInfo {
  id: LineId
  name: string
  /** RFN line code of the relation, when it came from one */
  ref?: string
  highSpeed: boolean
}

export const OTHER_LINE: LineInfo = { id: 'autres', name: 'Autres voies', highSpeed: false }

export interface LineAssignment {
  lineOf: Map<SegmentId, LineId>
  lines: Map<LineId, LineInfo>
  /** High-speed ways in no listed relation and no approach: what the manifest misses (they are propagated or « autres ») */
  unlistedHighSpeedWays: number
}

interface Relation {
  id: number
  ref?: string
  name?: string
  ways: Set<number>
}

/** A way carries high-speed traffic: `highspeed=yes`, or a TVM speed (`railway:tvm=no` is on classic tracks) */
export const isHighSpeedWay = (tags: Record<string, string>): boolean => tags.highspeed === 'yes' || /^[0-9]/.test(tags['railway:tvm'] ?? '')

/** The line relations of the answer, with the ways they hold */
export function readLineRelations(data: OverpassResponse): Relation[] {
  const relations: Relation[] = []
  for (const element of data.elements ?? []) {
    if (element.type !== 'relation' || !element.tags || !Array.isArray(element.members)) continue
    const tags = element.tags
    if (tags.type !== 'route' || !(tags.route === 'tracks' || tags.route === 'railway')) continue
    const ways = new Set<number>()
    for (const member of element.members) if (member.type === 'way') ways.add(member.ref)
    const relation: Relation = { id: element.id, ways }
    if (tags.ref) relation.ref = tags.ref
    if (tags.name) relation.name = tags.name
    relations.push(relation)
  }
  return relations
}

/** The published line each listed relation belongs to, and the rank of that line (its precedence) */
function linesOfManifest(manifest: DatasetManifest): Map<number, { info: LineInfo; rank: number }> {
  const byRelation = new Map<number, { info: LineInfo; rank: number }>()
  manifest.lines.forEach((spec, rank) => {
    const info: LineInfo = { id: spec.id, name: spec.name, highSpeed: true }
    if (spec.ref !== undefined) info.ref = spec.ref
    for (const relation of spec.relations) if (!byRelation.has(relation)) byRelation.set(relation, { info, rank })
  })
  return byRelation
}

/**
 * The line of each rail of a converted network. `approachWays`: the ways each approach query
 * brought. Returns the map and the lines it names.
 */
export function assignLines(
  result: OsmImportResult,
  data: OverpassResponse,
  manifest: DatasetManifest,
  approachWays: ReadonlyMap<string, ReadonlySet<number>>,
): LineAssignment {
  const net = result.network
  const wayOfRail = result.wayOfRail
  if (!wayOfRail) throw new Error('convertOsm must be run with traceWays')
  const lines = new Map<LineId, LineInfo>()
  const keep = (info: LineInfo): LineId => {
    if (!lines.has(info.id)) lines.set(info.id, info)
    return info.id
  }

  // 1. What each way says
  const wayTags = new Map<number, Record<string, string>>()
  for (const element of data.elements ?? []) if (element.type === 'way' && element.tags) wayTags.set(element.id, element.tags)
  const relations = readLineRelations(data)
  const relationsOfWay = new Map<number, Relation[]>()
  for (const relation of relations) {
    for (const way of relation.ways) {
      const list = relationsOfWay.get(way)
      if (list) list.push(relation)
      else relationsOfWay.set(way, [relation])
    }
  }
  const approachOfWay = new Map<number, string>()
  for (const [approachId, ways] of approachWays) for (const way of ways) if (!approachOfWay.has(way)) approachOfWay.set(way, approachId)
  const approachInfo = new Map(manifest.approaches.map((a) => [a.id, { id: a.id, name: a.name, highSpeed: false } as LineInfo]))
  const listed = linesOfManifest(manifest)

  let unlistedHighSpeedWays = 0
  const lineOfWay = new Map<number, LineId | null>()
  const wayLine = (way: number): LineId | null => {
    if (lineOfWay.has(way)) return lineOfWay.get(way)!
    const tags = wayTags.get(way) ?? {}
    const highSpeed = isHighSpeedWay(tags)
    let line: LineId | null = null
    // The listed line of highest precedence among the way's relations
    let preferred: { info: LineInfo; rank: number } | undefined
    for (const relation of relationsOfWay.get(way) ?? []) {
      const candidate = listed.get(relation.id)
      if (candidate && (!preferred || candidate.rank < preferred.rank)) preferred = candidate
    }
    // A high-speed way belongs to its line; a classic way of an approach to the approach
    const approach = approachOfWay.get(way)
    if (highSpeed && preferred) line = keep(preferred.info)
    else if (approach) line = keep(approachInfo.get(approach)!)
    else if (preferred) line = keep(preferred.info)
    else if (highSpeed) unlistedHighSpeedWays++
    lineOfWay.set(way, line)
    return line
  }

  // 2. Each section takes the line that holds most of its length
  const sections = findSectionChains(net)
  const lineOfSection = new Map<number, LineId>()
  const sectionsOfNode = new Map<string, number[]>()
  sections.forEach((section, i) => {
    const weight = new Map<LineId, number>()
    for (const segId of section.segmentIds) {
      const seg = net.segments.get(segId)!
      const way = wayOfRail.get(segId) ?? (seg.parentSegmentId ? wayOfRail.get(seg.parentSegmentId) : undefined)
      const line = way !== undefined ? wayLine(way) : null
      if (line) weight.set(line, (weight.get(line) ?? 0) + segmentShapeLength(net, seg))
    }
    let best: LineId | null = null
    for (const [line, w] of weight) if (best === null || w > weight.get(best)!) best = line
    if (best) lineOfSection.set(i, best)
    for (const nodeId of section.orderedNodes) {
      const list = sectionsOfNode.get(nodeId)
      if (list) list.push(i)
      else sectionsOfNode.set(nodeId, [i])
    }
  })

  // 3. A section nobody names takes the line of a neighbour, as long as some neighbour has one
  let changed = true
  while (changed) {
    changed = false
    sections.forEach((section, i) => {
      if (lineOfSection.has(i)) return
      for (const nodeId of section.orderedNodes) {
        for (const j of sectionsOfNode.get(nodeId) ?? []) {
          const line = lineOfSection.get(j)
          if (line) {
            lineOfSection.set(i, line)
            changed = true
            return
          }
        }
      }
    })
  }

  const lineOf = new Map<SegmentId, LineId>()
  sections.forEach((section, i) => {
    const line = lineOfSection.get(i) ?? keep(OTHER_LINE)
    for (const segId of section.segmentIds) lineOf.set(segId, line)
  })
  return { lineOf, lines, unlistedHighSpeedWays }
}

/** The groups a map of lines makes, for `splitSpeedZonesBy` */
export function groupOfRail(assignment: LineAssignment): (segId: SegmentId) => string {
  return (segId) => assignment.lineOf.get(segId) ?? OTHER_LINE.id
}

export type { Network }
