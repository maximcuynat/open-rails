import type { Network, Point, Signal, SignalId, SignalRole } from '../models/types'
import { positionOnSegment, segmentArcLength, segmentPartialLength, tangentOnSegment, walkBackward } from '../models/locomotive'
import { entriesOf } from '../models/routing'
import {
  SIGNAL_SWITCH_CLEARANCE,
  addSignal,
  addSignalPair,
  checkSignalPlacement,
  isSwitchNode,
  moveSignal,
  type SignalOptions,
  type SignalPlacementOptions,
  type SignalRefusal,
  type SignalResult,
} from '../models/signals'
import { findTrackPath, type TrackPoint } from './trackPath'

/** World position of a signal on its rail, null when the rail is gone. */
export function signalWorldPosition(net: Network, signal: Signal): Point | null {
  return positionOnSegment(net, signal.segId, signal.t)
}

/**
 * Unit direction of travel a signal speaks to, in the world: trains it addresses run this way past
 * it. Its face is turned the other way, and it stands by convention on the left of that direction.
 */
export function signalHeading(net: Network, signal: Signal): Point | null {
  const tangent = tangentOnSegment(net, signal.segId, signal.t)
  if (!tangent) return null
  return signal.forward ? tangent : { x: -tangent.x, y: -tangent.y }
}

/**
 * The `forward` of a signal at `place` for trains running in the world direction `heading`
 * (for instance from the side of the track the pointer is on, or from a drag along the track).
 */
export function signalForwardFor(net: Network, place: TrackPoint, heading: Point): boolean {
  const tangent = tangentOnSegment(net, place.segId, place.t)
  if (!tangent) return true
  return tangent.x * heading.x + tangent.y * heading.y >= 0
}

/**
 * Move a signal along the track to `place`, keeping the direction of travel it speaks to: the way
 * from where it stands to `place` is followed (`findTrackPath`), so the signal comes out the right
 * way round on a rail that runs the other way. Refused when no way joins the two places, or where
 * a new signal would be (see `checkSignalPlacement`).
 */
export function slideSignal(net: Network, id: SignalId, place: TrackPoint, options: SignalPlacementOptions = {}): SignalResult {
  const signal = net.signals.get(id)
  if (!signal || !net.segments.has(place.segId)) return { ok: false, reason: 'off-track' }
  const path = findTrackPath(net, { segId: signal.segId, t: signal.t }, place)
  if (!path) return { ok: false, reason: 'off-track' }
  let forward = signal.forward
  const first = path.spans[0]
  const last = path.spans[path.spans.length - 1]
  if (first && last) {
    // Does the signal speak to trains running along the path, or against it? The same holds at the far end
    const along = first.t1 > first.t0 === signal.forward
    forward = last.t1 > last.t0 === along
  }
  return moveSignal(net, id, place, forward, options)
}

/** What laying a row of signals did */
export interface SignalRowResult {
  signals: Signal[]
  /** The places where a signal was refused, and why */
  refused: { place: TrackPoint; reason: SignalRefusal }[]
}

/**
 * Lay signals in a row from `a` to `b` along the shortest way between them, one every `spacing`
 * metres starting at `a`, all speaking to trains running from `a` to `b` — and, with `bothWays`, a
 * second signal back to back with each for the other direction. A place where a signal cannot
 * stand is skipped and reported. Nothing is laid when no way joins the two points.
 */
export function addSignalRow(
  net: Network,
  a: TrackPoint,
  b: TrackPoint,
  spacing: number,
  role: SignalRole,
  options: SignalOptions & SignalPlacementOptions & { bothWays?: boolean } = {},
): SignalRowResult {
  const result: SignalRowResult = { signals: [], refused: [] }
  const places = signalRowPlaces(net, a, b, spacing)
  for (const { place, forward } of places) {
    if (options.bothWays) {
      const laid = addSignalPair(net, place, role, options)
      if (laid.ok) result.signals.push(...laid.signals)
      else result.refused.push({ place, reason: laid.reason })
    } else {
      const laid = addSignal(net, place, forward, role, options)
      if (laid.ok) result.signals.push(laid.signal)
      else result.refused.push({ place, reason: laid.reason })
    }
  }
  return result
}

/**
 * The places `addSignalRow` would lay its signals at, with the `forward` of each (for the preview
 * while the row is being drawn). Empty when no way joins the two points or `spacing` is not positive.
 */
export function signalRowPlaces(net: Network, a: TrackPoint, b: TrackPoint, spacing: number): { place: TrackPoint; forward: boolean }[] {
  if (!(spacing > 0)) return []
  const path = findTrackPath(net, a, b)
  if (!path) return []
  if (path.spans.length === 0) return [{ place: { segId: a.segId, t: a.t }, forward: true }]
  const places: { place: TrackPoint; forward: boolean }[] = []
  let travelled = 0
  let nextAt = 0
  for (const span of path.spans) {
    // Places are spread by parameter within a rail: exact on a straight rail, close enough on a curve
    const length = segmentPartialLength(net, span.segId, span.t0, span.t1)
    while (length > 0 && nextAt <= travelled + length + 1e-9) {
      const share = Math.max(0, Math.min(1, (nextAt - travelled) / length))
      places.push({ place: { segId: span.segId, t: span.t0 + (span.t1 - span.t0) * share }, forward: span.t1 > span.t0 })
      nextAt += spacing
    }
    travelled += length
  }
  return places
}

/** What `moveSignalsOffSwitches` did */
export interface SignalClearanceResult {
  /** Signals pushed back clear of the points */
  moved: SignalId[]
  /** Signals left where they stand, too near points: the signalling report names them */
  stuck: SignalId[]
}

/** Standard gauge (m): the clearance of `signals.ts` is given for it */
const REFERENCE_GAUGE = 1.435
/** A signal pushed back stands this much further than the clearance asks, so that rounding never leaves it inside */
const CLEARANCE_MARGIN = 1.001

/**
 * Where a signal standing too near points goes: back along the way its trains come by, to the
 * clearance before those points. Points right ahead of it: further back on its own rail. Points
 * right behind it: across them, onto the rail that leads there when there is only one (the stem,
 * for a signal on a branch). Null when the rail is too short or when two rails lead there.
 */
function approachPlace(net: Network, signal: Signal, clearance: number): { segId: string; t: number; forward: boolean } | null {
  const seg = net.segments.get(signal.segId)
  if (!seg) return null
  const aheadT = signal.forward ? 1 : 0
  const behindT = 1 - aheadT
  const aheadNode = signal.forward ? seg.to : seg.from
  const behindNode = signal.forward ? seg.from : seg.to
  if (isSwitchNode(net, aheadNode) && segmentPartialLength(net, seg.id, signal.t, aheadT) < clearance) {
    if (segmentArcLength(net, seg.id) < clearance) return null
    return walkBackward(net, seg.id, aheadT, signal.forward, clearance)
  }
  if (isSwitchNode(net, behindNode) && segmentPartialLength(net, seg.id, signal.t, behindT) < clearance) {
    if (entriesOf(net, behindNode, seg.id, { anyPosition: true }).length !== 1) return null
    return walkBackward(net, seg.id, behindT, signal.forward, clearance)
  }
  return null
}

/**
 * Push back the signals that points or a crossing built since they were laid have left too near
 * (`checkSignalPlacement` would refuse them, `on-switch`): each goes back along its approach to the
 * clearance before the points, still speaking to the same direction of travel. A signal that
 * cannot — rail too short, two rails leading there, another signal in the way — stays where it is
 * and is returned in `stuck`. Does nothing, at the cost of one check per signal, when all stand clear.
 */
export function moveSignalsOffSwitches(net: Network, options: SignalPlacementOptions = {}): SignalClearanceResult {
  const result: SignalClearanceResult = { moved: [], stuck: [] }
  if (net.signals.size === 0) return result
  const gauge = options.gauge
  const scale = typeof gauge === 'number' && gauge > 0 ? gauge / REFERENCE_GAUGE : 1
  const clearance = SIGNAL_SWITCH_CLEARANCE * scale * CLEARANCE_MARGIN
  for (const signal of [...net.signals.values()]) {
    if (checkSignalPlacement(net, signal, signal.forward, { ...options, ignoreId: signal.id }) !== 'on-switch') continue
    const place = approachPlace(net, signal, clearance)
    const moved = place ? moveSignal(net, signal.id, { segId: place.segId, t: place.t }, place.forward, options) : null
    if (moved?.ok) result.moved.push(signal.id)
    else result.stuck.push(signal.id)
  }
  return result
}
