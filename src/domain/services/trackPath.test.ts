import { beforeEach, describe, expect, it } from 'vitest'
import { addArcCurve, addNode, addSegment, createNetwork, resetIdCounter } from '../models/network'
import { placeTurnout, setJunctionBranch } from '../models/junction'
import { snapToNearestTrack } from '../models/locomotive'
import type { Network } from '../models/types'
import { findTrackPath, trackSpansEnds, trackSpansLength } from './trackPath'

beforeEach(() => resetIdCounter(0))

function at(net: Network, x: number, y = 0) {
  const hit = snapToNearestTrack(net, { x, y }, 0.5)
  if (!hit) throw new Error(`no track at ${x}, ${y}`)
  return { segId: hit.segId, t: hit.t }
}

describe('findTrackPath', () => {
  it('joins two points of one rail along it, in either direction', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 1000, y: 0 })
    const rail = addSegment(net, a.id, b.id)!

    const forward = findTrackPath(net, { segId: rail.id, t: 0.2 }, { segId: rail.id, t: 0.7 })!
    expect(forward.spans).toEqual([{ segId: rail.id, t0: 0.2, t1: 0.7 }])
    expect(forward.length).toBeCloseTo(500, 9)

    const backward = findTrackPath(net, { segId: rail.id, t: 0.7 }, { segId: rail.id, t: 0.2 })!
    expect(backward.spans).toEqual([{ segId: rail.id, t0: 0.7, t1: 0.2 }])
    expect(backward.length).toBeCloseTo(500, 9)
  })

  it('gives an empty path for one and the same place, and null off the track', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 1000, y: 0 })
    const rail = addSegment(net, a.id, b.id)!
    expect(findTrackPath(net, { segId: rail.id, t: 0.4 }, { segId: rail.id, t: 0.4 })).toEqual({ spans: [], length: 0 })
    expect(findTrackPath(net, { segId: 's_nope', t: 0.4 }, { segId: rail.id, t: 0.4 })).toBeNull()
    expect(findTrackPath(net, { segId: rail.id, t: 0.4 }, { segId: rail.id, t: NaN })).toBeNull()
  })

  it('runs over several rails, each in the direction it is walked', () => {
    const net = createNetwork()
    const n = [0, 300, 600, 1000].map((x) => addNode(net, { x, y: 0 }))
    const first = addSegment(net, n[0].id, n[1].id)!
    const middle = addSegment(net, n[2].id, n[1].id)! // laid the other way round
    const last = addSegment(net, n[2].id, n[3].id)!

    const path = findTrackPath(net, at(net, 100), at(net, 900))!
    expect(path.spans).toHaveLength(3)
    expect(path.spans[0].segId).toBe(first.id)
    expect(path.spans[0].t1).toBe(1)
    expect(path.spans[1]).toEqual({ segId: middle.id, t0: 1, t1: 0 })
    expect(path.spans[2].segId).toBe(last.id)
    expect(path.spans[2].t0).toBe(0)
    expect(path.length).toBeCloseTo(800, 9)
    expect(trackSpansLength(net, path.spans)).toBeCloseTo(path.length, 9)
    const ends = trackSpansEnds(net, path.spans)!
    expect(ends.a.x).toBeCloseTo(100, 9)
    expect(ends.b.x).toBeCloseTo(900, 9)

    const back = findTrackPath(net, at(net, 900), at(net, 100))!
    expect(back.spans.map((s) => s.segId)).toEqual([last.id, middle.id, first.id])
    expect(back.spans[1]).toEqual({ segId: middle.id, t0: 0, t1: 1 })
    expect(back.length).toBeCloseTo(800, 9)
  })

  it('drops the stretch of no length when a point sits on a node', () => {
    const net = createNetwork()
    const n = [0, 300, 600].map((x) => addNode(net, { x, y: 0 }))
    const first = addSegment(net, n[0].id, n[1].id)!
    const second = addSegment(net, n[1].id, n[2].id)!
    const path = findTrackPath(net, { segId: first.id, t: 1 }, { segId: second.id, t: 0.5 })!
    expect(path.spans).toEqual([{ segId: second.id, t0: 0, t1: 0.5 }])
    expect(path.length).toBeCloseTo(150, 9)
  })

  describe('through a turnout', () => {
    function turnoutLayout() {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const apex = addNode(net, { x: 200, y: 0 })
      const stem = addSegment(net, a.id, apex.id)!
      const res = placeTurnout(net, { startPos: apex.pos, direction: { x: 1, y: 0 }, frogNumber: 6, hand: 'left', stemNodeId: apex.id })
      const straight = [...net.segments.values()].find((s) => (s.from === res.straightNode.id || s.to === res.straightNode.id) && s.kind === 'straight' && s.id !== stem.id)!
      const diverging = [...net.segments.values()].find((s) => s.from === res.divergingNode.id || s.to === res.divergingNode.id)!
      return { net, stem, straight, diverging, junction: res.junction! }
    }

    it('takes either branch, whatever the position of the points', () => {
      const { net, stem, straight, diverging, junction } = turnoutLayout()
      for (const branch of ['straight', 'diverging'] as const) {
        setJunctionBranch(junction, branch)
        const toDiverging = findTrackPath(net, { segId: stem.id, t: 0.5 }, { segId: diverging.id, t: 0.5 })!
        expect(toDiverging.spans.map((s) => s.segId)).toEqual([stem.id, diverging.id])
        const toStraight = findTrackPath(net, { segId: stem.id, t: 0.5 }, { segId: straight.id, t: 0.5 })!
        expect(toStraight.spans.map((s) => s.segId)).toEqual([stem.id, straight.id])
        // …and from a branch back to the stem
        const fromBranch = findTrackPath(net, { segId: diverging.id, t: 0.5 }, { segId: stem.id, t: 0.5 })!
        expect(fromBranch.spans.map((s) => s.segId)).toEqual([diverging.id, stem.id])
        expect(fromBranch.length).toBeCloseTo(toDiverging.length, 6)
      }
    })

    it('does not go from one branch to the other: a train cannot turn at the points', () => {
      const { net, straight, diverging } = turnoutLayout()
      expect(findTrackPath(net, { segId: straight.id, t: 0.5 }, { segId: diverging.id, t: 0.5 })).toBeNull()
    })
  })

  describe('on a loop', () => {
    /** A square circuit with rounded corners, 100 m straights along its four sides */
    function circuit() {
      const net = createNetwork()
      const p = [
        { x: 50, y: 0 }, { x: 150, y: 0 },
        { x: 200, y: 50 }, { x: 200, y: 150 },
        { x: 150, y: 200 }, { x: 50, y: 200 },
        { x: 0, y: 150 }, { x: 0, y: 50 },
      ].map((pos) => addNode(net, pos))
      const corners = [{ x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 0 }]
      const sides = [0, 2, 4, 6].map((i) => addSegment(net, p[i].id, p[i + 1].id)!)
      for (let i = 0; i < 4; i++) addArcCurve(net, p[2 * i + 1].id, p[(2 * i + 2) % 8].id, corners[i])
      return { net, sides }
    }

    it('takes the shorter way round', () => {
      const { net, sides } = circuit()
      const [bottom, right, , left] = sides
      const clockwise = findTrackPath(net, { segId: bottom.id, t: 0.5 }, { segId: right.id, t: 0.5 })!
      expect(clockwise.spans[0]).toEqual({ segId: bottom.id, t0: 0.5, t1: 1 })
      expect(clockwise.spans[clockwise.spans.length - 1]).toEqual({ segId: right.id, t0: 0, t1: 0.5 })
      expect(clockwise.spans.some((s) => s.segId === left.id)).toBe(false)

      const other = findTrackPath(net, { segId: bottom.id, t: 0.5 }, { segId: left.id, t: 0.5 })!
      expect(other.spans[0]).toEqual({ segId: bottom.id, t0: 0.5, t1: 0 })
      // The left side is laid from top to bottom: it is entered by its `to` end
      expect(other.spans[other.spans.length - 1]).toEqual({ segId: left.id, t0: 1, t1: 0.5 })
      expect(other.length).toBeCloseTo(clockwise.length, 6)
      expect(trackSpansLength(net, other.spans)).toBeCloseTo(other.length, 9)
    })

    it('joins two points of one rail along that rail, not round the loop', () => {
      const { net, sides } = circuit()
      const path = findTrackPath(net, { segId: sides[0].id, t: 0.1 }, { segId: sides[0].id, t: 0.9 })!
      expect(path.spans).toEqual([{ segId: sides[0].id, t0: 0.1, t1: 0.9 }])
      expect(path.length).toBeCloseTo(80, 9)
    })
  })

  it('finds no path between two tracks that are not joined', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 0, y: 50 })
    const d = addNode(net, { x: 100, y: 50 })
    const one = addSegment(net, a.id, b.id)!
    const two = addSegment(net, c.id, d.id)!
    expect(findTrackPath(net, { segId: one.id, t: 0.5 }, { segId: two.id, t: 0.5 })).toBeNull()
  })

  it('finds no path round a corner a train cannot take', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 100, y: 100 })
    const one = addSegment(net, a.id, b.id)!
    const two = addSegment(net, b.id, c.id)!
    expect(findTrackPath(net, { segId: one.id, t: 0.5 }, { segId: two.id, t: 0.5 })).toBeNull()
  })
})
