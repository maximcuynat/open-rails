import type { Point } from '../models/types'
import { MAX_TRANSITION_DEFLECTION_DEG } from '../geometry/tangent'
import type { Chain, ChainEnd, TrackGraph } from './osmGraph'
import { pointAlong } from './osmGraph'
import { angleDeg, distance, mirrored, RAD, reversed, rotate, signedAngle, sub, unit } from './osmArcs'

// The direction in which each chain leaves the nodes it ends on. The editor reads the devices from
// those directions when the network is opened: a turnout where two rails leave within 15° of the
// prolongation of a third, a double slip where four rails are tangent to one line, a fixed
// crossing where two tracks run through each other. OSM only says where the node is, so the
// directions are settled here, node by node, before any rail is fitted.

/** Length (m) of track read on each side of a node to tell which way a chain leaves it */
const LEAVE_WINDOW = 15
/** A branch is bent to leave its stem within this (degrees), under the limit a train can take */
const MAX_BRANCH_DEFLECTION_DEG = MAX_TRANSITION_DEFLECTION_DEG - 1
/** A branch further than this (degrees) from every other track at its node is a corner, left as it is */
const MAX_BENT_DEFLECTION_DEG = 40
/** Two rails leaving a node on the same side closer than this (degrees) leave it tangent to each other */
const MIN_DIVERGENCE_DEG = 0.5
/** Distance (m) at which two rails leaving a node side by side are told left from right */
const LOOK_AHEAD = 30

export interface NodeTangents {
  /** Unit direction in which chain `i` leaves its first node; null when nothing constrains it */
  leaveStart: (Point | null)[]
  /** The same at its last node */
  leaveEnd: (Point | null)[]
  /** The nodes laid as double slips */
  slips: Set<number>
  /** Chains that continue each other through a node: for each chain end, the end it runs on into */
  through: Map<string, ChainEnd>
}

export const endKey = (end: ChainEnd): string => `${end.chain.index}:${end.atStart ? 0 : 1}`

const deflection = (leaveA: Point, leaveB: Point): number => 180 - angleDeg(leaveA, leaveB)

/**
 * The direction in which the track of a chain leaves one of its ends, read from the nodes that
 * follow: the tangent there of the circle through the end and two points further on.
 */
export function rawLeave(chain: Chain, atStart: boolean): Point {
  const origin = atStart ? chain.pts[0] : chain.pts[chain.pts.length - 1]
  const window = Math.min(LEAVE_WINDOW, chain.length / 2)
  const near = pointAlong(chain, atStart, window)
  const chord = unit(sub(near, origin))
  if (!chord) return unit(sub(pointAlong(chain, atStart, chain.length / 2), origin)) ?? { x: 1, y: 0 }
  if (window < 2) return chord
  const far = pointAlong(chain, atStart, 2 * window)
  const onward = unit(sub(far, near))
  if (!onward) return chord
  const l1 = distance(origin, near)
  const l2 = distance(near, far)
  const tangent = unit({ x: chord.x * l2 + onward.x * l1, y: chord.y * l2 + onward.y * l1 }) ?? chord
  return mirrored(tangent, chord)
}

/**
 * The line of a double slip at a node, when it is one: a node tagged `switch` where four tracks
 * meet two against two, each of which a train could leave for both tracks of the other side.
 */
function slipAxis(rays: Point[], tags: Record<string, string> | undefined): Point | null {
  if (rays.length !== 4 || tags?.railway !== 'switch' || tags['railway:switch'] === 'three_way') return null
  const mates = [1, 2, 3].filter((k) => rays[0].x * rays[k].x + rays[0].y * rays[k].y > 0)
  if (mates.length !== 1) return null
  const side = [0, mates[0]]
  const other = [1, 2, 3].filter((k) => k !== mates[0])
  if (!side.every((i) => other.every((k) => deflection(rays[i], rays[k]) <= MAX_TRANSITION_DEFLECTION_DEG))) return null
  return unit({
    x: rays[side[0]].x + rays[side[1]].x - rays[other[0]].x - rays[other[1]].x,
    y: rays[side[0]].y + rays[side[1]].y - rays[other[0]].y - rays[other[1]].y,
  })
}

/** Above this many tracks at a node the pairs are taken one by one, straightest first */
const MAX_MATCHED_ENDS = 8

/**
 * The tracks that run through a node: pairs of rays a train can pass between, as many as can be
 * made and, among those, the straightest as a whole. Taking the straightest pair first is not
 * enough where two tracks cross at a shallow angle: it can pair each ray with the one beside its
 * own continuation, which makes two tracks that touch instead of two that cross.
 */
function throughPairs(rays: Point[]): [number, number][] {
  const cost = (i: number, k: number): number => deflection(rays[i], rays[k])
  if (rays.length > MAX_MATCHED_ENDS) {
    const all: [number, number][] = []
    for (let i = 0; i < rays.length; i++) for (let k = i + 1; k < rays.length; k++) if (cost(i, k) <= MAX_TRANSITION_DEFLECTION_DEG) all.push([i, k])
    const taken = new Set<number>()
    return all
      .sort((p, q) => cost(p[0], p[1]) - cost(q[0], q[1]))
      .filter(([i, k]) => !taken.has(i) && !taken.has(k) && taken.add(i).add(k))
  }
  let best: { pairs: [number, number][]; total: number } = { pairs: [], total: 0 }
  const search = (from: number, free: boolean[], pairs: [number, number][], total: number): void => {
    let i = from
    while (i < rays.length && !free[i]) i++
    if (i >= rays.length) {
      if (pairs.length > best.pairs.length || (pairs.length === best.pairs.length && total < best.total)) best = { pairs: [...pairs], total }
      return
    }
    free[i] = false
    for (let k = i + 1; k < rays.length; k++) {
      if (!free[k] || cost(i, k) > MAX_TRANSITION_DEFLECTION_DEG) continue
      free[k] = false
      pairs.push([i, k])
      search(i + 1, free, pairs, total + cost(i, k))
      pairs.pop()
      free[k] = true
    }
    // …or this ray is left alone
    search(i + 1, free, pairs, total)
    free[i] = true
  }
  search(0, rays.map(() => true), [], 0)
  return best.pairs
}

/**
 * Settle the direction of every chain end.
 * - A double slip: its four rails leave along its line.
 * - Elsewhere the ends are paired into tracks that run through the node (`throughPairs`): both
 *   ends of a pair leave along one line, so a train runs through without a kink.
 * - An end left alone is a branch: it keeps the direction of its own track, bent if needed to stay
 *   within what a train can take from the track it leaves, and made tangent to the rail it leaves
 *   beside when the two could not be told apart — or would start on the wrong side of each other
 *   and cross a few metres on.
 * - A track end is left free.
 * `isShort` tells the chains that are laid as a single piece: their branch ends take the direction
 * that makes that piece a straight line or one arc.
 */
export function settleNodeTangents(
  graph: TrackGraph,
  chains: Chain[],
  ends: Map<number, ChainEnd[]>,
  isShort: (chain: Chain, slips: Set<number>) => boolean,
): NodeTangents {
  const leaveStart: (Point | null)[] = chains.map(() => null)
  const leaveEnd: (Point | null)[] = chains.map(() => null)
  const slips = new Set<number>()
  const through = new Map<string, ChainEnd>()
  const get = (end: ChainEnd): Point | null => (end.atStart ? leaveStart : leaveEnd)[end.chain.index]
  const set = (end: ChainEnd, dir: Point): void => {
    ;(end.atStart ? leaveStart : leaveEnd)[end.chain.index] = dir
  }
  /** Ends whose direction is imposed by the node: a branch is one that is not */
  const fixed = new Set<string>()
  const branches: { node: number; end: ChainEnd }[] = []

  for (const [node, list] of ends) {
    if (list.length < 2) continue
    const rays = list.map((end) => rawLeave(end.chain, end.atStart))
    const axis = slipAxis(rays, graph.nodes.get(node)?.tags)
    if (axis) {
      slips.add(node)
      list.forEach((end, i) => {
        set(end, axis.x * rays[i].x + axis.y * rays[i].y > 0 ? axis : reversed(axis))
        fixed.add(endKey(end))
      })
      // Its two straight routes are the tracks that run through it
      for (const [i, k] of throughPairs(rays)) {
        through.set(endKey(list[i]), list[k])
        through.set(endKey(list[k]), list[i])
      }
      continue
    }

    const paired = new Set<number>()
    for (const [i, k] of throughPairs(rays)) {
      const line = unit(sub(rays[i], rays[k]))
      if (!line) continue
      paired.add(i).add(k)
      set(list[i], line)
      set(list[k], reversed(line))
      fixed.add(endKey(list[i])).add(endKey(list[k]))
      through.set(endKey(list[i]), list[k])
      through.set(endKey(list[k]), list[i])
    }
    list.forEach((end, i) => {
      if (paired.has(i)) return
      set(end, rays[i])
      branches.push({ node, end })
    })
  }

  // A chain laid as one piece: a branch end follows from the other end, so that the piece is a
  // straight line (two branch ends) or a single arc (one)
  for (const chain of chains) {
    if (!isShort(chain, slips)) continue
    const start: ChainEnd = { chain, atStart: true }
    const end: ChainEnd = { chain, atStart: false }
    const chord = unit(sub(chain.pts[chain.pts.length - 1], chain.pts[0]))
    if (!chord || chain.nodes[0] === chain.nodes[chain.nodes.length - 1]) continue
    const startFixed = fixed.has(endKey(start))
    const endFixed = fixed.has(endKey(end))
    const startFree = get(start) === null
    const endFree = get(end) === null
    if (!startFixed && !endFixed) {
      if (!startFree) set(start, chord)
      if (!endFree) set(end, reversed(chord))
    } else if (startFixed && !endFixed && !endFree) {
      set(end, reversed(mirrored(get(start)!, chord)))
    } else if (endFixed && !startFixed && !startFree) {
      set(start, mirrored(reversed(get(end)!), chord))
    }
  }

  for (const { node, end } of branches) {
    const others = ends.get(node)!.filter((other) => other !== end && get(other))
    let own = get(end)!

    // The track it leaves: the one it prolongs best
    let stem: Point | null = null
    let stemDeflection = Infinity
    for (const other of others) {
      const angle = deflection(own, get(other)!)
      if (angle < stemDeflection) {
        stemDeflection = angle
        stem = get(other)!
      }
    }
    if (stem && stemDeflection > MAX_BRANCH_DEFLECTION_DEG && stemDeflection <= MAX_BENT_DEFLECTION_DEG) {
      const onward = reversed(stem)
      own = rotate(onward, Math.sign(signedAngle(onward, own)) * MAX_BRANCH_DEFLECTION_DEG * RAD)
      set(end, own)
    }

    // The rails it leaves beside
    for (const other of others) {
      const beside = get(other)!
      if (beside.x * own.x + beside.y * own.y <= 0) continue
      const reach = Math.min(LOOK_AHEAD, end.chain.length, other.chain.length)
      const origin = graph.pos.get(node)!
      const lookOwn = sub(pointAlong(end.chain, end.atStart, reach), origin)
      const lookOther = sub(pointAlong(other.chain, other.atStart, reach), origin)
      const lies = signedAngle(lookOther, lookOwn)
      const leaves = signedAngle(beside, own)
      const wrongSide = Math.abs(lies) > 0.05 * RAD && lies * leaves < 0
      if (!wrongSide && Math.abs(leaves) >= MIN_DIVERGENCE_DEG * RAD) continue
      if (fixed.has(endKey(other))) {
        own = beside
        set(end, own)
      } else if (wrongSide) {
        // Two branches: each leaves along the straight line to where it is further on
        const ownChord = unit(lookOwn)
        const otherChord = unit(lookOther)
        if (ownChord && otherChord) {
          own = ownChord
          set(end, ownChord)
          set(other, otherChord)
        }
      }
    }
  }

  return { leaveStart, leaveEnd, slips, through }
}

/** Two tracks out of a node are side by side until they are this far (m) apart */
const SIDE_BY_SIDE = 1
/** …which is looked for every so many metres, up to this far from the node */
const SIDE_BY_SIDE_STEP = 2
const MAX_SIDE_BY_SIDE = 40

/** Distance from a point to the first `reach` metres of a chain, measured from one of its ends */
function distanceToChainEnd(end: ChainEnd, reach: number, q: Point): number {
  const { pts, stations, length } = end.chain
  let best = Infinity
  for (let k = 0; k + 1 < pts.length; k++) {
    const from = end.atStart ? stations[k] : length - stations[k + 1]
    if (from > reach) {
      if (end.atStart) break
      continue
    }
    const a = pts[k]
    const b = pts[k + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / lenSq)) : 0
    best = Math.min(best, Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy)))
  }
  return best
}

/**
 * For each chain, how far from its first node and from its last node it runs side by side with
 * another chain that leaves the same node: two branches of a turnout are centimetres apart for the
 * first metres. No node is laid on a chain within that distance — the editor would take a node
 * that close to the other branch for a node of it, and join the two tracks there.
 */
export function sideBySideReach(chains: Chain[], ends: Map<number, ChainEnd[]>): { start: number[]; end: number[] } {
  const start = chains.map(() => 0)
  const end = chains.map(() => 0)
  for (const list of ends.values()) {
    if (list.length < 2) continue
    const rays = list.map((one) => rawLeave(one.chain, one.atStart))
    list.forEach((one, i) => {
      let reach = 0
      list.forEach((other, k) => {
        if (k === i || rays[i].x * rays[k].x + rays[i].y * rays[k].y <= 0) return
        let x = SIDE_BY_SIDE_STEP
        while (x < MAX_SIDE_BY_SIDE && x < one.chain.length) {
          if (distanceToChainEnd(other, x + 10, pointAlong(one.chain, one.atStart, x)) >= SIDE_BY_SIDE) break
          x += SIDE_BY_SIDE_STEP
        }
        reach = Math.max(reach, Math.min(x, one.chain.length))
      })
      ;(one.atStart ? start : end)[one.chain.index] = reach
    })
  }
  return { start, end }
}
