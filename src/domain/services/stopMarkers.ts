import type { TrackPosition } from '../models/locomotive'
import { platformsOf } from '../models/platforms'
import { endOverhang, type StockVehicle } from '../models/rollingStock'
import type { Network, Platform, PlatformEdge, PlatformId, SegmentId, Station, StationStop, StopMarker } from '../models/types'
import { segmentEnds, shapeLengthBetween, shapeParamAtDistance } from '../geometry/segmentGeometry'

// ─────────────────── Where the nose of a train stops at a station ───────────────────
//
// A train stops with its nose — the front end of its lead vehicle, its front bogie plus the
// overhang of the body beyond it — on the place the station gives, never its front bogie.
//
// A station with platforms gives it by their stop markers. On each edge of a platform and for each
// direction of travel along it, one marker speaks to a train of a given length (`chooseStopMarker`):
// among the markers of that edge facing the way the train runs, the one with the smallest
// `maxLength` the train fits under; a marker without `maxLength` takes every train and comes last;
// when none takes the train, the one furthest ahead. So a train that comes to a platform edge has
// exactly one place to stop at, which depends on which way it runs along the edge.
//
// A station without platforms (older saves, imports without them) gives its `stops` as they are,
// for either direction: the nose stops on them too (OpenStreetMap's `railway=stop` is where the
// head of a train comes to rest).

/** A place the nose of a train stops at, and the way it runs there */
export interface StopTarget extends StationStop {
  /** The train runs the rail of the stop towards its `to` end (growing t) when it comes to it */
  forward: boolean
  platformId: PlatformId
  edge: 0 | 1
  /** Index of the marker in `Platform.markers` */
  marker: number
}

/** A place to stop at as the route search takes it: a stop, and when it comes from a marker the way it is to be reached */
export type StopGoal = StationStop & { forward?: boolean }

/** Metres from the front bogie of the lead vehicle to the nose of the train */
export function noseOffset(vehicles: readonly StockVehicle[]): number {
  return vehicles.length > 0 ? endOverhang(vehicles, 0, 'front') : 0
}

/**
 * The marker that stops a train of `length` metres among `markers`, all of one edge and one
 * heading (by the rule above); null when there is none. Ahead is towards the end of the edge for
 * the heading `forward`, towards its start for `backward`.
 */
export function chooseStopMarker<M extends StopMarker>(markers: readonly M[], length: number): M | null {
  if (markers.length === 0) return null
  const ahead = (m: M): number => (m.heading === 'forward' ? m.at : -m.at)
  const furthest = (list: readonly M[]): M => list.reduce((best, m) => (ahead(m) > ahead(best) ? m : best))
  const limit = (m: M): number => m.maxLength ?? Infinity
  const taking = markers.filter((m) => limit(m) >= length)
  if (taking.length === 0) return furthest(markers)
  const least = Math.min(...taking.map(limit))
  return furthest(taking.filter((m) => limit(m) === least))
}

/** The place `at` metres along an edge, held to it, with the way the edge runs its rail there; null without track */
function placeOnEdge(net: Network, edge: PlatformEdge, at: number): { segId: SegmentId; t: number; edgeForward: boolean } | null {
  let left = Math.max(0, at)
  let last: { segId: SegmentId; t: number; edgeForward: boolean } | null = null
  for (const span of edge.track) {
    const seg = net.segments.get(span.segId)
    const ends = seg && segmentEnds(net, seg)
    if (!ends) continue
    const length = shapeLengthBetween(ends, span.t0, span.t1)
    const sign = span.t1 >= span.t0 ? 1 : -1
    const t = left <= length ? shapeParamAtDistance(ends, span.t0, sign * left) : span.t1
    last = { segId: span.segId, t, edgeForward: sign > 0 }
    if (left <= length) return last
    left -= length
  }
  return last
}

/** The stop targets of one platform for a train of `length` metres: one per edge and heading that has markers */
export function platformStopTargets(net: Network, platform: Platform, length: number): StopTarget[] {
  const targets: StopTarget[] = []
  platform.edges.forEach((edge, edgeIndex) => {
    for (const heading of ['forward', 'backward'] as const) {
      const markers = platform.markers.map((marker, index) => ({ ...marker, index })).filter((m) => m.edge === edgeIndex && m.heading === heading)
      const chosen = chooseStopMarker(markers, length)
      const place = chosen && placeOnEdge(net, edge, chosen.at)
      if (!chosen || !place) continue
      const target: StopTarget = {
        segId: place.segId,
        t: place.t,
        forward: heading === 'forward' ? place.edgeForward : !place.edgeForward,
        platformId: platform.id,
        edge: edgeIndex as 0 | 1,
        marker: chosen.index,
      }
      if (edge.ref !== undefined) target.ref = edge.ref
      targets.push(target)
    }
  })
  return targets
}

/** The stop targets of every platform of a station for a train of `length` metres, in the order of the platforms; none without platforms */
export function stationStopTargets(net: Network, station: Station, length: number): StopTarget[] {
  return platformsOf(net, station.id).flatMap((platform) => platformStopTargets(net, platform, length))
}

/**
 * Where a train of `length` metres may stop at a station, as the route search takes it: the
 * targets of its platforms, each to be reached running its way; for a station without
 * platforms, its stops, either way. Only places on rails of the network.
 */
export function stationStopGoals(net: Network, station: Station, length: number): StopGoal[] {
  const platforms = net.platforms.size > 0 ? platformsOf(net, station.id) : []
  const goals: StopGoal[] = platforms.length > 0 ? platforms.flatMap((platform) => platformStopTargets(net, platform, length)) : station.stops
  return goals.filter((goal) => net.segments.has(goal.segId))
}

/**
 * The target of a station for a train of `length` metres arriving at `at` (a place on the track
 * and the way it runs): the one of the platform edge whose track it is on, for the way it runs
 * along it. Null when it is on no edge of the station, or that edge has no marker for its way.
 */
export function stopTargetOnArrival(net: Network, station: Station, length: number, at: TrackPosition): StopTarget | null {
  for (const platform of platformsOf(net, station.id)) {
    for (const target of platformStopTargets(net, platform, length)) {
      const edge = platform.edges[target.edge]
      if (!edge) continue
      const span = edge.track.find((s) => s.segId === at.segId && at.t >= Math.min(s.t0, s.t1) - 1e-9 && at.t <= Math.max(s.t0, s.t1) + 1e-9)
      if (!span) continue
      // The way the train runs along the edge, read on the span it is on
      const runsWithEdge = (span.t1 >= span.t0) === at.forward
      const targetWithEdge = platform.markers[target.marker].heading === 'forward'
      if (runsWithEdge === targetWithEdge) return target
    }
  }
  return null
}
