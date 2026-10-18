import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, dissolveNode, removeSegment, resetIdCounter } from './network'
import { splitSegment } from './junction'
import { networkCheckToken } from './networkWatch'
import { addStation, removeStation } from './stations'
import type { Network, Platform, PlatformEdge } from './types'
import { addPlatform, edgeLength, pointOnEdge, restorePlatform, settlePlatforms, stopsOfPlatforms, updatePlatform } from './platforms'

/**
 * Three rails along y = 0 (0–100–200–300) and a platform from x = 50 to x = 280: 50 m on the first
 * rail, the whole second, 80 m on the third, 230 m. Its markers stand at x = 60 (backward, 10 m in)
 * and x = 270 (forward, 10 m short of its far end).
 */
function station(): { net: Network; nodes: string[]; rails: string[]; platform: Platform; stationId: string } {
  const net = createNetwork()
  const nodes = [0, 100, 200, 300].map((x) => addNode(net, { x, y: 0 }).id)
  const rails = nodes.slice(1).map((id, i) => addSegment(net, nodes[i], id)!.id)
  const stationId = addStation(net, { name: 'Gare', pos: { x: 150, y: -10 }, stops: [] }).id
  const edge: PlatformEdge = {
    track: [
      { segId: rails[0], t0: 0.5, t1: 1 },
      { segId: rails[1], t0: 0, t1: 1 },
      { segId: rails[2], t0: 0, t1: 0.8 },
    ],
    side: 'left',
    ref: '1',
  }
  const platform = addPlatform(net, {
    stationId,
    edges: [edge],
    width: 6,
    markers: [
      { edge: 0, at: 220, heading: 'forward' },
      { edge: 0, at: 10, heading: 'backward', maxLength: 100 },
    ],
  })
  return { net, nodes, rails, platform, stationId }
}

/** Where a marker stands on the track, x only (the track runs along y = 0) */
const markerX = (net: Network, platform: Platform, index: number): number => {
  const marker = platform.markers[index]
  return pointOnEdge(net, platform.edges[marker.edge]!, marker.at)!.point.x
}

describe('platforms follow the track', () => {
  beforeEach(() => resetIdCounter())

  it('are part of what the revision of the network stands for: a change in place must be told', () => {
    const { net, platform } = station()
    networkCheckToken(net)
    platform.width = 3
    expect(() => networkCheckToken(net)).toThrow(/without touchNetwork: platform/)

    const other = station()
    const before = networkCheckToken(other.net)
    other.platform.markers[0].at = 100
    expect(() => networkCheckToken(other.net)).toThrow(/platform/)
    expect(updatePlatform(other.net, other.platform.id, { width: 4, markers: [{ edge: 0, at: 5, heading: 'forward' }] })).toBe(true)
    expect(networkCheckToken(other.net)).not.toBe(before)
    expect(other.platform).toMatchObject({ width: 4, markers: [{ edge: 0, at: 5, heading: 'forward' }] })
    expect(updatePlatform(other.net, 'pl_nowhere', { width: 1 })).toBe(false)
  })

  it('a cut rail makes two consecutive stretches; the platform and its markers stay where they are', () => {
    const { net, rails, platform } = station()
    expect(splitSegment(net, rails[1], { x: 150, y: 0 })).not.toBeNull()
    const track = platform.edges[0].track
    expect(track).toHaveLength(4)
    expect(track.some((span) => span.segId === rails[1])).toBe(false)
    expect(edgeLength(net, platform.edges[0])).toBeCloseTo(230, 6)
    expect(platform.markers.map((m) => m.at)).toEqual([220, 10])
    expect(markerX(net, platform, 0)).toBeCloseTo(270, 6)
    networkCheckToken(net)
  })

  it('merged rails make one stretch', () => {
    const { net, nodes, rails, platform } = station()
    const merged = dissolveNode(net, nodes[1])!
    expect(merged).not.toBeNull()
    const track = platform.edges[0].track
    expect(track).toHaveLength(2)
    expect(track[0]).toEqual({ segId: merged.id, t0: expect.closeTo(0.25, 9), t1: expect.closeTo(1, 9) })
    expect(track[1].segId).toBe(rails[2])
    expect(edgeLength(net, platform.edges[0])).toBeCloseTo(230, 6)
    expect(markerX(net, platform, 1)).toBeCloseTo(60, 6)
    networkCheckToken(net)
  })

  it('a rail removed in the middle leaves the longest part; the markers keep their place on the track or are held to the edge', () => {
    const { net, rails, platform } = station()
    removeSegment(net, rails[1])
    expect(net.platforms.get(platform.id)).toBe(platform)
    // 50 m before the gap, 80 m after it: the part after is kept, 150 m were cut away before it
    expect(platform.edges[0].track).toEqual([{ segId: rails[2], t0: 0, t1: 0.8 }])
    expect(platform.markers).toEqual([
      { edge: 0, at: expect.closeTo(70, 6), heading: 'forward' },
      { edge: 0, at: 0, heading: 'backward', maxLength: 100 },
    ])
    expect(markerX(net, platform, 0)).toBeCloseTo(270, 6)
    networkCheckToken(net)
  })

  it('a rail removed at the start shifts the markers back by what it held', () => {
    const { net, rails, platform } = station()
    removeSegment(net, rails[0])
    expect(platform.edges[0].track.map((span) => span.segId)).toEqual([rails[1], rails[2]])
    expect(platform.markers[0].at).toBeCloseTo(170, 6)
    expect(markerX(net, platform, 0)).toBeCloseTo(270, 6)
  })

  it('a platform whose edge loses all its track goes; an island that loses one of its tracks too', () => {
    const { net, rails, platform, stationId } = station()
    removeSegment(net, rails[0])
    removeSegment(net, rails[1])
    expect(net.platforms.has(platform.id)).toBe(true)
    removeSegment(net, rails[2])
    expect(net.platforms.has(platform.id)).toBe(false)
    networkCheckToken(net)

    const a = addNode(net, { x: 0, y: 10 })
    const b = addNode(net, { x: 100, y: 10 })
    const c = addNode(net, { x: 0, y: 20 })
    const d = addNode(net, { x: 100, y: 20 })
    const one = addSegment(net, a.id, b.id)!
    const two = addSegment(net, c.id, d.id)!
    const island = addPlatform(net, {
      stationId,
      edges: [{ track: [{ segId: one.id, t0: 0, t1: 1 }], side: 'right' }, { track: [{ segId: two.id, t0: 0, t1: 1 }], side: 'left' }],
      width: 0,
      markers: [],
    })
    removeSegment(net, two.id)
    expect(net.platforms.has(island.id)).toBe(false)
    networkCheckToken(net)
  })
})

describe('settlePlatforms', () => {
  beforeEach(() => resetIdCounter())

  it('writes the stops of a station from the markers of its platforms, and leaves a station without platform alone', () => {
    const { net, rails, platform, stationId } = station()
    const other = addStation(net, { name: 'Halte', pos: { x: 0, y: 0 }, stops: [{ segId: rails[0], t: 0.1, ref: 'B' }] })
    networkCheckToken(net)
    expect(settlePlatforms(net)).toBe(true)
    const stops = net.stations.get(stationId)!.stops
    expect(stops).toEqual([
      { segId: rails[2], t: expect.closeTo(0.7, 9), ref: '1' },
      { segId: rails[0], t: expect.closeTo(0.6, 9), ref: '1' },
    ])
    expect(stops).toEqual(stopsOfPlatforms(net, [platform]))
    expect(other.stops).toEqual([{ segId: rails[0], t: 0.1, ref: 'B' }])
    networkCheckToken(net)

    // Nothing to write: nothing written, the revision does not move
    const token = networkCheckToken(net)
    expect(settlePlatforms(net)).toBe(false)
    expect(networkCheckToken(net)).toBe(token)
  })

  it('follows the markers when the track is edited', () => {
    const { net, rails, stationId } = station()
    settlePlatforms(net)
    removeSegment(net, rails[1])
    expect(settlePlatforms(net)).toBe(true)
    expect(net.stations.get(stationId)!.stops).toEqual([
      { segId: rails[2], t: expect.closeTo(0.7, 9), ref: '1' },
      { segId: rails[2], t: expect.closeTo(0, 9), ref: '1' },
    ])
  })

  it('drops the platforms of a station that is gone', () => {
    const { net, platform, stationId } = station()
    removeStation(net, stationId)
    expect(settlePlatforms(net)).toBe(true)
    expect(net.platforms.has(platform.id)).toBe(false)
    expect(settlePlatforms(net)).toBe(false)
  })

  it('cuts at a stretch on a rail that is not there and holds the markers to their edge', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const rail = addSegment(net, a.id, b.id)!
    const stationId = addStation(net, { name: 'G', pos: { x: 0, y: 0 }, stops: [] }).id
    // Changed by hand, as a file could hold it: then told
    const platform = addPlatform(net, {
      stationId,
      edges: [{ track: [{ segId: 'gone', t0: 0, t1: 1 }, { segId: rail.id, t0: 0, t1: 1 + 1e-12 }], side: 'right' }],
      width: 6,
      markers: [{ edge: 0, at: 500, heading: 'forward' }, { edge: 1 as 0, at: 5, heading: 'backward' }],
    })
    expect(settlePlatforms(net)).toBe(true)
    expect(platform.edges[0].track).toEqual([{ segId: rail.id, t0: 0, t1: 1 }])
    expect(platform.markers).toEqual([{ edge: 0, at: expect.closeTo(100, 9), heading: 'forward' }])
    expect(net.stations.get(stationId)!.stops).toEqual([{ segId: rail.id, t: expect.closeTo(1, 9) }])
    networkCheckToken(net)
  })
})

describe('restorePlatform', () => {
  it('takes a record as written and refuses one that does not hold together', () => {
    const net = createNetwork()
    const good = {
      id: 'pl_3',
      stationId: 'st_1',
      edges: [{ track: [{ segId: 's_1', t0: 0, t1: 1 }], side: 'left', ref: '2' }],
      width: 5,
      markers: [{ edge: 0, at: 4, heading: 'forward', maxLength: 120 }, { edge: 1, at: 4, heading: 'forward' }, { edge: 0, at: 'x', heading: 'forward' }, null],
    }
    expect(restorePlatform(net, good)).toBe(true)
    expect(net.platforms.get('pl_3')).toEqual({
      id: 'pl_3',
      stationId: 'st_1',
      edges: [{ track: [{ segId: 's_1', t0: 0, t1: 1 }], side: 'left', ref: '2' }],
      width: 5,
      markers: [{ edge: 0, at: 4, heading: 'forward', maxLength: 120 }],
    })
    const bad = [
      null,
      {},
      { ...good, id: 'pl_4', edges: [] },
      { ...good, id: 'pl_4', edges: [{ track: [], side: 'up' }] },
      { ...good, id: 'pl_4', edges: [{ track: [{ segId: 's_1', t0: 0 }], side: 'left' }] },
      { ...good, id: 'pl_4', stationId: 7 },
      good,
    ]
    for (const record of bad) expect(restorePlatform(net, record as never)).toBe(false)
    expect(net.platforms.size).toBe(1)
  })
})
