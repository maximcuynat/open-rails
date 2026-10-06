import { generateId } from './ids'
import { touchNetwork } from './networkWatch'
import type { Network, SegmentId, SpeedZone, SpeedZoneId, TrackSpan } from './types'
import { remapTrackSpanParts, TRACK_T_EPSILON, type RailReplacement } from './trackObjects'

// ─────────────────── Speed zones ───────────────────
//
// A speed zone lives in `Network.speedZones` and names the rails it covers, so it is kept in place
// by `replaceRail` whenever a rail is cut, merged or removed, wherever the edit comes from. Its
// stretches are parameters on rails: a rail that is moved or reshaped takes its zone along.
// Zones may overlap; which one applies is not decided here.
//
// `net.speedZones` and the `spans` of a zone are only changed by the functions of this file, which
// keep the rail → zones index in step (`zone.speed` may be read at any time; set it with
// `setSpeedZoneSpeed`). Code that must write them directly calls `invalidateSpeedZones` afterwards.

/** Zone speeds are multiples of this (km/h)… */
export const SPEED_ZONE_STEP = 10
/** …and at least this (km/h) */
export const MIN_ZONE_SPEED = 10

/** True for a speed a zone can carry: a multiple of 10 km/h, at least 10. */
export function isValidZoneSpeed(speed: unknown): speed is number {
  return typeof speed === 'number' && Number.isFinite(speed) && speed >= MIN_ZONE_SPEED && speed % SPEED_ZONE_STEP === 0
}

/** The valid zone speed closest to `speed`. */
export function normalizeZoneSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return MIN_ZONE_SPEED
  return Math.max(MIN_ZONE_SPEED, Math.round(speed / SPEED_ZONE_STEP) * SPEED_ZONE_STEP)
}

/** True when the stretch lies on a rail of the network, between parameters 0 and 1. */
export function isValidTrackSpan(net: Network, span: TrackSpan): boolean {
  const inRange = (t: unknown): boolean => typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= 1
  return !!span && net.segments.has(span.segId) && inRange(span.t0) && inRange(span.t1)
}

/**
 * Stretches in the same order without the ones of no length, and with consecutive stretches that
 * continue each other on the same rail made one.
 */
export function tidyTrackSpans(spans: readonly TrackSpan[]): TrackSpan[] {
  const tidy: TrackSpan[] = []
  for (const span of spans) {
    if (Math.abs(span.t1 - span.t0) < TRACK_T_EPSILON) continue
    const last = tidy[tidy.length - 1]
    const continues =
      last &&
      last.segId === span.segId &&
      Math.abs(last.t1 - span.t0) < TRACK_T_EPSILON &&
      last.t1 > last.t0 === span.t1 > span.t0
    if (continues) last.t1 = span.t1
    else tidy.push({ segId: span.segId, t0: span.t0, t1: span.t1 })
  }
  return tidy
}

// ─────────────────── Index ───────────────────

/** Part of a rail covered by a zone: parameters `lo` ≤ `hi`, whichever way the zone runs there */
export interface SpeedZoneStretch {
  zone: SpeedZone
  lo: number
  hi: number
}

export type SpeedZoneIndex = ReadonlyMap<SegmentId, readonly SpeedZoneStretch[]>

interface ZoneState {
  revision: number
  index: Map<SegmentId, SpeedZoneStretch[]> | null
}

const states = new WeakMap<Network, ZoneState>()
const NO_STRETCH: readonly SpeedZoneStretch[] = []

function stateOf(net: Network): ZoneState {
  let state = states.get(net)
  if (!state) {
    state = { revision: 0, index: null }
    states.set(net, state)
  }
  return state
}

/** To call after writing `net.speedZones` or the `spans` of a zone by hand: the index is rebuilt at the next read. */
export function invalidateSpeedZones(net: Network): void {
  const state = stateOf(net)
  state.revision++
  state.index = null
  // Zones are resized and given another speed in place: the network itself is told too
  touchNetwork(net)
}

/**
 * Counter that changes whenever a zone of the network is added, removed, resized or given another
 * speed: what is computed from the zones can be kept as long as it stays the same.
 */
export function speedZonesRevision(net: Network): number {
  return stateOf(net).revision
}

/**
 * For each rail, the stretches of it that zones cover. Built once and kept until a zone changes:
 * reading it at every frame costs one lookup. A rail without zone has no entry.
 */
export function speedZoneIndex(net: Network): SpeedZoneIndex {
  const state = stateOf(net)
  if (!state.index) {
    const index = new Map<SegmentId, SpeedZoneStretch[]>()
    for (const zone of net.speedZones.values()) {
      for (const span of zone.spans) {
        const stretch = { zone, lo: Math.min(span.t0, span.t1), hi: Math.max(span.t0, span.t1) }
        const list = index.get(span.segId)
        if (list) list.push(stretch)
        else index.set(span.segId, [stretch])
      }
    }
    state.index = index
  }
  return state.index
}

/** The stretches of rail `segId` covered by zones (empty for a rail without zone). */
export function speedZonesOnRail(net: Network, segId: SegmentId): readonly SpeedZoneStretch[] {
  return speedZoneIndex(net).get(segId) ?? NO_STRETCH
}

/** The zones covering the place `t` of rail `segId`, each once. */
export function speedZonesAt(net: Network, segId: SegmentId, t: number): SpeedZone[] {
  const zones: SpeedZone[] = []
  for (const stretch of speedZonesOnRail(net, segId)) {
    if (t < stretch.lo - TRACK_T_EPSILON || t > stretch.hi + TRACK_T_EPSILON) continue
    if (!zones.includes(stretch.zone)) zones.push(stretch.zone)
  }
  return zones
}

// ─────────────────── Editing ───────────────────

function sameSpans(a: readonly TrackSpan[], b: readonly TrackSpan[]): boolean {
  return a.length === b.length && a.every((span, i) => span.segId === b[i].segId && span.t0 === b[i].t0 && span.t1 === b[i].t1)
}

/**
 * Give a zone its new stretches, `null` marking a place where track it covered is gone: the zone
 * is cut there. The first part stays the zone, each further part becomes a zone of its own with
 * the same settings, and a zone left without any track is removed. Returns true when anything changed.
 */
function rewriteZone(net: Network, zone: SpeedZone, parts: readonly (TrackSpan | null)[]): boolean {
  const groups: TrackSpan[][] = []
  let current: TrackSpan[] = []
  for (const part of [...parts, null]) {
    if (part) {
      current.push(part)
      continue
    }
    const tidy = tidyTrackSpans(current)
    if (tidy.length > 0) groups.push(tidy)
    current = []
  }
  if (groups.length === 1 && sameSpans(groups[0], zone.spans)) return false
  if (groups.length === 0) {
    net.speedZones.delete(zone.id)
    return true
  }
  zone.spans = groups[0]
  for (const spans of groups.slice(1)) {
    const piece: SpeedZone = { ...zone, id: generateId('z'), spans }
    net.speedZones.set(piece.id, piece)
  }
  return true
}

/**
 * Lay a zone over `spans` (in order from A to B, see `findTrackPath`) at `speed` km/h, rounded to a
 * valid zone speed. Null when a stretch is not on the track or when nothing is covered.
 */
export function addSpeedZone(net: Network, spans: readonly TrackSpan[], speed: number): SpeedZone | null {
  if (!spans.every((span) => isValidTrackSpan(net, span))) return null
  const tidy = tidyTrackSpans(spans)
  if (tidy.length === 0) return null
  const zone: SpeedZone = { id: generateId('z'), speed: normalizeZoneSpeed(speed), spans: tidy }
  net.speedZones.set(zone.id, zone)
  invalidateSpeedZones(net)
  return zone
}

/** Stands for a stretch that could not be read: on no rail, so `cleanSpeedZones` cuts the zone there */
const LOST_SPAN: TrackSpan = { segId: '', t0: NaN, t1: NaN }

/**
 * Put back a zone read from a save, under its own id and with its stretches as they were written;
 * `null` among them marks one that could not be read. Nothing is checked against the track here:
 * once every zone is back and the id counter knows their ids (`syncIdCounter`), `cleanSpeedZones`
 * drops what is not on the track — cutting a zone in two takes a new id, which must not be one a
 * zone still to be read carries. Returns false, and adds nothing, when the id is taken or the
 * speed is not a valid one.
 */
export function restoreSpeedZone(
  net: Network,
  id: SpeedZoneId,
  speed: number,
  spans: readonly (TrackSpan | null)[],
): boolean {
  if (net.speedZones.has(id) || !isValidZoneSpeed(speed)) return false
  net.speedZones.set(id, { id, speed, spans: spans.map((span) => (span ? { segId: span.segId, t0: span.t0, t1: span.t1 } : LOST_SPAN)) })
  invalidateSpeedZones(net)
  return true
}

/** Change the speed of a zone (rounded to a valid zone speed). False when there is no such zone. */
export function setSpeedZoneSpeed(net: Network, id: SpeedZoneId, speed: number): boolean {
  const zone = net.speedZones.get(id)
  if (!zone) return false
  const next = normalizeZoneSpeed(speed)
  if (zone.speed !== next) {
    zone.speed = next
    invalidateSpeedZones(net)
  }
  return true
}

/** Remove a zone. False when there is no such zone. */
export function removeSpeedZone(net: Network, id: SpeedZoneId): boolean {
  if (!net.speedZones.delete(id)) return false
  invalidateSpeedZones(net)
  return true
}

/**
 * Bring the zones in line with the track: a stretch on a rail that is gone or out of 0…1 is
 * dropped and the zone is cut there (two zones when it was in the middle), stretches of no length
 * are dropped, consecutive stretches that continue each other on one rail are made one, and a zone
 * left with nothing is removed. Does nothing, at the cost of one pass over the stretches, when the
 * zones are already in order. Returns true when anything changed.
 */
export function cleanSpeedZones(net: Network): boolean {
  if (net.speedZones.size === 0) return false
  let changed = false
  for (const zone of [...net.speedZones.values()]) {
    if (rewriteZone(net, zone, zone.spans.map((span) => (isValidTrackSpan(net, span) ? span : null)))) changed = true
  }
  if (changed) invalidateSpeedZones(net)
  return changed
}

/**
 * Move the zones off a replaced rail and onto its pieces (called by `replaceRail`): a stretch that
 * straddles a cut becomes two, two stretches brought onto one merged rail become one, and a removed
 * rail shortens the zone or cuts it in two.
 */
export function remapSpeedZones(net: Network, replacement: RailReplacement): void {
  if (net.speedZones.size === 0) return
  let changed = false
  for (const zone of [...net.speedZones.values()]) {
    if (!zone.spans.some((span) => span.segId === replacement.oldId)) continue
    if (rewriteZone(net, zone, zone.spans.flatMap((span) => remapTrackSpanParts(span, replacement)))) changed = true
  }
  if (changed) invalidateSpeedZones(net)
}
