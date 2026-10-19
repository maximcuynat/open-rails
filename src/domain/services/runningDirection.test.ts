import { beforeEach, describe, expect, it } from 'vitest'
import type { Network, Segment, TrackSpan } from '../models/types'
import { addNode, addSegment, createNetwork, resetIdCounter } from '../models/network'
import { proposeJunction } from '../models/junction'
import { setRunning } from '../models/running'
import { addStation } from '../models/stations'
import { findRouteGuide } from './routeGuide'
import { inferKeepLeft, lengthAgainstRunning, RUNNING_TOLL_PER_M, runningToll } from './runningDirection'
import { findTrackPathToAny } from './trackPath'

beforeEach(() => resetIdCounter(0))

const SPACING = 4.5

/** A track along y, a rail between each two of `xs`, laid towards +x */
function track(net: Network, xs: number[], y: number): { rails: Segment[]; nodes: string[] } {
  const nodes = xs.map((x) => addNode(net, { x, y }).id)
  return { nodes, rails: nodes.slice(1).map((id, i) => addSegment(net, nodes[i], id)!) }
}

/**
 * A double line along x: the north track at y = 0, the south one at y = SPACING (y grows
 * southwards). Two crossovers, each way, at 1 000 – 1 100 m and at 3 000 – 3 100 m. Going east,
 * the north track is on the left.
 */
function doubleLine(withRunning = true) {
  const net = createNetwork()
  const xs = [0, 1000, 1100, 3000, 3100, 5000]
  const north = track(net, xs, 0)
  const south = track(net, xs, SPACING)
  const crossovers = [
    addSegment(net, south.nodes[1], north.nodes[2])!,
    addSegment(net, north.nodes[1], south.nodes[2])!,
    addSegment(net, south.nodes[3], north.nodes[4])!,
    addSegment(net, north.nodes[3], south.nodes[4])!,
  ]
  for (const nodeId of [...north.nodes.slice(1, 5), ...south.nodes.slice(1, 5)]) proposeJunction(net, nodeId)
  if (withRunning) {
    for (const rail of north.rails) setRunning(net, rail, 'forward')
    for (const rail of south.rails) setRunning(net, rail, 'backward')
  }
  return { net, north, south, crossovers }
}

/** The rails of the way that lie on the south track */
function southRailsOf(spans: readonly TrackSpan[], south: { rails: Segment[] }): string[] {
  const ids = new Set(south.rails.map((rail) => rail.id))
  return spans.filter((span) => ids.has(span.segId) && span.t0 !== span.t1).map((span) => span.segId)
}

describe('the toll of running against the normal direction', () => {
  it('is the length of the rail entered against it, nothing otherwise', () => {
    const { net, north, south } = doubleLine()
    const toll = runningToll(net)
    // Entering the second north rail at its from end: with it
    expect(toll(north.nodes[1], north.rails[0].id, north.rails[1].id)).toBe(0)
    // The second south rail entered at its from end: against, 100 m
    expect(toll(south.nodes[1], south.rails[0].id, south.rails[1].id)).toBeCloseTo(100 * RUNNING_TOLL_PER_M, 6)
    // Walked backwards, the other way round
    expect(runningToll(net, true)(south.nodes[1], south.rails[0].id, south.rails[1].id)).toBe(0)
    expect(runningToll(net, true)(north.nodes[1], north.rails[0].id, north.rails[1].id)).toBeCloseTo(100, 6)
  })

  it('brings a train set down on the wrong track back to its own at the first crossover', () => {
    const { net, north, south } = doubleLine()
    const station = addStation(net, {
      name: 'Est',
      pos: { x: 4500, y: 2 },
      stops: [
        { segId: north.rails[4].id, t: 0.7, ref: '1' },
        { segId: south.rails[4].id, t: 0.7, ref: '2' },
      ],
    })
    const lead = { segId: south.rails[0].id, t: 0.5, forward: true }
    const guide = findRouteGuide(net, lead, station)!
    expect(guide.stop?.ref).toBe('1')
    // Off the south track after its first rail, through the first crossover
    expect(southRailsOf(guide.path.spans, south)).toEqual([south.rails[0].id])
    expect(lengthAgainstRunning(net, guide.path.spans)).toBeCloseTo(500, 3)
    // The length is the real one, not what the toll counts
    expect(guide.path.length).toBeLessThan(4400)
  })

  it('keeps a train to the left, and the plain search to the shortest way', () => {
    const { net, north, south } = doubleLine()
    // A train going west on the north track, to the west end: it changes over to the south track
    const from = { segId: north.rails[4].id, t: 0.5 }
    const goals = [{ segId: north.rails[0].id, t: 0.1 }, { segId: south.rails[0].id, t: 0.1 }]
    const plain = findTrackPathToAny(net, from, goals, { leaving: 0 })!
    expect(plain.goal).toBe(0)
    const kept = findTrackPathToAny(net, from, goals, { leaving: 0, toll: runningToll(net) })!
    expect(kept.goal).toBe(1)
    // Only the stretch of the rail it starts on, then over at the first crossover
    expect(lengthAgainstRunning(net, kept.spans)).toBeCloseTo(950, 3)
  })

  it('is a cost, not a ban: a platform on the other track is still reached', () => {
    const { net, south } = doubleLine()
    const station = addStation(net, { name: 'Est', pos: { x: 4500, y: 5 }, stops: [{ segId: south.rails[4].id, t: 0.7, ref: '2' }] })
    const lead = { segId: south.rails[0].id, t: 0.5, forward: true }
    const guide = findRouteGuide(net, lead, station)!
    expect(guide).not.toBeNull()
    expect(guide.stop?.ref).toBe('2')
    // It keeps to the left as long as it can, and crosses over at the last crossover
    expect(lengthAgainstRunning(net, guide.path.spans)).toBeLessThan(2000)
  })

  it('costs nothing on track without a normal direction', () => {
    const { net, north, south } = doubleLine(false)
    const station = addStation(net, {
      name: 'Est',
      pos: { x: 4500, y: 2 },
      stops: [
        { segId: north.rails[4].id, t: 0.7, ref: '1' },
        { segId: south.rails[4].id, t: 0.7, ref: '2' },
      ],
    })
    const guide = findRouteGuide(net, { segId: south.rails[0].id, t: 0.5, forward: true }, station)!
    expect(guide.stop?.ref).toBe('2')
    expect(southRailsOf(guide.path.spans, south).length).toBe(5)
  })
})

describe('keeping left where the data says nothing', () => {
  it('gives the two tracks of a double line opposite directions, each leaving the other on its right', () => {
    const net = createNetwork()
    const xs = [0, 1000, 2000, 3000]
    const north = track(net, xs, 0)
    const south = track(net, xs, SPACING)
    expect(inferKeepLeft(net)).toBe(6)
    // Going east (from → to) the south track is on the right of the north one: north runs east
    for (const rail of north.rails) expect(rail.running).toBe('forward')
    for (const rail of south.rails) expect(rail.running).toBe('backward')
  })

  it('reads a rail laid the other way, and a line going north', () => {
    const net = createNetwork()
    // Going north (y decreasing), left is west: the west track runs north
    const west = addSegment(net, addNode(net, { x: 0, y: 3000 }).id, addNode(net, { x: 0, y: 0 }).id)!
    const east = addSegment(net, addNode(net, { x: SPACING, y: 0 }).id, addNode(net, { x: SPACING, y: 3000 }).id)!
    inferKeepLeft(net)
    expect(west.running).toBe('forward')
    // Laid southwards: its normal direction, south, is forward
    expect(east.running).toBe('forward')
  })

  it('leaves a single track, a passing loop and three tracks side by side alone', () => {
    const net = createNetwork()
    const single = track(net, [0, 1000, 2000], 0)
    // A loop of 800 m beside a single line
    const line = track(net, [10000, 11000, 11100, 11900, 12000, 13000], 0)
    const loop = track(net, [11100, 11900], SPACING)
    addSegment(net, line.nodes[1], loop.nodes[0])
    addSegment(net, loop.nodes[1], line.nodes[4])
    // Three tracks
    const three = [0, SPACING, 2 * SPACING].map((y) => track(net, [20000, 23000], 50 + y))
    inferKeepLeft(net)
    for (const rail of [...single.rails, ...line.rails, ...loop.rails, ...three.flatMap((t) => t.rails)]) expect(rail.running).toBeUndefined()
  })

  it('leaves alone what already has a direction, and what it is told to', () => {
    const net = createNetwork()
    const north = track(net, [0, 3000], 0)
    const south = track(net, [0, 3000], SPACING)
    setRunning(net, north.rails[0], 'backward')
    inferKeepLeft(net, { skip: (seg) => seg.id === south.rails[0].id })
    expect(north.rails[0].running).toBe('backward')
    expect(south.rails[0].running).toBeUndefined()
  })
})
