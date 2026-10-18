import { touchNetwork } from './networkWatch'
import { edgeLength, edgeLine, platformOutline, pointOnEdge, sideNormal, PLATFORM_WIDTH, type PlatformDimensions } from './platforms'
import { addStation } from './stations'
import type { Network, Platform, PlatformEdge, PlatformId, Point, SegmentId, Station, StationId, StopMarker, TrackSpan } from './types'
import { closestParamOnShape, distanceToShape, pointOnShape, segmentEnds, shapeLengthBetween, shapeParamAtDistance, type SegmentEnds } from '../geometry/segmentGeometry'

// ─────────────────── Editing platforms and stations ───────────────────
//
// What the editor does to a platform once it is laid (the selection tool): find it under the
// cursor, slide one of its ends (« bornes ») along its track, move its stop markers, change its
// station, track numbers and width. And what it does to a station: create one, rename it, move its
// label. Every change in place tells the revision of the network (`touchNetwork(net, null)`: a
// platform and a station are read whole).
//
// An end slides along the track the platform runs along: through the plain joints (nodes of two
// rails), never past a set of points or the end of the track. The stop markers are distances from
// the start of their edge: moving the start shifts them so that they stay where they stand.
//
// This file must not import `network.ts` (which imports `platforms.ts`) nor anything that does.

/** Shortest platform an end can be dragged to, metres at 1:1 */
export const MIN_PLATFORM_LENGTH = 2

/** One end of one edge of a platform */
export interface PlatformEnd {
  platformId: PlatformId
  edge: 0 | 1
  end: 'start' | 'end'
}

/** A stop marker of a platform, by its index in `Platform.markers` */
export interface PlatformMarkerHit {
  platformId: PlatformId
  index: number
}

// ─────────────────── Finding a platform ───────────────────

/**
 * The platform under a world position: inside its outline, or within `tolerance` metres of the
 * edge of the platform. The last laid comes first where platforms overlap.
 */
export function platformAt(net: Network, p: Point, dims: PlatformDimensions, tolerance: number): Platform | null {
  const platforms = [...net.platforms.values()]
  for (let i = platforms.length - 1; i >= 0; i--) {
    const platform = platforms[i]
    if (!nearPlatformTrack(net, platform, p, dims, tolerance)) continue
    const outline = platformOutline(net, platform, dims)
    if (!outline) continue
    if (pointInPolygon(p, outline)) return platform
    for (const edge of platform.edges) {
      if (distanceToPolyline(p, edgeLine(net, edge, dims.edgeOffset)) <= tolerance) return platform
    }
  }
  return null
}

/** Cheap test before the outline: the point is near enough to one of the rails of the platform */
function nearPlatformTrack(net: Network, platform: Platform, p: Point, dims: PlatformDimensions, tolerance: number): boolean {
  const reach = dims.edgeOffset + platformBodyWidth(platform, dims) + tolerance
  for (const edge of platform.edges) {
    for (const span of edge.track) {
      const ends = railEnds(net, span.segId)
      if (ends && distanceToShape(ends, p) <= reach) return true
    }
  }
  return false
}

/** Width of the body of a platform beside one track at the scale of `dims`; an island: none of its own */
function platformBodyWidth(platform: Platform, dims: PlatformDimensions): number {
  return platform.edges.length === 1 ? platform.width * (dims.width / PLATFORM_WIDTH) : dims.islandMinSpacing
}

/**
 * The end (« borne ») of a platform under a world position, within `tolerance` metres: the short
 * side of the platform at that end, from its edge to its back. `only`: look at that platform alone.
 */
export function platformEndAt(net: Network, p: Point, dims: PlatformDimensions, tolerance: number, only?: PlatformId): PlatformEnd | null {
  let best: PlatformEnd | null = null
  let bestDistance = tolerance
  for (const platform of candidates(net, only)) {
    const width = platform.edges.length === 1 ? platform.width * (dims.width / PLATFORM_WIDTH) : 0
    platform.edges.forEach((edge, index) => {
      const length = edgeLength(net, edge)
      for (const end of ['start', 'end'] as const) {
        const place = pointOnEdge(net, edge, end === 'start' ? 0 : length)
        if (!place) continue
        const n = sideNormal(place.heading, edge.side)
        const front = { x: place.point.x + n.x * dims.edgeOffset, y: place.point.y + n.y * dims.edgeOffset }
        const back = { x: front.x + n.x * width, y: front.y + n.y * width }
        const d = distanceToSegment(p, front, back)
        if (d <= bestDistance) {
          bestDistance = d
          best = { platformId: platform.id, edge: index as 0 | 1, end }
        }
      }
    })
  }
  return best
}

/** Where a stop marker stands: on the track, and on the edge of the platform in front of it */
export function markerPlace(net: Network, platform: Platform, marker: StopMarker, dims: PlatformDimensions): { track: Point; edge: Point } | null {
  const edge = platform.edges[marker.edge]
  const place = edge && pointOnEdge(net, edge, marker.at)
  if (!place) return null
  const n = sideNormal(place.heading, edge.side)
  return { track: place.point, edge: { x: place.point.x + n.x * dims.edgeOffset, y: place.point.y + n.y * dims.edgeOffset } }
}

/** The stop marker under a world position, within `tolerance` metres of its foot. `only`: that platform alone. */
export function platformMarkerAt(net: Network, p: Point, dims: PlatformDimensions, tolerance: number, only?: PlatformId): PlatformMarkerHit | null {
  let best: PlatformMarkerHit | null = null
  let bestDistance = tolerance
  for (const platform of candidates(net, only)) {
    platform.markers.forEach((marker, index) => {
      const place = markerPlace(net, platform, marker, dims)
      if (!place) return
      const d = distanceToSegment(p, place.track, place.edge)
      if (d <= bestDistance) {
        bestDistance = d
        best = { platformId: platform.id, index }
      }
    })
  }
  return best
}

function candidates(net: Network, only?: PlatformId): Platform[] {
  if (only === undefined) return [...net.platforms.values()]
  const platform = net.platforms.get(only)
  return platform ? [platform] : []
}

/** The middle of a platform (where a station created for it is put): half way along, on its body */
export function platformCentre(net: Network, platform: Platform, dims: PlatformDimensions): Point | null {
  const edge = platform.edges[0]
  const place = pointOnEdge(net, edge, edgeLength(net, edge) / 2)
  if (!place) return null
  const n = sideNormal(place.heading, edge.side)
  const across = dims.edgeOffset + platformBodyWidth(platform, dims) / 2
  return { x: place.point.x + n.x * across, y: place.point.y + n.y * across }
}

// ─────────────────── Along the track of an edge ───────────────────

/** One rail of the track an edge may run along, walked in the way of the edge */
interface CorridorRail {
  segId: SegmentId
  ends: SegmentEnds
  /** The edge walks it from `from` to `to` (growing t) */
  forward: boolean
  /** Distance from the start of the corridor to the start of this rail, metres */
  offset: number
  length: number
}

/** A place on a corridor: which rail of it, and where on that rail */
interface CorridorPlace {
  index: number
  t: number
}

/** Most rails a corridor reaches out to on either side of an edge: a long line is not walked whole */
const CORRIDOR_REACH = 400

/**
 * The track an edge can run along: its own rails, then on either side the rails that follow
 * through plain joints (a node of two rails), up to a set of points, the end of the track or a
 * rail already in it. Null when a rail of the edge is gone.
 */
function edgeCorridor(net: Network, edge: PlatformEdge): CorridorRail[] | null {
  if (edge.track.length === 0) return null
  const rails: { segId: SegmentId; forward: boolean }[] = []
  for (let i = 0; i < edge.track.length; i++) {
    const span = edge.track[i]
    if (!net.segments.has(span.segId)) return null
    rails.push({ segId: span.segId, forward: spanForward(net, edge.track, i) })
  }
  const used = new Set(rails.map((rail) => rail.segId))
  const before: { segId: SegmentId; forward: boolean }[] = []
  extend(rails[0], false, before)
  extend(rails[rails.length - 1], true, rails)

  function extend(from: { segId: SegmentId; forward: boolean }, ahead: boolean, into: { segId: SegmentId; forward: boolean }[]): void {
    let current = from
    for (let step = 0; step < CORRIDOR_REACH; step++) {
      const seg = net.segments.get(current.segId)
      if (!seg) return
      // The node the walk leaves the rail by: ahead of it, or behind it
      const node = current.forward === ahead ? seg.to : seg.from
      const adjacent = net.adjacency.get(node) ?? []
      if (adjacent.length !== 2) return
      const nextId = adjacent[0] === current.segId ? adjacent[1] : adjacent[0]
      const next = net.segments.get(nextId)
      if (!next || used.has(nextId) || next.from === next.to) return
      // Ahead, the next rail is walked away from the node; behind, towards it
      const forward = ahead ? next.from === node : next.to === node
      used.add(nextId)
      current = { segId: nextId, forward }
      into.push(current)
    }
  }

  const ordered = [...before.reverse(), ...rails]
  const corridor: CorridorRail[] = []
  let offset = 0
  for (const rail of ordered) {
    const ends = railEnds(net, rail.segId)
    if (!ends) return null
    const length = shapeLengthBetween(ends, 0, 1)
    corridor.push({ segId: rail.segId, ends, forward: rail.forward, offset, length })
    offset += length
  }
  return corridor
}

/** The way the edge walks the rail of its span `i`; for a span without length, from the rails around it */
function spanForward(net: Network, track: TrackSpan[], i: number): boolean {
  const span = track[i]
  if (span.t1 !== span.t0) return span.t1 > span.t0
  const seg = net.segments.get(span.segId)
  const next = track[i + 1] && net.segments.get(track[i + 1].segId)
  if (seg && next) return seg.to === next.from || seg.to === next.to
  const prev = track[i - 1] && net.segments.get(track[i - 1].segId)
  if (seg && prev) return seg.from === prev.from || seg.from === prev.to
  return true
}

/** Distance of a place from the start of the corridor */
function corridorDistance(corridor: CorridorRail[], place: CorridorPlace): number {
  const rail = corridor[place.index]
  return rail.offset + shapeLengthBetween(rail.ends, rail.forward ? 0 : 1, place.t)
}

/** The place `distance` metres from the start of the corridor, held to its ends */
function corridorPlaceAt(corridor: CorridorRail[], distance: number): CorridorPlace {
  for (let index = 0; index < corridor.length; index++) {
    const rail = corridor[index]
    if (distance <= rail.offset + rail.length || index === corridor.length - 1) {
      const along = Math.max(0, Math.min(rail.length, distance - rail.offset))
      const t = shapeParamAtDistance(rail.ends, rail.forward ? 0 : 1, rail.forward ? along : -along)
      return { index, t }
    }
  }
  return { index: 0, t: corridor[0].forward ? 0 : 1 }
}

/** The place of the corridor nearest to a world position */
function corridorPlaceNear(corridor: CorridorRail[], p: Point): CorridorPlace {
  let best: CorridorPlace = { index: 0, t: corridor[0].forward ? 0 : 1 }
  let bestDistance = Infinity
  corridor.forEach((rail, index) => {
    const t = closestParamOnShape(rail.ends, p)
    const q = pointOnShape(rail.ends, t)
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d < bestDistance) {
      bestDistance = d
      best = { index, t }
    }
  })
  return best
}

/** The spans of the corridor from one place to another (`start` before `end`) */
function corridorSpans(corridor: CorridorRail[], start: CorridorPlace, end: CorridorPlace): TrackSpan[] {
  const spans: TrackSpan[] = []
  for (let index = start.index; index <= end.index; index++) {
    const rail = corridor[index]
    const t0 = index === start.index ? start.t : rail.forward ? 0 : 1
    const t1 = index === end.index ? end.t : rail.forward ? 1 : 0
    spans.push({ segId: rail.segId, t0, t1 })
  }
  // A rail touched at its very end only is no part of the platform, unless nothing else is left
  const kept = spans.filter((span) => span.t0 !== span.t1)
  return kept.length > 0 ? kept : spans.slice(0, 1)
}

/** Where the start and the end of an edge are on its corridor */
function edgePlaces(edge: PlatformEdge, corridor: CorridorRail[]): { start: CorridorPlace; end: CorridorPlace } | null {
  const first = edge.track[0]
  const last = edge.track[edge.track.length - 1]
  const startIndex = corridor.findIndex((rail) => rail.segId === first.segId)
  let endIndex = -1
  for (let i = corridor.length - 1; i >= 0; i--) {
    if (corridor[i].segId === last.segId) {
      endIndex = i
      break
    }
  }
  if (startIndex < 0 || endIndex < 0) return null
  return { start: { index: startIndex, t: first.t0 }, end: { index: endIndex, t: last.t1 } }
}

/**
 * Slide one end of an edge to the place of its track nearest to `toward`, never closer than
 * `minLength` to its other end. Returns the new track and how far its start moved (positive: the
 * start moved forward, towards the end), or null when the edge cannot be read.
 */
function slideEdgeEnd(net: Network, edge: PlatformEdge, end: 'start' | 'end', toward: Point, minLength: number): { track: TrackSpan[]; startShift: number } | null {
  const corridor = edgeCorridor(net, edge)
  if (!corridor) return null
  const places = edgePlaces(edge, corridor)
  if (!places) return null
  const startAt = corridorDistance(corridor, places.start)
  const endAt = corridorDistance(corridor, places.end)
  let target = corridorPlaceNear(corridor, toward)
  const targetAt = corridorDistance(corridor, target)
  if (end === 'start') {
    if (targetAt > endAt - minLength) target = corridorPlaceAt(corridor, Math.max(0, endAt - minLength))
    const newStartAt = corridorDistance(corridor, target)
    return { track: corridorSpans(corridor, target, places.end), startShift: newStartAt - startAt }
  }
  const total = corridor[corridor.length - 1].offset + corridor[corridor.length - 1].length
  if (targetAt < startAt + minLength) target = corridorPlaceAt(corridor, Math.min(total, startAt + minLength))
  return { track: corridorSpans(corridor, places.start, target), startShift: 0 }
}

/**
 * Move one end (« borne ») of a platform along its track, to the place nearest to the world
 * position `toward`: the platform is lengthened or shortened, through plain joints, never past a
 * set of points or the end of the track, and never shorter than `minLength` metres. The stop
 * markers of the edge stay where they stand (held to the platform). On an island the matching
 * end of the other edge follows, so that the two edges keep facing each other. Returns true when
 * anything changed.
 */
export function moveEdgeEnd(
  net: Network,
  platformId: PlatformId,
  edgeIndex: 0 | 1,
  end: 'start' | 'end',
  toward: Point,
  minLength = MIN_PLATFORM_LENGTH,
): boolean {
  const platform = net.platforms.get(platformId)
  const edge = platform?.edges[edgeIndex]
  if (!platform || !edge) return false
  const before = shapeKey(platform)
  const length = edgeLength(net, edge)
  const moved = pointOnEdge(net, edge, end === 'start' ? 0 : length)
  const slid = slideEdgeEnd(net, edge, end, toward, minLength)
  if (!moved || !slid) return false
  applySlide(net, platform, edgeIndex, slid)

  const otherIndex = edgeIndex === 0 ? 1 : 0
  const other = platform.edges[otherIndex]
  if (other) {
    // The end of the other edge that faced the moved one goes to face it again
    const otherLength = edgeLength(net, other)
    const otherStart = pointOnEdge(net, other, 0)
    const otherEnd = pointOnEdge(net, other, otherLength)
    const now = pointOnEdge(net, edge, end === 'start' ? 0 : edgeLength(net, edge))
    if (otherStart && otherEnd && now) {
      const otherSide = distance(otherStart.point, moved.point) <= distance(otherEnd.point, moved.point) ? 'start' : 'end'
      const follow = slideEdgeEnd(net, other, otherSide, now.point, minLength)
      if (follow) applySlide(net, platform, otherIndex, follow)
    }
  }
  if (shapeKey(platform) === before) return false
  touchNetwork(net, null)
  return true
}

/** Put a slid track in an edge and keep its markers where they stand, on the platform */
function applySlide(net: Network, platform: Platform, edgeIndex: 0 | 1, slid: { track: TrackSpan[]; startShift: number }): void {
  const edge = platform.edges[edgeIndex]
  if (!edge) return
  edge.track = slid.track
  const length = edgeLength(net, edge)
  for (const marker of platform.markers) {
    if (marker.edge !== edgeIndex) continue
    marker.at = clamp(marker.at - slid.startShift, 0, length)
  }
}

/** Everything of a platform an edit can change, as text: equal keys, equal platforms */
function shapeKey(platform: Platform): string {
  return JSON.stringify([platform.stationId, platform.width, platform.edges, platform.markers])
}

/** The edges and markers of a platform, as a copy: what a drag puts back when it is cancelled */
export interface PlatformShape {
  edges: PlatformEdge[]
  markers: StopMarker[]
}

/** A copy of the edges and markers of a platform */
export function platformShape(platform: Platform): PlatformShape {
  return JSON.parse(JSON.stringify({ edges: platform.edges, markers: platform.markers })) as PlatformShape
}

/** Put back edges and markers taken by `platformShape`. False when there is no such platform or nothing changes. */
export function restorePlatformShape(net: Network, platformId: PlatformId, shape: PlatformShape): boolean {
  const platform = net.platforms.get(platformId)
  if (!platform || shape.edges.length !== platform.edges.length) return false
  const copy = JSON.parse(JSON.stringify(shape)) as PlatformShape
  const before = shapeKey(platform)
  platform.edges = copy.edges as Platform['edges']
  platform.markers = copy.markers
  if (shapeKey(platform) === before) return false
  touchNetwork(net, null)
  return true
}

/** Distance along an edge of its place nearest to a world position, metres from its start */
export function distanceAlongEdge(net: Network, edge: PlatformEdge, p: Point): number | null {
  let best: number | null = null
  let bestGap = Infinity
  let offset = 0
  for (const span of edge.track) {
    const ends = railEnds(net, span.segId)
    if (!ends) continue
    const lo = Math.min(span.t0, span.t1)
    const hi = Math.max(span.t0, span.t1)
    const t = clamp(closestParamOnShape(ends, p), lo, hi)
    const q = pointOnShape(ends, t)
    const gap = Math.hypot(q.x - p.x, q.y - p.y)
    if (gap < bestGap) {
      bestGap = gap
      best = offset + shapeLengthBetween(ends, span.t0, t)
    }
    offset += shapeLengthBetween(ends, span.t0, span.t1)
  }
  return best
}

// ─────────────────── Stop markers ───────────────────

/** Slide a stop marker along its edge to the place nearest to a world position. True when it moved. */
export function moveMarker(net: Network, platformId: PlatformId, index: number, toward: Point): boolean {
  const platform = net.platforms.get(platformId)
  const marker = platform?.markers[index]
  const edge = marker && platform?.edges[marker.edge]
  if (!marker || !edge) return false
  const at = distanceAlongEdge(net, edge, toward)
  if (at === null) return false
  const next = clamp(at, 0, edgeLength(net, edge))
  if (next === marker.at) return false
  marker.at = next
  touchNetwork(net, null)
  return true
}

/** Add a stop marker, held to its edge. Returns its index, or null when there is no such platform or edge. */
export function addMarker(net: Network, platformId: PlatformId, marker: StopMarker): number | null {
  const platform = net.platforms.get(platformId)
  const edge = platform?.edges[marker.edge]
  if (!platform || !edge) return null
  const copy: StopMarker = { edge: marker.edge, at: clamp(marker.at, 0, edgeLength(net, edge)), heading: marker.heading }
  if (marker.maxLength !== undefined && marker.maxLength > 0) copy.maxLength = marker.maxLength
  platform.markers.push(copy)
  touchNetwork(net, null)
  return platform.markers.length - 1
}

/** Remove a stop marker. False when there is none at that index. */
export function removeMarker(net: Network, platformId: PlatformId, index: number): boolean {
  const platform = net.platforms.get(platformId)
  if (!platform || index < 0 || index >= platform.markers.length) return false
  platform.markers.splice(index, 1)
  touchNetwork(net, null)
  return true
}

/**
 * The direction and the longest train of a stop marker; a field left out is kept, `maxLength`
 * undefined (or not above 0) clears it. False when there is no such marker or nothing changes.
 */
export function setMarkerOptions(
  net: Network,
  platformId: PlatformId,
  index: number,
  options: { heading?: StopMarker['heading']; maxLength?: number },
): boolean {
  const marker = net.platforms.get(platformId)?.markers[index]
  if (!marker) return false
  let changed = false
  if (options.heading !== undefined && options.heading !== marker.heading) {
    marker.heading = options.heading
    changed = true
  }
  if ('maxLength' in options) {
    const next = options.maxLength !== undefined && Number.isFinite(options.maxLength) && options.maxLength > 0 ? options.maxLength : undefined
    if (next !== marker.maxLength) {
      if (next === undefined) delete marker.maxLength
      else marker.maxLength = next
      changed = true
    }
  }
  if (changed) touchNetwork(net, null)
  return changed
}

// ─────────────────── Platform settings ───────────────────

/** The track number of an edge; empty or undefined clears it. False when nothing changes. */
export function setPlatformRef(net: Network, platformId: PlatformId, edgeIndex: 0 | 1, ref: string | undefined): boolean {
  const edge = net.platforms.get(platformId)?.edges[edgeIndex]
  if (!edge) return false
  const next = ref?.trim() || undefined
  if (next === edge.ref) return false
  if (next === undefined) delete edge.ref
  else edge.ref = next
  touchNetwork(net, null)
  return true
}

/** The width of a platform beside one track, metres at 1:1 (above 0). False when refused or nothing changes. */
export function setPlatformWidth(net: Network, platformId: PlatformId, width: number): boolean {
  const platform = net.platforms.get(platformId)
  if (!platform || !Number.isFinite(width) || width <= 0 || platform.width === width) return false
  platform.width = width
  touchNetwork(net, null)
  return true
}

/** The station a platform belongs to. False when either is missing or nothing changes. */
export function setPlatformStation(net: Network, platformId: PlatformId, stationId: StationId): boolean {
  const platform = net.platforms.get(platformId)
  if (!platform || !net.stations.has(stationId) || platform.stationId === stationId) return false
  platform.stationId = stationId
  touchNetwork(net, null)
  return true
}

// ─────────────────── Stations in the editor ───────────────────

/** A new station of the editor: a name and a place, no stop of its own (its platforms will give them) */
export function createStation(net: Network, name: string, pos: Point): Station {
  return addStation(net, { name: name.trim() || 'Nouvelle gare', pos, stops: [] })
}

/** Move the place (the label) of a station. False when there is no such station or it does not move. */
export function moveStationLabel(net: Network, stationId: StationId, pos: Point): boolean {
  const station = net.stations.get(stationId)
  if (!station || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false
  if (station.pos.x === pos.x && station.pos.y === pos.y) return false
  station.pos = { x: pos.x, y: pos.y }
  touchNetwork(net, null)
  return true
}

// ─────────────────── Plane geometry ───────────────────

function railEnds(net: Network, segId: SegmentId): SegmentEnds | null {
  const seg = net.segments.get(segId)
  return seg ? segmentEnds(net, seg) : null
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1)
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y)
}

function distanceToPolyline(p: Point, line: Point[]): number {
  let best = Infinity
  for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i - 1], line[i]))
  return best
}

function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
