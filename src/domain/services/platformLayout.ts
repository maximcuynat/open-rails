import type { Network, Platform, PlatformEdge, Point, SegmentId, Station, StationId } from '../models/types'
import { findTrackPathToAny, type TrackPoint } from './trackPath'
import { findJunctionAtNode, isPassageOpen } from '../models/routing'
import { positionOnSegment, projectOnSegment, segmentPartialLength, tangentOnSegment } from '../models/locomotive'
import { nodesWithin, railsWithin } from '../geometry/networkFollower'
import { addPlatform, defaultMarkers, edgeLength, PLATFORM_WIDTH, platformDimensions, pointOnEdge, sideNormal, type PlatformDimensions } from '../models/platforms'
import { addStation } from '../models/stations'
import { scaleFactor } from '../geometry/scale'
import { defaultRakeOption, rakeOptions, ROLLING_STOCK, type RollingStockModel } from '../models/rollingStock'

// ─────────────────── Laying a platform ───────────────────
//
// The platform tool lays a platform in two clicks along a track: what is worked out between the
// clicks lives here, pure, so that the preview, the contextual bar and the click say the same.
// The start is a place of the track; the end is the cursor brought back onto the track the start
// is on (followed through joints and points, never onto a track beside it); the side of the track
// is the side the cursor is on. Between two tracks far enough apart the plan is an island.

/** The two edges (an island) or the one edge of a platform */
export type PlatformEdges = Platform['edges']

/** Farthest along the track from its start the end of a platform is looked for, metres at 1:1 */
export const PLATFORM_REACH = 1000
/** Shortest platform the tool lays, metres at 1:1 */
export const MIN_PLATFORM_LENGTH = 5
/** An OpenStreetMap platform finds its station within this distance, metres at 1:1 */
export const STATION_REACH = 300
/** A platform this close to a platform already laid joins its station, metres at 1:1 */
export const NEIGHBOUR_PLATFORM_REACH = 40

/** Where two tracks are looked at for an island: up to this far apart, axis to axis */
export function islandReach(dims: PlatformDimensions): number {
  return dims.islandMinSpacing + 2 * dims.width
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })

/**
 * The rails a train could run on from `from` within `reach` metres either way, the points set any
 * way: the track a platform started there may run along.
 */
export function railsAlong(net: Network, from: TrackPoint, reach: number): Set<SegmentId> {
  const rails = new Set<SegmentId>()
  const seg = net.segments.get(from.segId)
  if (!seg) return rails
  rails.add(seg.id)
  const queue: { node: string; inSeg: SegmentId; dist: number }[] = [
    { node: seg.from, inSeg: seg.id, dist: segmentPartialLength(net, seg.id, from.t, 0) },
    { node: seg.to, inSeg: seg.id, dist: segmentPartialLength(net, seg.id, from.t, 1) },
  ]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const { node, inSeg, dist: reached } = queue.shift()!
    if (reached > reach) continue
    for (const sid of net.adjacency.get(node) ?? []) {
      if (sid === inSeg) continue
      const key = `${node}>${sid}`
      if (seen.has(key)) continue
      if (!isPassageOpen(net, node, inSeg, sid, { anyPosition: true })) continue
      seen.add(key)
      const next = net.segments.get(sid)
      if (!next || next.from === next.to) continue
      rails.add(sid)
      queue.push({ node: next.from === node ? next.to : next.from, inSeg: sid, dist: reached + segmentPartialLength(net, sid, 0, 1) })
    }
  }
  return rails
}

/** A place of the track and where it is */
export interface PlacedPoint extends TrackPoint {
  at: Point
}

/** The point of these rails nearest to `p`, or null when none of them is there any more */
export function projectOnRails(net: Network, rails: Iterable<SegmentId>, p: Point): PlacedPoint | null {
  let best: PlacedPoint | null = null
  let bestDist = Infinity
  for (const sid of rails) {
    const seg = net.segments.get(sid)
    const proj = seg && projectOnSegment(net, seg, p)
    if (!proj) continue
    const d = dist(proj.point, p)
    if (d < bestDist) {
      bestDist = d
      best = { segId: sid, t: proj.t, at: proj.point }
    }
  }
  return best
}

/** What an end of a platform was caught by */
export type PlatformSnapKind = 'platform-end' | 'platform-across' | 'turnout' | 'rail-end'

/** An end of the platform being laid: the place of the track, and what it was caught by */
export interface PlatformAim extends PlacedPoint {
  /** The thing the end was brought onto, and where it stands (across the track for `platform-across`) */
  snap: { kind: PlatformSnapKind; from: Point } | null
}

/**
 * Bring a place of the track onto what is near it, along `rails`: the end of a platform laid on
 * the same track, or the end of the platform across it (aligned with it), a set of points, the end
 * of the track. Within `snapDistance` metres; the nearest wins. `avoid`: a place it must not be
 * brought onto (the start of the platform, for its end).
 */
export function snapPlatformEnd(
  net: Network,
  rails: ReadonlySet<SegmentId>,
  aim: PlacedPoint,
  dims: PlatformDimensions,
  snapDistance: number,
  avoid: Point | null = null,
): PlatformAim {
  let best: PlatformAim = { ...aim, snap: null }
  let bestDist = snapDistance
  const offer = (point: PlacedPoint, kind: PlatformSnapKind, from: Point): void => {
    const d = dist(point.at, aim.at)
    if (d > bestDist) return
    if (avoid && dist(point.at, avoid) < 1e-6) return
    bestDist = d
    best = { ...point, snap: { kind, from } }
  }
  const across = islandReach(dims)
  for (const platform of net.platforms.values()) {
    for (const edge of platform.edges) {
      const length = edgeLength(net, edge)
      for (const at of [0, length]) {
        const end = pointOnEdge(net, edge, at)
        if (!end || dist(end.point, aim.at) > across + snapDistance) continue
        const onTrack = projectOnRails(net, rails, end.point)
        if (!onTrack) continue
        const gap = dist(onTrack.at, end.point)
        if (gap < 1e-3) offer(onTrack, 'platform-end', end.point)
        else if (gap <= across) offer(onTrack, 'platform-across', end.point)
      }
    }
  }
  for (const node of nodesWithin(net, aim.at, snapDistance)) {
    const adjacent = net.adjacency.get(node.id) ?? []
    const kind: PlatformSnapKind | null =
      adjacent.length >= 3 || findJunctionAtNode(net, node.id) ? 'turnout' : adjacent.length === 1 ? 'rail-end' : null
    if (!kind) continue
    const sid = adjacent.find((id) => rails.has(id))
    const seg = sid && net.segments.get(sid)
    if (!seg) continue
    offer({ segId: seg.id, t: seg.from === node.id ? 0 : 1, at: { ...node.pos } }, kind, { ...node.pos })
  }
  return best
}

/**
 * Where the first click of the tool would start a platform: the track nearest the cursor within
 * `tolerance`, brought onto what is near it. Null off the track.
 */
export function aimPlatformStart(net: Network, cursor: Point, tolerance: number, dims: PlatformDimensions, snapDistance: number): PlatformAim | null {
  const nearest = projectOnRails(net, [...railsWithin(net, cursor, tolerance)].map((seg) => seg.id), cursor)
  if (!nearest || dist(nearest.at, cursor) > tolerance) return null
  return snapPlatformEnd(net, railsAlong(net, nearest, snapDistance * 2), nearest, dims, snapDistance)
}

/** Two tracks around the cursor: how far apart, and whether an island fits between them */
export interface IslandCheck {
  spacing: number
  minSpacing: number
  ok: boolean
}

export interface PlatformPlan {
  start: PlatformAim
  end: PlatformAim
  /** Side of the track the cursor is on, walking from the start to the end */
  side: 'left' | 'right'
  /** Length of the platform along its track, m */
  length: number
  /** `side`: one platform beside the track; `both`: one on each side; `island`: one between two tracks */
  kind: 'side' | 'both' | 'island'
  /** The track across, when the cursor lies between two tracks */
  island: IslandCheck | null
  /** What the click would lay: the edges of each platform. Empty when it would be refused */
  platforms: PlatformEdges[]
  /** Why nothing would be laid */
  refusal: 'no-path' | 'too-short' | null
}

export interface PlatformPlanInput {
  start: TrackPoint
  cursor: Point
  dims: PlatformDimensions
  /** Distance within which an end is caught, metres */
  snapDistance: number
  /** Lay one platform on each side of the track */
  bothSides: boolean
  /** Rail gauge of the layout (1:1 when left out): the reach and the shortest platform follow it */
  gauge?: number
}

/** The heading of a stretch walked from t0 to t1, at `t` */
function headingAt(net: Network, segId: SegmentId, t: number, forward: boolean): Point | null {
  const tangent = tangentOnSegment(net, segId, t)
  if (!tangent) return null
  return forward ? tangent : { x: -tangent.x, y: -tangent.y }
}

/** The side of `p` from a place of the track walked with `heading` */
export function sideOf(p: Point, at: Point, heading: Point): 'left' | 'right' {
  return dot(sub(p, at), sideNormal(heading, 'left')) >= 0 ? 'left' : 'right'
}

/**
 * The track across from `at` (heading `heading`) on the side `normal` points to, up to `reach`
 * metres, running alongside: the rail and the place on it facing `at`. The rails of `own` (the
 * track of the platform) are passed over.
 */
export function trackAcross(net: Network, own: ReadonlySet<SegmentId>, at: Point, heading: Point, normal: Point, reach: number): (PlacedPoint & { spacing: number }) | null {
  let best: (PlacedPoint & { spacing: number }) | null = null
  for (const seg of railsWithin(net, at, reach)) {
    if (own.has(seg.id)) continue
    const proj = projectOnSegment(net, seg, at)
    if (!proj) continue
    const d = sub(proj.point, at)
    const across = dot(d, normal)
    const length = Math.hypot(d.x, d.y)
    if (across <= 1e-6 || length > reach || Math.abs(dot(d, heading)) > 0.25 * length) continue
    const tangent = tangentOnSegment(net, seg.id, proj.t)
    if (!tangent || Math.abs(dot(tangent, heading)) < Math.cos((20 * Math.PI) / 180)) continue
    if (!best || across < best.spacing) best = { segId: seg.id, t: proj.t, at: proj.point, spacing: across }
  }
  return best
}

/** Rails of a list of stretches */
const railsOf = (edge: PlatformEdge): Set<SegmentId> => new Set(edge.track.map((span) => span.segId))

/**
 * The edge facing `edge` on the track across (found at `across`): the same stretch brought onto
 * that track, walked the same way, its side towards `edge`. Null when that track does not run the
 * whole way along.
 */
export function facingEdge(net: Network, edge: PlatformEdge, across: TrackPoint, reach: number, maxGap: number): PlatformEdge | null {
  const own = railsOf(edge)
  const startAt = pointOnEdge(net, edge, 0)
  const endAt = pointOnEdge(net, edge, edgeLength(net, edge))
  if (!startAt || !endAt) return null
  const rails = railsAlong(net, across, reach)
  for (const sid of own) rails.delete(sid)
  const a = projectOnRails(net, rails, startAt.point)
  const b = projectOnRails(net, rails, endAt.point)
  if (!a || !b || dist(a.at, startAt.point) > maxGap || dist(b.at, endAt.point) > maxGap) return null
  const path = findTrackPathToAny(net, a, [b], { blocked: (sid) => own.has(sid) || !rails.has(sid) })
  if (!path || path.spans.length === 0 || path.length < 1e-6) return null
  const first = path.spans[0]
  const heading = headingAt(net, first.segId, first.t0, first.t1 >= first.t0)
  if (!heading) return null
  return { track: path.spans, side: sideOf(startAt.point, a.at, heading) }
}

/**
 * What the second click would lay with the cursor at `cursor`, the start being set. Null when the
 * start is no longer on the track.
 */
export function planPlatform(net: Network, input: PlatformPlanInput): PlatformPlan | null {
  const { start: from, cursor, dims, snapDistance, bothSides } = input
  const k = scaleFactor(input.gauge)
  const startAt = positionOnSegment(net, from.segId, from.t)
  if (!startAt) return null
  const start: PlatformAim = { segId: from.segId, t: from.t, at: startAt, snap: null }
  const reach = PLATFORM_REACH * k
  const rails = railsAlong(net, from, reach)
  const projected = projectOnRails(net, rails, cursor)
  if (!projected) return null
  const end = snapPlatformEnd(net, rails, projected, dims, snapDistance, startAt)

  const refused = (refusal: PlatformPlan['refusal'], length = 0, side: 'left' | 'right' = 'left'): PlatformPlan => ({
    start, end, side, length, kind: bothSides ? 'both' : 'side', island: null, platforms: [], refusal,
  })
  const path = findTrackPathToAny(net, from, [end], { blocked: (sid) => !rails.has(sid) })
  if (!path) return refused('no-path')

  // The heading at the end, walking from the start: the side is read there, where the cursor is
  const last = path.spans[path.spans.length - 1]
  const heading = last
    ? headingAt(net, last.segId, last.t1, last.t1 >= last.t0)
    : headingAt(net, from.segId, from.t, true)
  if (!heading) return null
  const side = sideOf(cursor, end.at, heading)
  if (path.length < MIN_PLATFORM_LENGTH * k) return refused('too-short', path.length, side)

  const edge: PlatformEdge = { track: path.spans, side }
  const plan: PlatformPlan = { start, end, side, length: path.length, kind: 'side', island: null, platforms: [[edge]], refusal: null }
  if (bothSides) {
    plan.kind = 'both'
    plan.platforms = [[{ track: path.spans, side: 'left' }], [{ track: path.spans.map((span) => ({ ...span })), side: 'right' }]]
    return plan
  }

  // The cursor between this track and another one: an island, when there is room for it
  const normal = sideNormal(heading, side)
  const offset = Math.abs(dot(sub(cursor, end.at), normal))
  const across = trackAcross(net, railsOf(edge), end.at, heading, normal, islandReach(dims))
  if (across && offset < across.spacing) {
    plan.island = { spacing: across.spacing, minSpacing: dims.islandMinSpacing, ok: across.spacing >= dims.islandMinSpacing - 1e-9 }
    if (plan.island.ok) {
      const other = facingEdge(net, edge, across, reach, islandReach(dims) * 1.5)
      if (other) {
        plan.kind = 'island'
        plan.platforms = [[edge, other]]
      }
    }
  }
  return plan
}

// ─────────────────── Station ───────────────────

/** A few places along the edges of a platform */
function samples(net: Network, edges: readonly PlatformEdge[]): Point[] {
  const points: Point[] = []
  for (const edge of edges) {
    const length = edgeLength(net, edge)
    for (const share of [0, 0.25, 0.5, 0.75, 1]) {
      const p = pointOnEdge(net, edge, length * share)
      if (p) points.push(p.point)
    }
  }
  return points
}

/**
 * The station a new platform joins: the one of a platform laid right beside it, else the one that
 * stops on its track beside it (a station read from OpenStreetMap, without platforms yet). Being
 * near the place of a station is not enough: two stations may stand 100 m apart. Null: a new
 * station is owed.
 */
export function stationForPlatform(net: Network, edges: readonly PlatformEdge[], gauge?: number): StationId | null {
  const reach = NEIGHBOUR_PLATFORM_REACH * scaleFactor(gauge)
  const mine = samples(net, edges)
  if (mine.length === 0) return null
  const nearest = (p: Point): number => Math.min(...mine.map((q) => dist(p, q)))
  let best: { id: StationId; d: number } | null = null
  for (const platform of net.platforms.values()) {
    if (!net.stations.has(platform.stationId)) continue
    for (const p of samples(net, platform.edges)) {
      const d = nearest(p)
      if (d <= reach && (!best || d < best.d)) best = { id: platform.stationId, d }
    }
  }
  if (best) return best.id
  const spans = edges.flatMap((edge) => edge.track)
  for (const station of net.stations.values()) {
    for (const stop of station.stops) {
      const along = spans.some((span) =>
        span.segId === stop.segId && stop.t >= Math.min(span.t0, span.t1) && stop.t <= Math.max(span.t0, span.t1))
      if (along) return station.id
      const p = positionOnSegment(net, stop.segId, stop.t)
      const d = p ? nearest(p) : Infinity
      if (d <= reach && (!best || d < best.d)) best = { id: station.id, d }
    }
  }
  return best?.id ?? null
}

/** « Gare 1 », « Gare 2 »…: the first such name no station has */
export function nextStationName(net: Network): string {
  const taken = new Set([...net.stations.values()].map((station) => station.name))
  for (let n = 1; ; n++) if (!taken.has(`Gare ${n}`)) return `Gare ${n}`
}

/** The middle of what a plan lays: on the platform beside a track, between the two tracks of an island */
function planMiddle(net: Network, platforms: readonly PlatformEdges[], dims: PlatformDimensions): Point | null {
  const edge = platforms[0]?.[0]
  const mid = edge && pointOnEdge(net, edge, edgeLength(net, edge) / 2)
  if (!mid) return null
  if (platforms.length > 1) {
    // Several platforms: between their tracks (one point for two platforms around one track)
    const mids = platforms.flatMap((edges) => {
      const p = pointOnEdge(net, edges[0], edgeLength(net, edges[0]) / 2)
      return p ? [p.point] : []
    })
    return { x: mids.reduce((sum, p) => sum + p.x, 0) / mids.length, y: mids.reduce((sum, p) => sum + p.y, 0) / mids.length }
  }
  const other = platforms[0][1]
  if (other) {
    const facing = pointOnEdge(net, other, edgeLength(net, other) / 2)
    if (facing) return { x: (mid.point.x + facing.point.x) / 2, y: (mid.point.y + facing.point.y) / 2 }
  }
  const n = sideNormal(mid.heading, edge.side)
  const away = dims.edgeOffset + dims.width / 2
  return { x: mid.point.x + n.x * away, y: mid.point.y + n.y * away }
}

export interface LaidPlatforms {
  platforms: Platform[]
  station: Station
  /** The station was made for them */
  newStation: boolean
}

/**
 * Lay what a plan says: its platforms, with their stop markers, in the station beside them or a
 * new one named « Gare n » at their middle. Null when the plan lays nothing.
 */
export function layPlatforms(net: Network, plan: PlatformPlan, gauge?: number): LaidPlatforms | null {
  return layPlatformGroup(net, plan.platforms, gauge)
}

/**
 * Lay platforms that belong together (each given as its edges), with their stop markers, in the
 * station beside them or a new one named « Gare n » at their middle. Null when there is none.
 */
export function layPlatformGroup(net: Network, group: readonly PlatformEdges[], gauge?: number): LaidPlatforms | null {
  if (group.length === 0) return null
  const dims = platformDimensions(gauge)
  const joined = stationForPlatform(net, group.flat(), gauge)
  let station = joined ? net.stations.get(joined) ?? null : null
  const newStation = !station
  if (!station) {
    const pos = planMiddle(net, group, dims)
    if (!pos) return null
    station = addStation(net, { name: nextStationName(net), pos, stops: [] })
  }
  const platforms = group.map((edges) =>
    addPlatform(net, { stationId: station.id, edges, width: PLATFORM_WIDTH, markers: defaultMarkers(net, edges, dims.markerMargin) }),
  )
  return { platforms, station, newStation }
}

// ─────────────────── Rakes ───────────────────

/** Which rakes of a model a platform holds: one trainset, and two coupled */
export interface RakeFit {
  model: RollingStockModel
  label: string
  single: boolean
  double: boolean
}

/** The rakes a platform `length` metres long holds, each model as it comes and two of it coupled */
export function rakesFitting(length: number, gauge?: number): RakeFit[] {
  // Trains are 1:1: the platform is brought back to 1:1 to compare
  const real = length / scaleFactor(gauge)
  return (Object.keys(ROLLING_STOCK) as RollingStockModel[]).map((model) => {
    const double = rakeOptions(model).find((option) => option.units === 2)
    return {
      model,
      label: ROLLING_STOCK[model].label,
      single: defaultRakeOption(model).length <= real + 1e-9,
      double: double !== undefined && double.length <= real + 1e-9,
    }
  })
}
