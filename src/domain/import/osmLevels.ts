import type { Chain, TrackGraph } from './osmGraph'
import type { OsmTrack } from './osmRead'
import type { ChainCrossing } from './osmCrossings'

// Stacking levels. OSM gives a level to a way (see `readWayLevel`) and the network wants a height
// on each node, a rail between two heights being a ramp. A way is cut where a bridge or a tunnel
// starts, so its two end nodes are shared with the track outside it:
// - every node of a structure, its end nodes included, is given the level of the structure, so the
//   whole of it passes clear of what it crosses;
// - the track comes back to the level of the next way on a short ramp just outside the structure.
// Where ways of several levels share a node, the level furthest from the ground wins, a bridge
// before a tunnel. `layer` is a local order, not a height: nothing here reads a slope from it.

/** Length (m) of the ramp that brings the track from the level of a structure back to the next one */
export const LEVEL_TRANSITION = 6
/** A stretch of track too short (m) for a ramp at each end and a level part between them is one ramp */
const MIN_TRANSITION = 1

/**
 * How far a bridge is lifted, or a tunnel sunk, when it crosses a track that is neither at the same
 * `layer`: enough for the two not to meet (`LEVEL_CLEARANCE`), not enough to reach the next level
 */
const STRUCTURE_SHIFT = 0.5

/** The way a chain is made of at a distance along it */
export function trackAt(chain: Chain, station: number): OsmTrack {
  let i = chain.stations.findIndex((s) => s > station) - 1
  if (i < 0) i = station <= 0 ? 0 : chain.edges.length - 1
  return chain.edges[Math.min(i, chain.edges.length - 1)].track
}

/**
 * Two ways that cross at the same `layer` are still told apart when one is a bridge or a tunnel and
 * the other is neither: a track in a cutting carries `layer=-1` like the tunnel that passes under
 * it. The structure is moved half a level away, which changes nothing to what it crosses at
 * another layer. Returns the number of ways moved. To be called before the levels are planned.
 */
export function separateStructures(chains: Chain[], crossings: ChainCrossing[][]): number {
  const moved = new Set<OsmTrack>()
  for (const chain of chains) {
    for (const crossing of crossings[chain.index]) {
      const one = trackAt(chain, crossing.station)
      const two = trackAt(crossing.other, crossing.otherStation)
      if (one.level.level !== two.level.level) continue
      if (one.level.structure && !two.level.structure) moved.add(one)
    }
  }
  for (const track of moved) track.level.level += track.level.structure === 'bridge' ? STRUCTURE_SHIFT : -STRUCTURE_SHIFT
  return moved.size
}

/** The height of a chain at a distance along it; heights run straight from one point to the next */
export interface LevelPoint {
  s: number
  level: number
}

export interface LevelPlan {
  /** Level of an OSM node */
  nodeLevel(id: number): number
  /** For each chain, its heights from one end to the other */
  profiles: LevelPoint[][]
  /** Nodes whose level had to be picked among ways that pull opposite ways, or among three levels */
  ambiguous: number[]
}

/** The level a node shared by ways of these levels takes */
function winningLevel(levels: Iterable<number>): number {
  let best = 0
  for (const level of levels) {
    if (Math.abs(level) > Math.abs(best) || (Math.abs(level) === Math.abs(best) && level > best)) best = level
  }
  return best
}

/**
 * Plan the levels. `reach` gives, for each chain, the distance from each of its ends within which
 * it may not be given a node (see `sideBySideReach`): a change of height that falls there is moved
 * out of it, so the ramp that leaves a node runs at least that far.
 */
export function planLevels(
  graph: TrackGraph,
  chains: Chain[],
  crossings: ChainCrossing[][],
  reach: { start: number[]; end: number[] },
): LevelPlan {
  const levels = new Map<number, number>()
  const ambiguous: number[] = []
  for (const [id, edges] of graph.at) {
    const distinct = new Set(edges.map((edge) => edge.track.level.level))
    const level = winningLevel(distinct)
    if (level !== 0) levels.set(id, level)
    if (distinct.size > 2 || (distinct.size === 2 && distinct.has(-level))) ambiguous.push(id)
  }
  const nodeLevel = (id: number): number => levels.get(id) ?? 0

  const profiles = chains.map((chain) => {
    // Stretches of the chain on one level
    const stretches: { s0: number; s1: number; level: number; first: number; last: number }[] = []
    chain.edges.forEach((edge, i) => {
      const level = edge.track.level.level
      const current = stretches[stretches.length - 1]
      if (current && current.level === level) {
        current.s1 = chain.stations[i + 1]
        current.last = i + 1
      } else {
        stretches.push({ s0: chain.stations[i], s1: chain.stations[i + 1], level, first: i, last: i + 1 })
      }
    })

    /** The ramp may not run under or over another track: it stops halfway to the first one it would meet */
    const clearOf = (from: number, to: number): number => {
      let reach = Math.abs(to - from)
      for (const crossing of crossings[chain.index]) {
        const ahead = (crossing.station - from) * Math.sign(to - from)
        if (ahead > 0 && ahead < reach + MIN_TRANSITION) reach = Math.min(reach, ahead / 2)
      }
      return reach
    }

    const profile: LevelPoint[] = []
    const push = (s: number, level: number): void => {
      const before = profile[profile.length - 1]
      if (before && Math.abs(before.s - s) < 1e-9 && before.level === level) return
      profile.push({ s, level })
    }
    for (const stretch of stretches) {
      const atStart = nodeLevel(chain.nodes[stretch.first])
      const atEnd = nodeLevel(chain.nodes[stretch.last])
      const needStart = atStart !== stretch.level
      const needEnd = atEnd !== stretch.level
      const room = (stretch.s1 - stretch.s0) / (needStart && needEnd ? 2 : 1)
      push(stretch.s0, atStart)
      if (room >= MIN_TRANSITION || !(needStart && needEnd)) {
        if (needStart) push(stretch.s0 + clearOf(stretch.s0, stretch.s0 + Math.min(LEVEL_TRANSITION, room)), stretch.level)
        if (needEnd) push(stretch.s1 - clearOf(stretch.s1, stretch.s1 - Math.min(LEVEL_TRANSITION, room)), stretch.level)
      }
      push(stretch.s1, atEnd)
    }

    const low = reach.start[chain.index]
    const high = chain.length - reach.end[chain.index]
    if (profile.length <= 2 || (low === 0 && high === chain.length)) return profile
    // No room between the two ends: one ramp from one node to the other
    if (low >= high) return [profile[0], profile[profile.length - 1]]
    return profile.map((point, i) => (i === 0 || i === profile.length - 1 ? point : { s: Math.max(low, Math.min(high, point.s)), level: point.level }))
  })

  return { nodeLevel, profiles, ambiguous }
}

/** Height of a chain at a distance along it. Where it steps, the height beyond the step. */
export function levelAt(profile: LevelPoint[], s: number): number {
  if (profile.length === 0) return 0
  let i = -1
  while (i + 1 < profile.length && profile[i + 1].s <= s + 1e-9) i++
  if (i < 0) return profile[0].level
  if (i === profile.length - 1) return profile[i].level
  const a = profile[i]
  const b = profile[i + 1]
  return a.level + ((b.level - a.level) * (s - a.s)) / (b.s - a.s)
}

/** Distances along a chain at which its height changes slope: where a node is needed */
export function levelBreaks(profile: LevelPoint[]): number[] {
  const breaks: number[] = []
  for (let i = 1; i + 1 < profile.length; i++) {
    const a = profile[i - 1]
    const b = profile[i]
    const c = profile[i + 1]
    const before = b.s - a.s < 1e-9 ? NaN : (b.level - a.level) / (b.s - a.s)
    const after = c.s - b.s < 1e-9 ? NaN : (c.level - b.level) / (c.s - b.s)
    if (before !== after) breaks.push(b.s)
  }
  return breaks
}
