import { generateId } from './ids'
import { touchNetwork } from './networkWatch'
import { tidyTrackSpans } from './speedZones'
import { remapTrackSpanParts, TRACK_T_EPSILON, type RailReplacement } from './trackObjects'
import type { Network, Platform, PlatformEdge, PlatformId, Point, SegmentId, StationId, StationStop, StopMarker, TrackSpan } from './types'
import { scaleFactor } from '../geometry/scale'
import { pointOnShape, segmentEnds, shapeChordCount, shapeLengthBetween, shapeParamAtDistance, tangentOnShape } from '../geometry/segmentGeometry'

// ─────────────────── Platforms ───────────────────
//
// A platform lives in `Network.platforms` and belongs to a station. It runs along one track (one
// edge, a platform beside the track) or between two (an island: two edges facing each other).
// « Both sides » of a track is two platforms, one on each side. The ends of an edge's track are the
// ends of the platform; the stop markers are distances along an edge.
//
// Sides are seen on screen, walking the edge from its start to its end: world y grows downwards,
// so the left of a heading (hx, hy) is (hy, −hx) — the convention of the signals, and the opposite
// of the normal of `bezierNormal` / `computeParallelCurve`.
//
// `net.platforms` and the fields of a platform are only changed by the functions of this file.
// This file must not import `network.ts` (which may import it) nor anything that does.

/** Distance from the axis of the track to the edge of the platform, metres at 1:1 */
export const PLATFORM_EDGE_OFFSET = 1.7
/** Width of a platform beside one track, metres at 1:1 */
export const PLATFORM_WIDTH = 6
/** Narrowest island, metres at 1:1: below it two tracks are too close for a platform between them */
export const ISLAND_MIN_WIDTH = 3
/** Distance from the end of a platform to the stop marker laid by default, metres at 1:1 */
export const STOP_MARKER_MARGIN = 10

/** The sizes of a platform at the scale of a layout */
export interface PlatformDimensions {
  edgeOffset: number
  width: number
  /** Distance between the axes of two tracks below which no island fits between them */
  islandMinSpacing: number
  markerMargin: number
}

/** Sizes of a platform for a rail gauge (1:1 when left out) */
export function platformDimensions(gauge?: number): PlatformDimensions {
  const k = scaleFactor(gauge)
  return {
    edgeOffset: PLATFORM_EDGE_OFFSET * k,
    width: PLATFORM_WIDTH * k,
    islandMinSpacing: (2 * PLATFORM_EDGE_OFFSET + ISLAND_MIN_WIDTH) * k,
    markerMargin: STOP_MARKER_MARGIN * k,
  }
}

/** What a platform is made of, its id apart */
export type PlatformDraft = Omit<Platform, 'id'> & { id?: PlatformId }

const copySpan = (span: TrackSpan): TrackSpan => ({ segId: span.segId, t0: span.t0, t1: span.t1 })

function copyEdge(edge: PlatformEdge): PlatformEdge {
  const copy: PlatformEdge = { track: edge.track.map(copySpan), side: edge.side }
  if (edge.ref !== undefined) copy.ref = edge.ref
  return copy
}

function copyMarker(marker: StopMarker): StopMarker {
  const copy: StopMarker = { edge: marker.edge, at: marker.at, heading: marker.heading }
  if (marker.maxLength !== undefined) copy.maxLength = marker.maxLength
  return copy
}

/** Add a platform, under its own id when it brings one that is free, else a new one. Returns it as kept. */
export function addPlatform(net: Network, draft: PlatformDraft): Platform {
  const platform: Platform = {
    id: draft.id !== undefined && !net.platforms.has(draft.id) ? draft.id : generateId('pl'),
    stationId: draft.stationId,
    edges: draft.edges.length === 2 ? [copyEdge(draft.edges[0]), copyEdge(draft.edges[1])] : [copyEdge(draft.edges[0])],
    width: draft.width,
    markers: draft.markers.map(copyMarker),
  }
  net.platforms.set(platform.id, platform)
  return platform
}

/** Remove a platform. False when there is no such platform. */
export function removePlatform(net: Network, id: PlatformId): boolean {
  return net.platforms.delete(id)
}

/** The platforms of a station, in the order they were laid */
export function platformsOf(net: Network, stationId: StationId): Platform[] {
  return [...net.platforms.values()].filter((platform) => platform.stationId === stationId)
}

// ─────────────────── Along an edge ───────────────────

/** Length of the track of an edge, metres; the rails that are gone count for nothing */
export function edgeLength(net: Network, edge: PlatformEdge): number {
  let length = 0
  for (const span of edge.track) {
    const seg = net.segments.get(span.segId)
    const ends = seg && segmentEnds(net, seg)
    if (ends) length += shapeLengthBetween(ends, span.t0, span.t1)
  }
  return length
}

/** A place on an edge: on which rail, where, and the heading of the edge there (unit vector) */
export interface EdgePoint {
  segId: SegmentId
  t: number
  point: Point
  heading: Point
}

/** The place `at` metres from the start of an edge along its track, held to its ends; null without track */
export function pointOnEdge(net: Network, edge: PlatformEdge, at: number): EdgePoint | null {
  let left = Math.max(0, at)
  let last: EdgePoint | null = null
  for (const span of edge.track) {
    const seg = net.segments.get(span.segId)
    const ends = seg && segmentEnds(net, seg)
    if (!ends) continue
    const length = shapeLengthBetween(ends, span.t0, span.t1)
    const sign = span.t1 >= span.t0 ? 1 : -1
    const t = left <= length ? shapeParamAtDistance(ends, span.t0, sign * left) : span.t1
    last = { segId: span.segId, t, point: pointOnShape(ends, t), heading: scaled(tangentOnShape(ends, t), sign) }
    if (left <= length) return last
    left -= length
  }
  return last
}

const scaled = (v: Point, k: number): Point => ({ x: v.x * k, y: v.y * k })

/** The side of an edge as a unit vector, for a heading along it */
export function sideNormal(heading: Point, side: 'left' | 'right'): Point {
  return side === 'left' ? { x: heading.y, y: -heading.x } : { x: -heading.y, y: heading.x }
}

/**
 * The track of an edge as a line shifted `offset` metres towards its side (away from it when
 * negative), from the start of the edge to its end. Curves are cut finely enough to stay within
 * `tolerance` metres of the track.
 */
export function edgeLine(net: Network, edge: PlatformEdge, offset: number, tolerance = 0.05): Point[] {
  const line: Point[] = []
  for (const span of edge.track) {
    const seg = net.segments.get(span.segId)
    const ends = seg && segmentEnds(net, seg)
    if (!ends || span.t0 === span.t1) continue
    const sign = span.t1 >= span.t0 ? 1 : -1
    const share = Math.abs(span.t1 - span.t0)
    const chords = ends.via || ends.path ? shapeChordCount(ends, tolerance) * (ends.path?.pieces.length ?? 1) : 1
    const steps = Math.max(1, Math.ceil(chords * share))
    // The first point of a rail is the last one of the rail before
    for (let i = line.length === 0 ? 0 : 1; i <= steps; i++) {
      const t = span.t0 + ((span.t1 - span.t0) * i) / steps
      const p = pointOnShape(ends, t)
      const n = sideNormal(scaled(tangentOnShape(ends, t), sign), edge.side)
      line.push({ x: p.x + n.x * offset, y: p.y + n.y * offset })
    }
  }
  return line
}

/**
 * The outline of a platform, a closed polygon (first point not repeated): its edge and its back
 * for a platform beside one track, its two edges for an island. Null when an edge has no track left.
 */
export function platformOutline(net: Network, platform: Platform, dims: PlatformDimensions): Point[] | null {
  const front = edgeLine(net, platform.edges[0], dims.edgeOffset)
  if (front.length < 2) return null
  if (platform.edges.length === 1) {
    const back = edgeLine(net, platform.edges[0], dims.edgeOffset + platform.width * (dims.width / PLATFORM_WIDTH))
    return [...front, ...back.reverse()]
  }
  const other = edgeLine(net, platform.edges[1], dims.edgeOffset)
  if (other.length < 2) return null
  // The two edges may be walked the same way or opposite ways: go round, never across
  const sameWay = distance(front[0], other[0]) <= distance(front[0], other[other.length - 1])
  return [...front, ...(sameWay ? other.reverse() : other)]
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The stop markers laid with a new platform: on each edge, one per direction of travel, `margin`
 * metres short of the end a train runs towards — or in the middle of an edge too short for that.
 */
export function defaultMarkers(net: Network, edges: readonly PlatformEdge[], margin: number): StopMarker[] {
  const markers: StopMarker[] = []
  edges.forEach((edge, index) => {
    const length = edgeLength(net, edge)
    const inset = Math.min(margin, length / 2)
    const at = index === 0 ? 0 : 1
    markers.push({ edge: at, at: length - inset, heading: 'forward' }, { edge: at, at: inset, heading: 'backward' })
  })
  return markers
}

/**
 * Change a platform in place: each field given replaces the one it has (copied, as `addPlatform`
 * does), `id` apart. False when there is no such platform. Tells the revision of the network.
 */
export function updatePlatform(net: Network, id: PlatformId, change: Partial<Omit<PlatformDraft, 'id'>>): boolean {
  const platform = net.platforms.get(id)
  if (!platform) return false
  if (change.stationId !== undefined) platform.stationId = change.stationId
  if (change.edges !== undefined) {
    platform.edges = change.edges.length === 2 ? [copyEdge(change.edges[0]), copyEdge(change.edges[1])] : [copyEdge(change.edges[0])]
  }
  if (change.width !== undefined) platform.width = change.width
  if (change.markers !== undefined) platform.markers = change.markers.map(copyMarker)
  touchNetwork(net, null)
  return true
}

// ─────────────────── Following the track ───────────────────
//
// A platform names rails, so `replaceRail` (`models/network.ts`) hands it every rail replacement
// through `remapPlatforms`, and `settlePlatforms` (run by the store whenever the network changed,
// and on loading) drops what is left on a rail taken out of the graph by other means. The rules,
// for each edge of a platform:
//
// 1. Each stretch of the edge is carried onto the rails that stand for it (`remapTrackSpanParts`):
//    a cut rail makes two consecutive stretches, merged rails make one (consecutive stretches that
//    continue each other on one rail are joined), a removed rail leaves a gap.
// 2. An edge with a gap is no longer one platform edge: it keeps its longest contiguous part, by
//    length along the track (the first one on a tie).
// 3. The markers are distances from the start of the edge: when the part kept does not start where
//    the edge started, each marker moves back by the length of what was cut away before it — it
//    stays at its place on the track. The length of a removed stretch is measured on the old rail
//    while it is still in the network (`removeSegment` replaces it before it takes it out); a rail
//    already gone counts for nothing.
// 4. Every marker is then held to [0, length of its edge]; a marker of an edge the platform does
//    not have is dropped.
// 5. A platform one of whose edges has no track left is removed (an island that loses one of its
//    tracks is not turned into a platform beside the other).
//
// Then the stops of a station that has platforms are its markers (see `stopsOfPlatforms`).

/** One stretch of an edge after an edit, or a gap, and its length along the track */
interface EdgePart {
  span: TrackSpan | null
  length: number
}

/** Length of a stretch on a rail of the network; nothing when the rail is not there */
function spanLength(net: Network, span: TrackSpan): number {
  const seg = net.segments.get(span.segId)
  const ends = seg && segmentEnds(net, seg)
  return ends ? shapeLengthBetween(ends, span.t0, span.t1) : 0
}

/** The longest contiguous part of an edge (rule 2) and the length cut away before it, null when nothing is left */
function keptPart(parts: readonly EdgePart[]): { track: TrackSpan[]; shift: number } | null {
  let best: { track: TrackSpan[]; shift: number; length: number } | null = null
  let before = 0
  let run: EdgePart[] = []
  const close = (): void => {
    const track = tidyTrackSpans(run.map((part) => part.span!))
    const length = run.reduce((sum, part) => sum + part.length, 0)
    if (track.length > 0 && (!best || length > best.length)) best = { track, shift: before, length }
    before += length
    run = []
  }
  for (const part of parts) {
    if (part.span) {
      run.push(part)
      continue
    }
    close()
    before += part.length
  }
  close()
  return best
}

const sameSpan = (a: TrackSpan, b: TrackSpan): boolean => a.segId === b.segId && a.t0 === b.t0 && a.t1 === b.t1

function sameTrack(a: readonly TrackSpan[], b: readonly TrackSpan[]): boolean {
  return a.length === b.length && a.every((span, i) => sameSpan(span, b[i]))
}

/**
 * Bring one platform to the parts of its edges (`null` for an edge left as it is): rules 2 to 5.
 * Returns true when the platform changed (removed, or rewritten in place: the caller tells the revision).
 */
function rewritePlatform(net: Network, platform: Platform, partsOf: (edge: PlatformEdge) => EdgePart[] | null): boolean {
  const tracks: TrackSpan[][] = []
  const shifts: number[] = []
  for (const edge of platform.edges) {
    const parts = partsOf(edge)
    if (!parts) {
      tracks.push(edge.track)
      shifts.push(0)
      continue
    }
    const kept = keptPart(parts)
    if (!kept) {
      net.platforms.delete(platform.id)
      return true
    }
    tracks.push(kept.track)
    shifts.push(kept.shift)
  }
  const lengths = platform.edges.map((edge, i) => edgeLength(net, { ...edge, track: tracks[i] }))
  const markers: StopMarker[] = []
  for (const marker of platform.markers) {
    if (marker.edge >= platform.edges.length) continue
    const at = Math.min(lengths[marker.edge], Math.max(0, marker.at - shifts[marker.edge]))
    markers.push(at === marker.at ? marker : { ...marker, at })
  }
  let changed = markers.length !== platform.markers.length || markers.some((marker, i) => marker !== platform.markers[i])
  platform.edges.forEach((edge, i) => {
    if (sameTrack(edge.track, tracks[i])) return
    edge.track = tracks[i]
    changed = true
  })
  if (changed) platform.markers = markers
  return changed
}

/**
 * Carry the platforms off a replaced rail and onto its pieces (called by `replaceRail`), by the
 * rules above: each one stays where it is on the track; one that loses the whole track of an edge goes.
 */
export function remapPlatforms(net: Network, replacement: RailReplacement): void {
  if (net.platforms.size === 0) return
  let changed = false
  const onOld = (edge: PlatformEdge): boolean => edge.track.some((span) => span.segId === replacement.oldId)
  for (const platform of [...net.platforms.values()]) {
    if (!platform.edges.some(onOld)) continue
    const partsOf = (edge: PlatformEdge): EdgePart[] | null => {
      if (!onOld(edge)) return null
      const parts: EdgePart[] = []
      for (const span of edge.track) {
        if (span.segId !== replacement.oldId) {
          parts.push({ span, length: spanLength(net, span) })
          continue
        }
        const mapped = remapTrackSpanParts(span, replacement)
        const lengths = mapped.map((part) => (part ? spanLength(net, part) : 0))
        const gaps = mapped.filter((part) => part === null).length
        // What the pieces do not stand for, measured on the old rail (rule 3)
        const missing = gaps > 0 ? Math.max(0, spanLength(net, span) - lengths.reduce((sum, l) => sum + l, 0)) / gaps : 0
        mapped.forEach((part, i) => parts.push({ span: part, length: part ? lengths[i] : missing }))
      }
      return parts
    }
    if (rewritePlatform(net, platform, partsOf)) changed = true
  }
  if (changed) touchNetwork(net, null)
}

/** True when a stretch lies on a rail of the network, within 0…1 (a hair beyond is held to it) */
function onTrack(net: Network, span: TrackSpan): boolean {
  const inRange = (t: number): boolean => Number.isFinite(t) && t >= -TRACK_T_EPSILON && t <= 1 + TRACK_T_EPSILON
  return net.segments.has(span.segId) && inRange(span.t0) && inRange(span.t1)
}

const held = (t: number): number => Math.max(0, Math.min(1, t))

/** The stops of a station drawn from the markers of its platforms: one per marker, in order */
export function stopsOfPlatforms(net: Network, platforms: readonly Platform[]): StationStop[] {
  const stops: StationStop[] = []
  for (const platform of platforms) {
    for (const marker of platform.markers) {
      const edge = platform.edges[marker.edge]
      const place = edge && pointOnEdge(net, edge, marker.at)
      if (!place) continue
      stops.push(edge.ref !== undefined ? { segId: place.segId, t: place.t, ref: edge.ref } : { segId: place.segId, t: place.t })
    }
  }
  return stops
}

const sameStop = (a: StationStop, b: StationStop): boolean => a.segId === b.segId && a.t === b.t && a.ref === b.ref

/**
 * Bring the platforms in line with the network, and the stations with their platforms: a platform
 * of a station that is gone goes; a stretch on a rail that is gone, or out of 0…1, is a gap (rules
 * 2 to 5 above, a gap counting for nothing); the markers are held to their edge. The stops of every
 * station that has platforms are then those of its markers (`stopsOfPlatforms`); a station without
 * platform keeps its own. Writes only what differs. Returns true when anything changed.
 */
export function settlePlatforms(net: Network): boolean {
  if (net.platforms.size === 0) return false
  let changed = false
  for (const platform of [...net.platforms.values()]) {
    if (!net.stations.has(platform.stationId)) {
      net.platforms.delete(platform.id)
      changed = true
      continue
    }
    const partsOf = (edge: PlatformEdge): EdgePart[] | null => {
      if (edge.track.every((span) => onTrack(net, span) && span.t0 === held(span.t0) && span.t1 === held(span.t1))) return null
      return edge.track.map((span) => {
        if (!onTrack(net, span)) return { span: null, length: 0 }
        const kept = { segId: span.segId, t0: held(span.t0), t1: held(span.t1) }
        return { span: kept, length: spanLength(net, kept) }
      })
    }
    if (rewritePlatform(net, platform, partsOf)) changed = true
  }
  const byStation = new Map<StationId, Platform[]>()
  for (const platform of net.platforms.values()) {
    const list = byStation.get(platform.stationId)
    if (list) list.push(platform)
    else byStation.set(platform.stationId, [platform])
  }
  for (const [stationId, platforms] of byStation) {
    const station = net.stations.get(stationId)!
    const stops = stopsOfPlatforms(net, platforms)
    if (stops.length === station.stops.length && stops.every((stop, i) => sameStop(stop, station.stops[i]))) continue
    station.stops = stops
    changed = true
  }
  if (changed) touchNetwork(net, null)
  return changed
}

// ─────────────────── Saves ───────────────────

/** A platform as a save holds it; anything may be missing or wrong in a file */
export interface StoredPlatform {
  id?: unknown
  stationId?: unknown
  edges?: unknown
  width?: unknown
  markers?: unknown
}

/**
 * Put back a platform read from a save, under its own id. Nothing is checked against the track or
 * the stations here (`settlePlatforms` does once everything is back). Returns false, and adds
 * nothing, when the record does not hold together or the id is taken; a marker that does not hold
 * together is left out.
 */
export function restorePlatform(net: Network, raw: StoredPlatform | null | undefined): boolean {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.stationId !== 'string' || net.platforms.has(raw.id)) return false
  if (!Array.isArray(raw.edges) || (raw.edges.length !== 1 && raw.edges.length !== 2)) return false
  const edges: PlatformEdge[] = []
  for (const item of raw.edges as unknown[]) {
    const edge = storedEdge(item)
    if (!edge) return false
    edges.push(edge)
  }
  const width = typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width >= 0 ? raw.width : PLATFORM_WIDTH
  const markers: StopMarker[] = []
  if (Array.isArray(raw.markers)) {
    for (const item of raw.markers as unknown[]) {
      const marker = storedMarker(item, edges.length)
      if (marker) markers.push(marker)
    }
  }
  addPlatform(net, { id: raw.id, stationId: raw.stationId, edges: edges as Platform['edges'], width, markers })
  return true
}

function storedEdge(raw: unknown): PlatformEdge | null {
  if (!raw || typeof raw !== 'object') return null
  const { track, side, ref } = raw as Record<string, unknown>
  if ((side !== 'left' && side !== 'right') || !Array.isArray(track)) return null
  const spans: TrackSpan[] = []
  for (const item of track as unknown[]) {
    if (!item || typeof item !== 'object') return null
    const { segId, t0, t1 } = item as Record<string, unknown>
    if (typeof segId !== 'string' || !isNumber(t0) || !isNumber(t1)) return null
    spans.push({ segId, t0, t1 })
  }
  const edge: PlatformEdge = { track: spans, side }
  if (typeof ref === 'string' && ref !== '') edge.ref = ref
  return edge
}

function storedMarker(raw: unknown, edges: number): StopMarker | null {
  if (!raw || typeof raw !== 'object') return null
  const { edge, at, heading, maxLength } = raw as Record<string, unknown>
  if ((edge !== 0 && edge !== 1) || edge >= edges || !isNumber(at) || (heading !== 'forward' && heading !== 'backward')) return null
  const marker: StopMarker = { edge, at, heading }
  if (isNumber(maxLength) && maxLength > 0) marker.maxLength = maxLength
  return marker
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
