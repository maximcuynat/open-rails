import { beforeEach, describe, expect, it } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork, resetIdCounter, syncIdCounter } from './network'
import { generateId } from './ids'
import type { Network, PlatformEdge } from './types'
import {
  addPlatform,
  defaultMarkers,
  edgeLength,
  edgeLine,
  PLATFORM_EDGE_OFFSET,
  PLATFORM_WIDTH,
  platformDimensions,
  platformOutline,
  platformsOf,
  pointOnEdge,
  removePlatform,
} from './platforms'

/** A straight track from (0, 0) to (100, 0), as two rails of 50 m, and another at y = 10 */
function twoTracks(): { net: Network; a1: string; a2: string; b: string } {
  const net = createNetwork()
  const n0 = addNode(net, { x: 0, y: 0 })
  const n1 = addNode(net, { x: 50, y: 0 })
  const n2 = addNode(net, { x: 100, y: 0 })
  const a1 = addSegment(net, n0.id, n1.id)!.id
  const a2 = addSegment(net, n1.id, n2.id)!.id
  const m0 = addNode(net, { x: 0, y: 10 })
  const m1 = addNode(net, { x: 100, y: 10 })
  const b = addSegment(net, m0.id, m1.id)!.id
  return { net, a1, a2, b }
}

const close = (v: number) => expect.closeTo(v, 6)

describe('platforms', () => {
  beforeEach(() => resetIdCounter())

  it('are added, listed by station, and removed; their ids count with the others', () => {
    const { net, a1 } = twoTracks()
    const edge: PlatformEdge = { track: [{ segId: a1, t0: 0.2, t1: 0.8 }], side: 'left', ref: '1' }
    const platform = addPlatform(net, { stationId: 'st_1', edges: [edge], width: PLATFORM_WIDTH, markers: [{ edge: 0, at: 5, heading: 'forward' }] })
    // Kept as a copy: the draft may be changed afterwards
    edge.track[0].t1 = 1
    expect(net.platforms.get(platform.id)!.edges[0].track[0].t1).toBe(0.8)
    expect(platformsOf(net, 'st_1').map((p) => p.id)).toEqual([platform.id])
    expect(platformsOf(net, 'st_2')).toEqual([])

    resetIdCounter()
    syncIdCounter(net)
    expect(Number(generateId('x').split('_')[1])).toBeGreaterThan(Number(platform.id.split('_')[1]))

    expect(removePlatform(net, platform.id)).toBe(true)
    expect(removePlatform(net, platform.id)).toBe(false)
  })

  it('measure an edge along its track, across rails and against the way of a rail', () => {
    const { net, a1, a2 } = twoTracks()
    // From x = 90 back to x = 20: against the rails, 70 m
    const edge: PlatformEdge = { track: [{ segId: a2, t0: 0.8, t1: 0 }, { segId: a1, t0: 1, t1: 0.4 }], side: 'left' }
    expect(edgeLength(net, edge)).toBeCloseTo(70, 6)
    const start = pointOnEdge(net, edge, 0)!
    expect(start.point).toEqual({ x: close(90), y: close(0) })
    expect(start.heading).toEqual({ x: close(-1), y: close(0) })
    const middle = pointOnEdge(net, edge, 50)!
    expect(middle).toMatchObject({ segId: a1, point: { x: close(40), y: close(0) } })
    // Held to its ends
    expect(pointOnEdge(net, edge, 500)!.point.x).toBeCloseTo(20, 6)
    expect(pointOnEdge(net, edge, -5)!.point.x).toBeCloseTo(90, 6)
  })

  it('stand on the side seen on screen: left of a track running east is up (y smaller)', () => {
    const { net, a1 } = twoTracks()
    const left = edgeLine(net, { track: [{ segId: a1, t0: 0, t1: 1 }], side: 'left' }, 2)
    const right = edgeLine(net, { track: [{ segId: a1, t0: 0, t1: 1 }], side: 'right' }, 2)
    expect(left).toEqual([{ x: close(0), y: close(-2) }, { x: close(50), y: close(-2) }])
    expect(right).toEqual([{ x: close(0), y: close(2) }, { x: close(50), y: close(2) }])
    // Walked west, the left is down
    const westLeft = edgeLine(net, { track: [{ segId: a1, t0: 1, t1: 0 }], side: 'left' }, 2)
    expect(westLeft[0]).toEqual({ x: close(50), y: close(2) })
  })

  it('follow a curve, the platform edge at the same distance from the track all along', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 100 })
    const seg = addCurveSegment(net, a.id, b.id, { x: 100, y: 0 })!
    const edge: PlatformEdge = { track: [{ segId: seg.id, t0: 0, t1: 1 }], side: 'right' }
    const line = edgeLine(net, edge, PLATFORM_EDGE_OFFSET)
    expect(line.length).toBeGreaterThan(10)
    // Every point of the edge is 1.7 m from the curve, and inside the bend (the right, going round clockwise on screen)
    for (const p of line) {
      let nearest = Infinity
      for (let i = 0; i <= 2000; i++) {
        const q = pointOnEdge(net, edge, (edgeLength(net, edge) * i) / 2000)!.point
        nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.y - q.y))
      }
      expect(nearest).toBeCloseTo(PLATFORM_EDGE_OFFSET, 1)
    }
    expect(line[Math.floor(line.length / 2)].y).toBeGreaterThan(pointOnEdge(net, edge, edgeLength(net, edge) / 2)!.point.y)
  })

  it('outline a platform beside a track, and an island between two', () => {
    const { net, a1, b } = twoTracks()
    const dims = platformDimensions()
    const beside = addPlatform(net, { stationId: 'st_1', edges: [{ track: [{ segId: a1, t0: 0, t1: 1 }], side: 'right' }], width: 6, markers: [] })
    expect(platformOutline(net, beside, dims)).toEqual([
      { x: close(0), y: close(1.7) }, { x: close(50), y: close(1.7) },
      { x: close(50), y: close(7.7) }, { x: close(0), y: close(7.7) },
    ])
    // Track b (y = 10) walked the other way, west: its right faces track a, and the outline goes round
    const island = addPlatform(net, {
      stationId: 'st_1',
      edges: [{ track: [{ segId: a1, t0: 0, t1: 1 }], side: 'right' }, { track: [{ segId: b, t0: 0.5, t1: 0 }], side: 'right' }],
      width: 0,
      markers: [],
    })
    expect(platformOutline(net, island, dims)).toEqual([
      { x: close(0), y: close(1.7) }, { x: close(50), y: close(1.7) },
      { x: close(50), y: close(8.3) }, { x: close(0), y: close(8.3) },
    ])
  })

  it('get a stop marker per edge and per direction, short of the end a train runs towards', () => {
    const { net, a1, b } = twoTracks()
    const edges: PlatformEdge[] = [{ track: [{ segId: a1, t0: 0, t1: 1 }], side: 'right' }, { track: [{ segId: b, t0: 0.05, t1: 0 }], side: 'right' }]
    expect(defaultMarkers(net, edges, 10)).toEqual([
      { edge: 0, at: close(40), heading: 'forward' },
      { edge: 0, at: close(10), heading: 'backward' },
      // 5 m of edge: both in the middle
      { edge: 1, at: close(2.5), heading: 'forward' },
      { edge: 1, at: close(2.5), heading: 'backward' },
    ])
  })

  it('scale with the gauge of the layout', () => {
    const ho = platformDimensions(0.0165)
    expect(ho.edgeOffset).toBeCloseTo((PLATFORM_EDGE_OFFSET * 0.0165) / 1.435, 9)
    expect(platformDimensions().islandMinSpacing).toBeCloseTo(6.4, 9)
  })
})
