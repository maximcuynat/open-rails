import { reprojection, sameFrame } from '../../domain/import/osmProjection'
import { pathAt, pathOf } from '../../domain/geometry/railPath'
import { normalizedName, uicKey } from '../../domain/models/stationRegistry'
import type {
  SerializedJunction,
  SerializedNode,
  SerializedProject,
  SerializedSegment,
  SerializedSignal,
  SerializedSpeedZone,
  SerializedStation,
} from './persistence'

// A second project added to the current one, as data. Two project files know nothing of each
// other: both count their ids from 1, each has its own frame, and where they meet they may both
// hold the same node, the same rail, the same station. `mergeProjects` gives the incoming one ids
// of its own, moves it onto the map of the current one when both say where they are on the globe,
// then melts into the current project what the two have in common. Where they disagree, the
// current project wins. What is left to do on a loaded network — welding a rail end onto a rail,
// cutting at a crossing — is the business of `reconcileNetworkIntersections`, called by the store.

/** Two stations of one name further apart than this are two stations (the rule of the OSM import) */
const SAME_STATION_WITHIN = 1500
/** Two signals or two stops of one rail closer than this are the same one, metres */
const SAME_PLACE_WITHIN = 1
/** Two nodes whose heights differ by more than this are on two floors: never melted */
const SAME_LEVEL_WITHIN = 0.5

export interface MergeOptions {
  /** Two nodes closer than this are one node, metres: the reconcile tolerance of the current project */
  tolerance: number
}

export interface MergeReport {
  nodesAdded: number
  railsAdded: number
  /** Incoming nodes that were a node of the current project */
  nodesMerged: number
  /** Incoming rails that were a rail of the current project */
  railsDropped: number
  stationsAdded: number
  stationsMerged: number
  /** Incoming route tables left out: the current project had one at that node, and it still fits */
  junctionsDropped: number
  /** Route tables of both projects left out at a node where the two meet: the editor proposes one again */
  junctionsRebuilt: number
  signalsAdded: number
  zonesAdded: number
  trainsAdded: number
  /** `same`: one map already; `reprojected`: moved onto the map of the current project; `as-is`: no common frame */
  frame: 'same' | 'reprojected' | 'as-is'
  /** The two projects have different gauges */
  gaugeDiffers: boolean
  /** Box of what was added, world metres; null when nothing was */
  addedBox: { minX: number; minY: number; maxX: number; maxY: number } | null
}

/** The number an id ends with (`s_40` → 40), 0 when it has none */
function idNumber(id: string): number {
  const at = id.lastIndexOf('_')
  if (at < 0 || at === id.length - 1) return 0
  const n = Number(id.slice(at + 1))
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** Every id a project gives to something of its own */
function* ownIds(project: SerializedProject): Generator<string> {
  for (const node of project.nodes) yield node.id
  for (const seg of project.segments) yield seg.id
  for (const junction of project.junctions ?? []) yield junction.id
  for (const zone of project.speedZones ?? []) yield zone.id
  for (const signal of project.signals ?? []) yield signal.id
  for (const station of project.stations ?? []) yield station.id
  for (const train of project.trains ?? []) {
    yield train.id
    for (const vehicle of train.vehicles) yield vehicle.id
  }
}

/** The highest number among the ids of a project */
export function highestIdNumber(project: SerializedProject): number {
  let max = 0
  for (const id of ownIds(project)) max = Math.max(max, idNumber(id))
  return max
}

/** The key of some section settings (rail ids in order, joined by '-') with every rail renamed; null when one is unknown */
function renamedKey(key: string, rename: (id: string) => string | undefined): string | null {
  const ids: string[] = []
  for (const id of key.split('-')) {
    const next = rename(id)
    if (next === undefined) return null
    if (!ids.includes(next)) ids.push(next)
  }
  return ids.sort().join('-')
}

/**
 * The same project under ids numbered from `firstFree` up, prefixes kept (`s_3` → `s_812`). Every
 * reference follows; one that names something the file does not hold (a route table cut from a
 * larger project still names the rails of its other half) is left out, as the editor would on
 * loading: kept, it could come to name something of the project this one is added to. The computed
 * sections are not carried: they are worked out again.
 */
export function renumberProject(project: SerializedProject, firstFree: number): SerializedProject {
  const ids = new Map<string, string>()
  let next = firstFree
  for (const id of ownIds(project)) {
    if (ids.has(id)) continue
    const at = id.lastIndexOf('_')
    ids.set(id, `${idNumber(id) > 0 ? id.slice(0, at) : id}_${next++}`)
  }
  const id = (old: string): string => ids.get(old) ?? old
  const known = (old: string | undefined): string | undefined => (old === undefined ? undefined : ids.get(old))
  const rails = new Set(project.segments.map((seg) => seg.id))
  const nodes = new Set(project.nodes.map((node) => node.id))

  const segments = project.segments.filter((seg) => nodes.has(seg.from) && nodes.has(seg.to)).map((seg) => ({ ...seg, id: id(seg.id), from: id(seg.from), to: id(seg.to) }))
  const junctions = (project.junctions ?? [])
    .filter((junction) => nodes.has(junction.nodeId))
    .map((junction) => renumberJunction(junction, id, known, rails))
  const speedZones = (project.speedZones ?? [])
    .map((zone) => ({ ...zone, id: id(zone.id), spans: zone.spans.filter((span) => rails.has(span.segId)).map((span) => ({ ...span, segId: id(span.segId) })) }))
    .filter((zone) => zone.spans.length > 0)
  const signals = (project.signals ?? []).filter((signal) => rails.has(signal.segId)).map((signal) => ({ ...signal, id: id(signal.id), segId: id(signal.segId) }))
  const stations = (project.stations ?? []).map((station) => ({
    ...station,
    id: id(station.id),
    stops: station.stops.filter((stop) => rails.has(stop.segId)).map((stop) => ({ ...stop, segId: id(stop.segId) })),
  }))
  const trains = (project.trains ?? [])
    .filter((train) => train.vehicles.every((v) => rails.has(v.front.segId) && rails.has(v.rear.segId)))
    .map((train) => ({
      ...train,
      id: id(train.id),
      vehicles: train.vehicles.map((v) => ({ ...v, id: id(v.id), front: { ...v.front, segId: id(v.front.segId) }, rear: { ...v.rear, segId: id(v.rear.segId) } })),
    }))
  let sectionMeta: Record<string, unknown> | undefined
  if (project.sectionMeta) {
    sectionMeta = {}
    for (const key in project.sectionMeta) {
      const renamed = renamedKey(key, (old) => (rails.has(old) ? ids.get(old) : undefined))
      if (renamed !== null) sectionMeta[renamed] = project.sectionMeta[key]
    }
  }
  return withoutUndefined({
    ...project,
    nodes: project.nodes.map((node) => ({ ...node, id: id(node.id) })),
    segments,
    junctions: junctions.length > 0 ? junctions : undefined,
    speedZones: speedZones.length > 0 ? speedZones : undefined,
    signals: signals.length > 0 ? signals : undefined,
    stations: stations.length > 0 ? stations : undefined,
    trains: trains.length > 0 ? trains : undefined,
    sectionMeta: sectionMeta && Object.keys(sectionMeta).length > 0 ? sectionMeta : undefined,
    sections: undefined,
  })
}

function renumberJunction(
  junction: SerializedJunction,
  id: (old: string) => string,
  known: (old: string | undefined) => string | undefined,
  rails: ReadonlySet<string>,
): SerializedJunction {
  const next: SerializedJunction = { ...junction, id: id(junction.id), nodeId: id(junction.nodeId) }
  if (junction.passages) {
    // A passage through a rail the file does not hold goes, and the positions that opened it forget it
    const kept: number[] = []
    next.passages = []
    junction.passages.forEach(([a, b], i) => {
      if (!rails.has(a) || !rails.has(b)) return
      kept[i] = next.passages!.length
      next.passages!.push([id(a), id(b)])
    })
    if (junction.positions) next.positions = junction.positions.map((position) => position.filter((i) => kept[i] !== undefined).map((i) => kept[i]))
  }
  // Version 1: a turnout by its parts
  for (const field of ['stemNodeId', 'straightNodeId', 'divergingNodeId', 'divergingRightNodeId', 'straightSegmentId', 'divergingSegmentId', 'divergingRightSegmentId'] as const) {
    if (junction[field] === undefined) continue
    const renamed = known(junction[field])
    if (renamed === undefined) delete next[field]
    else next[field] = renamed
  }
  return next
}

/** A rail of the incoming project that is a rail of the current one, and which way round */
interface Survivor {
  id: string
  /** The incoming rail ran from the survivor's `to` to its `from` */
  flipped: boolean
}

/** The length of a saved rail, near enough to tell one metre along it */
function railLength(seg: SerializedSegment, nodes: ReadonlyMap<string, SerializedNode>): number {
  if (seg.kind === 'path' && seg.path) return seg.path.reduce((sum, piece) => sum + (piece[4] ?? 0), 0)
  const a = nodes.get(seg.from)
  const b = nodes.get(seg.to)
  if (!a || !b) return 0
  if (seg.kind === 'curve' && seg.via) return (Math.hypot(seg.via.x - a.x, seg.via.y - a.y) + Math.hypot(b.x - seg.via.x, b.y - seg.via.y) + Math.hypot(b.x - a.x, b.y - a.y)) / 2
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** The middle of a saved long rail, null when its path cannot be read */
function pathMiddle(seg: SerializedSegment): { x: number; y: number; length: number } | null {
  if (!seg.path || seg.path.length === 0) return null
  const pieces = seg.path.map(([x, y, heading, curvature, length]) => ({ x, y, heading, curvature, length }))
  if (pieces.some((p) => ![p.x, p.y, p.heading, p.curvature, p.length].every(Number.isFinite))) return null
  const path = pathOf(pieces)
  const middle = pathAt(path, path.length / 2)
  return { x: middle.x, y: middle.y, length: path.length }
}

/** True when two saved rails between the same two nodes are one rail drawn twice */
function sameRail(a: SerializedSegment, b: SerializedSegment, nodes: ReadonlyMap<string, SerializedNode>, tolerance: number): boolean {
  const kindOf = (seg: SerializedSegment): string => (seg.kind === 'path' && seg.path ? 'path' : seg.kind === 'curve' && seg.via ? 'curve' : 'straight')
  const kind = kindOf(a)
  if (kind !== kindOf(b)) return false
  if (kind === 'straight') return true
  if (kind === 'curve') {
    const from = nodes.get(a.from)
    const to = nodes.get(a.to)
    if (!from || !to) return false
    // The rule of `removeDuplicateSegments`: a loose tolerance must not melt two different curves
    const viaTolerance = Math.min(2 * tolerance, 0.01 * Math.hypot(to.x - from.x, to.y - from.y))
    return Math.hypot(a.via!.x - b.via!.x, a.via!.y - b.via!.y) <= viaTolerance
  }
  const ma = pathMiddle(a)
  const mb = pathMiddle(b)
  if (!ma || !mb) return false
  if (Math.abs(ma.length - mb.length) > 0.01 * Math.max(ma.length, mb.length)) return false
  return Math.hypot(ma.x - mb.x, ma.y - mb.y) <= 2 * tolerance
}

/** The incoming project moved by `move`: nodes, control points, the pieces of long rails, stations */
function movedProject(project: SerializedProject, move: (p: { x: number; y: number }) => { x: number; y: number }): SerializedProject {
  const point = <T extends { x: number; y: number }>(p: T): T => ({ ...p, ...move(p) })
  return {
    ...project,
    nodes: project.nodes.map(point),
    segments: project.segments.map((seg) => ({
      ...seg,
      ...(seg.via ? { via: move(seg.via) } : {}),
      ...(seg.path
        ? {
            path: seg.path.map(([x, y, heading, curvature, length]) => {
              // A piece keeps its shape; the turn and the scale between the two grids are read
              // from where a metre along it lands
              const start = move({ x, y })
              const ahead = move({ x: x + Math.cos(heading), y: y + Math.sin(heading) })
              const scale = Math.hypot(ahead.x - start.x, ahead.y - start.y) || 1
              return [start.x, start.y, Math.atan2(ahead.y - start.y, ahead.x - start.x), curvature / scale, length * scale]
            }),
          }
        : {}),
    })),
    stations: project.stations?.map(point),
  }
}

/** The nodes of a project on a grid of cells one tolerance wide, to find the one near a point */
function nodeFinder(nodes: readonly SerializedNode[], tolerance: number): (p: SerializedNode) => SerializedNode | null {
  const cell = Math.max(tolerance, 1e-6)
  const key = (cx: number, cy: number): string => `${cx}:${cy}`
  const grid = new Map<string, SerializedNode[]>()
  for (const node of nodes) {
    const k = key(Math.floor(node.x / cell), Math.floor(node.y / cell))
    const bucket = grid.get(k)
    if (bucket) bucket.push(node)
    else grid.set(k, [node])
  }
  return (p) => {
    const cx = Math.floor(p.x / cell)
    const cy = Math.floor(p.y / cell)
    let best: SerializedNode | null = null
    let bestDistance = tolerance
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const node of grid.get(key(cx + dx, cy + dy)) ?? []) {
          if (Math.abs((node.level ?? 0) - (p.level ?? 0)) > SAME_LEVEL_WITHIN) continue
          const d = Math.hypot(node.x - p.x, node.y - p.y)
          if (d <= bestDistance) {
            best = node
            bestDistance = d
          }
        }
      }
    }
    return best
  }
}

/**
 * The current project with the incoming one added to it. Neither is changed. The result is ready
 * to be loaded: every id is unique, every reference names something it holds.
 */
export function mergeProjects(current: SerializedProject, incoming: SerializedProject, options: MergeOptions): { project: SerializedProject; report: MergeReport } {
  const { tolerance } = options
  let added = renumberProject(incoming, highestIdNumber(current) + 1)

  // 1. One map
  let frame: MergeReport['frame'] = 'as-is'
  if (current.osmSource && added.osmSource) {
    frame = sameFrame(added.osmSource, current.osmSource) ? 'same' : 'reprojected'
    if (frame === 'reprojected') added = movedProject(added, reprojection(added.osmSource, current.osmSource))
  }

  // 2. An incoming node on a node of the current project is that node
  const findNode = nodeFinder(current.nodes, tolerance)
  const nodeIs = new Map<string, string>()
  const newNodes: SerializedNode[] = []
  for (const node of added.nodes) {
    const same = findNode(node)
    if (same) nodeIs.set(node.id, same.id)
    else newNodes.push(node)
  }
  const node = (id: string): string => nodeIs.get(id) ?? id
  const nodes = new Map<string, SerializedNode>()
  for (const n of current.nodes) nodes.set(n.id, n)
  for (const n of newNodes) nodes.set(n.id, n)

  // 3. An incoming rail between two such nodes that doubles a rail of the current project is that rail
  const between = new Map<string, SerializedSegment[]>()
  const pair = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  for (const seg of current.segments) {
    const k = pair(seg.from, seg.to)
    const list = between.get(k)
    if (list) list.push(seg)
    else between.set(k, [seg])
  }
  const railIs = new Map<string, Survivor>()
  /** Incoming rails whose two ends are one node of the current project: too short to be anything */
  const collapsed = new Set<string>()
  const newRails: SerializedSegment[] = []
  for (const seg of added.segments) {
    const from = node(seg.from)
    const to = node(seg.to)
    if (from === to) {
      collapsed.add(seg.id)
      continue
    }
    const moved: SerializedSegment = from === seg.from && to === seg.to ? seg : { ...seg, from, to }
    if (nodeIs.has(seg.from) && nodeIs.has(seg.to)) {
      const double = (between.get(pair(from, to)) ?? []).find((other) => sameRail(other, moved, nodes, tolerance))
      if (double) {
        railIs.set(seg.id, { id: double.id, flipped: double.from !== from })
        continue
      }
    }
    newRails.push(moved)
  }
  const segments = [...current.segments, ...newRails]
  const railsById = new Map(segments.map((seg) => [seg.id, seg]))
  const gone = (segId: string): boolean => collapsed.has(segId)
  /** A place on an incoming rail, on the rail it now is */
  const place = <T extends { segId: string; t: number }>(at: T): T => {
    const survivor = railIs.get(at.segId)
    if (!survivor) return at
    return { ...at, segId: survivor.id, t: survivor.flipped ? 1 - at.t : at.t }
  }
  const metresApart = (segId: string, t0: number, t1: number): number => {
    const seg = railsById.get(segId)
    return seg ? Math.abs(t0 - t1) * railLength(seg, nodes) : Infinity
  }

  // 4. Route tables. Where the two projects meet at a node that has a table, the table of the
  // current project stands as long as the incoming one brings no rail of its own there; when it
  // does, no saved table knows the whole of the junction: both go and the editor proposes one.
  const newRailsAt = new Map<string, number>()
  for (const seg of newRails) {
    newRailsAt.set(seg.from, (newRailsAt.get(seg.from) ?? 0) + 1)
    newRailsAt.set(seg.to, (newRailsAt.get(seg.to) ?? 0) + 1)
  }
  const rail = (segId: string): string => railIs.get(segId)?.id ?? segId
  const incomingTables = (added.junctions ?? []).map((junction) => mergedJunction(junction, node, rail, gone))
  const mergedNodes = new Set(nodeIs.values())
  const meets = (nodeId: string): boolean => mergedNodes.has(nodeId) && newRailsAt.has(nodeId)
  const currentTableAt = new Set((current.junctions ?? []).map((junction) => junction.nodeId))
  let junctionsDropped = 0
  let junctionsRebuilt = 0
  const junctions: SerializedJunction[] = []
  for (const junction of current.junctions ?? []) {
    if (meets(junction.nodeId)) junctionsRebuilt++
    else junctions.push(junction)
  }
  for (const junction of incomingTables) {
    if (meets(junction.nodeId)) junctionsRebuilt++
    else if (currentTableAt.has(junction.nodeId)) junctionsDropped++
    else junctions.push(junction)
  }

  // 5. Signals: one that came with a doubled rail and stands where the current project has one is left out
  const signals: SerializedSignal[] = [...(current.signals ?? [])]
  let signalsAdded = 0
  for (const raw of added.signals ?? []) {
    if (gone(raw.segId)) continue
    const survivor = railIs.get(raw.segId)
    const signal = survivor ? { ...place(raw), forward: survivor.flipped ? !raw.forward : raw.forward } : raw
    if (survivor && (current.signals ?? []).some((s) => s.segId === signal.segId && s.forward === signal.forward && metresApart(s.segId, s.t, signal.t) < SAME_PLACE_WITHIN)) continue
    signals.push(signal)
    signalsAdded++
  }

  // 6. Speed zones: one that came with a doubled rail the current project already limits is left out
  const limited = new Set<string>()
  for (const zone of current.speedZones ?? []) for (const span of zone.spans) limited.add(span.segId)
  const speedZones: SerializedSpeedZone[] = [...(current.speedZones ?? [])]
  let zonesAdded = 0
  for (const zone of added.speedZones ?? []) {
    const spans = zone.spans.filter((span) => !gone(span.segId))
    if (spans.length === 0) continue
    if (spans.some((span) => railIs.has(span.segId) && limited.has(rail(span.segId)))) continue
    speedZones.push({
      ...zone,
      spans: spans.map((span) => {
        const survivor = railIs.get(span.segId)
        if (!survivor) return span
        return survivor.flipped ? { ...span, segId: survivor.id, t0: 1 - span.t0, t1: 1 - span.t1 } : { ...span, segId: survivor.id }
      }),
    })
    zonesAdded++
  }

  // 7. Stations: the same code, or the same name close by, is the same station
  const stations: SerializedStation[] = (current.stations ?? []).map((station) => ({ ...station, stops: [...station.stops] }))
  let stationsAdded = 0
  let stationsMerged = 0
  for (const raw of added.stations ?? []) {
    const stops = raw.stops.filter((stop) => !gone(stop.segId)).map(place)
    const code = uicKey(raw.uic)
    const name = normalizedName(raw.name)
    const same =
      (code !== undefined ? stations.find((s) => uicKey(s.uic) === code) : undefined) ??
      stations.find((s) => normalizedName(s.name) === name && Math.hypot(s.x - raw.x, s.y - raw.y) <= SAME_STATION_WITHIN)
    if (!same) {
      stations.push({ ...raw, stops })
      stationsAdded++
      continue
    }
    stationsMerged++
    for (const stop of stops) {
      if (!same.stops.some((s) => s.segId === stop.segId && metresApart(s.segId, s.t, stop.t) < SAME_PLACE_WITHIN)) same.stops.push(stop)
    }
  }

  // 8. Trains come along, standing where they stood
  const trains = [...(current.trains ?? [])]
  let trainsAdded = 0
  for (const train of added.trains ?? []) {
    if (train.vehicles.some((v) => gone(v.front.segId) || gone(v.rear.segId))) continue
    const stand = <T extends { segId: string; t: number; forward: boolean }>(at: T): T => {
      const survivor = railIs.get(at.segId)
      return survivor ? { ...place(at), forward: survivor.flipped ? !at.forward : at.forward } : at
    }
    trains.push({ ...train, vehicles: train.vehicles.map((v) => ({ ...v, front: stand(v.front), rear: stand(v.rear) })) })
    trainsAdded++
  }

  // 9. Section settings: the key follows its rails; the current project's settings win
  const sectionMeta: Record<string, unknown> = {}
  for (const key in added.sectionMeta ?? {}) {
    const renamed = renamedKey(key, (id) => (gone(id) ? undefined : rail(id)))
    if (renamed !== null) sectionMeta[renamed] = added.sectionMeta![key]
  }
  Object.assign(sectionMeta, current.sectionMeta)

  let addedBox: MergeReport['addedBox'] = null
  for (const n of newNodes) {
    if (!addedBox) addedBox = { minX: n.x, minY: n.y, maxX: n.x, maxY: n.y }
    else {
      addedBox.minX = Math.min(addedBox.minX, n.x)
      addedBox.minY = Math.min(addedBox.minY, n.y)
      addedBox.maxX = Math.max(addedBox.maxX, n.x)
      addedBox.maxY = Math.max(addedBox.maxY, n.y)
    }
  }

  const project = withoutUndefined({
    ...current,
    version: (added.version > current.version ? added.version : current.version) as SerializedProject['version'],
    nodes: [...current.nodes, ...newNodes],
    segments,
    junctions: junctions.length > 0 ? junctions : undefined,
    speedZones: speedZones.length > 0 ? speedZones : undefined,
    signals: signals.length > 0 ? signals : undefined,
    stations: stations.length > 0 ? stations : undefined,
    trains: trains.length > 0 ? trains : undefined,
    sectionMeta: Object.keys(sectionMeta).length > 0 ? sectionMeta : undefined,
    sections: undefined,
    // An empty project takes the place on the globe of the one it receives
    osmSource: current.osmSource ?? (current.nodes.length === 0 ? added.osmSource : undefined),
  })
  const report: MergeReport = {
    nodesAdded: newNodes.length,
    railsAdded: newRails.length,
    nodesMerged: nodeIs.size,
    railsDropped: railIs.size + collapsed.size,
    stationsAdded,
    stationsMerged,
    junctionsDropped,
    junctionsRebuilt,
    signalsAdded,
    zonesAdded,
    trainsAdded,
    frame,
    gaugeDiffers: current.gauge !== undefined && added.gauge !== undefined && Math.abs(current.gauge - added.gauge) > 1e-9,
    addedBox,
  }
  return { project, report }
}

/** An incoming route table on the nodes and rails of the merged project */
function mergedJunction(junction: SerializedJunction, node: (id: string) => string, rail: (id: string) => string, gone: (id: string) => boolean): SerializedJunction {
  const next: SerializedJunction = { ...junction, nodeId: node(junction.nodeId) }
  if (junction.passages) {
    const kept: number[] = []
    next.passages = []
    junction.passages.forEach(([a, b], i) => {
      if (gone(a) || gone(b)) return
      kept[i] = next.passages!.length
      next.passages!.push([rail(a), rail(b)])
    })
    if (junction.positions) next.positions = junction.positions.map((position) => position.filter((i) => kept[i] !== undefined).map((i) => kept[i]))
  }
  for (const field of ['stemNodeId', 'straightNodeId', 'divergingNodeId', 'divergingRightNodeId'] as const) if (junction[field] !== undefined) next[field] = node(junction[field])
  for (const field of ['straightSegmentId', 'divergingSegmentId', 'divergingRightSegmentId'] as const) if (junction[field] !== undefined) next[field] = rail(junction[field])
  return next
}

/** The same object without its `undefined` fields: written as JSON it would lose them anyway, compared it must not keep them */
function withoutUndefined(project: SerializedProject): SerializedProject {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(project)) if (value !== undefined) clean[key] = value
  return clean as unknown as SerializedProject
}
