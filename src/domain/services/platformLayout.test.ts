import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, resetIdCounter } from '../models/network'
import { addPlatform, edgeLength, PLATFORM_WIDTH, platformDimensions, pointOnEdge } from '../models/platforms'
import { addStation } from '../models/stations'
import { proposeJunction } from '../models/junction'
import type { Network, PlatformEdge, SegmentId } from '../models/types'
import {
  aimPlatformStart,
  layPlatforms,
  nextStationName,
  planPlatform,
  railsAlong,
  rakesFitting,
  stationForPlatform,
  type PlatformPlanInput,
} from './platformLayout'

const dims = platformDimensions()

/** Track A along y = 0 from x = 0 to 100 (two rails of 50 m), and optionally track B along y = `other` */
function tracks(other: number | null = null): { net: Network; a1: SegmentId; a2: SegmentId; b: SegmentId | null } {
  const net = createNetwork()
  const n0 = addNode(net, { x: 0, y: 0 })
  const n1 = addNode(net, { x: 50, y: 0 })
  const n2 = addNode(net, { x: 100, y: 0 })
  const a1 = addSegment(net, n0.id, n1.id)!.id
  const a2 = addSegment(net, n1.id, n2.id)!.id
  let b: SegmentId | null = null
  if (other !== null) {
    const m0 = addNode(net, { x: 0, y: other })
    const m1 = addNode(net, { x: 100, y: other })
    b = addSegment(net, m0.id, m1.id)!.id
  }
  return { net, a1, a2, b }
}

const input = (start: { segId: SegmentId; t: number }, x: number, y: number, more: Partial<PlatformPlanInput> = {}): PlatformPlanInput => ({
  start, cursor: { x, y }, dims, snapDistance: 1, bothSides: false, ...more,
})

const endX = (net: Network, edge: PlatformEdge) => pointOnEdge(net, edge, edgeLength(net, edge))!.point.x

describe('laying a platform', () => {
  beforeEach(() => resetIdCounter())

  it('follows its track from the start to the cursor, across rails', () => {
    const { net, a1, a2 } = tracks()
    const plan = planPlatform(net, input({ segId: a1, t: 0.2 }, 90, -4))!
    expect(plan.refusal).toBeNull()
    expect(plan.kind).toBe('side')
    expect(plan.length).toBeCloseTo(80, 6)
    expect(plan.platforms).toHaveLength(1)
    const edge = plan.platforms[0][0]
    expect(edge.track.map((s) => s.segId)).toEqual([a1, a2])
    expect(edge.track[0].t0).toBeCloseTo(0.2, 6)
    expect(edge.track[1].t1).toBeCloseTo(0.8, 6)
  })

  it('takes the side of the cursor, seen walking from the start to the end', () => {
    const { net, a1 } = tracks()
    // y grows downwards: walking towards +x, y < 0 is on the left
    expect(planPlatform(net, input({ segId: a1, t: 0.2 }, 90, -4))!.side).toBe('left')
    expect(planPlatform(net, input({ segId: a1, t: 0.2 }, 90, 4))!.side).toBe('right')
    // Walked the other way, the same place is on the other side
    expect(planPlatform(net, input({ segId: a1, t: 0.9 }, 5, -4))!.side).toBe('right')
  })

  it('stays on the track it started on: a track beside it is not taken for its end', () => {
    const { net, a1 } = tracks(10)
    // The cursor is nearer track B, the end is still on track A
    const plan = planPlatform(net, input({ segId: a1, t: 0.2 }, 60, 9, { bothSides: true }))!
    expect(plan.end.at.y).toBeCloseTo(0, 6)
    expect(plan.end.at.x).toBeCloseTo(60, 6)
  })

  it('lays one platform on each side when asked', () => {
    const { net, a1 } = tracks()
    const plan = planPlatform(net, input({ segId: a1, t: 0.2 }, 90, -4, { bothSides: true }))!
    expect(plan.kind).toBe('both')
    expect(plan.platforms.map((edges) => edges.map((e) => e.side))).toEqual([['left'], ['right']])
  })

  it('refuses a platform too short, and keeps nothing to lay', () => {
    const { net, a1 } = tracks()
    const plan = planPlatform(net, input({ segId: a1, t: 0.2 }, 12, -4))!
    expect(plan.refusal).toBe('too-short')
    expect(plan.platforms).toEqual([])
  })

  it('proposes an island between two tracks far enough apart', () => {
    const { net, a1, b } = tracks(10)
    const plan = planPlatform(net, input({ segId: a1, t: 0.2 }, 90, 5))!
    expect(plan.kind).toBe('island')
    expect(plan.island).toEqual({ spacing: expect.closeTo(10, 6), minSpacing: dims.islandMinSpacing, ok: true })
    const [front, back] = plan.platforms[0]
    expect(front.side).toBe('right')
    // The facing edge is the same stretch on track B, walked the same way, its side towards A
    expect(back!.track.map((s) => s.segId)).toEqual([b])
    expect(back!.side).toBe('left')
    expect(pointOnEdge(net, back!, 0)!.point.x).toBeCloseTo(10, 6)
    expect(endX(net, back!)).toBeCloseTo(90, 6)
  })

  it('says when two tracks are too close for an island, and offers a platform beside one', () => {
    const { net, a1 } = tracks(3.8)
    const plan = planPlatform(net, input({ segId: a1, t: 0.2 }, 90, 2))!
    expect(plan.island).toEqual({ spacing: expect.closeTo(3.8, 6), minSpacing: dims.islandMinSpacing, ok: false })
    expect(plan.kind).toBe('side')
    expect(plan.platforms).toHaveLength(1)
    expect(plan.platforms[0]).toHaveLength(1)
  })

  it('catches its end on the end of a platform of the same track, across the track, and on rail ends', () => {
    const { net, a1, a2, b } = tracks(10)
    addPlatform(net, { stationId: 'st_x', edges: [{ track: [{ segId: a1, t0: 0.4, t1: 1 }], side: 'left' }], width: PLATFORM_WIDTH, markers: [] })
    addPlatform(net, { stationId: 'st_x', edges: [{ track: [{ segId: b!, t0: 0.3, t1: 0.7 }], side: 'right' }], width: PLATFORM_WIDTH, markers: [] })

    // Short of the platform laid on the same track at x = 20
    const same = planPlatform(net, input({ segId: a2, t: 0.8 }, 20.6, -4))!
    expect(same.end.snap?.kind).toBe('platform-end')
    expect(same.end.at.x).toBeCloseTo(20, 6)

    // Aligned with the end of the platform across, at x = 70
    const across = planPlatform(net, input({ segId: a1, t: 0.1 }, 70.5, -4))!
    expect(across.end.snap?.kind).toBe('platform-across')
    expect(across.end.at.x).toBeCloseTo(70, 6)

    // The end of the track
    const railEnd = planPlatform(net, input({ segId: a1, t: 0.1 }, 99.4, -4))!
    expect(railEnd.end.snap?.kind).toBe('rail-end')
    expect(railEnd.end.at.x).toBeCloseTo(100, 6)

    // Out of reach of anything: where the cursor is
    expect(planPlatform(net, input({ segId: a1, t: 0.1 }, 85, -4))!.end.snap).toBeNull()
  })

  it('catches its start on a set of points', () => {
    const net = createNetwork()
    const n0 = addNode(net, { x: 0, y: 0 })
    const n1 = addNode(net, { x: 50, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const n3 = addNode(net, { x: 100, y: 5 })
    addSegment(net, n0.id, n1.id)
    addSegment(net, n1.id, n2.id)
    addSegment(net, n1.id, n3.id)
    const aim = aimPlatformStart(net, { x: 50.5, y: -1 }, 8, dims, 1)!
    expect(aim.snap?.kind).toBe('turnout')
    expect(aim.at).toEqual({ x: 50, y: 0 })
    // Off the track
    expect(aimPlatformStart(net, { x: 50, y: -30 }, 8, dims, 1)).toBeNull()
  })

  it('follows the track through points, on the branch the cursor is by', () => {
    const net = createNetwork()
    const n0 = addNode(net, { x: 0, y: 0 })
    const n1 = addNode(net, { x: 50, y: 0 })
    const n2 = addNode(net, { x: 150, y: 0 })
    const n3 = addNode(net, { x: 150, y: 12 })
    const stem = addSegment(net, n0.id, n1.id)!.id
    const straight = addSegment(net, n1.id, n2.id)!.id
    const branch = addSegment(net, n1.id, n3.id)!.id
    // A fork drawn by hand gets its route table (what `notify` does in the editor)
    proposeJunction(net, n1.id)
    expect([...railsAlong(net, { segId: stem, t: 0.5 }, 500)].sort()).toEqual([stem, straight, branch].sort())
    const plan = planPlatform(net, input({ segId: stem, t: 0.2 }, 140, 15))!
    expect(plan.platforms[0][0].track.map((s) => s.segId)).toEqual([stem, branch])
  })
})

describe('the station of a new platform', () => {
  beforeEach(() => resetIdCounter())

  it('is a new one, « Gare 1 » then « Gare 2 », at the middle of the platform', () => {
    const { net, a1 } = tracks()
    const plan = planPlatform(net, input({ segId: a1, t: 0.2 }, 90, -4))!
    const laid = layPlatforms(net, plan)!
    expect(laid.newStation).toBe(true)
    expect(laid.station.name).toBe('Gare 1')
    expect(laid.station.stops).toEqual([])
    // Middle of the platform beside the track, on its left (y < 0)
    expect(laid.station.pos.x).toBeCloseTo(50, 6)
    expect(laid.station.pos.y).toBeCloseTo(-(dims.edgeOffset + dims.width / 2), 6)
    expect(laid.platforms).toHaveLength(1)
    expect(laid.platforms[0].stationId).toBe(laid.station.id)
    expect(laid.platforms[0].markers).toHaveLength(2)
    expect(nextStationName(net)).toBe('Gare 2')
  })

  it('is the station of a platform right beside it', () => {
    const { net, a1, b } = tracks(10)
    const first = layPlatforms(net, planPlatform(net, input({ segId: a1, t: 0.2 }, 90, -4))!)!
    const second = layPlatforms(net, planPlatform(net, input({ segId: b!, t: 0.2 }, 90, 14))!)!
    expect(second.newStation).toBe(false)
    expect(second.station.id).toBe(first.station.id)
  })

  it('is a station that stops on its track beside it, never one only placed near', () => {
    const { net, a1, a2 } = tracks()
    const edges: PlatformEdge[] = [{ track: [{ segId: a1, t0: 0, t1: 1 }], side: 'left' }]
    expect(stationForPlatform(net, edges)).toBeNull()
    addStation(net, { name: 'Près', pos: { x: 30, y: -100 }, stops: [] })
    expect(stationForPlatform(net, edges)).toBeNull()
    // A station read from OpenStreetMap: no platform yet, a stop on the track
    const along = addStation(net, { name: 'Sur la voie', pos: { x: 25, y: 0 }, stops: [{ segId: a1, t: 0.5 }] })
    expect(stationForPlatform(net, edges)).toBe(along.id)
    // A stop just past the end of the platform, on the next rail
    const next = addStation(net, { name: 'Juste après', pos: { x: 60, y: 0 }, stops: [{ segId: a2, t: 0.2 }] })
    net.stations.delete(along.id)
    expect(stationForPlatform(net, edges)).toBe(next.id)
  })

  it('makes a second station for a platform laid 100 m past the first one', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 400, y: 0 })
    const seg = addSegment(net, a.id, b.id)!.id
    const first = layPlatforms(net, planPlatform(net, input({ segId: seg, t: 0.05 }, 120, -4))!)!
    const second = layPlatforms(net, planPlatform(net, input({ segId: seg, t: 0.55 }, 320, -4))!)!
    expect(first.newStation).toBe(true)
    expect(second.newStation).toBe(true)
    expect(second.station.id).not.toBe(first.station.id)
    expect(second.station.name).toBe('Gare 2')
  })

  it('lays both platforms of « both sides » in one station', () => {
    const { net, a1 } = tracks()
    const laid = layPlatforms(net, planPlatform(net, input({ segId: a1, t: 0.2 }, 90, -4, { bothSides: true }))!)!
    expect(laid.platforms).toHaveLength(2)
    expect(net.stations.size).toBe(1)
    expect(new Set(laid.platforms.map((p) => p.stationId))).toEqual(new Set([laid.station.id]))
  })
})

describe('rakes a platform holds', () => {
  it('compares the platform with each model, alone and two coupled', () => {
    const short = rakesFitting(100)
    expect(short.find((f) => f.model === 'duplex')).toMatchObject({ single: false, double: false })
    expect(short.find((f) => f.model === 'regiolis')!.single).toBe(true)
    expect(rakesFitting(1000).every((f) => f.single && f.double)).toBe(true)
    // At HO a platform is 87 times shorter for the same trains
    expect(rakesFitting(1000 / 87, 0.0165).every((f) => f.single && f.double)).toBe(true)
  })
})
