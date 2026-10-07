import type { Network, NodeId, Point, SegmentId, TrackSpan } from '../models/types'
import { addCurveSegment, addNode, addSegment, createNetwork } from '../models/network'
import { addSpeedZone } from '../models/speedZones'
import type { OsmImportOptions } from './osmTypes'
import type { Chain, ChainEnd, TrackGraph } from './osmGraph'
import { endKey, type NodeTangents } from './osmJunctions'
import { fitChain, isSinglePiece, MIN_JOINT_SPACING, SLIP_CLEARANCE, type DesignSpeed, type FittedPrim } from './osmFit'
import { levelAt, levelBreaks, type LevelPlan } from './osmLevels'
import { primBetween, primRails } from './osmArcs'
import { zoneSpeedUnder } from './osmRead'

// The network itself: each chain fitted, cut where its height changes, and laid rail by rail with
// the helpers of the domain; then the speed zones.

/** A change of height closer than this (m) to a joint of the fitted track is made at that joint */
const LEVEL_SNAP = 0.5

/** A rail of a chain and the stretch of the chain (distances along it) it stands for, `from` → `to` */
export interface ChainRail {
  segId: SegmentId
  s0: number
  s1: number
}

export interface BuiltNetwork {
  network: Network
  /** The OSM node a network node was laid on, for the nodes chains end on */
  osmNode: Map<NodeId, number>
  railChain: Map<SegmentId, Chain>
  /** The rails of each chain, in order */
  chainRails: ChainRail[][]
  /** Rails that could not be laid: a second straight between the same two nodes */
  lostRails: number
}

/** For each chain, the distance from its first node and from its last node within which it gets no node */
export interface ChainReach {
  start: number[]
  end: number[]
}

/** Distance from each end of a chain within which no joint is kept */
export function chainClearances(chain: Chain, slips: Set<number>, reach: ChainReach): [number, number] {
  const clear = (node: number): number => (slips.has(node) ? SLIP_CLEARANCE : MIN_JOINT_SPACING)
  return [
    Math.max(clear(chain.nodes[0]), reach.start[chain.index]),
    Math.max(clear(chain.nodes[chain.nodes.length - 1]), reach.end[chain.index]),
  ]
}

/** True for a chain laid as a single piece from one end to the other */
export function isLaidAsOnePiece(chain: Chain, slips: Set<number>, reach: ChainReach): boolean {
  const [clearStart, clearEnd] = chainClearances(chain, slips, reach)
  return isSinglePiece(chain, clearStart, clearEnd)
}

/**
 * The speed a chain is built for: what `maxspeed` says of its ways. Null for a chain that carries
 * none: nothing says how fast its curves are to be taken.
 */
export function designSpeed(chain: Chain, highSpeed: boolean): DesignSpeed | undefined {
  if (!chain.edges.some((edge) => edge.track.speed !== null)) return undefined
  return {
    lineType: highSpeed ? 'highSpeed' : 'classic',
    over: (s0, s1) => {
      let speed: number | null = null
      chain.edges.forEach((edge, i) => {
        if (edge.track.speed === null || chain.stations[i + 1] <= s0 + 1e-6 || chain.stations[i] >= s1 - 1e-6) return
        if (speed === null || edge.track.speed < speed) speed = edge.track.speed
      })
      return speed
    },
  }
}

export function buildNetwork(
  graph: TrackGraph,
  chains: Chain[],
  tangents: NodeTangents,
  plan: LevelPlan,
  reach: ChainReach,
  tolerances: number[],
): BuiltNetwork {
  const network = createNetwork()
  const osmNode = new Map<NodeId, number>()
  const railChain = new Map<SegmentId, Chain>()
  const chainRails: ChainRail[][] = chains.map(() => [])
  const placed = new Map<number, NodeId>()
  let lostRails = 0
  // The kind of line the curves are judged for, as the project will be set (`osmLineSettings`)
  const highSpeed = graph.edges.some((edge) => edge.track.highSpeed)

  /**
   * The network node of an OSM node chains end on. It stands on the OSM node, but for a track end:
   * that one stands where the fitted track stops (`at`), which no other chain has to reach.
   */
  const endNode = (id: number, at: Point): NodeId => {
    let nodeId = placed.get(id)
    if (!nodeId) {
      const alone = (graph.at.get(id)?.length ?? 0) === 1
      nodeId = addNode(network, alone ? at : graph.pos.get(id)!, plan.nodeLevel(id)).id
      placed.set(id, nodeId)
      osmNode.set(nodeId, id)
    }
    return nodeId
  }

  for (const chain of chains) {
    const [clearStart, clearEnd] = chainClearances(chain, tangents.slips, reach)
    const prims = fitChain(chain, tangents.leaveStart[chain.index], tangents.leaveEnd[chain.index], clearStart, clearEnd, tolerances[chain.index], designSpeed(chain, highSpeed))
    if (prims.length === 0) continue

    // Heights: a change next to a joint, or to another change, is moved onto it; the others cut
    // the piece they fall in
    const anchors = [prims[0].s0, ...prims.map((prim) => prim.s1)]
    const profile = plan.profiles[chain.index].map((point) => {
      let s = point.s
      let gap = LEVEL_SNAP
      for (const anchor of anchors) {
        if (Math.abs(anchor - point.s) < gap) {
          gap = Math.abs(anchor - point.s)
          s = anchor
        }
      }
      if (s === point.s) anchors.push(s)
      return { s, level: point.level }
    })
    const cuts = [...new Set(levelBreaks(profile))]
    const pieces: FittedPrim[] = []
    for (const prim of prims) {
      const inside = cuts.filter((s) => s > prim.s0 + 1e-6 && s < prim.s1 - 1e-6)
      if (inside.length === 0) {
        pieces.push(prim)
        continue
      }
      const stops = [prim.s0, ...inside, prim.s1]
      for (let i = 0; i + 1 < stops.length; i++) {
        const f0 = (stops[i] - prim.s0) / (prim.s1 - prim.s0)
        const f1 = (stops[i + 1] - prim.s0) / (prim.s1 - prim.s0)
        pieces.push({ ...primBetween(prim, f0, f1), s0: stops[i], s1: stops[i + 1] })
      }
    }

    const lastNode = endNode(chain.nodes[chain.nodes.length - 1], prims[prims.length - 1].p1)
    let from = endNode(chain.nodes[0], prims[0].p0)
    pieces.forEach((piece, p) => {
      const rails = primRails(piece)
      rails.forEach((rail, r) => {
        const s0 = piece.s0 + rail.f0 * (piece.s1 - piece.s0)
        const s1 = piece.s0 + rail.f1 * (piece.s1 - piece.s0)
        const isLast = p === pieces.length - 1 && r === rails.length - 1
        const to = isLast ? lastNode : addNode(network, rail.p1, levelAt(profile, s1)).id
        const before = network.segments.size
        const seg = rail.via ? addCurveSegment(network, from, to, rail.via) : addSegment(network, from, to)
        if (seg && network.segments.size > before) {
          railChain.set(seg.id, chain)
          chainRails[chain.index].push({ segId: seg.id, s0, s1 })
        } else {
          lostRails++
        }
        from = to
      })
    })
  }

  return { network, osmNode, railChain, chainRails, lostRails }
}

/** A stretch of a chain at one speed */
interface SpeedRun {
  chain: Chain
  s0: number
  s1: number
  speed: number
  /** The run that continues this one beyond the start of its chain, and beyond its end */
  links: [SpeedRun | null, SpeedRun | null]
}

/**
 * Lay the speed zones: one for each stretch of track that carries the same `maxspeed` from one end
 * to the other, followed through the nodes where the track runs on (see `NodeTangents.through`).
 * A service track without `maxspeed` takes `defaultServiceSpeed`. Returns the number of zones laid.
 */
export function laySpeedZones(built: BuiltNetwork, chains: Chain[], tangents: NodeTangents, options: OsmImportOptions): number {
  const serviceSpeed = options.defaultServiceSpeed > 0 ? zoneSpeedUnder(options.defaultServiceSpeed) : null
  const runs: SpeedRun[] = []
  const firstRun = new Map<Chain, SpeedRun>()
  const lastRun = new Map<Chain, SpeedRun>()
  for (const chain of chains) {
    let current: SpeedRun | null = null
    chain.edges.forEach((edge, i) => {
      const speed = edge.track.speed ?? (edge.track.service ? serviceSpeed : null)
      if (speed === null) {
        current = null
        return
      }
      if (current && current.speed === speed) {
        current.s1 = chain.stations[i + 1]
      } else {
        current = { chain, s0: chain.stations[i], s1: chain.stations[i + 1], speed, links: [null, null] }
        runs.push(current)
        if (i === 0) firstRun.set(chain, current)
      }
      if (i === chain.edges.length - 1) lastRun.set(chain, current)
    })
  }

  const runAt = (end: ChainEnd): SpeedRun | undefined => (end.atStart ? firstRun : lastRun).get(end.chain)
  for (const chain of chains) {
    for (const atStart of [true, false]) {
      const end: ChainEnd = { chain, atStart }
      const onward = tangents.through.get(endKey(end))
      const run = runAt(end)
      const next = onward && runAt(onward)
      if (!run || !next || run === next || run.speed !== next.speed) continue
      run.links[atStart ? 0 : 1] = next
      next.links[onward.atStart ? 0 : 1] = run
    }
  }

  const spansOf = (run: SpeedRun, withChain: boolean): TrackSpan[] => {
    const spans: TrackSpan[] = []
    for (const rail of built.chainRails[run.chain.index]) {
      const lo = Math.max(run.s0, rail.s0)
      const hi = Math.min(run.s1, rail.s1)
      if (hi - lo < 1e-6) continue
      const snap = (t: number): number => (t < 1e-9 ? 0 : t > 1 - 1e-9 ? 1 : t)
      const t0 = snap((lo - rail.s0) / (rail.s1 - rail.s0))
      const t1 = snap((hi - rail.s0) / (rail.s1 - rail.s0))
      spans.push({ segId: rail.segId, t0, t1 })
    }
    return withChain ? spans : spans.reverse().map((span) => ({ segId: span.segId, t0: span.t1, t1: span.t0 }))
  }

  let zones = 0
  const done = new Set<SpeedRun>()
  const lay = (start: SpeedRun, enteredAt: 0 | 1): void => {
    const spans: TrackSpan[] = []
    let run: SpeedRun | null = start
    let side = enteredAt
    while (run && !done.has(run)) {
      done.add(run)
      spans.push(...spansOf(run, side === 0))
      const next: SpeedRun | null = run.links[side === 0 ? 1 : 0]
      if (next) side = next.links[0] === run ? 0 : 1
      run = next
    }
    if (addSpeedZone(built.network, spans, start.speed)) zones++
  }
  // From the runs that have an end of their own, then the ones that close on themselves
  for (const run of runs) if (!done.has(run) && (!run.links[0] || !run.links[1])) lay(run, run.links[0] ? 1 : 0)
  for (const run of runs) if (!done.has(run)) lay(run, 0)
  return zones
}
