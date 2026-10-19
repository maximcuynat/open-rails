import type { Network, RailwayKind, Segment } from './types'
import type { RailReplacement } from './trackObjects'
import { touchNetwork } from './networkWatch'

// ─────────────────── Kind of railway of a rail ───────────────────
//
// A rail belongs to the railway (absent `Segment.railway`) or to a metro (`subway`, OSM
// `railway=subway`, brought by the « LGV France » dataset around the cities it reaches). It is
// read at the import, carried by `replaceRail` when a rail is cut or merged, saved, and kept off by
// every train of the table: none is a metro (`store.railsBlockedFor`).

/** True for a rail of a metro */
export function isSubwayRail(seg: Pick<Segment, 'railway'> | undefined): boolean {
  return seg?.railway === 'subway'
}

/**
 * Hand the kind of railway of a replaced rail to its pieces (called by `replaceRail`). A piece that
 * already has one keeps its own (a rail that already lay there, or the first of two merged rails).
 */
export function remapRailway(net: Network, replacement: RailReplacement): void {
  const railway = replacement.railway
  if (!railway) return
  for (const piece of replacement.pieces) {
    const seg = net.segments.get(piece.segId)
    if (!seg || seg.railway) continue
    seg.railway = railway
    touchNetwork(net, seg.id)
  }
}

/** Set (or clear, with undefined) the kind of railway of a rail. Returns true when it changed. */
export function setRailway(net: Network, seg: Segment, railway: RailwayKind | undefined): boolean {
  if (seg.railway === railway) return false
  if (railway === undefined) delete seg.railway
  else seg.railway = railway
  touchNetwork(net, seg.id)
  return true
}
