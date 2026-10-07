import type { Network, Point, Segment, SegmentId } from '../models/types'
import type { Chain } from './osmGraph'
import type { BuiltNetwork } from './osmBuild'
import { projectOnSegment } from '../models/locomotive'

// Where an OSM node stands on the laid track. The fitting moves the track a little away from its
// nodes, and a rail may since have been cut: a node is looked for on the rails of its own chain
// first, within a few metres, else right under it. Shared by the signals and the stations.

/** A node is looked for on the rails of its own track within this distance (m)… */
export const OWN_TRACK_REACH = 5
/** …and, when those cannot be told (rails cut since they were laid), on any rail within this one */
const ANY_TRACK_REACH = 1.5
/** Side (m) of the cells the rails are sorted into */
const CELL = 100

export interface TrackPlace {
  segId: SegmentId
  t: number
}

export interface TrackPlacer {
  /** The place of a node on the laid track: the nearest rail of its own track, else any rail right under it; null when none */
  placeOf(id: number, at: Point): TrackPlace | null
  /** The chain a rail was laid from; a rail cut since then answers for the one it was cut from */
  chainOfRail(seg: Segment): Chain | undefined
}

/** The chain a rail was laid from; a rail cut since then answers for the one it was cut from */
export function chainOfRail(built: BuiltNetwork, seg: Segment): Chain | undefined {
  return built.railChain.get(seg.id) ?? (seg.parentSegmentId ? built.railChain.get(seg.parentSegmentId) : undefined)
}

/** A placer on the network as it stands; its indexes are built at the first place asked for */
export function createTrackPlacer(net: Network, chains: Chain[], built: BuiltNetwork): TrackPlacer {
  let chainsAt: Map<number, Set<Chain>> | null = null
  let rails: Map<string, Segment[]> | null = null
  const prepare = (): void => {
    if (rails) return
    chainsAt = new Map()
    for (const chain of chains) {
      for (const id of chain.nodes) {
        const set = chainsAt.get(id)
        if (set) set.add(chain)
        else chainsAt.set(id, new Set([chain]))
      }
    }
    rails = railIndex(net)
  }
  return {
    chainOfRail: (seg) => chainOfRail(built, seg),
    placeOf(id, at) {
      prepare()
      const mine = chainsAt!.get(id)
      let own: TrackPlace | null = null
      let ownDist = OWN_TRACK_REACH
      let any: TrackPlace | null = null
      let anyDist = ANY_TRACK_REACH
      for (const seg of rails!.get(`${Math.floor(at.x / CELL)},${Math.floor(at.y / CELL)}`) ?? []) {
        const found = projectOnSegment(net, seg, at)
        if (!found) continue
        const dist = Math.hypot(found.point.x - at.x, found.point.y - at.y)
        const chain = chainOfRail(built, seg)
        if (chain && mine?.has(chain)) {
          if (dist < ownDist) {
            ownDist = dist
            own = { segId: seg.id, t: found.t }
          }
        } else if (!chain && dist < anyDist) {
          anyDist = dist
          any = { segId: seg.id, t: found.t }
        }
      }
      return own ?? any
    },
  }
}

function railIndex(net: Network): Map<string, Segment[]> {
  const cells = new Map<string, Segment[]>()
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)?.pos
    const b = net.nodes.get(seg.to)?.pos
    if (!a || !b) continue
    const xs = seg.via ? [a.x, b.x, seg.via.x] : [a.x, b.x]
    const ys = seg.via ? [a.y, b.y, seg.via.y] : [a.y, b.y]
    const x0 = Math.floor((Math.min(...xs) - OWN_TRACK_REACH) / CELL)
    const x1 = Math.floor((Math.max(...xs) + OWN_TRACK_REACH) / CELL)
    const y0 = Math.floor((Math.min(...ys) - OWN_TRACK_REACH) / CELL)
    const y1 = Math.floor((Math.max(...ys) + OWN_TRACK_REACH) / CELL)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`
        const list = cells.get(key)
        if (list) list.push(seg)
        else cells.set(key, [seg])
      }
    }
  }
  return cells
}
