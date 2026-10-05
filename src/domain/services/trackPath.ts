import type { Network, NodeId, Point, SegmentId, TrackSpan } from '../models/types'
import { positionOnSegment, segmentPartialLength } from '../models/locomotive'
import { isPassageOpen } from '../models/routing'
import { tidyTrackSpans } from '../models/speedZones'

/** A place on the track: a rail and a parameter on it (0 at its `from` node, 1 at its `to` node) */
export interface TrackPoint {
  segId: SegmentId
  t: number
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
  const segA = net.segments.get(a.segId)
  const segB = net.segments.get(b.segId)
  if (!segA || !segB) return null
  if (!net.nodes.has(segA.from) || !net.nodes.has(segA.to) || !net.nodes.has(segB.from) || !net.nodes.has(segB.to)) return null
  if (!Number.isFinite(a.t) || !Number.isFinite(b.t)) return null
  const ta = Math.max(0, Math.min(1, a.t))
  const tb = Math.max(0, Math.min(1, b.t))

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
  offer({ key: key(segA.from, segA.id), node: segA.from, inSeg: segA.id, dist: segmentPartialLength(net, segA.id, ta, 0), parent: null })
  offer({ key: key(segA.to, segA.id), node: segA.to, inSeg: segA.id, dist: segmentPartialLength(net, segA.id, ta, 1), parent: null })
  if (segA.id === segB.id) {
    offer({ key: GOAL, node: segA.from, inSeg: segA.id, dist: segmentPartialLength(net, segA.id, ta, tb), parent: null, goalEntry: ta })
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
      if (!isPassageOpen(net, current.node, current.inSeg, sid, { anyPosition: true })) continue
      const entry = seg.from === current.node ? 0 : 1
      if (sid === segB.id) {
        // Running the whole of rail B to come back to it is never shorter: it is only entered
        offer({ key: GOAL, node: current.node, inSeg: sid, dist: current.dist + segmentPartialLength(net, sid, entry, tb), parent: current.key, goalEntry: entry })
        continue
      }
      const next = entry === 0 ? seg.to : seg.from
      offer({ key: key(next, sid), node: next, inSeg: sid, dist: current.dist + segmentPartialLength(net, sid, 0, 1), parent: current.key })
    }
  }
  if (!goal) return null

  // Walk back from B: the last stretch, the rails run from end to end, then the stretch out of A
  const spans: TrackSpan[] = []
  if (goal.parent === null) {
    spans.push({ segId: segA.id, t0: ta, t1: tb })
  } else {
    spans.push({ segId: segB.id, t0: goal.goalEntry!, t1: tb })
    let item = settled.get(goal.parent)
    while (item) {
      const seg = net.segments.get(item.inSeg)!
      const arrival = seg.to === item.node ? 1 : 0
      spans.push(item.parent === null ? { segId: seg.id, t0: ta, t1: arrival } : { segId: seg.id, t0: 1 - arrival, t1: arrival })
      item = item.parent === null ? undefined : settled.get(item.parent)
    }
    spans.reverse()
  }
  return { spans: tidyTrackSpans(spans), length: goal.dist }
}
