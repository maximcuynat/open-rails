import { segmentPartialLength, type TrackPosition } from '../models/locomotive'
import type { Network, NodeId, Station, StationStop } from '../models/types'
import { findTrackPathToAny, type TrackPath, type TrackPoint } from './trackPath'

// ─────────────────── The way to the next station, rail by rail ───────────────────
//
// What an itinerary becomes on the track that is loaded: the shortest way a train could run from
// where its lead bogie is to a platform of the station it heads for — or, while that station is
// on a line not loaded yet, to the node where the loaded track meets the way there (a gate).
// Found once and then only measured: where the train is along it says how far is left.

export interface RouteGuide {
  path: TrackPath
  /** Length left from the start of each stretch of the path to its end, m */
  left: number[]
  /** A platform of the station, or the gate towards it on the edge of what is loaded */
  target: 'platform' | 'gate'
  /** The stop reached, for a platform */
  stop?: StationStop
  /** The way starts behind the train: it has to be driven from its other cab */
  behind: boolean
}

function guideOf(net: Network, path: TrackPath, target: RouteGuide['target'], behind: boolean, stop?: StationStop): RouteGuide {
  const left: number[] = new Array<number>(path.spans.length)
  let after = 0
  for (let i = path.spans.length - 1; i >= 0; i--) {
    const span = path.spans[i]
    after += segmentPartialLength(net, span.segId, span.t0, span.t1)
    left[i] = after
  }
  const guide: RouteGuide = { path, left, target, behind }
  if (stop) guide.stop = stop
  return guide
}

/** Every rail end at a node, as a place on the track */
function railEndsAt(net: Network, nodeId: NodeId): TrackPoint[] {
  const ends: TrackPoint[] = []
  for (const segId of net.adjacency.get(nodeId) ?? []) {
    const seg = net.segments.get(segId)
    if (seg) ends.push({ segId, t: seg.from === nodeId ? 0 : 1 })
  }
  return ends
}

/**
 * The way from the lead bogie of a train to the nearest platform of `station`, or — when the
 * station has no platform on the track loaded — to the nearest of `gates` (nodes of the track).
 * Ahead of the train when there is such a way, else behind it (`behind`). Null when neither.
 */
export function findRouteGuide(net: Network, lead: TrackPosition, station: Station | undefined, gates: readonly NodeId[] = []): RouteGuide | null {
  const stops = (station?.stops ?? []).filter((stop) => net.segments.has(stop.segId))
  const target: RouteGuide['target'] = stops.length > 0 ? 'platform' : 'gate'
  const goals: TrackPoint[] = target === 'platform' ? stops : gates.flatMap((nodeId) => railEndsAt(net, nodeId))
  if (goals.length === 0) return null
  const from = { segId: lead.segId, t: lead.t }
  const ahead = findTrackPathToAny(net, from, goals, { leaving: lead.forward ? 1 : 0 })
  const found = ahead ?? findTrackPathToAny(net, from, goals, { leaving: lead.forward ? 0 : 1 })
  if (!found) return null
  return guideOf(net, { spans: found.spans, length: found.length }, target, !ahead, target === 'platform' ? stops[found.goal] : undefined)
}

/** How far along a stretch walked from `t0` to `t1` the parameter `t` is; null when it is not on it */
function within(t0: number, t1: number, t: number): boolean {
  const eps = 1e-9
  return t0 <= t1 ? t >= t0 - eps && t <= t1 + eps : t <= t0 + eps && t >= t1 - eps
}

/**
 * Metres left on the guide for a train whose lead bogie is at `at`; null when it is no longer on
 * the way (it took another branch, or ran past the end): the guide is to be found again.
 */
export function guideLeft(net: Network, guide: RouteGuide, at: TrackPoint): number | null {
  const { spans } = guide.path
  if (spans.length === 0) return 0
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]
    if (span.segId !== at.segId || !within(span.t0, span.t1, at.t)) continue
    const rest = i + 1 < spans.length ? guide.left[i + 1] : 0
    return segmentPartialLength(net, span.segId, at.t, span.t1) + rest
  }
  return null
}
