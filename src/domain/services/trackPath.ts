import type { Network, NodeId, Point, SegmentId, TrackSpan } from '../models/types'
import { positionOnSegment, segmentPartialLength } from '../models/locomotive'
import { isPassageOpen } from '../models/routing'
import { tidyTrackSpans } from '../models/speedZones'

/** A place on the track: a rail and a parameter on it (0 at its `from` node, 1 at its `to` node) */
export interface TrackPoint {
  segId: SegmentId
  t: number
}

/**
 * A place to reach: with `forward`, only running its rail that way (true: towards its `to` end,
 * growing t) — a stop marker speaks to one direction of travel; without it, either way.
 */
export interface TrackGoal extends TrackPoint {
  forward?: boolean
}

/** A way along the track: the stretches covered, in order and each in the direction it is walked, and their length in metres */
export interface TrackPath {
  spans: TrackSpan[]
  length: number
}

/** Length in metres of a list of stretches (`segmentPartialLength` of each). */
export function trackSpansLength(net: Network, spans: readonly TrackSpan[]): number {
  let length = 0
  for (const span of spans) length += segmentPartialLength(net, span.segId, span.t0, span.t1)
  return length
}

/** World positions of the two ends of a list of stretches walked in order, or null when it is empty or off the track. */
export function trackSpansEnds(net: Network, spans: readonly TrackSpan[]): { a: Point; b: Point } | null {
  if (spans.length === 0) return null
  const last = spans[spans.length - 1]
  const a = positionOnSegment(net, spans[0].segId, spans[0].t0)
  const b = positionOnSegment(net, last.segId, last.t1)
  return a && b ? { a, b } : null
}

/** A node reached by a rail; `goal` is set on the one item that stands for the arrival at B */
interface SearchItem {
  key: string
  node: NodeId
  inSeg: SegmentId
  dist: number
  parent: string | null
  /** Parameter at which rail B is entered (the start parameter itself when A and B are joined along one rail) */
  goalEntry?: number
  /** Which of the goals this arrival is at */
  goalIndex?: number
}

/** Binary heap on `dist`: the search is run at every pointer move while a zone is being laid */
class MinHeap {
  private items: SearchItem[] = []

  get size(): number {
    return this.items.length
  }

  push(item: SearchItem): void {
    const items = this.items
    let i = items.length
    items.push(item)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent].dist <= item.dist) break
      items[i] = items[parent]
      i = parent
    }
    items[i] = item
  }

  pop(): SearchItem {
    const items = this.items
    const top = items[0]
    const last = items.pop()!
    if (items.length > 0) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= items.length) break
        if (child + 1 < items.length && items[child + 1].dist < items[child].dist) child++
        if (items[child].dist >= last.dist) break
        items[i] = items[child]
        i = child
      }
      items[i] = last
    }
    return top
  }
}

const GOAL = 'GOAL'

/**
 * Shortest way along the track from point `a` to point `b`, or null when there is none.
 * A train could run it: it never turns back on a rail and passes each node the way the track
 * allows (see `isPassageOpen`), but the position of the points is ignored — every branch of a
 * turnout can be taken. Both points on one rail are joined along that rail, unless going round a
 * loop is shorter. `a` and `b` at the same place give an empty path of length 0.
 */
export function findTrackPath(net: Network, a: TrackPoint, b: TrackPoint): TrackPath | null {
  const found = findTrackPathToAny(net, a, [b])
  return found ? { spans: found.spans, length: found.length } : null
}

export interface TrackPathOptions {
  /** Leave `a` towards the `to` end of its rail only (1) or its `from` end only (0): the way a train faces */
  leaving?: 0 | 1
  /** Rails the way must not take (track the train has no business on); the rail of `a` itself is always left freely */
  blocked?: (segId: SegmentId) => boolean
  /**
   * Metres a way is counted longer by for passing from `inSeg` to `outSeg` at `node`: what makes
   * one of two ways as good as each other the one to take. The length returned is the real one
   */
  toll?: (node: NodeId, inSeg: SegmentId, outSeg: SegmentId) => number
}

/**
 * Shortest way from `a` to the nearest of `goals`, as `findTrackPath` finds it, with the index of
 * the goal reached. Goals off the track are passed over; null when none can be reached. A goal
 * with a direction (`TrackGoal.forward`) is only reached running its rail that way: a rail whose
 * goals all want the other way is run through like any other.
 */
export function findTrackPathToAny(net: Network, a: TrackPoint, goals: readonly TrackGoal[], options: TrackPathOptions = {}): (TrackPath & { goal: number }) | null {
  const segA = net.segments.get(a.segId)
  if (!segA) return null
  if (!net.nodes.has(segA.from) || !net.nodes.has(segA.to)) return null
  if (!Number.isFinite(a.t)) return null
  const ta = Math.max(0, Math.min(1, a.t))
  const goalsOn = new Map<SegmentId, { index: number; t: number; forward?: boolean }[]>()
  goals.forEach((goal, index) => {
    const seg = net.segments.get(goal.segId)
    if (!seg || !net.nodes.has(seg.from) || !net.nodes.has(seg.to) || !Number.isFinite(goal.t)) return
    const on = goalsOn.get(seg.id) ?? []
    on.push(goal.forward === undefined ? { index, t: Math.max(0, Math.min(1, goal.t)) } : { index, t: Math.max(0, Math.min(1, goal.t)), forward: goal.forward })
    goalsOn.set(seg.id, on)
  })
  if (goalsOn.size === 0) return null
  const { leaving, blocked, toll } = options

  const key = (node: NodeId, inSeg: SegmentId): string => `${inSeg}>${node}`
  const heap = new MinHeap()
  const best = new Map<string, number>()
  const settled = new Map<string, SearchItem>()
  const offer = (item: SearchItem): void => {
    if (item.dist >= (best.get(item.key) ?? Infinity)) return
    best.set(item.key, item.dist)
    heap.push(item)
  }

  // Leaving A by either end of its rail; that rail cannot be taken again straight away
  if (leaving !== 1) offer({ key: key(segA.from, segA.id), node: segA.from, inSeg: segA.id, dist: segmentPartialLength(net, segA.id, ta, 0), parent: null })
  if (leaving !== 0) offer({ key: key(segA.to, segA.id), node: segA.to, inSeg: segA.id, dist: segmentPartialLength(net, segA.id, ta, 1), parent: null })
  for (const goal of goalsOn.get(segA.id) ?? []) {
    // Further along the rail on the side it is left by; either side when it may be left by both
    if ((leaving === 1 && goal.t < ta) || (leaving === 0 && goal.t > ta)) continue
    // Reached along the rail the way it runs from A
    if ((goal.forward === true && goal.t < ta) || (goal.forward === false && goal.t > ta)) continue
    offer({ key: GOAL, node: segA.from, inSeg: segA.id, dist: segmentPartialLength(net, segA.id, ta, goal.t), parent: null, goalEntry: ta, goalIndex: goal.index })
  }

  let goal: SearchItem | null = null
  while (heap.size > 0) {
    const current = heap.pop()
    if (current.dist > (best.get(current.key) ?? Infinity)) continue
    if (current.key === GOAL) {
      goal = current
      break
    }
    settled.set(current.key, current)

    for (const sid of net.adjacency.get(current.node) ?? []) {
      if (sid === current.inSeg) continue
      const seg = net.segments.get(sid)
      if (!seg || seg.from === seg.to) continue
      if (blocked?.(sid)) continue
      if (!isPassageOpen(net, current.node, current.inSeg, sid, { anyPosition: true })) continue
      const entry = seg.from === current.node ? 0 : 1
      const reached = current.dist + (toll ? Math.max(0, toll(current.node, current.inSeg, sid)) : 0)
      // Entered by its `from` end, the rail is run forward: the goals that want that way
      const here = goalsOn.get(sid)?.filter((goal) => goal.forward === undefined || goal.forward === (entry === 0))
      if (here && here.length > 0) {
        // Running the whole of a goal's rail to come back to it is never shorter, and a goal
        // beyond it is further than the one on it: the rail is only entered
        for (const goal of here) {
          offer({ key: GOAL, node: current.node, inSeg: sid, dist: reached + segmentPartialLength(net, sid, entry, goal.t), parent: current.key, goalEntry: entry, goalIndex: goal.index })
        }
        continue
      }
      const next = entry === 0 ? seg.to : seg.from
      offer({ key: key(next, sid), node: next, inSeg: sid, dist: reached + segmentPartialLength(net, sid, 0, 1), parent: current.key })
    }
  }
  if (!goal) return null

  // Walk back from B: the last stretch, the rails run from end to end, then the stretch out of A
  const spans: TrackSpan[] = []
  const reached = goals[goal.goalIndex!]
  const tb = Math.max(0, Math.min(1, reached.t))
  if (goal.parent === null) {
    spans.push({ segId: segA.id, t0: ta, t1: tb })
  } else {
    spans.push({ segId: reached.segId, t0: goal.goalEntry!, t1: tb })
    let item = settled.get(goal.parent)
    while (item) {
      const seg = net.segments.get(item.inSeg)!
      const arrival = seg.to === item.node ? 1 : 0
      spans.push(item.parent === null ? { segId: seg.id, t0: ta, t1: arrival } : { segId: seg.id, t0: 1 - arrival, t1: arrival })
      item = item.parent === null ? undefined : settled.get(item.parent)
    }
    spans.reverse()
  }
  const tidy = tidyTrackSpans(spans)
  return { spans: tidy, length: toll ? trackSpansLength(net, tidy) : goal.dist, goal: goal.goalIndex! }
}
