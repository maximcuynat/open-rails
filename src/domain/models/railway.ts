import type { Network, RailwayKind, Segment } from './types'
import type { RailReplacement } from './trackObjects'
import { touchNetwork } from './networkWatch'

// ─────────────────── Kind of railway of a rail ───────────────────
//
// A rail belongs to the railway (absent `Segment.railway`) or to an urban network of its own: a
// metro (`subway`, OSM `railway=subway`, brought by the « LGV France » dataset around the cities it
// reaches), a tram (`tram`) or a light rail (`light_rail`), never mistaken for one another nor for
// the railway. It is read at the import, carried by `replaceRail` when a rail is cut or merged,
// saved, and kept off by every train of the table: none is a metro or a tram
// (`store.railsBlockedFor`).

/** The kinds of railway a rail may belong to besides the railway itself */
export const RAILWAY_KINDS: readonly RailwayKind[] = ['subway', 'tram', 'light_rail']

export function isRailwayKind(value: unknown): value is RailwayKind {
  return (RAILWAY_KINDS as readonly unknown[]).includes(value)
}

/** True for a rail of a metro */
export function isSubwayRail(seg: Pick<Segment, 'railway'> | undefined): boolean {
  return seg?.railway === 'subway'
}

/** True for a rail of a metro, a tram or a light rail: no train of the table runs on it */
export function isUrbanRail(seg: Pick<Segment, 'railway'> | undefined): boolean {
  return seg?.railway !== undefined
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
