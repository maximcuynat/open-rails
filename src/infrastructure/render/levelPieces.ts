import type { Network, NodeId, Point, Segment } from '@domain/models/types'
import { derivativeOnShape, pointOnShape, segmentEnds } from '@domain/geometry/segmentGeometry'
import { LEVEL_CLEARANCE, segmentEndLevels, segmentHeightAt } from '@domain/models/network'

// ─────────────────── Drawing bands of a track with heights ───────────────────
//
// A rail is drawn level by level (see `renderNetworkWithTrains`). A flat rail belongs to one level;
// a ramp is cut where its height crosses a half level, so that each piece is drawn — and styled —
// with the level it is really at: on the ground up to half a level, on a bridge deck above
// `LEVEL_CLEARANCE`, in a tunnel below `−LEVEL_CLEARANCE`. It is the rule the domain uses to decide
// whether two tracks meet.

const HEIGHT_EPSILON = 1e-9

/**
 * Whole level a height is drawn with: the nearest one, a half level going to the side of the
 * ground (0.5 → 0, 0.6 → 1, 1.5 → 1, −0.5 → 0, −0.6 → −1).
 */
export function heightBand(height: number): number {
  if (height > LEVEL_CLEARANCE + HEIGHT_EPSILON) return Math.ceil(height - LEVEL_CLEARANCE - HEIGHT_EPSILON)
  if (height < -LEVEL_CLEARANCE - HEIGHT_EPSILON) return Math.floor(height + LEVEL_CLEARANCE + HEIGHT_EPSILON)
  return 0
}

/** Part of a rail (parameters `t0` → `t1`) that is drawn with one level */
export interface LevelPiece {
  t0: number
  t1: number
  band: number
}

/**
 * A rail cut into the pieces drawn with each level, from `from` to `to`. One piece covering the
 * whole rail (`t0` 0, `t1` 1) when it is flat or stays within one level.
 */
export function segmentLevelPieces(net: Network, seg: Segment): LevelPiece[] {
  const ends = segmentEndLevels(net, seg)
  if (ends.from === ends.to) return [{ t0: 0, t1: 1, band: heightBand(ends.from) }]
  const low = Math.min(ends.from, ends.to)
  const high = Math.max(ends.from, ends.to)
  // Heights k + ½ strictly inside the ramp, turned into parameters along it
  const cuts: number[] = []
  for (let boundary = Math.floor(low - LEVEL_CLEARANCE) + LEVEL_CLEARANCE; boundary < high; boundary += 1) {
    if (boundary > low + HEIGHT_EPSILON && boundary < high - HEIGHT_EPSILON) {
      cuts.push((boundary - ends.from) / (ends.to - ends.from))
    }
  }
  cuts.sort((x, y) => x - y)
  const stops = [0, ...cuts, 1]
  const pieces: LevelPiece[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    pieces.push({ t0: stops[i], t1: stops[i + 1], band: heightBand(segmentHeightAt(net, seg, (stops[i] + stops[i + 1]) / 2)) })
  }
  return pieces
}

/** Level a rail is drawn with where it leaves `nodeId` */
export function segmentEndBand(net: Network, seg: Segment, nodeId: NodeId): number {
  const pieces = segmentLevelPieces(net, seg)
  return seg.from === nodeId ? pieces[0].band : pieces[pieces.length - 1].band
}

/** Level of the joint, fishplate or buffer drawn at `nodeId` between these rails: the highest one */
export function nodeJointBand(net: Network, nodeId: NodeId, segIds: Iterable<string>): number {
  let band = -Infinity
  for (const segId of segIds) {
    const seg = net.segments.get(segId)
    if (seg) band = Math.max(band, segmentEndBand(net, seg, nodeId))
  }
  return band === -Infinity ? 0 : band
}

/** Level of what stands on a rail at parameter `t` (a bogie): its real height there */
export function trackPositionBand(net: Network, pos: { segId: string; t: number }): number {
  const seg = net.segments.get(pos.segId)
  return seg ? heightBand(segmentHeightAt(net, seg, pos.t)) : 0
}

/** A piece of a rail as the drawing passes handle it, with the level of its neighbours on the rail */
export interface TrackPiece extends LevelPiece {
  seg: Segment
  /** Level of the piece before `t0` on the same rail; absent when the piece starts at the node */
  bandBefore?: number
  /** Level of the piece after `t1` on the same rail; absent when the piece ends at the node */
  bandAfter?: number
}

export function isWholePiece(piece: { t0: number; t1: number }): boolean {
  return piece.t0 <= 0 && piece.t1 >= 1
}

export function segmentTrackPieces(net: Network, seg: Segment): TrackPiece[] {
  const pieces = segmentLevelPieces(net, seg)
  return pieces.map((piece, i) => ({
    ...piece,
    seg,
    ...(i > 0 ? { bandBefore: pieces[i - 1].band } : {}),
    ...(i < pieces.length - 1 ? { bandAfter: pieces[i + 1].band } : {}),
  }))
}

/** Pieces split by level, lowest first; the order of the rails inside a level is kept. */
export function groupPiecesByLevel(net: Network, segs: Iterable<Segment>): { level: number; pieces: TrackPiece[] }[] {
  const byLevel = new Map<number, TrackPiece[]>()
  for (const seg of segs) {
    for (const piece of segmentTrackPieces(net, seg)) {
      const group = byLevel.get(piece.band)
      if (group) group.push(piece)
      else byLevel.set(piece.band, [piece])
    }
  }
  return [...byLevel.entries()].sort((x, y) => x[0] - y[0]).map(([level, pieces]) => ({ level, pieces }))
}

/** Where a bridge deck starts: the point, the unit tangent pointing into the deck and its normal */
export interface DeckEnd {
  pos: Point
  tangent: Point
  normal: Point
}

function deckEndAt(net: Network, seg: Segment, t: number, intoDeck: 1 | -1): DeckEnd | null {
  const ends = segmentEnds(net, seg)
  if (!ends) return null
  const pos = pointOnShape(ends, t)
  const d = derivativeOnShape(ends, t)
  const len = Math.hypot(d.x, d.y)
  const tangent = len > 1e-4 ? { x: (d.x / len) * intoDeck, y: (d.y / len) * intoDeck } : { x: intoDeck, y: 0 }
  return { pos, tangent, normal: { x: -tangent.y, y: tangent.x } }
}

/**
 * Ends of the deck of one piece above ground that get an abutment: where the deck starts on a
 * ramp (the piece next to it on the same rail is on the ground), or at a node where every other
 * rail leaves on the ground. A deck that goes on — onto the next rail, or up to the next level —
 * has none, and neither has the free end of a bridge.
 */
export function deckAbutments(net: Network, piece: TrackPiece): DeckEnd[] {
  if (piece.band <= 0) return []
  const ends: DeckEnd[] = []
  const atNode = (nodeId: NodeId): boolean => {
    const others = (net.adjacency.get(nodeId) ?? []).filter((sid) => sid !== piece.seg.id)
    return others.length > 0 && nodeJointBand(net, nodeId, others) <= 0
  }
  if (piece.bandBefore !== undefined ? piece.bandBefore <= 0 : atNode(piece.seg.from)) {
    const end = deckEndAt(net, piece.seg, piece.t0, 1)
    if (end) ends.push(end)
  }
  if (piece.bandAfter !== undefined ? piece.bandAfter <= 0 : atNode(piece.seg.to)) {
    const end = deckEndAt(net, piece.seg, piece.t1, -1)
    if (end) ends.push(end)
  }
  return ends
}
