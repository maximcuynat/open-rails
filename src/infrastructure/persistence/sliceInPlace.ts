import { raiseIdCounter } from '../../domain/models/ids'
import { findJunctionAtNode, removeJunction } from '../../domain/models/junction'
import { touchNetwork, verifyingNetworkRevisions } from '../../domain/models/networkWatch'
import { cleanSpeedZones } from '../../domain/models/speedZones'
import { cleanSignals, restoreSignal } from '../../domain/models/signals'
import { cleanStations, restoreStation } from '../../domain/models/stations'
import { restorePlatform, settlePlatforms } from '../../domain/models/platforms'
import { adoptReconciledNetwork } from '../../domain/geometry/reconcile'
import type { Junction, Network } from '../../domain/models/types'
import {
  deserializeNetwork,
  readSavedNode,
  readSavedSegment,
  restoreJunction,
  restoreZone,
  type SerializedJunction,
  type SerializedPlatform,
  type SerializedProject,
  type SerializedStation,
} from './persistence'
import { unionProjects } from './projectSlices'

// The slices of one project (the pieces of the dataset, see `projectSlices.ts`) put onto a live
// network and taken off it one at a time, instead of reading the union of everything loaded
// again: what a slice brings is added, what only it held is taken out, and the rest of the
// network is left as it is — every node, rail and table stays the object it was, so that what is
// kept from the network (sections, profile, index…) only works out again the part that changed.
//
// What stands at the border of two slices is in both (a node, its route table, a station and its
// platforms): it is put back whole from the files that hold it once the other side comes, and as
// the files left hold it when a side goes (the editor then trims it to the track it has, as it
// does when a slice is read alone). The network is then the one read anew from the union of the
// files loaded, but for the order of its maps and the positions of the points (kept as they are
// set): the tests check that on every call (`verifyingNetworkRevisions`).

/** What a file holds, by id: looked up whenever a slice comes or goes */
interface SliceCatalog {
  nodes: Set<string>
  segments: Set<string>
  junctions: Map<string, SerializedJunction>
  speedZones: Set<string>
  signals: Set<string>
  stations: Map<string, SerializedStation>
  platforms: Map<string, SerializedPlatform>
}

const catalogs = new WeakMap<SerializedProject, SliceCatalog>()

function catalogOf(project: SerializedProject): SliceCatalog {
  let catalog = catalogs.get(project)
  if (!catalog) {
    catalog = {
      nodes: new Set(project.nodes.map((n) => n.id)),
      segments: new Set(project.segments.map((s) => s.id)),
      junctions: new Map((project.junctions ?? []).map((j) => [j.id, j])),
      speedZones: new Set((project.speedZones ?? []).map((z) => z.id)),
      signals: new Set((project.signals ?? []).map((s) => s.id)),
      stations: new Map((project.stations ?? []).map((s) => [s.id, s])),
      platforms: new Map((project.platforms ?? []).map((p) => [p.id, p])),
    }
    catalogs.set(project, catalog)
  }
  return catalog
}

/** The highest number an id of the slice ends with: the ids made from now on keep clear of it */
function highestId(slice: SerializedProject): number {
  let highest = 0
  const scan = (id: unknown): void => {
    if (typeof id !== 'string') return
    const at = id.lastIndexOf('_')
    const n = Number(id.slice(at + 1))
    if (at >= 0 && Number.isInteger(n) && n > highest) highest = n
  }
  for (const list of [slice.nodes, slice.segments, slice.junctions, slice.speedZones, slice.signals, slice.stations, slice.platforms]) {
    for (const item of list ?? []) scan(item.id)
  }
  return highest
}

/** A station as the files hold it together: the first one's record, with the stops of every one (as `unionProjects` does) */
function mergedStation(id: string, files: readonly SerializedProject[]): SerializedStation | undefined {
  let merged: SerializedStation | undefined
  for (const file of files) {
    const station = catalogOf(file).stations.get(id)
    if (!station) continue
    if (!merged) {
      merged = { ...station, stops: [...station.stops] }
      continue
    }
    for (const stop of station.stops) {
      if (!merged.stops.some((s) => s.segId === stop.segId && Math.abs(s.t - stop.t) < 1e-9)) merged.stops.push(stop)
    }
  }
  return merged
}

/** The first record of an item among the files, by id */
function firstOf<T>(files: readonly SerializedProject[], pick: (catalog: SliceCatalog) => Map<string, T>, id: string): T | undefined {
  for (const file of files) {
    const item = pick(catalogOf(file)).get(id)
    if (item !== undefined) return item
  }
  return undefined
}

const passageKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Put a route table back from its record in place of the one the node has: the points stay as
 * they are set when the passage they open is still one of the table (a train may be on them).
 */
function replaceJunction(net: Network, saved: SerializedJunction | undefined, id: string, nodeId: string): void {
  const live = net.junctions.get(id) ?? findJunctionAtNode(net, nodeId)
  const open = live ? new Set((live.positions[live.active] ?? []).map((i) => live.passages[i]).filter((p) => p).map((p) => passageKey(p.a, p.b))) : null
  if (live) removeJunction(net, live.id)
  const other = findJunctionAtNode(net, nodeId)
  if (other) removeJunction(net, other.id)
  if (!saved) return
  restoreJunction(net, saved)
  const restored: Junction | undefined = net.junctions.get(saved.id)
  if (!restored || !open || open.size === 0) return
  const position = restored.positions.findIndex((position) => position.some((i) => {
    const p = restored.passages[i]
    return p !== undefined && open.has(passageKey(p.a, p.b))
  }))
  if (position >= 0 && position !== restored.active) restored.active = position
}

/** The tables, zones, signals and stations brought in line with the track, as a project read anew is */
function settle(net: Network, tolerance: number): void {
  cleanSpeedZones(net)
  cleanSignals(net)
  cleanStations(net)
  settlePlatforms(net)
  // The slices were cut from one reconciled project: nothing to mend, the tables to follow their rails
  adoptReconciledNetwork(net, tolerance)
  cleanSpeedZones(net)
  cleanSignals(net)
  cleanStations(net)
  settlePlatforms(net)
  // Tables put back in place of the ones the nodes had: they are read whole again
  touchNetwork(net, null)
}

/**
 * Put one slice onto a live network that holds the union of the other files: `loaded` is every
 * file now loaded, in their order, `slice` among them. `tolerance`: the one the project was
 * reconciled at.
 */
export function addSliceInPlace(net: Network, slice: SerializedProject, loaded: readonly SerializedProject[], tolerance: number): void {
  // 1. Nodes: those the network does not have yet
  const adjacency = new Map<string, string[]>()
  for (const n of slice.nodes) {
    if (!n || typeof n.id !== 'string' || net.nodes.has(n.id)) continue
    net.nodes.set(n.id, readSavedNode(n))
    adjacency.set(n.id, [])
  }
  // 2. Rails: those it does not have yet, onto the rails of their nodes (a node of the border gets a list anew)
  for (const s of slice.segments) {
    if (!s || typeof s.id !== 'string' || net.segments.has(s.id) || !net.nodes.has(s.from) || !net.nodes.has(s.to)) continue
    net.segments.set(s.id, readSavedSegment(s))
    for (const nodeId of [s.from, s.to]) {
      let list = adjacency.get(nodeId)
      if (!list) adjacency.set(nodeId, (list = [...(net.adjacency.get(nodeId) ?? [])]))
      list.push(s.id)
    }
  }
  for (const [nodeId, list] of adjacency) net.adjacency.set(nodeId, list)

  // 3. Tables: a node of the border has the one its other side had trimmed; it is put back whole
  for (const j of slice.junctions ?? []) {
    if (!j || typeof j.id !== 'string' || typeof j.nodeId !== 'string' || !net.nodes.has(j.nodeId)) continue
    if (!net.junctions.has(j.id) && !findJunctionAtNode(net, j.nodeId)) restoreJunction(net, j)
    else replaceJunction(net, j, j.id, j.nodeId)
  }
  // Zones and signals stand on rails, and a rail is in one file only but for doubles: added when new
  for (const z of slice.speedZones ?? []) if (z && !net.speedZones.has(z.id)) restoreZone(net, z)
  for (const signal of slice.signals ?? []) if (signal && !net.signals.has(signal.id)) restoreSignal(net, signal)
  // A station of the border gets the stops of both sides, its platforms their whole length again
  for (const station of slice.stations ?? []) {
    if (!station || typeof station.id !== 'string') continue
    net.stations.delete(station.id)
    restoreStation(net, mergedStation(station.id, loaded))
  }
  for (const platform of slice.platforms ?? []) {
    if (!platform || typeof platform.id !== 'string') continue
    net.platforms.delete(platform.id)
    restorePlatform(net, platform)
  }

  raiseIdCounter(highestId(slice))
  settle(net, tolerance)
  if (verifyingNetworkRevisions()) checkAgainstUnion(net, loaded, tolerance)
}

/**
 * Take one slice off a live network that holds the union of it and of `remaining` (the files
 * still loaded, in their order): what the files left do not hold goes, what they hold too is put
 * back as they hold it.
 */
export function removeSliceInPlace(net: Network, slice: SerializedProject, remaining: readonly SerializedProject[], tolerance: number): void {
  const held = (pick: (catalog: SliceCatalog) => { has(id: string): boolean }, id: string): boolean => remaining.some((file) => pick(catalogOf(file)).has(id))
  const goingNodes = new Set<string>()
  for (const n of slice.nodes) if (n && net.nodes.has(n.id) && !held((c) => c.nodes, n.id)) goingNodes.add(n.id)

  // 1. Tables of the nodes that go, and of the border as the files left hold them
  for (const nodeId of goingNodes) {
    const junction = findJunctionAtNode(net, nodeId)
    if (junction) removeJunction(net, junction.id)
  }
  for (const j of slice.junctions ?? []) {
    if (!j || typeof j.id !== 'string' || goingNodes.has(j.nodeId) || !net.nodes.has(j.nodeId)) continue
    replaceJunction(net, firstOf(remaining, (c) => c.junctions, j.id), j.id, j.nodeId)
  }

  // 2. Rails only this slice held, then its nodes; a node of the border keeps its other rails
  const adjacency = new Map<string, string[]>()
  for (const s of slice.segments) {
    if (!s || !net.segments.has(s.id) || held((c) => c.segments, s.id)) continue
    const seg = net.segments.get(s.id)!
    net.segments.delete(s.id)
    for (const nodeId of [seg.from, seg.to]) {
      if (goingNodes.has(nodeId)) continue
      let list = adjacency.get(nodeId)
      if (!list) adjacency.set(nodeId, (list = [...(net.adjacency.get(nodeId) ?? [])]))
      const at = list.indexOf(s.id)
      if (at >= 0) list.splice(at, 1)
    }
  }
  for (const nodeId of goingNodes) {
    net.nodes.delete(nodeId)
    net.adjacency.delete(nodeId)
  }
  for (const [nodeId, list] of adjacency) net.adjacency.set(nodeId, list)

  // 3. Zones and signals the files left do not hold; stations and platforms as they hold them
  for (const z of slice.speedZones ?? []) if (z && !held((c) => c.speedZones, z.id)) net.speedZones.delete(z.id)
  for (const signal of slice.signals ?? []) if (signal && !held((c) => c.signals, signal.id)) net.signals.delete(signal.id)
  for (const station of slice.stations ?? []) {
    if (!station || typeof station.id !== 'string') continue
    net.stations.delete(station.id)
    const kept = mergedStation(station.id, remaining)
    if (kept) restoreStation(net, kept)
  }
  for (const platform of slice.platforms ?? []) {
    if (!platform || typeof platform.id !== 'string') continue
    net.platforms.delete(platform.id)
    const kept = firstOf(remaining, (c) => c.platforms, platform.id)
    if (kept) restorePlatform(net, kept)
  }

  settle(net, tolerance)
  if (verifyingNetworkRevisions()) checkAgainstUnion(net, remaining, tolerance)
}

/**
 * Tests: the network the slices were put onto and taken off is the one read anew from the union
 * of the files loaded — the same nodes, rails, rails at each node, tables, zones, signals,
 * stations and platforms, whatever their order, the points as they may have been set.
 */
function checkAgainstUnion(net: Network, files: readonly SerializedProject[], tolerance: number): void {
  const fresh = files.length > 0 ? deserializeNetwork(unionProjects(files), tolerance).network : null
  const sorted = (rows: unknown[][]): string => JSON.stringify(rows.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0)))
  const parts = (n: Network | null): Record<string, string> => ({
    nodes: sorted(n ? [...n.nodes.values()].map((node) => [node.id, node.pos.x, node.pos.y, node.level ?? 0]) : []),
    rails: sorted(n ? [...n.segments.values()].map((seg) => [seg.id, seg.from, seg.to, seg.kind, seg.via?.x, seg.via?.y, seg.cant, seg.path]) : []),
    adjacency: sorted(n ? [...n.adjacency].map(([id, rails]) => [id, ...[...rails].sort()]) : []),
    tables: sorted(n ? [...n.junctions.values()].map((j) => [j.id, j.nodeId, j.kind, j.passages, j.positions, j.frogNumber]) : []),
    zones: sorted(n ? [...n.speedZones.values()].map((z) => [z.id, z]) : []),
    signals: sorted(n ? [...n.signals.values()].map((s) => [s.id, s]) : []),
    stations: sorted(n ? [...n.stations.values()].map((s) => [s.id, s]) : []),
    platforms: sorted(n ? [...n.platforms.values()].map((p) => [p.id, p]) : []),
  })
  const mine = parts(net)
  const theirs = parts(fresh)
  for (const part in mine) {
    if (mine[part] === theirs[part]) continue
    let at = 0
    while (mine[part][at] === theirs[part][at]) at++
    const from = Math.max(0, at - 60)
    throw new Error(`The network the slices were put onto is not the one read from their union: ${part} differ at ${at}:\n  in place: ${mine[part].slice(from, at + 120)}\n  read:     ${theirs[part].slice(from, at + 120)}`)
  }
}

/** True when the file holds that rail */
export function sliceHoldsRail(project: SerializedProject, segId: string): boolean {
  return catalogOf(project).segments.has(segId)
}
