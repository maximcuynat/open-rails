import type { BBox, DatasetIndex, IndexLine, LineId } from './datasetIndex'

// The way from one station to another over the index, line by line: lines are the vertices,
// the connections (a node where rails of two lines meet) the edges. The index is tiny (a few
// dozen lines), so a plain Dijkstra by scanning does. The route says which files to fetch; the
// exact path along the track is found on the loaded network when a train needs it.

export interface LineGraph {
  byId: Map<LineId, IndexLine>
  neighbours: Map<LineId, Set<LineId>>
}

export function buildLineGraph(index: DatasetIndex): LineGraph {
  const byId = new Map(index.lines.map((line) => [line.id, line]))
  const neighbours = new Map<LineId, Set<LineId>>()
  for (const id of byId.keys()) neighbours.set(id, new Set())
  for (const connection of index.connections) {
    for (const a of connection.lines) {
      if (!byId.has(a)) continue
      for (const b of connection.lines) if (a !== b && byId.has(b)) neighbours.get(a)!.add(b)
    }
  }
  return { byId, neighbours }
}

/**
 * The cheapest sequence of lines from any line of `from` to any line of `to`, the lines of
 * `from` costing nothing (the train is already there) and every line entered afterwards its
 * `weight` (its length of track by default). A line in both sets is a route of its own.
 * `null` when the two sets are not connected.
 */
export function shortestLineRoute(
  graph: LineGraph,
  from: ReadonlySet<LineId>,
  to: ReadonlySet<LineId>,
  weight: (line: IndexLine) => number = (line) => line.lengthKm,
): LineId[] | null {
  const cost = new Map<LineId, number>()
  const previous = new Map<LineId, LineId>()
  const settled = new Set<LineId>()
  for (const id of from) if (graph.byId.has(id)) cost.set(id, 0)
  while (true) {
    let current: LineId | null = null
    for (const [id, c] of cost) if (!settled.has(id) && (current === null || c < cost.get(current)!)) current = id
    if (current === null) return null
    if (to.has(current)) {
      const route: LineId[] = []
      for (let id: LineId | undefined = current; id !== undefined; id = previous.get(id)) route.unshift(id)
      return route
    }
    settled.add(current)
    for (const next of graph.neighbours.get(current) ?? []) {
      if (settled.has(next)) continue
      const through = cost.get(current)! + weight(graph.byId.get(next)!)
      if (through < (cost.get(next) ?? Infinity)) {
        cost.set(next, through)
        previous.set(next, current)
      }
    }
  }
}

export interface JourneyLeg {
  from: string
  to: string
  lines: LineId[]
}

export interface JourneyRoute {
  legs: JourneyLeg[]
  /** Every line of the journey once, in order of first use */
  lines: LineId[]
  /** Track of those lines, in km, as the index gives it */
  lengthKm: number
  bytes: number
  bbox: BBox
}

export interface RouteProblem {
  error: 'unknown-station' | 'no-route'
  /** Index in the list of stations of the one at fault (the second of the pair for a missing route) */
  at: number
}

/** The route through two stations or more, in the order given */
export function routeThroughStations(index: DatasetIndex, stationIds: readonly string[]): JourneyRoute | RouteProblem {
  const stations = new Map(index.stations.map((station) => [station.id, station]))
  for (let i = 0; i < stationIds.length; i++) if (!stations.has(stationIds[i])) return { error: 'unknown-station', at: i }
  if (stationIds.length < 2) return { error: 'no-route', at: stationIds.length }
  const graph = buildLineGraph(index)
  const legs: JourneyLeg[] = []
  const lines: LineId[] = []
  for (let i = 1; i < stationIds.length; i++) {
    const from = stations.get(stationIds[i - 1])!
    const to = stations.get(stationIds[i])!
    const leg = shortestLineRoute(graph, new Set(from.lines), new Set(to.lines))
    if (!leg) return { error: 'no-route', at: i }
    legs.push({ from: from.id, to: to.id, lines: leg })
    for (const id of leg) if (!lines.includes(id)) lines.push(id)
  }
  let lengthKm = 0
  let bytes = 0
  for (const id of lines) {
    const line = graph.byId.get(id)!
    lengthKm += line.lengthKm
    bytes += line.bytes
  }
  return { legs, lines, lengthKm: Math.round(lengthKm * 10) / 10, bytes, bbox: routeBbox(index, lines) }
}

/** The box around some lines */
export function routeBbox(index: DatasetIndex, lines: readonly LineId[]): BBox {
  const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const line of index.lines) {
    if (!lines.includes(line.id)) continue
    box.minX = Math.min(box.minX, line.bbox.minX)
    box.minY = Math.min(box.minY, line.bbox.minY)
    box.maxX = Math.max(box.maxX, line.bbox.maxX)
    box.maxY = Math.max(box.maxY, line.bbox.maxY)
  }
  return box
}

export interface LineGate {
  x: number
  y: number
  /** The lines met there that are not loaded */
  lines: LineId[]
}

/** The connections that lead from a loaded line to one not loaded: where a train leaves what it has */
export function connectionsToward(index: DatasetIndex, loaded: ReadonlySet<LineId>): LineGate[] {
  const gates: LineGate[] = []
  for (const connection of index.connections) {
    if (!connection.lines.some((id) => loaded.has(id))) continue
    const missing = connection.lines.filter((id) => !loaded.has(id))
    if (missing.length) gates.push({ x: connection.x, y: connection.y, lines: missing })
  }
  return gates
}
