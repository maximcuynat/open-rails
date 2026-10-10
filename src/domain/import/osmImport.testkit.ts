// Shared by the tests of the import: Overpass answers written by hand, in metres around a place,
// and what the tests ask of a converted network.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { reconcileNetworkIntersections } from '../geometry/reconcile'
import { distToCurve } from '../geometry/curve'
import { distToSegment, nodeLevel } from '../models/network'
import type { Network, Point, RailNode } from '../models/types'
import { projectionFor } from './osmProjection'
import { DEFAULT_OSM_IMPORT_OPTIONS, type OsmImportOptions, type OsmImportResult, type OverpassElement, type OverpassResponse } from './osmTypes'

/** Where the hand-made answers are: world (0, 0) of the kit */
const PLACE = { lat: 47, lon: 5 }
const METRES_PER_DEGREE_LAT = 111_170
const METRES_PER_DEGREE_LON = 111_320 * Math.cos((PLACE.lat * Math.PI) / 180)

type Tags = Record<string, string>

/** An OSM node `x` metres east and `y` metres south of the place of the kit */
export function osmNode(id: number, x: number, y: number, tags?: Tags): OverpassElement {
  const node: OverpassElement = { type: 'node', id, lat: PLACE.lat - y / METRES_PER_DEGREE_LAT, lon: PLACE.lon + x / METRES_PER_DEGREE_LON }
  if (tags) node.tags = tags
  return node
}

/** An OSM way through nodes, a plain track unless tags say otherwise */
export function osmWay(id: number, nodes: number[], tags: Tags = {}): OverpassElement {
  return { type: 'way', id, nodes, tags: { railway: 'rail', ...tags } }
}

/**
 * A track drawn through places (metres), a node at each: ids run from `firstId`. Returns the nodes,
 * the way, and the ids in order.
 */
export function osmTrack(wayId: number, firstId: number, places: [number, number][], tags: Tags = {}): { elements: OverpassElement[]; ids: number[] } {
  const ids = places.map((_, i) => firstId + i)
  return { elements: [...places.map(([x, y], i) => osmNode(ids[i], x, y)), osmWay(wayId, ids, tags)], ids }
}

/** Where a place of the kit (metres east and south of its own origin) lies in the world of a converted network */
export function placeIn(result: OsmImportResult, x: number, y: number): Point {
  return projectionFor(result.frame, result.origin)(PLACE.lat - y / METRES_PER_DEGREE_LAT, PLACE.lon + x / METRES_PER_DEGREE_LON)
}

/** Places every `step` metres on the straight line from one place to another, both included */
export function along(from: [number, number], to: [number, number], step = 25): [number, number][] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const count = Math.max(1, Math.round(length / step))
  return Array.from({ length: count + 1 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / count, from[1] + ((to[1] - from[1]) * i) / count])
}

export function answer(...elements: (OverpassElement | OverpassElement[])[]): OverpassResponse {
  return { elements: elements.flat() }
}

export function options(over: Partial<OsmImportOptions> = {}): OsmImportOptions {
  return { ...DEFAULT_OSM_IMPORT_OPTIONS, ...over }
}

/** One of the trimmed answers of `fixtures/` */
export function readFixture(name: string): OverpassResponse {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8'))
}

/** Ids of everything a network holds, to tell whether anything was added, removed or renamed */
export function contentsOf(net: Network): { nodes: string[]; segments: string[]; junctions: string[]; zones: string[] } {
  return {
    nodes: [...net.nodes.keys()].sort(),
    segments: [...net.segments.keys()].sort(),
    junctions: [...net.junctions.values()].map((junction) => `${junction.id}@${junction.nodeId}:${junction.kind}`).sort(),
    zones: [...net.speedZones.keys()].sort(),
  }
}

/**
 * What the editor does to the network when it opens it. The answer an imported network must give:
 * nothing welded, nothing cut, and the same nodes, rails, route tables and zones as before.
 */
export function openInEditor(net: Network): { splitCount: number; weldedCount: number; unchanged: boolean } {
  const before = contentsOf(net)
  const counts = reconcileNetworkIntersections(net)
  return { ...counts, unchanged: JSON.stringify(contentsOf(net)) === JSON.stringify(before) }
}

/** The node of a network nearest to a place, and how far it is */
export function nodeNear(net: Network, x: number, y: number): { node: RailNode; distance: number } {
  let best: RailNode | null = null
  let distance = Infinity
  for (const node of net.nodes.values()) {
    const d = Math.hypot(node.pos.x - x, node.pos.y - y)
    if (d < distance) {
      distance = d
      best = node
    }
  }
  return { node: best!, distance }
}

/**
 * How far each of the places lies from the nearest rail of a network (m), in the order given;
 * Infinity for a place more than `reach` metres from every rail. The rails are sorted into cells
 * first: a sample area has thousands of each.
 */
export function distancesToTrack(net: Network, places: Point[], reach = 10): number[] {
  const cell = 2 * reach
  const cells = new Map<string, { a: Point; b: Point; via?: Point }[]>()
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)!.pos
    const b = net.nodes.get(seg.to)!.pos
    const xs = seg.via ? [a.x, b.x, seg.via.x] : [a.x, b.x]
    const ys = seg.via ? [a.y, b.y, seg.via.y] : [a.y, b.y]
    const rail = seg.via ? { a, b, via: seg.via } : { a, b }
    for (let cx = Math.floor((Math.min(...xs) - reach) / cell); cx <= Math.floor((Math.max(...xs) + reach) / cell); cx++) {
      for (let cy = Math.floor((Math.min(...ys) - reach) / cell); cy <= Math.floor((Math.max(...ys) + reach) / cell); cy++) {
        const key = `${cx},${cy}`
        const list = cells.get(key)
        if (list) list.push(rail)
        else cells.set(key, [rail])
      }
    }
  }
  return places.map((p) => {
    let best = Infinity
    for (const rail of cells.get(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`) ?? []) {
      // A straight rail far off is set aside before anything is measured
      const d = rail.via ? distToCurve(p, rail.a, rail.via, rail.b) : distToSegment(p, rail.a, rail.b)
      if (d < best) best = d
    }
    return best <= reach ? best : Infinity
  })
}

/**
 * The places where two tracks of an answer cross without a common node, counted on the answer
 * itself: every pair of stretches between two consecutive nodes, of two ways of the given kinds,
 * that have no node in common and cut each other.
 */
export function countOsmCrossings(data: OverpassResponse, kinds: string[] = ['rail']): number {
  const at = new Map<number, Point>()
  for (const el of data.elements) if (el.type === 'node' && !at.has(el.id)) at.set(el.id, { x: el.lon! * 75_000, y: -el.lat! * 111_000 })
  const stretches: { a: number; b: number; p: Point; q: Point }[] = []
  const seen = new Set<string>()
  for (const el of data.elements) {
    if (el.type !== 'way' || !kinds.includes(el.tags?.railway ?? '')) continue
    for (let i = 0; i + 1 < el.nodes!.length; i++) {
      const [a, b] = [el.nodes![i], el.nodes![i + 1]]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      if (a === b || seen.has(key) || !at.has(a) || !at.has(b)) continue
      seen.add(key)
      stretches.push({ a, b, p: at.get(a)!, q: at.get(b)! })
    }
  }
  stretches.sort((s, t) => Math.min(s.p.x, s.q.x) - Math.min(t.p.x, t.q.x))
  let count = 0
  for (let i = 0; i < stretches.length; i++) {
    const one = stretches[i]
    const right = Math.max(one.p.x, one.q.x)
    for (let k = i + 1; k < stretches.length && Math.min(stretches[k].p.x, stretches[k].q.x) <= right; k++) {
      const two = stretches[k]
      if (one.a === two.a || one.a === two.b || one.b === two.a || one.b === two.b) continue
      const d1 = { x: one.q.x - one.p.x, y: one.q.y - one.p.y }
      const d2 = { x: two.q.x - two.p.x, y: two.q.y - two.p.y }
      const det = d1.x * d2.y - d1.y * d2.x
      if (Math.abs(det) < 1e-12) continue
      const t = ((two.p.x - one.p.x) * d2.y - (two.p.y - one.p.y) * d2.x) / det
      const u = ((two.p.x - one.p.x) * d1.y - (two.p.y - one.p.y) * d1.x) / det
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) count++
    }
  }
  return count
}

/** How many nodes of a network stand at each level */
export function levelCounts(net: Network): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const node of net.nodes.values()) counts[nodeLevel(node)] = (counts[nodeLevel(node)] ?? 0) + 1
  return counts
}

/** Number of rails at each node that has `count` of them */
export function nodesWithRails(net: Network, count: number): RailNode[] {
  return [...net.nodes.values()].filter((node) => (net.adjacency.get(node.id) ?? []).length === count)
}
