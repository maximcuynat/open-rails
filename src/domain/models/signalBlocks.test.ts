import { beforeEach, describe, expect, it } from 'vitest'
import { addSegment, createNetwork, resetIdCounter } from './network'
import { syncJunctions, toggleJunction } from './junction'
import { addSignal, removeSignal } from './signals'
import { signalBlock, signalBlockStats, signalBlocks, signalRoute, signalTopology } from './signalBlocks'
import type { TrackSpan } from './types'
import { chain, crossoverLayout, junctionAt, line, setPoints, signalAt } from './signalling.testkit'

beforeEach(() => resetIdCounter(0))

const rails = (spans: TrackSpan[]): string[] => [...new Set(spans.map((span) => span.segId))]

describe('block of a signal', () => {
  it('runs from the signal to the next signal of the same direction', () => {
    const { net } = line(10, 500)
    const first = signalAt(net, 1250, 0, 'east')
    const second = signalAt(net, 3100, 0, 'east')
    const block = signalBlock(net, first.id)!
    expect(block.boundingSignals).toEqual([second.id])
    expect(block.trackEnds).toBe(0)
    expect(block.length).toBeCloseTo(1850, 6)
    expect(block.minLength).toBeCloseTo(1850, 6)
    expect(block.maxLength).toBeCloseTo(1850, 6)
    expect(block.nodes).toEqual([])
    // In the order it is walked, each stretch from the signal onwards
    expect(block.spans[0]).toEqual({ segId: first.segId, t0: first.t, t1: 1 })
    expect(block.spans[block.spans.length - 1]).toEqual({ segId: second.segId, t0: 0, t1: second.t })
    expect(block.truncated).toBe(false)
  })

  it('runs to the end of the track when no signal bounds it', () => {
    const { net } = line(10, 500)
    const last = signalAt(net, 4000, 0, 'east')
    const block = signalBlock(net, last.id)!
    expect(block.boundingSignals).toEqual([])
    expect(block.trackEnds).toBe(1)
    expect(block.length).toBeCloseTo(1000, 6)
  })

  it('ignores the signals of the other direction: two signals back to back bound nothing for each other', () => {
    const { net } = line(10, 500)
    const east = signalAt(net, 1000.5, 0, 'east')
    const west = signalAt(net, 3000.5, 0, 'west')
    signalAt(net, 2000.5, 0, 'west')
    expect(signalBlock(net, east.id)!.boundingSignals).toEqual([])
    expect(signalBlock(net, east.id)!.length).toBeCloseTo(3999.5, 6)
    // The westbound one is bounded by the other westbound one, 1 000 m further west
    expect(signalBlock(net, west.id)!.length).toBeCloseTo(1000, 6)
  })

  it('takes every branch at a fork that no path signal guards', () => {
    const net = createNetwork()
    const main = chain(net, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 3000, y: 0 }])
    const branch = chain(net, [{ x: 1400, y: 20 }, { x: 3000, y: 20 }], main.nodes[1])
    const junction = junctionAt(net, main.nodes[1])
    const entry = signalAt(net, 500, 0, 'east')
    const onMain = signalAt(net, 2000, 0, 'east')
    const onBranch = signalAt(net, 2000, 20, 'east')

    const block = signalBlock(net, entry.id)!
    expect(new Set(block.boundingSignals)).toEqual(new Set([onMain.id, onBranch.id]))
    expect(rails(block.spans)).toEqual(expect.arrayContaining([main.rails[0].id, main.rails[1].id, branch.rails[0].id, branch.rails[1].id]))
    expect(block.nodes).toEqual([main.nodes[1].id])
    expect(block.junctions).toEqual([junction.id])
    expect(block.conflictPoints).toEqual([
      { nodeId: main.nodes[1].id, kind: 'facing', junctionId: junction.id, segId: main.rails[0].id, t: 1 },
    ])
    // 500 m to the points, then 1 000 m on the main line and 400.5 + 600 m on the branch
    expect(block.length).toBeCloseTo(500 + 1000 + Math.hypot(400, 20) + 600, 6)
    expect(block.minLength).toBeCloseTo(1500, 6)
    expect(block.maxLength).toBeCloseTo(500 + Math.hypot(400, 20) + 600, 6)

    // Throwing the points changes nothing to it
    const kept = signalTopology(net)
    toggleJunction(junction)
    expect(signalTopology(net)).toBe(kept)
  })

  it('goes through trailing points onto the one track they lead to, and counts them', () => {
    const layout = crossoverLayout()
    const block = signalBlock(layout.net, layout.pb.id)!
    expect(block.boundingSignals).toEqual([layout.sb.id])
    expect(block.nodes).toEqual([layout.forkB.id])
    // Met by the heel: no route parts there
    expect(block.conflictPoints).toEqual([])
    expect(rails(block.spans)).not.toContain(layout.crossover.id)
  })

  it('a loop with a single signal: the block is the whole loop, once', () => {
    // Thirty-six rails on a circle of 500 m radius: each meets the next within the deflection limit
    const net = createNetwork()
    const points = Array.from({ length: 36 }, (_, i) => {
      const angle = (i * 2 * Math.PI) / 36
      return { x: 500 * Math.cos(angle), y: 500 * Math.sin(angle) }
    })
    const ring = chain(net, points)
    ring.rails.push(addSegment(net, ring.nodes[35].id, ring.nodes[0].id)!)
    const laid = addSignal(net, { segId: ring.rails[3].id, t: 0.5 }, true, 'spacing')
    if (!laid.ok) throw new Error('refused')

    const block = signalBlock(net, laid.signal.id)!
    expect(block.boundingSignals).toEqual([laid.signal.id])
    expect(block.truncated).toBe(false)
    const side = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
    expect(block.length).toBeCloseTo(36 * side, 6)
    expect(rails(block.spans)).toHaveLength(36)
  })

  it('a balloon loop without bounding signal ends once every rail has been run both ways', () => {
    // A stem leading to a ring through points: the walk comes back down the stem and stops at its end
    const net = createNetwork()
    const points = Array.from({ length: 36 }, (_, i) => {
      const angle = (i * 2 * Math.PI) / 36
      return { x: 500 * Math.cos(angle), y: 500 * Math.sin(angle) }
    })
    const ring = chain(net, points)
    ring.rails.push(addSegment(net, ring.nodes[35].id, ring.nodes[0].id)!)
    // The stem arrives tangent to the ring at its node 0 (500, 0), from below
    const stem = chain(net, [{ x: 500, y: -1000 }, { x: 500, y: -500 }])
    addSegment(net, stem.nodes[1].id, ring.nodes[0].id)
    syncJunctions(net)
    const signal = signalAt(net, 500, -800, 'east')
    // Whatever the direction read for it, the block is finite and not truncated
    const block = signalBlock(net, signal.id)!
    expect(block.truncated).toBe(false)
    expect(Number.isFinite(block.length)).toBe(true)
    expect(block.spans.length).toBeLessThan(200)
  })
})

describe('blocks are kept', () => {
  it('until the track, a route table or a signal changes', () => {
    const { net, nodes } = line(10, 500)
    const first = signalAt(net, 1250, 0, 'east')
    const builds = signalBlockStats.topologyBuilds
    const topology = signalTopology(net)
    expect(signalBlockStats.topologyBuilds).toBe(builds + 1)
    for (let i = 0; i < 50; i++) signalBlocks(net)
    expect(signalBlockStats.topologyBuilds).toBe(builds + 1)
    expect(signalTopology(net)).toBe(topology)

    const second = signalAt(net, 3100, 0, 'east')
    expect(signalTopology(net)).not.toBe(topology)
    expect(signalBlock(net, first.id)!.length).toBeCloseTo(1850, 6)

    // The track moves under the signals: the block is measured again
    nodes[3].pos.x += 100
    expect(signalBlock(net, first.id)!.length).toBeCloseTo(1800, 6)
    nodes[3].pos.x -= 100

    removeSignal(net, second.id)
    expect(signalBlock(net, second.id)).toBeNull()
    expect(signalBlock(net, first.id)!.boundingSignals).toEqual([])
  })

  it('the rail → blocks index tells which blocks a place belongs to', () => {
    const { net } = line(10, 500)
    const first = signalAt(net, 1250, 0, 'east')
    const second = signalAt(net, 3100, 0, 'east')
    const topology = signalTopology(net)
    const onRail = topology.railBlocks.get(second.segId)!
    // The rail of the second signal is shared: up to the signal in the first block, beyond in the second
    expect(onRail.map((stretch) => [stretch.block.signalId, stretch.lo, stretch.hi])).toEqual([
      [first.id, 0, second.t],
      [second.id, second.t, 1],
    ])
  })
})

describe('route from a signal', () => {
  it('follows the points as they are set to the next signal, and is walked again when they are thrown', () => {
    const net = createNetwork()
    const main = chain(net, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 3000, y: 0 }])
    const branch = chain(net, [{ x: 1400, y: 20 }, { x: 3000, y: 20 }], main.nodes[1])
    const entry = signalAt(net, 500, 0, 'east')
    const onMain = signalAt(net, 2000, 0, 'east')
    signalAt(net, 2500, 20, 'east')

    setPoints(net, main.nodes[1], main.rails[0], main.rails[1])
    const walks = signalBlockStats.routeWalks
    const straight = signalRoute(net, entry.id)!
    expect(straight.next).toBe(onMain.id)
    expect(straight.length).toBeCloseTo(1500, 6)
    expect(straight.nodes).toEqual([main.nodes[1].id])
    expect(straight.endsOnTrackEnd).toBe(false)
    expect(signalRoute(net, entry.id)).toBe(straight)
    expect(signalBlockStats.routeWalks).toBe(walks + 1)

    setPoints(net, main.nodes[1], main.rails[0], branch.rails[0])
    const diverging = signalRoute(net, entry.id)!
    expect(diverging).not.toBe(straight)
    expect(diverging.length).toBeCloseTo(500 + Math.hypot(400, 20) + 1100, 6)
    expect(rails(diverging.spans)).toContain(branch.rails[0].id)
  })

  it('ends on the end of the track, or on points set against it', () => {
    const layout = crossoverLayout()
    const { net } = layout
    expect(signalRoute(net, layout.sa.id)).toMatchObject({ next: null, endsOnTrackEnd: true })
    expect(signalRoute(net, layout.sa.id)!.length).toBeCloseTo(500, 6)

    // Points on B set for the crossover: a train coming along B finds them against it
    layout.route('diverging')
    const blocked = signalRoute(net, layout.pb.id)!
    expect(blocked).toMatchObject({ next: null, endsOnTrackEnd: true })
    expect(blocked.length).toBeCloseTo(500, 6)
    layout.route('straight')
    expect(signalRoute(net, layout.pb.id)!.next).toBe(layout.sb.id)
  })

  it('names the plain track beyond the next signal, as far as the next points', () => {
    const { net, rails: laid } = line(6, 500)
    const first = signalAt(net, 250, 0, 'east')
    signalAt(net, 1250, 0, 'east')
    const route = signalRoute(net, first.id)!
    expect(route.beyond.map((rail) => rail.segId)).toEqual(laid.slice(2).map((rail) => rail.id))
    expect(route.beyond.every((rail) => rail.ascending)).toBe(true)
  })
})
