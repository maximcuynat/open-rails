import type { Network, NodeId, PathPiece, Point, Segment } from '../models/types'
import { addPathSegment, detachSegment, nodeLevel, removeNode, replaceRail } from '../models/network'
import { splitSegment } from '../models/junction'
import { pieceEnd } from '../geometry/railPath'
import { leaveDirectionOnShape, pointOnShape, segmentEnds, shapeChordCount, shapeLengthBetween, shapePolyline } from '../geometry/segmentGeometry'

// ─────────────────── Small rails into long rails ───────────────────
//
// Track drawn or imported piece by piece is a run of many small rails between two junctions, with a
// node at every change of direction. Such a run is one stretch of track: it is replaced here by long
// rails that carry its path (`PathPiece`), with nodes left only where something happens — points, an
// end of track, a change of slope. Whatever stood on the small rails (signals, speed zones, trains,
// route tables) is moved onto the long ones by `replaceRail`, as for any other edit.

/** Fits lines and arcs to points: the pieces run from the first point to the last, tangent to each other */
export type PathFitter = (
  points: readonly Point[],
  options: { tolerance: number; startTangent: Point; endTangent: Point },
) => PathPiece[]

export interface LongRailOptions {
  fit: PathFitter
  /** How far (m) the long rail may lie from the rails it replaces */
  tolerance: number
  /**
   * A long rail is cut in the middle of each straight this long (m) or more that lies between two of
   * its curves, so that a rail holds one curve with the straights that lead to it: its speed is then
   * that of that curve, not of the tightest of a whole line. 0: never cut.
   */
  cutStraightsOver: number
}

/** A curved rail is mapped onto the long rail in this many steps of its parameter */
const CURVE_MAPPING_STEPS = 8

interface ChainRail {
  seg: Segment
  /** True when the rail runs the way the chain is walked */
  forward: boolean
}

/** A node the long rails must keep: anything but a plain joint of two rails on one slope */
function isKept(net: Network, nodeId: NodeId): boolean {
  const rails = net.adjacency.get(nodeId) ?? []
  if (rails.length !== 2 || rails[0] === rails[1]) return true
  const node = net.nodes.get(nodeId)
  if (!node) return true
  for (const sid of rails) {
    const seg = net.segments.get(sid)
    // A cant set by hand belongs to its own rail
    if (!seg || seg.cant !== undefined) return true
    const other = net.nodes.get(seg.from === nodeId ? seg.to : seg.from)
    // Heights are carried by the nodes: one where the track is not level with its neighbours stays
    if (!other || nodeLevel(other) !== nodeLevel(node)) return true
  }
  return false
}

/** Every run of two rails or more between two kept nodes, each walked once */
function chains(net: Network): ChainRail[][] {
  const found: ChainRail[][] = []
  const seen = new Set<string>()
  for (const start of net.nodes.keys()) {
    if (!isKept(net, start)) continue
    for (const firstId of net.adjacency.get(start) ?? []) {
      if (seen.has(firstId)) continue
      const chain: ChainRail[] = []
      let nodeId = start
      let segId: string | undefined = firstId
      while (segId) {
        const seg = net.segments.get(segId)
        if (!seg || seen.has(seg.id)) break
        seen.add(seg.id)
        const forward = seg.from === nodeId
        chain.push({ seg, forward })
        nodeId = forward ? seg.to : seg.from
        if (isKept(net, nodeId)) break
        const here: string = seg.id
        segId = (net.adjacency.get(nodeId) ?? []).find((sid) => sid !== here)
      }
      // A run that comes back to where it left has no two ends to join
      if (chain.length >= 2 && nodeId !== start) found.push(chain)
    }
  }
  return found
}

/** Places (m along the path) where a fitted path is cut: the middle of each long straight between two curves */
function cutPlaces(pieces: readonly PathPiece[], cutStraightsOver: number): number[] {
  if (!(cutStraightsOver > 0)) return []
  const places: number[] = []
  let s = 0
  let curveBefore = false
  pieces.forEach((piece, i) => {
    const straight = piece.curvature === 0
    if (straight && curveBefore && piece.length >= cutStraightsOver && pieces.slice(i + 1).some((later) => later.curvature !== 0)) {
      places.push(s + piece.length / 2)
    }
    if (!straight) curveBefore = true
    s += piece.length
  })
  return places
}

/**
 * Replace every run of small rails by long ones. Returns how many rails the network had and has;
 * a run the fitter cannot follow within the tolerance is left as it is.
 */
export function mergeIntoLongRails(net: Network, options: LongRailOptions): { before: number; after: number; merged: number } {
  const before = net.segments.size
  let merged = 0
  for (const chain of chains(net)) {
    // The run as points, close enough together to tell its curves, with the lengths of its rails
    const points: Point[] = []
    const lengths: number[] = []
    let usable = true
    for (const { seg, forward } of chain) {
      const ends = segmentEnds(net, seg)
      if (!ends) {
        usable = false
        break
      }
      lengths.push(shapeLengthBetween(ends, 0, 1))
      const chords = Math.max(shapeChordCount(ends, options.tolerance / 4), ends.via || ends.path ? 4 : 1)
      const pts = shapePolyline(ends, chords, forward ? 0 : 1, forward ? 1 : 0)
      points.push(...(points.length > 0 ? pts.slice(1) : pts))
    }
    const total = lengths.reduce((sum, length) => sum + length, 0)
    if (!usable || !(total > 0)) continue

    const first = chain[0]
    const last = chain[chain.length - 1]
    const firstEnds = segmentEnds(net, first.seg)!
    const lastEnds = segmentEnds(net, last.seg)!
    const startTangent = leaveDirectionOnShape(firstEnds, first.forward)
    const arriving = leaveDirectionOnShape(lastEnds, !last.forward)
    const endTangent = { x: -arriving.x, y: -arriving.y }

    let pieces: PathPiece[]
    try {
      pieces = options.fit(points, { tolerance: options.tolerance, startTangent, endTangent })
    } catch {
      continue
    }
    if (pieces.length === 0) continue
    const start = points[0]
    const end = points[points.length - 1]
    const reached = pieceEnd(pieces[pieces.length - 1])
    if (Math.hypot(pieces[0].x - start.x, pieces[0].y - start.y) > 1e-3 || Math.hypot(reached.x - end.x, reached.y - end.y) > 1e-3) continue

    const fromId = first.forward ? first.seg.from : first.seg.to
    const toId = last.forward ? last.seg.to : last.seg.from
    const long = addPathSegment(net, fromId, toId, pieces)
    if (!long) continue

    // Each small rail now lies on its share of the long one, by length. The parameter of a curved
    // rail does not run evenly along it: its share is handed over in several steps, each straight
    // enough for a place on it to stay where it was
    let done = 0
    const inner: NodeId[] = []
    chain.forEach(({ seg, forward }, i) => {
      const ends = segmentEnds(net, seg)!
      const steps = ends.via ? CURVE_MAPPING_STEPS : 1
      const place = (t: number): number => {
        const along = shapeLengthBetween(ends, 0, t)
        return (done + (forward ? along : lengths[i] - along)) / total
      }
      const shares = []
      for (let k = 0; k < steps; k++) {
        const from = k / steps
        const to = (k + 1) / steps
        shares.push({ segId: long.id, from, to, start: place(from), end: place(to) })
      }
      replaceRail(net, { oldId: seg.id, pieces: shares })
      done += lengths[i]
      if (i < chain.length - 1) inner.push(forward ? seg.to : seg.from)
    })
    for (const { seg } of chain) detachSegment(net, seg.id)
    for (const nodeId of inner) removeNode(net, nodeId)
    merged++

    // One curve per rail: cut from the far end, so that the places already found stay on the rail still to cut
    let railLength = pieces.reduce((sum, piece) => sum + piece.length, 0)
    let rail = long
    for (const place of cutPlaces(pieces, options.cutStraightsOver).reverse()) {
      const ends = segmentEnds(net, rail)
      if (!ends) break
      const cut = splitSegment(net, rail.id, pointOnShape(ends, place / railLength))
      if (!cut) break
      // What is left to cut is the near half, which ends at the place just cut
      rail = cut.seg1
      railLength = place
    }
  }
  return { before, after: net.segments.size, merged }
}
