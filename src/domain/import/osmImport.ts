import type { NodeId, Point } from '../models/types'
import type { OsmImportIssue, OsmImportOptions, OsmImportReport, OsmImportResult, OsmSurvey, OverpassResponse } from './osmTypes'
import { throughTracksAtNode } from '../models/crossing'
import { findJunctionAtNode, syncJunctions } from '../models/junction'
import { generateId, resetIdCounter, segmentBand, syncIdCounter } from '../models/network'
import { segmentShapeLength } from '../geometry/segmentGeometry'
import { analyzeKinematics } from '../services/kinematicDiagnostics'
import { isExtraKind, readOsm, type OsmRead, type OsmTrack } from './osmRead'
import { LAMBERT93_ORIGIN, projectionFor, type OsmFrame } from './osmProjection'
import { createTrackPlacer } from './osmPlace'
import { countStations, layStations } from './osmStations'
import { buildChains, buildGraph, chainEnds, components, restrictGraph, type Chain, type TrackGraph } from './osmGraph'
import { findChainCrossings, type ChainCrossing } from './osmCrossings'
import { planLevels, separateStructures, trackAt } from './osmLevels'
import { settleNodeTangents, sideBySideReach } from './osmJunctions'
import { DEFAULT_FIT_TOLERANCE } from './osmFit'
import { buildNetwork, isLaidAsOnePiece, laySpeedZones, type BuiltNetwork } from './osmBuild'
import { checkNetwork, settleContacts, type Contact } from './osmCheck'
import { distance } from './osmArcs'
import { importLine, isUsableSignal, laySignals } from './osmSignals'

/** How many times the chains found crossing or touching each other are fitted again, closer to their nodes */
const MAX_REFITS = 3
/** Each time, their tolerance is divided by this */
const REFIT_RATIO = 3
/** Two tracks cross in the OSM data when a crossing of theirs lies within this (m) of the place */
const SAME_CROSSING_DISTANCE = 20
/** Coefficients of the estimate of the number of rails (`surveyOsm`) */
const RAILS_PER_CHAIN = 2.7
const RAILS_PER_KM = 2
const RAILS_PER_TURN = 2.8
const RAILS_PER_LEVEL_CHANGE = 1.9
/** How many times the contacts left are settled the way the editor would, each time changing the track */
const MAX_SETTLE_PASSES = 20

/** The frame of an import and its projection: the national one when asked for, else centred on the data */
function frameOf(read: OsmRead, options: OsmImportOptions): { frame: OsmFrame; origin: { lat: number; lon: number }; project: (lat: number, lon: number) => Point } {
  const frame: OsmFrame = options.frame ?? 'local'
  const origin = frame === 'lambert93' ? LAMBERT93_ORIGIN : centreOf(read)
  return { frame, origin, project: projectionFor(frame, origin) }
}

/** Centre of the tracks kept: the origin of the local projection */
function centreOf(read: OsmRead): { lat: number; lon: number } {
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  const tracks = read.tracks.length > 0 ? read.tracks : read.allTracks
  for (const track of tracks) {
    for (const id of track.nodes) {
      const node = read.nodes.get(id)!
      south = Math.min(south, node.lat)
      north = Math.max(north, node.lat)
      west = Math.min(west, node.lon)
      east = Math.max(east, node.lon)
    }
  }
  if (!Number.isFinite(south)) return { lat: 0, lon: 0 }
  return { lat: (south + north) / 2, lon: (west + east) / 2 }
}

/**
 * The box every way of the answer reaches into, in degrees. Overpass returns each way whole as soon
 * as it touches the area asked for, so a track that stops outside this box stops where the answer
 * does, not where the track does.
 */
function innerBox(data: OverpassResponse, read: OsmRead): { south: number; north: number; west: number; east: number } {
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const element of data?.elements ?? []) {
    if (element?.type !== 'way' || !Array.isArray(element.nodes)) continue
    let minLat = Infinity
    let maxLat = -Infinity
    let minLon = Infinity
    let maxLon = -Infinity
    for (const id of element.nodes) {
      const node = read.nodes.get(id)
      if (!node) continue
      minLat = Math.min(minLat, node.lat)
      maxLat = Math.max(maxLat, node.lat)
      minLon = Math.min(minLon, node.lon)
      maxLon = Math.max(maxLon, node.lon)
    }
    if (!Number.isFinite(minLat)) continue
    south = Math.min(south, maxLat)
    north = Math.max(north, minLat)
    west = Math.min(west, maxLon)
    east = Math.max(east, minLon)
  }
  return { south, north, west, east }
}

/** The graph of the tracks the options keep, without the parts that do not touch the main network */
function mainNetwork(read: OsmRead, options: OsmImportOptions, project: (lat: number, lon: number) => Point): { graph: TrackGraph; dropped: number; droppedLength: number } {
  const whole = buildGraph(read, project)
  const keep = new Set<number>()
  let dropped = 0
  let droppedLength = 0
  components(whole).forEach((part, i) => {
    const detached = options.keepDetachedOverKm
    if (i === 0 || (detached !== undefined && part.length >= detached * 1000)) {
      for (const id of part.nodes) keep.add(id)
    } else {
      dropped++
      droppedLength += part.length
    }
  })
  return { graph: restrictGraph(whole, keep), dropped, droppedLength }
}

/**
 * Counts what an Overpass answer holds under these options, without building anything: the tracks
 * the conversion would lay, so without the parts that do not touch the main network.
 */
export function surveyOsm(data: OverpassResponse, options: OsmImportOptions): OsmSurvey {
  const read = readOsm(data, options)
  const { graph, droppedLength } = mainNetwork(read, options, frameOf(read, options).project)
  const survey: OsmSurvey = {
    ways: 0,
    lengthKm: 0,
    serviceWays: 0,
    switches: 0,
    bridges: 0,
    tunnels: 0,
    extraKinds: {},
    signals: 0,
    typedMainSignals: 0,
    usableSignals: 0,
    stations: countStations(read),
    estimatedRails: 0,
    detachedKm: droppedLength / 1000,
  }

  const counted = new Set<number>()
  for (const track of read.allTracks) {
    if (counted.has(track.id)) continue
    counted.add(track.id)
    if (isExtraKind(track.kind)) survey.extraKinds[track.kind] = (survey.extraKinds[track.kind] ?? 0) + 1
  }

  const ways = new Set<OsmTrack>()
  for (const edge of graph.edges) {
    survey.lengthKm += edge.length / 1000
    ways.add(edge.track)
  }
  const ids = new Set<number>()
  for (const track of ways) {
    if (ids.has(track.id)) continue
    ids.add(track.id)
    survey.ways++
    if (track.service) survey.serviceWays++
    if (track.tags.bridge !== undefined && track.tags.bridge !== 'no') survey.bridges++
    if (track.tags.tunnel !== undefined && track.tags.tunnel !== 'no') survey.tunnels++
  }
  for (const id of graph.at.keys()) {
    const tags = graph.nodes.get(id)?.tags
    if (tags?.railway === 'switch') survey.switches++
    if (tags?.railway === 'signal') {
      survey.signals++
      const direction = tags['railway:signal:direction']
      if (tags['railway:signal:main']?.startsWith('FR:') && (direction === 'forward' || direction === 'backward')) survey.typedMainSignals++
      if (isUsableSignal(tags)) survey.usableSignals = (survey.usableSignals ?? 0) + 1
    }
  }

  // ESTIMATED on the four sample areas, each under several sets of options (within 15 % of what
  // was laid): rails for each run of track between two turnouts, for the length, for every 15° the
  // track turns, and for every place where it changes level
  const chains = buildChains(graph)
  let turn = 0
  let levelChanges = 0
  for (const chain of chains) {
    for (let k = 1; k + 1 < chain.pts.length; k++) {
      const before = Math.atan2(chain.pts[k].y - chain.pts[k - 1].y, chain.pts[k].x - chain.pts[k - 1].x)
      const after = Math.atan2(chain.pts[k + 1].y - chain.pts[k].y, chain.pts[k + 1].x - chain.pts[k].x)
      const delta = Math.abs(after - before)
      turn += delta > Math.PI ? 2 * Math.PI - delta : delta
    }
    for (let k = 1; k < chain.edges.length; k++) if (chain.edges[k].track.level.level !== chain.edges[k - 1].track.level.level) levelChanges++
  }
  survey.estimatedRails = Math.round(
    RAILS_PER_CHAIN * chains.length + RAILS_PER_KM * survey.lengthKm + (RAILS_PER_TURN * turn) / ((15 * Math.PI) / 180) + RAILS_PER_LEVEL_CHANGE * levelChanges,
  )
  return survey
}

/** The network laid from the chains, with what was found crossing or touching in it */
interface Attempt {
  built: BuiltNetwork
  stacked: number
  contacts: Contact[]
}

/** Converts an Overpass answer into a network ready to be loaded as it is. */
export function convertOsm(data: OverpassResponse, options: OsmImportOptions): OsmImportResult {
  const read = readOsm(data, options)
  const { frame, origin, project } = frameOf(read, options)

  // Only the main network is kept: what does not touch it is counted and left out
  const { graph, dropped } = mainNetwork(read, options, project)

  const chains = buildChains(graph)
  const ends = chainEnds(chains)
  const crossings = findChainCrossings(chains)
  separateStructures(chains, crossings)
  const reach = sideBySideReach(chains, ends)
  const plan = planLevels(graph, chains, crossings, reach)
  const tangents = settleNodeTangents(graph, chains, ends, (chain, slips) => isLaidAsOnePiece(chain, slips, reach))

  // The id counter of the domain is put back before each attempt: only the network kept takes ids
  const firstId = lastIdTaken()
  const tolerances = chains.map(() => DEFAULT_FIT_TOLERANCE)
  const attempt = (): Attempt => {
    resetIdCounter(firstId)
    const built = buildNetwork(graph, chains, tangents, plan, reach, tolerances)
    return { built, ...checkNetwork(built.network) }
  }
  let current = attempt()
  for (let round = 0; round < MAX_REFITS; round++) {
    // Tracks that cross or touch where the OSM data keeps them apart were brought together by the
    // fitting: their chains are laid again, closer to their nodes
    const tighter = new Set<Chain>()
    for (const contact of current.contacts) {
      for (const chain of contactChains(current.built, contact)) {
        if (!isOsmCrossing(crossings, contact, current.built)) tighter.add(chain)
      }
    }
    if (tighter.size === 0) break
    for (const chain of tighter) tolerances[chain.index] /= REFIT_RATIO
    const next = attempt()
    // No better: what was there is kept
    if (next.contacts.length >= current.contacts.length) break
    current = next
  }

  const { built } = current
  const net = built.network
  // The last attempt may not be the one kept: ids go on from the ones this network holds, and
  // never from below where they were (an empty network holds none)
  syncIdCounter(net)
  if (lastIdTaken() < firstId) resetIdCounter(firstId)
  if (options.speedLimits) laySpeedZones(built, chains, tangents, options)
  const issues: OsmImportIssue[] = []
  /** The OSM way a rail was laid from; a rail cut since then answers for the one it was cut from */
  const wayOf = (segId: string): number[] => {
    const laid = net.segments.get(segId)?.parentSegmentId ?? segId
    const chain = built.railChain.get(laid)
    const rail = chain && built.chainRails[chain.index].find((r) => r.segId === laid)
    if (!chain || !rail) return []
    return [trackAt(chain, (rail.s0 + rail.s1) / 2).id]
  }

  // What is left is settled the way the editor would at the first opening, and said
  let undecided = 0
  let contacts = current.contacts
  for (let pass = 0; pass < MAX_SETTLE_PASSES && contacts.length > 0; pass++) {
    const fromOsm = new Map(contacts.map((contact) => [contact, isOsmCrossing(crossings, contact, built)]))
    const ways = new Map(contacts.map((contact) => [contact, contact.kind === 'cross' ? [...wayOf(contact.segA), ...wayOf(contact.segB)] : []]))
    const settled = settleContacts(net, contacts)
    for (const contact of settled) {
      if (contact.kind !== 'cross') continue
      undecided++
      issues.push({
        kind: 'undecided-crossing',
        x: contact.point.x,
        y: contact.point.y,
        osmIds: ways.get(contact)!,
        detail: fromOsm.get(contact)
          ? 'Deux voies se croisent au même niveau sans nœud commun : laissées en traversée à niveau.'
          : 'Deux voies voisines se touchent une fois tracées : laissées en traversée à niveau.',
      })
    }
    if (settled.length === 0) break
    contacts = checkNetwork(net).contacts
  }

  // From here on no rail changes: the signals and the stations only add to the network
  let wayOfRail: Map<string, number> | undefined
  if (options.traceWays) {
    wayOfRail = new Map()
    for (const segId of net.segments.keys()) {
      const [way] = wayOf(segId)
      if (way !== undefined) wayOfRail.set(segId, way)
    }
  }

  const junctions = syncJunctions(net)
  const report: OsmImportReport = {
    nodes: net.nodes.size,
    rails: net.segments.size,
    lengthKm: 0,
    turnouts: junctions.filter((junction) => junction.kind === 'turnout' || junction.kind === 'three_way').length,
    doubleSlips: junctions.filter((junction) => junction.kind === 'double_slip').length,
    fixedCrossings: 0,
    railsOnBridge: 0,
    railsInTunnel: 0,
    stackedCrossings: current.stacked,
    undecidedCrossings: undecided,
    speedZones: net.speedZones.size,
    lengthWithoutSpeedKm: 0,
    droppedComponents: dropped,
    issues,
  }
  for (const seg of net.segments.values()) {
    report.lengthKm += segmentShapeLength(net, seg) / 1000
    const band = segmentBand(net, seg)
    if (band > 0) report.railsOnBridge++
    else if (band < 0) report.railsInTunnel++
  }
  for (const edge of graph.edges) {
    if (!edge.track.service && edge.track.speed === null) report.lengthWithoutSpeedKm += edge.length / 1000
  }

  noteLevelIssues(issues, graph, plan.ambiguous)
  noteDeviceIssues(issues, report, built, graph)
  noteTrackEnds(issues, data, read, graph, built)

  let lineSpeed: number | undefined
  let highSpeed = false
  for (const edge of graph.edges) {
    if (edge.track.highSpeed) highSpeed = true
    if (options.speedLimits && edge.track.speed !== null && (lineSpeed === undefined || edge.track.speed > lineSpeed)) lineSpeed = edge.track.speed
  }

  // The signals and the stations come last, on the track as it is handed over: they change
  // neither nodes nor rails
  const placer = createTrackPlacer(net, chains, built)
  const signals = laySignals({
    net,
    read,
    graph,
    built,
    project,
    placer,
    mode: options.signals ?? 'generated',
    line: importLine(lineSpeed, highSpeed),
  })
  report.signals = signals.report
  issues.push(...signals.issues)
  if (options.stations !== false) {
    const stations = layStations({ net, read, graph, project, placer })
    report.stations = stations.report
    issues.push(...stations.issues)
  }

  const result: OsmImportResult = { network: net, highSpeed, origin, frame, report }
  if (lineSpeed !== undefined) result.lineSpeed = lineSpeed
  if (wayOfRail) result.wayOfRail = wayOfRail
  const dataDate = data?.osm3s?.timestamp_osm_base
  if (typeof dataDate === 'string') result.dataDate = dataDate
  return result
}

/** The number of the last id the domain gave out. Reading it takes one, which is given back. */
function lastIdTaken(): number {
  const last = parseInt(generateId('n').split('_')[1], 10) - 1
  resetIdCounter(last)
  return last
}

/** The chains whose rails a contact involves */
function contactChains(built: BuiltNetwork, contact: Contact): Chain[] {
  const net = built.network
  const segIds: string[] = []
  if (contact.kind === 'cross') segIds.push(contact.segA, contact.segB)
  else {
    segIds.push(...(net.adjacency.get(contact.nodeId) ?? []))
    if (contact.kind === 'split') segIds.push(contact.segId)
    else segIds.push(...(net.adjacency.get(contact.otherNodeId) ?? []))
  }
  const chains = new Set<Chain>()
  for (const segId of segIds) {
    const chain = built.railChain.get(segId)
    if (chain) chains.add(chain)
  }
  return [...chains]
}

/** True when the OSM data itself has the two tracks of a crossing cross each other there */
function isOsmCrossing(crossings: ChainCrossing[][], contact: Contact, built: BuiltNetwork): boolean {
  if (contact.kind !== 'cross') return false
  const laid = (segId: string): Chain | undefined => built.railChain.get(built.network.segments.get(segId)?.parentSegmentId ?? segId)
  const one = laid(contact.segA)
  const two = laid(contact.segB)
  if (!one || !two) return false
  return crossings[one.index].some((crossing) => crossing.other === two && distance(crossing.point, contact.point) < SAME_CROSSING_DISTANCE)
}

/** Ways whose level is a choice among several, or was out of range, and nodes whose ways disagree */
function noteLevelIssues(issues: OsmImportIssue[], graph: TrackGraph, ambiguous: number[]): void {
  const seen = new Set<OsmTrack>()
  for (const edge of graph.edges) {
    const { track } = edge
    if (seen.has(track) || !(track.level.multiple || track.level.clamped)) continue
    seen.add(track)
    const middle = graph.pos.get(track.nodes[track.nodes.length >> 1]) ?? graph.pos.get(edge.a)!
    issues.push({
      kind: 'uncertain-level',
      x: middle.x,
      y: middle.y,
      osmIds: [track.id],
      detail: track.level.multiple
        ? `Plusieurs niveaux indiqués (layer=${track.level.layer}) : niveau ${track.level.level} retenu.`
        : `Niveau hors limites (layer=${track.level.layer}) : ramené à ${track.level.level}.`,
    })
  }
  for (const id of ambiguous) {
    const pos = graph.pos.get(id)!
    const levels = [...new Set(graph.at.get(id)!.map((edge) => edge.track.level.level))].sort((a, b) => a - b)
    issues.push({
      kind: 'uncertain-level',
      x: pos.x,
      y: pos.y,
      osmIds: [id],
      detail: `Des voies de niveaux ${levels.join(', ')} se rejoignent ici.`,
    })
  }
}

/**
 * Count the fixed crossings, and note the nodes the editor makes no device of: a node OSM tags as a
 * double slip that is not read as one, four tracks or more that fit nothing, and whatever the
 * kinematic check finds (a corner no train can take, a fork without a way through).
 */
function noteDeviceIssues(issues: OsmImportIssue[], report: OsmImportReport, built: BuiltNetwork, graph: TrackGraph): void {
  const net = built.network
  const noted = new Set<NodeId>()
  const note = (nodeId: NodeId, kind: OsmImportIssue['kind'], detail: string): void => {
    const node = net.nodes.get(nodeId)
    if (!node || noted.has(nodeId)) return
    noted.add(nodeId)
    const osmId = built.osmNode.get(nodeId)
    issues.push({ kind, x: node.pos.x, y: node.pos.y, osmIds: osmId === undefined ? [] : [osmId], detail })
  }

  for (const [nodeId, rails] of net.adjacency) {
    if (rails.length < 4) continue
    const junction = findJunctionAtNode(net, nodeId)
    const osmId = built.osmNode.get(nodeId)
    const tags = osmId === undefined ? undefined : graph.nodes.get(osmId)?.tags
    const slipTagged = tags?.['railway:switch'] === 'double_slip' || tags?.['railway:switch'] === 'single_slip'
    if (junction) {
      if (slipTagged && junction.kind !== 'double_slip') note(nodeId, 'unknown-junction', 'Traversée-jonction dans OpenStreetMap, non reconnue comme telle.')
      continue
    }
    if (rails.length === 4 && throughTracksAtNode(net, nodeId)) {
      report.fixedCrossings++
      if (slipTagged) note(nodeId, 'unknown-junction', 'Traversée-jonction dans OpenStreetMap, posée en traversée fixe.')
      else if (tags?.railway === 'switch') note(nodeId, 'unknown-junction', 'Aiguillage à quatre voies dans OpenStreetMap, posé en traversée fixe.')
      continue
    }
    note(nodeId, 'unknown-junction', `${rails.length} voies se rejoignent ici sans former un appareil connu.`)
  }

  for (const found of analyzeKinematics(net)) {
    const rails = net.adjacency.get(found.nodeId)?.length ?? 0
    if (found.kind === 'track_gap') note(found.nodeId, 'sharp-angle', 'Voie interrompue : deux bouts de voie se font face sans être raccordés.')
    else if (rails >= 4) note(found.nodeId, 'unknown-junction', `${rails} voies se rejoignent ici sans former un appareil connu.`)
    else note(found.nodeId, 'sharp-angle', found.angleDeg === undefined ? 'Aucun train ne peut passer d’une voie à l’autre ici.' : `Angle de ${found.angleDeg}° : aucun train ne peut le franchir.`)
  }
}

/** Track ends that are the edge of the answer rather than the end of the track */
function noteTrackEnds(issues: OsmImportIssue[], data: OverpassResponse, read: OsmRead, graph: TrackGraph, built: BuiltNetwork): void {
  const box = innerBox(data, read)
  for (const [nodeId, id] of built.osmNode) {
    const edges = graph.at.get(id) ?? []
    const node = read.nodes.get(id)
    const pos = built.network.nodes.get(nodeId)?.pos
    if (edges.length !== 1 || !node || !pos || node.tags?.railway === 'buffer_stop') continue
    const outside = node.lat < box.south || node.lat > box.north || node.lon < box.west || node.lon > box.east
    if (!outside && !graph.cutNodes.has(id)) continue
    issues.push({ kind: 'cut-by-area', x: pos.x, y: pos.y, osmIds: [id, edges[0].track.id], detail: 'La voie continue au-delà de la zone importée.' })
  }
}
