import { generateId } from './ids'
import type { Network, Platform, PlatformEdge, PlatformId, Point, SegmentId, StationId, StopMarker, TrackSpan } from './types'
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
