import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, resetIdCounter } from '../models/network'
import { addStation } from '../models/stations'
import { addSpeedZone } from '../models/speedZones'
import { findRouteGuide, guideDurationLeft, guideDurations, guideLeft } from './routeGuide'

beforeEach(() => resetIdCounter(0))

/** A 3 km line in three rails, a branch leaving at 1 km, a station with two platforms at 2.5 km */
function line() {
  const net = createNetwork()
  const n = [0, 1000, 2000, 3000].map((x) => addNode(net, { x, y: 0 }))
  const rails = [0, 1, 2].map((i) => addSegment(net, n[i].id, n[i + 1].id)!)
  const side = addNode(net, { x: 2000, y: 100 })
  const branch = addSegment(net, n[1].id, side.id)!
  const station = addStation(net, {
    name: 'Arrivée',
    pos: { x: 2500, y: 0 },
    stops: [
      { segId: rails[2].id, t: 0.8, ref: '2' },
      { segId: rails[2].id, t: 0.5, ref: '1' },
    ],
  })
  return { net, n, rails, branch, station }
}

describe('the way to the next station', () => {
  it('leads to the nearest platform ahead and measures what is left', () => {
    const { net, rails, station } = line()
    const lead = { segId: rails[0].id, t: 0.5, forward: true }
    const guide = findRouteGuide(net, lead, station)!
    expect(guide.target).toBe('platform')
    expect(guide.stop?.ref).toBe('1')
    expect(guide.behind).toBe(false)
    expect(guide.path.length).toBeCloseTo(2000, 6)
    expect(guideLeft(net, guide, lead)).toBeCloseTo(2000, 6)
    expect(guideLeft(net, guide, { segId: rails[1].id, t: 0.25 })).toBeCloseTo(1250, 6)
    expect(guideLeft(net, guide, { segId: rails[2].id, t: 0.5 })).toBeCloseTo(0, 6)
  })

  it('tells the time the way takes at the limits of the track, never faster than the rake', () => {
    const { net, rails, station } = line()
    const lead = { segId: rails[0].id, t: 0.5, forward: true }
    const guide = findRouteGuide(net, lead, station)!
    const line180 = { lineSpeed: 180, lineType: 'classic' as const }
    // 2 000 m at 180 km/h: 40 s
    const plain = guideDurations(net, guide, line180, 100)
    expect(guideDurationLeft(guide, plain, 2000)).toBeCloseTo(40, 6)
    expect(guideDurationLeft(guide, plain, 500)).toBeCloseTo(10, 6)
    expect(guideDurationLeft(guide, plain, 0)).toBeCloseTo(0, 6)
    // A rake that runs at 25 m/s at most: 80 s
    expect(guideDurationLeft(guide, guideDurations(net, guide, line180, 25), 2000)).toBeCloseTo(80, 6)
    // The middle rail held to 90 km/h: its 1 000 m take 40 s instead of 20
    addSpeedZone(net, [{ segId: rails[1].id, t0: 0, t1: 1 }], 90)
    const zoned = guideDurations(net, guide, line180, 100)
    expect(guideDurationLeft(guide, zoned, 2000)).toBeCloseTo(60, 6)
    expect(guideDurationLeft(guide, zoned, 1000)).toBeCloseTo(30, 6)
  })

  it('says so when the train left the way or ran past its end', () => {
    const { net, rails, branch, station } = line()
    const guide = findRouteGuide(net, { segId: rails[0].id, t: 0.5, forward: true }, station)!
    expect(guideLeft(net, guide, { segId: branch.id, t: 0.3 })).toBeNull()
    expect(guideLeft(net, guide, { segId: rails[2].id, t: 0.6 })).toBeNull()
    expect(guideLeft(net, guide, { segId: rails[0].id, t: 0.2 })).toBeNull()
  })

  it('finds the way behind a train that faces the other way, and marks it', () => {
    const { net, rails, station } = line()
    const guide = findRouteGuide(net, { segId: rails[0].id, t: 0.5, forward: false }, station)!
    expect(guide.behind).toBe(true)
    expect(guide.path.length).toBeCloseTo(2000, 6)
  })

  it('heads for a gate while the station has no platform on the track loaded', () => {
    const { net, n, rails } = line()
    const lead = { segId: rails[0].id, t: 0.5, forward: true }
    const guide = findRouteGuide(net, lead, undefined, [n[3].id, 'n_unknown'])!
    expect(guide.target).toBe('gate')
    expect(guide.stop).toBeUndefined()
    expect(guide.path.length).toBeCloseTo(2500, 6)
    expect(findRouteGuide(net, lead, undefined, [])).toBeNull()
    expect(findRouteGuide(net, lead, undefined, ['n_unknown'])).toBeNull()
  })
})
