import { segmentPartialLength, type TrackPosition } from '../models/locomotive'
import { findJunctionAtNode, isPassageOpen } from '../models/routing'
import type { Network, NodeId, SegmentId, Station, TrackSpan } from '../models/types'
import type { LineSettings } from '../models/speedLimits'
import { speedLimitOverSpans } from '../models/trackSpeed'
import { stationStopGoals, type StopGoal } from './stopMarkers'
import { findTrackPathToAny, type TrackPath, type TrackPathOptions, type TrackPoint } from './trackPath'
import { runningToll, sumTolls } from './runningDirection'

// ─────────────────── The way to the next station, rail by rail ───────────────────
//
// What an itinerary becomes on the track that is loaded: the shortest way a train could run from
// where its lead bogie is to a platform of the station it heads for — or, while that station is
// on a line not loaded yet, to the node where the loaded track meets the way there (a gate).
// Found once and then only measured: where the train is along it says how far is left.
//
// The way ends where the NOSE of the train is to stop (`stopMarkers.ts`): at a station with
// platforms, the marker of the platform edge that speaks to the train's length and to the way it
// comes to the edge; at one without, a stop of the station. What is left along it is measured from
// the lead bogie: the nose is `noseOffset` metres nearer.

export interface RouteGuide {
  path: TrackPath
  /** Length left from the start of each stretch of the path to its end, m */
  left: number[]
  /** A platform of the station, or the gate towards it on the edge of what is loaded */
  target: 'platform' | 'gate'
  /** The stop reached, for a platform: where the nose stops (with the way it is reached, for a marker) */
  stop?: StopGoal
  /** The way starts behind the train: it has to be driven from its other cab */
  behind: boolean
}

function guideOf(net: Network, path: TrackPath, target: RouteGuide['target'], behind: boolean, stop?: StopGoal): RouteGuide {
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

/** Where a train goes on after the station it heads for: the next station of its itinerary, or the gates towards it */
export interface Beyond {
  station?: Station
  gates?: readonly NodeId[]
}

/** How many platforms of a terminus are looked for from what lies beyond (a search each) */
const TERMINUS_PLATFORMS = 4

/**
 * The platforms of a station a train can call at and go on from to what lies beyond: those the
 * way onward runs through; or, at a terminus (no way runs through), the nearest ones from which
 * there is a way out towards it — the train changes ends there.
 */
function onwardStops(net: Network, from: TrackPoint, leaving: 0 | 1, stops: readonly StopGoal[], beyond: Beyond, blocked: TrackPathOptions['blocked'], toll: TrackPathOptions['toll']): StopGoal[] {
  const onward = (beyond.station?.stops ?? []).filter((stop) => net.segments.has(stop.segId))
  const goals: TrackPoint[] = onward.length > 0 ? onward : (beyond.gates ?? []).flatMap((nodeId) => railEndsAt(net, nodeId))
  if (goals.length === 0) return []
  const way = findTrackPathToAny(net, from, goals, { leaving, blocked, toll })
  const through = way ? stops.filter((stop) => way.spans.some((span) => span.segId === stop.segId && within(span.t0, span.t1, stop.t) && runsTheWay(span, stop))) : []
  if (through.length > 0) return through
  // A way runs the same both ways: the platforms reached from beyond are those it is reached from
  const reached: StopGoal[] = []
  const pool = [...stops]
  while (pool.length > 0 && reached.length < TERMINUS_PLATFORMS) {
    // Walked from beyond back to the platform: the train runs it the other way
    const back = findTrackPathToAny(net, goals[0], pool, { blocked, toll: runningToll(net, true) })
    if (!back) break
    reached.push(pool[back.goal])
    pool.splice(back.goal, 1)
  }
  return reached
}

/**
 * The way from the lead bogie of a train to the nearest platform of `station`, or — when the
 * station has no platform on the track loaded — to the nearest of `gates` (nodes of the track).
 * Ahead of the train when there is such a way, else behind it (`behind`). Null when neither.
 * With `beyond` (the train goes on afterwards), a platform the way onward runs through is taken
 * rather than the nearest one, which may be a bay it could only leave backwards.
 * At a terminus, a platform it can leave towards it from the other cab.
 */
export function findRouteGuide(
  net: Network,
  lead: TrackPosition,
  station: Station | undefined,
  gates: readonly NodeId[] = [],
  beyond?: Beyond,
  /** Rails the train must keep off (see `TrackPathOptions.blocked`) */
  blocked?: TrackPathOptions['blocked'],
  /** What makes one way better than another as short (see `TrackPathOptions.toll`): a track another train is on. The track run against its normal direction is paid for in any case (`runningToll`) */
  toll?: TrackPathOptions['toll'],
  /** Length of the train, m: which stop marker of a platform it stops at (unknown: the one for every train) */
  trainLength = Infinity,
): RouteGuide | null {
  // Running on the normal track of a double line is paid for on top of what the caller pays
  toll = sumTolls(runningToll(net), toll)
  let stops = station ? stationStopGoals(net, station, trainLength) : []
  const target: RouteGuide['target'] = stops.length > 0 ? 'platform' : 'gate'
  const from = { segId: lead.segId, t: lead.t }
  if (beyond && stops.length > 1) {
    const onward = onwardStops(net, from, lead.forward ? 1 : 0, stops, beyond, blocked, toll)
    // Unless the train cannot get to any of them: the nearest platform then, as without a beyond
    if (onward.length > 0 && (findTrackPathToAny(net, from, onward, { leaving: lead.forward ? 1 : 0, blocked, toll }) ?? findTrackPathToAny(net, from, onward, { leaving: lead.forward ? 0 : 1, blocked, toll }))) stops = onward
  }
  const goals: TrackPoint[] = target === 'platform' ? stops : gates.flatMap((nodeId) => railEndsAt(net, nodeId))
  if (goals.length === 0) return null
  const ahead = findTrackPathToAny(net, from, goals, { leaving: lead.forward ? 1 : 0, blocked, toll })
  const found = ahead ?? findTrackPathToAny(net, from, goals, { leaving: lead.forward ? 0 : 1, blocked, toll })
  if (!found) return null
  return guideOf(net, { spans: found.spans, length: found.length }, target, !ahead, target === 'platform' ? stops[found.goal] : undefined)
}

/** A stretch runs its rail the way a stop wants to be reached (a stretch without length, either way) */
function runsTheWay(span: TrackSpan, stop: StopGoal): boolean {
  return stop.forward === undefined || span.t0 === span.t1 || (span.t1 > span.t0) === stop.forward
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

/**
 * Seconds from the start of each stretch of the guide to its end, run at the limit of the track
 * (line speed, zones, curves: `speedLimitOverSpans`) and never faster than `maxSpeed` m/s. Starting,
 * stopping and the signals are not counted: it is the least the way takes.
 */
export function guideDurations(net: Network, guide: RouteGuide, line: LineSettings, maxSpeed: number): number[] {
  const { spans } = guide.path
  const durations: number[] = new Array<number>(spans.length)
  let after = 0
  for (let i = spans.length - 1; i >= 0; i--) {
    const length = guide.left[i] - (i + 1 < spans.length ? guide.left[i + 1] : 0)
    const speed = Math.min(speedLimitOverSpans(net, [spans[i]], line) / 3.6, maxSpeed)
    if (speed > 0) after += length / speed
    durations[i] = after
  }
  return durations
}

/**
 * Seconds left on the guide for a train `left` metres from its end (`guideLeft`), from the
 * `guideDurations` of that guide.
 */
export function guideDurationLeft(guide: RouteGuide, durations: readonly number[], left: number): number {
  const lengths = guide.left
  for (let i = lengths.length - 1; i >= 0; i--) {
    if (lengths[i] < left) continue
    const restLength = i + 1 < lengths.length ? lengths[i + 1] : 0
    const restTime = i + 1 < lengths.length ? durations[i + 1] : 0
    const stretch = lengths[i] - restLength
    return restTime + (stretch > 0 ? ((durations[i] - restTime) * (left - restLength)) / stretch : 0)
  }
  return durations[0] ?? 0
}

/** Index of the stretch of the guide the lead bogie is on; -1 when it is not on the way */
function stretchAt(guide: RouteGuide, at: TrackPoint): number {
  return guide.path.spans.findIndex((span) => span.segId === at.segId && within(span.t0, span.t1, at.t))
}

/** A set of points the guide passes, with the two rails it passes between */
export interface GuidePoints {
  nodeId: NodeId
  inSeg: SegmentId
  outSeg: SegmentId
  /** Metres from the lead bogie to the node */
  distance: number
}

/**
 * The points on the way within `reach` metres ahead of the lead bogie that are not set for it,
 * nearest first: the nodes with a route table where the guide passes between two rails the
 * table does not open as it stands. None when the train is off the way.
 */
export function pointsAgainstGuide(net: Network, guide: RouteGuide, at: TrackPoint, reach: number): GuidePoints[] {
  const start = stretchAt(guide, at)
  const here = guideLeft(net, guide, at)
  if (start < 0 || here === null) return []
  const { spans } = guide.path
  const against: GuidePoints[] = []
  for (let i = start; i + 1 < spans.length; i++) {
    const distance = here - guide.left[i + 1]
    if (distance > reach) break
    const span = spans[i]
    const next = spans[i + 1]
    if (span.segId === next.segId) continue
    const seg = net.segments.get(span.segId)
    if (!seg) continue
    const nodeId = span.t1 >= span.t0 ? seg.to : seg.from
    if (!findJunctionAtNode(net, nodeId) || isPassageOpen(net, nodeId, span.segId, next.segId)) continue
    against.push({ nodeId, inSeg: span.segId, outSeg: next.segId, distance })
  }
  return against
}

/**
 * The stretches of the guide from the lead bogie on, as far as `reach` metres: what is drawn of
 * the way. Empty when the train is off it.
 */
export function guideAhead(net: Network, guide: RouteGuide, at: TrackPoint, reach: number): TrackSpan[] {
  const start = stretchAt(guide, at)
  const here = guideLeft(net, guide, at)
  if (start < 0 || here === null) return []
  const { spans } = guide.path
  const ahead: TrackSpan[] = [{ segId: spans[start].segId, t0: at.t, t1: spans[start].t1 }]
  for (let i = start + 1; i < spans.length; i++) {
    if (here - guide.left[i] > reach) break
    ahead.push(spans[i])
  }
  return ahead
}
