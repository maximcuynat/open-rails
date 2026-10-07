import { generateId } from './ids'
import { touchNetwork } from './networkWatch'
import type { Network, Point, Station, StationId, StationStop } from './types'
import { remapTrackPosition, TRACK_T_EPSILON, type RailReplacement } from './trackObjects'

// ─────────────────── Stations ───────────────────
//
// A station lives in `Network.stations`. Its stops name the rails trains stop at, so `replaceRail`
// keeps them in place whenever a rail is cut or merged and drops them with the rail, wherever the
// edit comes from. A station whose rails are all gone stays, with its name and its place.
//
// `net.stations` and the fields of a station are only changed by the functions of this file, each
// of which tells the revision of the network. Nothing edits a station in the editor yet: the
// OpenStreetMap import lays them, the canvas and the panels read them.
//
// This file must not import `network.ts` (which imports it) nor anything that does.

/** What a station is made of, its id apart: what the import hands over */
export type StationDraft = Omit<Station, 'id'> & { id?: StationId }

/** Add a station, under its own id when it brings one that is free, else a new one. Returns it as kept. */
export function addStation(net: Network, draft: StationDraft): Station {
  const station: Station = {
    id: draft.id !== undefined && !net.stations.has(draft.id) ? draft.id : generateId('st'),
    name: draft.name,
    pos: { x: draft.pos.x, y: draft.pos.y },
    stops: draft.stops.map(copyStop),
  }
  if (draft.uic !== undefined) station.uic = draft.uic
  if (draft.code !== undefined) station.code = draft.code
  net.stations.set(station.id, station)
  return station
}

/** Remove a station. False when there is no such station. */
export function removeStation(net: Network, id: StationId): boolean {
  return net.stations.delete(id)
}

/** Name and codes of a station; a field left out is kept, `undefined` clears it. False when there is no such station. */
export function setStationIdentity(net: Network, id: StationId, identity: { name?: string; uic?: string; code?: string }): boolean {
  const station = net.stations.get(id)
  if (!station) return false
  if ('name' in identity && identity.name !== undefined) station.name = identity.name
  for (const key of ['uic', 'code'] as const) {
    if (!(key in identity)) continue
    if (identity[key] === undefined) delete station[key]
    else station[key] = identity[key]
  }
  touchNetwork(net, null)
  return true
}

/** The station whose place is nearest to `p`, within `tolerance` metres, if any */
export function stationAt(net: Network, p: Point, tolerance: number): Station | null {
  let best: Station | null = null
  let bestDistance = tolerance
  for (const station of net.stations.values()) {
    const d = Math.hypot(station.pos.x - p.x, station.pos.y - p.y)
    if (d <= bestDistance) {
      best = station
      bestDistance = d
    }
  }
  return best
}

// ─────────────────── Saves and track edits ───────────────────

/** A station as a save holds it; anything may be missing or wrong in a file */
export interface StoredStation {
  id?: unknown
  name?: unknown
  x?: unknown
  y?: unknown
  uic?: unknown
  code?: unknown
  stops?: unknown
}

/**
 * Put back a station read from a save, under its own id and with the stops as written. Nothing is
 * checked against the track here (`cleanStations` drops the stops that are not on it once every
 * rail is back). Returns false, and adds nothing, when the record does not hold together or the id
 * is taken; a stop that does not hold together is left out.
 */
export function restoreStation(net: Network, raw: StoredStation | null | undefined): boolean {
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || net.stations.has(raw.id)) return false
  if (!isFinite(raw.x) || !isFinite(raw.y)) return false
  const stops: StationStop[] = []
  if (Array.isArray(raw.stops)) {
    for (const item of raw.stops as unknown[]) {
      const stop = storedStop(item)
      if (stop) stops.push(stop)
    }
  }
  const station: Station = { id: raw.id, name: raw.name, pos: { x: raw.x, y: raw.y }, stops }
  if (typeof raw.uic === 'string' && raw.uic !== '') station.uic = raw.uic
  if (typeof raw.code === 'string' && raw.code !== '') station.code = raw.code
  net.stations.set(station.id, station)
  return true
}

/**
 * Bring the stations in line with the track: a stop on a rail that is gone, or out of 0…1, is
 * removed; the station stays. Returns true when anything changed.
 */
export function cleanStations(net: Network): boolean {
  if (net.stations.size === 0) return false
  let changed = false
  for (const station of net.stations.values()) {
    const kept = station.stops.filter((stop) => net.segments.has(stop.segId) && stop.t >= -TRACK_T_EPSILON && stop.t <= 1 + TRACK_T_EPSILON)
    if (kept.length === station.stops.length) continue
    station.stops = kept
    changed = true
  }
  if (changed) touchNetwork(net, null)
  return changed
}

/**
 * Move the stops off a replaced rail and onto its pieces (called by `replaceRail`): each one stays
 * at the same place of the world. A stop whose rail is removed goes with it; the station stays.
 */
export function remapStations(net: Network, replacement: RailReplacement): void {
  if (net.stations.size === 0) return
  let changed = false
  for (const station of net.stations.values()) {
    if (!station.stops.some((stop) => stop.segId === replacement.oldId)) continue
    const moved: StationStop[] = []
    for (const stop of station.stops) {
      if (stop.segId !== replacement.oldId) {
        moved.push(stop)
        continue
      }
      const place = remapTrackPosition({ segId: stop.segId, t: stop.t, forward: true }, replacement)
      if (place) moved.push(stop.ref !== undefined ? { segId: place.segId, t: place.t, ref: stop.ref } : { segId: place.segId, t: place.t })
    }
    station.stops = moved
    changed = true
  }
  if (changed) touchNetwork(net, null)
}

function copyStop(stop: StationStop): StationStop {
  return stop.ref !== undefined ? { segId: stop.segId, t: stop.t, ref: stop.ref } : { segId: stop.segId, t: stop.t }
}

function storedStop(raw: unknown): StationStop | null {
  if (!raw || typeof raw !== 'object') return null
  const { segId, t, ref } = raw as Record<string, unknown>
  if (typeof segId !== 'string' || !isFinite(t)) return null
  return typeof ref === 'string' && ref !== '' ? { segId, t, ref } : { segId, t }
}

function isFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
