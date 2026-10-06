import { beforeEach, describe, expect, it } from 'vitest'
import type { Network, PathPiece, Point } from '../models/types'
import { addNode, addSegment, createNetwork, resetIdCounter } from '../models/network'
import { positionOnSegment, segmentArcLength, walkForward } from '../models/locomotive'
import { addSignal } from '../models/signals'
import { declareTurnout, syncJunctions } from '../models/junction'
import { junctionRails } from '../models/routing'
import { mergeIntoLongRails, type PathFitter } from './longRails'

/** Stand-in fitter for runs that are one straight line: a single piece from the first point to the last */
const lineFit: PathFitter = (points) => {
  const a = points[0]
  const b = points[points.length - 1]
  const piece: PathPiece = { x: a.x, y: a.y, heading: Math.atan2(b.y - a.y, b.x - a.x), curvature: 0, length: Math.hypot(b.x - a.x, b.y - a.y) }
  return [piece]
}
const options = { fit: lineFit, tolerance: 0.3, cutStraightsOver: 0 }

/** A straight track from x = 0 to x = `xs[last]`, with a node at every `xs` */
function line(net: Network, xs: number[], y = 0) {
  const nodes = xs.map((x) => addNode(net, { x, y }))
  const rails = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
  return { nodes, rails }
}

describe('small rails into long rails', () => {
  beforeEach(() => resetIdCounter())

  it('a run of rails between two ends of track becomes one rail, its inner nodes gone', () => {
    const net = createNetwork()
    const { nodes } = line(net, [0, 40, 100, 130, 200])
    const result = mergeIntoLongRails(net, options)
    expect(result).toEqual({ before: 4, after: 1, merged: 1 })
    expect(net.nodes.size).toBe(2)
    const long = [...net.segments.values()][0]
    expect(long.kind).toBe('path')
    expect([long.from, long.to].sort()).toEqual([nodes[0].id, nodes[4].id].sort())
    expect(segmentArcLength(net, long.id)).toBeCloseTo(200)
  })

  it('a single rail is left as it is', () => {
    const net = createNetwork()
    line(net, [0, 100])
    expect(mergeIntoLongRails(net, options).merged).toBe(0)
    expect([...net.segments.values()][0].kind).toBe('straight')
  })

  it('what stood on the small rails is at the same place of the world on the long one', () => {
    const net = createNetwork()
    const { rails } = line(net, [0, 40, 100, 130, 200])
    // A signal 15 m into the third rail (x = 115), for trains running towards +x
    const placed = addSignal(net, { segId: rails[2].id, t: 0.5 }, true, 'spacing')
    expect(placed.ok).toBe(true)
    mergeIntoLongRails(net, options)
    const signal = [...net.signals.values()][0]
    const where = positionOnSegment(net, signal.segId, signal.t)!
    expect(net.segments.get(signal.segId)!.kind).toBe('path')
    expect(where.x).toBeCloseTo(115)
    expect(where.y).toBeCloseTo(0)
  })

  it('rails laid the other way round are merged all the same', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 50, y: 0 })
    const c = addNode(net, { x: 120, y: 0 })
    addSegment(net, b.id, a.id)
    const second = addSegment(net, b.id, c.id)!
    addSignal(net, { segId: second.id, t: 0.5 }, true, 'spacing')
    expect(mergeIntoLongRails(net, options).merged).toBe(1)
    const signal = [...net.signals.values()][0]
    expect(positionOnSegment(net, signal.segId, signal.t)!.x).toBeCloseTo(85)
  })

  it('stops at points: the route table names the long rails, and trains still take them', () => {
    const net = createNetwork()
    const xs = [0, 30, 60, 100, 140, 200].map((x) => addNode(net, { x, y: 0 }))
    const main = xs.slice(1).map((node, i) => addSegment(net, xs[i].id, node.id)!)
    const b1 = addNode(net, { x: 150, y: 6 })
    const b2 = addNode(net, { x: 200, y: 12 })
    const branch1 = addSegment(net, xs[3].id, b1.id)!
    addSegment(net, b1.id, b2.id)
    const junction = declareTurnout(net, { nodeId: xs[3].id, stemSegmentId: main[2].id, straightSegmentId: main[3].id, divergingSegmentId: branch1.id })!

    const result = mergeIntoLongRails(net, options)
    // The stem (3 rails), the main line beyond the points (2 rails) and the branch (2 rails)
    expect(result).toEqual({ before: 7, after: 3, merged: 3 })
    syncJunctions(net)
    const named = junctionRails(junction)
    expect(named).toHaveLength(3)
    for (const id of named) expect(net.segments.get(id)!.kind).toBe('path')

    // From the start of the stem, through the points, to the end of the main line
    const stemRail = named.find((id) => {
      const seg = net.segments.get(id)!
      return seg.from === xs[0].id || seg.to === xs[0].id
    })!
    const forward = net.segments.get(stemRail)!.from === xs[0].id
    const reached = walkForward(net, stemRail, forward ? 0 : 1, forward, 180)!
    const where: Point = positionOnSegment(net, reached.segId, reached.t)!
    expect(where.x).toBeCloseTo(180)
    expect(where.y).toBeCloseTo(0)
  })

  it('keeps a node where the track changes height', () => {
    const net = createNetwork()
    const { nodes } = line(net, [0, 50, 100, 150])
    nodes[2].level = 1
    nodes[3].level = 1
    mergeIntoLongRails(net, options)
    // 0 → 50 → 100 climbs at its last rail only: the node at 50 goes, the ones at 100 and 150 stay
    expect(net.nodes.has(nodes[1].id)).toBe(true)
    expect(net.nodes.has(nodes[2].id)).toBe(true)
    expect(net.segments.size).toBe(3)
  })

  it('a run the fitter does not bring to its end is left alone', () => {
    const net = createNetwork()
    line(net, [0, 40, 100])
    const short: PathFitter = (points) => [{ x: points[0].x, y: points[0].y, heading: 0, curvature: 0, length: 10 }]
    expect(mergeIntoLongRails(net, { ...options, fit: short })).toEqual({ before: 2, after: 2, merged: 0 })
  })
})
