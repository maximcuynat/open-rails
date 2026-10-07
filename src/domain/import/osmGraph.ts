import type { Point } from '../models/types'
import type { OsmNode, OsmRead, OsmTrack } from './osmRead'
import { distance, lerp } from './osmArcs'

// The tracks as a graph of OSM nodes, and its chains: the runs of nodes between two nodes that are
// not plain joints (a turnout, a crossing, a track end, a corner). Two tracks are joined where they share a
// node, and nowhere else.

/** Two consecutive nodes of a way closer than this (m) are one node */
const SAME_NODE_DISTANCE = 0.2

/** A stretch of a way between two consecutive nodes, `a` → `b` in the direction the way is drawn */
export interface TrackEdge {
  a: number
  b: number
  track: OsmTrack
  length: number
}

export interface TrackGraph {
  /** World position of each node that carries track */
  pos: Map<number, Point>
  /** Tags of the nodes that have some */
  nodes: Map<number, OsmNode>
  edges: TrackEdge[]
  at: Map<number, TrackEdge[]>
  /** Nodes where a way stops because the answer does not hold its next node */
  cutNodes: Set<number>
}

export function buildGraph(read: OsmRead, project: (lat: number, lon: number) => Point): TrackGraph {
  const pos = new Map<number, Point>()
  const place = (id: number): Point => {
    let p = pos.get(id)
    if (!p) {
      const node = read.nodes.get(id)!
      p = project(node.lat, node.lon)
      pos.set(id, p)
    }
    return p
  }

  // Nodes standing on each other along a way are made one, under the id of the first met
  const alias = new Map<number, number>()
  const resolve = (id: number): number => {
    let rep = id
    while (alias.has(rep)) rep = alias.get(rep)!
    return rep
  }
  for (const track of read.tracks) {
    for (let i = 0; i + 1 < track.nodes.length; i++) {
      const a = resolve(track.nodes[i])
      const b = resolve(track.nodes[i + 1])
      if (a !== b && distance(place(a), place(b)) < SAME_NODE_DISTANCE) alias.set(b, a)
    }
  }

  const nodes = new Map<number, OsmNode>()
  const edges: TrackEdge[] = []
  const at = new Map<number, TrackEdge[]>()
  const cutNodes = new Set<number>()
  const seen = new Set<string>()
  const attach = (id: number, edge: TrackEdge): void => {
    const list = at.get(id)
    if (list) list.push(edge)
    else at.set(id, [edge])
  }
  for (const track of read.tracks) {
    for (const id of track.nodes) {
      const node = read.nodes.get(id)
      const rep = resolve(id)
      // The tags of a node made one with another are kept when the other has none
      if (node?.tags && !nodes.get(rep)?.tags?.railway) nodes.set(rep, node)
    }
    if (track.cutAtStart) cutNodes.add(resolve(track.nodes[0]))
    if (track.cutAtEnd) cutNodes.add(resolve(track.nodes[track.nodes.length - 1]))
    for (let i = 0; i + 1 < track.nodes.length; i++) {
      const a = resolve(track.nodes[i])
      const b = resolve(track.nodes[i + 1])
      if (a === b) continue
      // The same stretch drawn twice (two ways over the same two nodes) is one track
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      if (seen.has(key)) continue
      seen.add(key)
      const edge: TrackEdge = { a, b, track, length: distance(place(a), place(b)) }
      edges.push(edge)
      attach(a, edge)
      attach(b, edge)
    }
  }
  for (const id of [...pos.keys()]) if (!at.has(id)) pos.delete(id)
  return { pos, nodes, edges, at, cutNodes }
}

/** The connected parts of the graph, each with the length of its track, the longest first */
export function components(graph: TrackGraph): { nodes: Set<number>; length: number }[] {
  const parts: { nodes: Set<number>; length: number }[] = []
  const seen = new Set<number>()
  for (const start of graph.at.keys()) {
    if (seen.has(start)) continue
    const part = { nodes: new Set<number>([start]), length: 0 }
    const stack = [start]
    seen.add(start)
    while (stack.length > 0) {
      const id = stack.pop()!
      for (const edge of graph.at.get(id) ?? []) {
        // Each edge is met from both its ends
        part.length += edge.length / 2
        const other = edge.a === id ? edge.b : edge.a
        if (seen.has(other)) continue
        seen.add(other)
        part.nodes.add(other)
        stack.push(other)
      }
    }
    parts.push(part)
  }
  return parts.sort((p, q) => q.length - p.length)
}

/** The graph without the nodes outside `keep`, and the edges that hang on them */
export function restrictGraph(graph: TrackGraph, keep: Set<number>): TrackGraph {
  const at = new Map<number, TrackEdge[]>()
  const pos = new Map<number, Point>()
  for (const [id, edges] of graph.at) {
    if (!keep.has(id)) continue
    at.set(id, edges)
    pos.set(id, graph.pos.get(id)!)
  }
  return {
    pos,
    nodes: graph.nodes,
    edges: graph.edges.filter((edge) => keep.has(edge.a)),
    at,
    cutNodes: graph.cutNodes,
  }
}

/** A run of track between two nodes that are not plain joints, or a closed loop without any */
export interface Chain {
  index: number
  /** OSM nodes along the chain; the first and the last are the same on a closed loop */
  nodes: number[]
  /** `edges[i]` joins `nodes[i]` and `nodes[i + 1]`; `forward[i]` when the way is drawn that way */
  edges: TrackEdge[]
  forward: boolean[]
  pts: Point[]
  /** Distance along the chain of each node */
  stations: number[]
  length: number
}

/** One end of a chain at a node */
export interface ChainEnd {
  chain: Chain
  atStart: boolean
}

function makeChain(graph: TrackGraph, index: number, nodes: number[], edges: TrackEdge[]): Chain {
  // A chain runs the way its ways are drawn (the longer share of them when they disagree)
  let along = 0
  for (let i = 0; i < edges.length; i++) along += edges[i].a === nodes[i] ? edges[i].length : -edges[i].length
  if (along < 0) {
    nodes.reverse()
    edges.reverse()
  }
  const pts = nodes.map((id) => graph.pos.get(id)!)
  const stations = [0]
  for (const edge of edges) stations.push(stations[stations.length - 1] + edge.length)
  return {
    index,
    nodes,
    edges,
    forward: edges.map((edge, i) => edge.a === nodes[i]),
    pts,
    stations,
    length: stations[stations.length - 1],
  }
}

/** A plain joint where the track turns back by more than this (degrees) is a corner: chains end on it */
const CORNER_DEG = 60

/** True for a node that joins two stretches of track at an angle no fitted curve should round off */
function isCorner(graph: TrackGraph, id: number): boolean {
  const edges = graph.at.get(id)!
  const here = graph.pos.get(id)!
  const [p, q] = edges.map((edge) => graph.pos.get(edge.a === id ? edge.b : edge.a)!)
  const turn = Math.atan2((p.x - here.x) * (q.y - here.y) - (p.y - here.y) * (q.x - here.x), (p.x - here.x) * (q.x - here.x) + (p.y - here.y) * (q.y - here.y))
  return Math.PI - Math.abs(turn) > (CORNER_DEG * Math.PI) / 180
}

export function buildChains(graph: TrackGraph): Chain[] {
  const chains: Chain[] = []
  const used = new Set<TrackEdge>()
  // Chains end where the track does not simply run on: any node but a plain joint, and corners
  const ends = new Set<number>()
  for (const [id, edges] of graph.at) if (edges.length !== 2 || isCorner(graph, id)) ends.add(id)

  const walk = (start: number, first: TrackEdge): void => {
    const nodes = [start]
    const edges: TrackEdge[] = []
    let edge = first
    let node = start
    for (;;) {
      used.add(edge)
      edges.push(edge)
      node = edge.a === node ? edge.b : edge.a
      nodes.push(node)
      if (ends.has(node) || node === start) break
      const [e1, e2] = graph.at.get(node)!
      edge = e1 === edge ? e2 : e1
      if (used.has(edge)) break
    }
    chains.push(makeChain(graph, chains.length, nodes, edges))
  }

  for (const id of ends) {
    for (const edge of graph.at.get(id)!) if (!used.has(edge)) walk(id, edge)
  }
  // What is left is closed loops that no turnout leads to
  for (const [id, edges] of graph.at) {
    for (const edge of edges) if (!used.has(edge)) walk(id, edge)
  }
  return chains
}

/** The ends of chains at each node they end on */
export function chainEnds(chains: Chain[]): Map<number, ChainEnd[]> {
  const ends = new Map<number, ChainEnd[]>()
  const add = (id: number, end: ChainEnd): void => {
    const list = ends.get(id)
    if (list) list.push(end)
    else ends.set(id, [end])
  }
  for (const chain of chains) {
    add(chain.nodes[0], { chain, atStart: true })
    add(chain.nodes[chain.nodes.length - 1], { chain, atStart: false })
  }
  return ends
}

/** The point at a distance along a chain, measured from the end `atStart` names */
export function pointAlong(chain: Chain, atStart: boolean, dist: number): Point {
  const station = atStart ? dist : chain.length - dist
  return pointAtStation(chain, station)
}

export function pointAtStation(chain: Chain, station: number): Point {
  const { pts, stations } = chain
  if (station <= 0) return pts[0]
  if (station >= chain.length) return pts[pts.length - 1]
  let lo = 0
  let hi = stations.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (stations[mid] <= station) lo = mid
    else hi = mid
  }
  const span = stations[hi] - stations[lo]
  return span > 0 ? lerp(pts[lo], pts[hi], (station - stations[lo]) / span) : pts[lo]
}
