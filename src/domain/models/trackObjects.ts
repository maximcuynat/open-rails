import type { Network, Segment, SegmentId, TrackSpan } from './types'
import type { TrackPosition } from './locomotive'

// ─────────────────── Objects attached to the track ───────────────────
//
// A place on the track is named by a rail and a parameter on it (`segId`, `t`), and the id of a
// rail does not survive an edit: cutting a rail makes two new ones, dissolving a node merges two
// into a new one, a duplicate is dropped in favour of the rail under it. Every operation of the
// domain that does so describes it as a `RailReplacement` and hands it to `replaceRail`
// (`models/network.ts`), the one place from which whatever is attached to the track is moved to the
// new rails. The functions below do that move for a position and for a stretch; they are pure.

/** Parameters closer than this are the same place on a rail */
export const TRACK_T_EPSILON = 1e-9

/**
 * One rail standing for a stretch of a replaced rail: the stretch `from`…`to` of the old rail
 * (`from` ≤ `to`) now lies on rail `segId` between its parameters `start` and `end`, linearly.
 * `start` > `end` when the new rail runs the other way.
 */
export interface RailPiece {
  segId: SegmentId
  from: number
  to: number
  start: number
  end: number
}

/**
 * "Rail `oldId` is replaced by these pieces". No piece at all: the rail is removed. A stretch of
 * the old rail no piece stands for is gone as well.
 */
export interface RailReplacement {
  oldId: SegmentId
  pieces: RailPiece[]
}

/**
 * The piece `seg` as the stand-in for the stretch `from`…`to` of an old rail, lying on `seg` between
 * `start` and `end` measured the way the old rail runs; `sameWay` is false when `seg` runs against it.
 */
export function railPiece(seg: Segment, from: number, to: number, sameWay: boolean, start = 0, end = 1): RailPiece {
  return sameWay
    ? { segId: seg.id, from, to, start, end }
    : { segId: seg.id, from, to, start: 1 - start, end: 1 - end }
}

/** A rail cut at its parameter `t` into `first` (towards its `from` node) and `second` (towards its `to` node). */
export function splitReplacement(old: Segment, t: number, first: Segment, second: Segment): RailReplacement {
  return {
    oldId: old.id,
    // A half may be a rail that already lay there, in either orientation
    pieces: [railPiece(first, 0, t, first.from === old.from), railPiece(second, t, 1, second.to === old.to)],
  }
}

/**
 * Two rails meeting at a node merged into `merged`, which joins their far ends: `first` takes the
 * share `firstLength / (firstLength + secondLength)` of it from the far end of `first`.
 * Returns one replacement per old rail.
 */
export function mergeReplacements(
  first: Segment,
  firstLength: number,
  second: Segment,
  secondLength: number,
  sharedNodeId: string,
  merged: Segment,
): [RailReplacement, RailReplacement] {
  const total = firstLength + secondLength
  const share = total > 0 ? firstLength / total : 0.5
  // Measured from the far end of `first`: `first` lies on 0…share, `second` on share…1
  const sameWay = merged.from === (first.from === sharedNodeId ? first.to : first.from)
  const firstPiece = first.to === sharedNodeId ? railPiece(merged, 0, 1, sameWay, 0, share) : railPiece(merged, 0, 1, sameWay, share, 0)
  const secondPiece = second.from === sharedNodeId ? railPiece(merged, 0, 1, sameWay, share, 1) : railPiece(merged, 0, 1, sameWay, 1, share)
  return [
    { oldId: first.id, pieces: [firstPiece] },
    { oldId: second.id, pieces: [secondPiece] },
  ]
}

/** A rail dropped in favour of `survivor`, which joins the same two nodes with the same shape. */
export function duplicateReplacement(dropped: Segment, survivor: Segment): RailReplacement {
  return { oldId: dropped.id, pieces: [railPiece(survivor, 0, 1, survivor.from === dropped.from)] }
}

/** A rail removed without anything taking its place. */
export function removalReplacement(oldId: SegmentId): RailReplacement {
  return { oldId, pieces: [] }
}

function mapParam(piece: RailPiece, t: number): number {
  const width = piece.to - piece.from
  const mapped = width > 0 ? piece.start + ((t - piece.from) / width) * (piece.end - piece.start) : piece.start
  return Math.max(0, Math.min(1, mapped))
}

/**
 * A stretch after a rail replacement, in the order it is walked, with `null` wherever part of it
 * is gone (removed rail). A stretch that straddles a cut comes back as two; one on another rail
 * comes back as it is.
 */
export function remapTrackSpanParts(span: TrackSpan, replacement: RailReplacement): (TrackSpan | null)[] {
  if (span.segId !== replacement.oldId) return [span]
  const ascending = span.t0 <= span.t1
  const lo = Math.min(span.t0, span.t1)
  const hi = Math.max(span.t0, span.t1)
  const isPoint = hi - lo < TRACK_T_EPSILON
  const pieces = [...replacement.pieces].sort((p, q) => p.from - q.from)
  if (!ascending) pieces.reverse()

  const parts: (TrackSpan | null)[] = []
  let cursor = span.t0
  for (const piece of pieces) {
    const a = Math.max(lo, piece.from)
    const b = Math.min(hi, piece.to)
    if (b < a) continue
    // A piece the stretch only touches at one end carries none of it
    if (!isPoint && b - a < TRACK_T_EPSILON) continue
    const enter = ascending ? a : b
    const leave = ascending ? b : a
    if (Math.abs(enter - cursor) > TRACK_T_EPSILON) parts.push(null)
    parts.push({ segId: piece.segId, t0: mapParam(piece, enter), t1: mapParam(piece, leave) })
    cursor = leave
    if (isPoint) break
  }
  if (Math.abs(cursor - span.t1) > TRACK_T_EPSILON) parts.push(null)
  return parts
}

/** A stretch after a rail replacement: the stretches that stand for it, in the order they are walked. */
export function remapTrackSpan(span: TrackSpan, replacement: RailReplacement): TrackSpan[] {
  return remapTrackSpanParts(span, replacement).filter((part): part is TrackSpan => part !== null)
}

/**
 * A position after a rail replacement: on the piece that stands for its place, facing the same way
 * in the world (`forward` is flipped on a piece that runs the other way). Null when its rail is
 * gone; a position on another rail comes back as it is.
 */
export function remapTrackPosition(pos: TrackPosition, replacement: RailReplacement): TrackPosition | null {
  if (pos.segId !== replacement.oldId) return pos
  const piece = replacement.pieces.find((p) => pos.t >= p.from - TRACK_T_EPSILON && pos.t <= p.to + TRACK_T_EPSILON)
  if (!piece) return null
  return { segId: piece.segId, t: mapParam(piece, pos.t), forward: piece.end < piece.start ? !pos.forward : pos.forward }
}

// ─────────────────── Listeners ───────────────────

export type RailReplacementListener = (net: Network, replacement: RailReplacement) => void

const listeners = new WeakMap<Network, Set<RailReplacementListener>>()

/**
 * Be told of every rail replacement of one network, for what follows the track without being
 * stored in `Network` (trains, for instance). What `Network` holds itself is moved by `replaceRail`
 * directly. A network read back from a save (load, undo, redo) is another object: listen again.
 * Returns the function that stops listening.
 */
export function onRailReplaced(net: Network, listener: RailReplacementListener): () => void {
  let set = listeners.get(net)
  if (!set) {
    set = new Set()
    listeners.set(net, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}

/** Called by `replaceRail` only. */
export function notifyRailReplaced(net: Network, replacement: RailReplacement): void {
  const set = listeners.get(net)
  if (!set) return
  for (const listener of [...set]) listener(net, replacement)
}
