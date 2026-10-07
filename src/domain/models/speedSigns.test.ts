import { beforeEach, describe, expect, it } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork, resetIdCounter } from './network'
import { syncJunctions } from './junction'
import { segmentPartialLength } from './locomotive'
import { addSpeedZone, removeSpeedZone, setSpeedZoneSpeed } from './speedZones'
import type { LineSettings } from './speedLimits'
import {
  MIN_SPEED_SIGN_DISTANCE,
  announcementDistance,
  speedSignStats,
  speedSigns,
  type SpeedSign,
} from './speedSigns'
import { speedLimitAt } from './trackSpeed'
import type { Network } from './types'
import { chain, line } from './signalling.testkit'
import { networkChanged } from '@domain/models/networkWatch'

beforeEach(() => resetIdCounter(0))

const LINE_160: LineSettings = { lineSpeed: 160, lineType: 'classic' }

/** x of a sign standing on a straight rail laid along y = 0 */
function signX(net: Network, sign: SpeedSign): number {
  const seg = net.segments.get(sign.segId)!
  const a = net.nodes.get(seg.from)!.pos
  const b = net.nodes.get(seg.to)!.pos
  return a.x + (b.x - a.x) * sign.t
}

describe('announcement distance', () => {
  it('is the braking distance at 0.7 m/s² between the two speeds', () => {
    // (44.44² − 25²) / 1.4 = 964.5 m
    expect(announcementDistance(160, 90)).toBeCloseTo((Math.pow(160 / 3.6, 2) - Math.pow(90 / 3.6, 2)) / 1.4, 9)
    expect(announcementDistance(160, 90)).toBeCloseTo(964.5, 1)
    expect(announcementDistance(300, 160)).toBeCloseTo(3549.4, 1)
  })

  it('is never under 300 m', () => {
    expect(announcementDistance(40, 30)).toBe(MIN_SPEED_SIGN_DISTANCE)
    // 160 → 150 would brake over 170 m: the floor stands
    expect(announcementDistance(160, 150)).toBe(MIN_SPEED_SIGN_DISTANCE)
    expect(announcementDistance(160, 130)).toBeGreaterThan(MIN_SPEED_SIGN_DISTANCE)
  })
})

describe('distant speed signs', () => {
  it('has none on a network without zone', () => {
    const { net } = line(2, 1000)
    expect(speedSigns(net, LINE_160)).toEqual([])
  })

  it('announces a drop from 160 to 90 at its braking distance, to each direction entering the zone', () => {
    // One rail of 6 000 m laid west to east, a zone at 90 from x = 2400 to x = 3600
    const { net, rails } = line(1, 6000)
    const zone = addSpeedZone(net, [{ segId: rails[0].id, t0: 0.4, t1: 0.6 }], 90)!
    const signs = speedSigns(net, LINE_160)
    expect(signs).toHaveLength(2)
    const d = announcementDistance(160, 90)

    const eastbound = signs.find((sign) => sign.forward)!
    expect(eastbound).toMatchObject({ zoneId: zone.id, segId: rails[0].id, speed: 90, fromSpeed: 160, diamond: true })
    expect(eastbound.distance).toBeCloseTo(d, 6)
    expect(signX(net, eastbound)).toBeCloseTo(2400 - d, 6)

    // The other end is entered by westbound trains: its sign stands east of the zone and faces them
    const westbound = signs.find((sign) => !sign.forward)!
    expect(westbound).toMatchObject({ zoneId: zone.id, speed: 90, fromSpeed: 160, diamond: true })
    expect(westbound.distance).toBeCloseTo(d, 6)
    expect(signX(net, westbound)).toBeCloseTo(3600 + d, 6)
  })

  it('does not depend on the way the zone was drawn', () => {
    const { net, rails } = line(1, 6000)
    addSpeedZone(net, [{ segId: rails[0].id, t0: 0.6, t1: 0.4 }], 90)
    const signs = speedSigns(net, LINE_160)
    const d = announcementDistance(160, 90)
    expect(signs.map((sign) => [sign.forward, Math.round(signX(net, sign))]).sort()).toEqual(
      [[true, Math.round(2400 - d)], [false, Math.round(3600 + d)]].sort(),
    )
  })

  it('is a square under a drop of 40 km/h, a diamond from 40 km/h', () => {
    const { net, rails } = line(1, 6000)
    const zone = addSpeedZone(net, [{ segId: rails[0].id, t0: 0.4, t1: 0.6 }], 130)!
    expect(speedSigns(net, LINE_160).every((sign) => !sign.diamond)).toBe(true)
    setSpeedZoneSpeed(net, zone.id, 120)
    expect(speedSigns(net, LINE_160).every((sign) => sign.diamond)).toBe(true)
  })

  it('announces nothing for a rise', () => {
    // The zone allows more than the line: entering it is no drop
    const { net, rails } = line(1, 6000)
    addSpeedZone(net, [{ segId: rails[0].id, t0: 0.4, t1: 0.6 }], 200)
    expect(speedSigns(net, LINE_160)).toEqual([])
    expect(speedSigns(net, { lineSpeed: 200, lineType: 'classic' })).toEqual([])
  })

  it('only announces the drop: leaving a low zone for a higher one gets no sign', () => {
    // 60 from x = 1000 to x = 3000, then 90 from x = 3000 to x = 5000
    const { net, rails } = line(1, 6000)
    const low = addSpeedZone(net, [{ segId: rails[0].id, t0: 1 / 6, t1: 0.5 }], 60)!
    const high = addSpeedZone(net, [{ segId: rails[0].id, t0: 0.5, t1: 5 / 6 }], 90)!
    const signs = speedSigns(net, LINE_160)
    const of = (id: string, forward: boolean) => signs.find((sign) => sign.zoneId === id && sign.forward === forward)
    // Eastbound: 160 → 60 announced, 60 → 90 is a rise
    expect(of(low.id, true)).toMatchObject({ fromSpeed: 160, speed: 60 })
    expect(of(high.id, true)).toBeUndefined()
    // Westbound: 160 → 90 announced east of the zones, then 90 → 60 announced inside the 90 zone
    expect(of(high.id, false)).toMatchObject({ fromSpeed: 160, speed: 90 })
    const inner = of(low.id, false)!
    expect(inner).toMatchObject({ fromSpeed: 90, speed: 60, diamond: false })
    expect(inner.distance).toBeCloseTo(announcementDistance(90, 60), 6)
    expect(signX(net, inner)).toBeCloseTo(3000 + announcementDistance(90, 60), 6)
    expect(signs).toHaveLength(3)
  })

  it('goes up the track across the joints of the rails', () => {
    // Six rails of 1 000 m; the zone covers the fifth one
    const { net, rails } = line(6, 1000)
    addSpeedZone(net, [{ segId: rails[4].id, t0: 0, t1: 1 }], 90)
    const eastbound = speedSigns(net, LINE_160).find((sign) => sign.forward)!
    const d = announcementDistance(160, 90)
    expect(eastbound.segId).toBe(rails[3].id)
    expect(signX(net, eastbound)).toBeCloseTo(4000 - d, 6)
    expect(eastbound.distance).toBeCloseTo(d, 6)
  })

  it('stands at the end of the track when it is shorter than the announcement distance', () => {
    // The zone starts 500 m from the western end of the track
    const { net, rails } = line(1, 6000)
    addSpeedZone(net, [{ segId: rails[0].id, t0: 500 / 6000, t1: 0.5 }], 90)
    const eastbound = speedSigns(net, LINE_160).find((sign) => sign.forward)!
    expect(eastbound.t).toBe(0)
    expect(eastbound.distance).toBeCloseTo(500, 6)
    expect(eastbound).toMatchObject({ speed: 90, fromSpeed: 160, diamond: true })
  })

  it('gives no sign to a zone end nobody can enter by: the end of the track', () => {
    const { net, rails } = line(1, 6000)
    addSpeedZone(net, [{ segId: rails[0].id, t0: 0, t1: 0.5 }], 90)
    const signs = speedSigns(net, LINE_160)
    // Only westbound trains enter the zone, at x = 3000
    expect(signs).toHaveLength(1)
    expect(signs[0].forward).toBe(false)
  })

  it('takes the straightest way up the track through points', () => {
    // Main line west to east; a siding joins it from the south-west at x = 2000. Zone from x = 2200.
    const net = createNetwork()
    const main = chain(net, [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 6000, y: 0 }])
    const sidingEnd = addNode(net, { x: 1000, y: 60 })
    const siding = addSegment(net, sidingEnd.id, main.nodes[1].id)!
    syncJunctions(net)
    addSpeedZone(net, [{ segId: main.rails[1].id, t0: 0.05, t1: 0.5 }], 90)
    const eastbound = speedSigns(net, LINE_160).find((sign) => sign.forward)!
    expect(eastbound.segId).toBe(main.rails[0].id)
    expect(eastbound.segId).not.toBe(siding.id)
    expect(signX(net, eastbound)).toBeCloseTo(2200 - announcementDistance(160, 90), 6)
  })

  it('measures the distance along a curve', () => {
    // A straight of 2 000 m, then a wide curve, then the zone on a last straight
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 2000, y: 0 })
    const c = addNode(net, { x: 4000, y: 300 })
    const d = addNode(net, { x: 5000, y: 600 })
    const straight = addSegment(net, a.id, b.id)!
    const curve = addCurveSegment(net, b.id, c.id, { x: 3000, y: 0 })!
    const last = addSegment(net, c.id, d.id)!
    addSpeedZone(net, [{ segId: last.id, t0: 0, t1: 1 }], 60)
    const line: LineSettings = { lineSpeed: 100, lineType: 'classic', realScale: false }
    const sign = speedSigns(net, line).find((s) => s.forward)!
    const wanted = announcementDistance(100, 60)
    expect(sign.distance).toBeCloseTo(wanted, 6)
    // The sign is on the curve or on the first straight: its distance to the zone, measured along the track
    const along =
      sign.segId === curve.id
        ? segmentPartialLength(net, curve.id, sign.t, 1)
        : segmentPartialLength(net, curve.id, 0, 1) + segmentPartialLength(net, straight.id, sign.t, 1)
    expect(along).toBeCloseTo(wanted, 3)
  })

  it('reads the limit before the zone with `speedLimitAt`: an overlapping lower zone announces nothing more', () => {
    const { net, rails } = line(1, 6000)
    addSpeedZone(net, [{ segId: rails[0].id, t0: 0.1, t1: 0.9 }], 60)
    const inner = addSpeedZone(net, [{ segId: rails[0].id, t0: 0.4, t1: 0.6 }], 90)!
    expect(speedLimitAt(net, rails[0].id, 0.39, LINE_160)).toBe(60)
    expect(speedSigns(net, LINE_160).filter((sign) => sign.zoneId === inner.id)).toEqual([])
  })

  it('is kept until the zones, the track or the line settings change', () => {
    const { net, rails, nodes } = line(1, 6000)
    const zone = addSpeedZone(net, [{ segId: rails[0].id, t0: 0.4, t1: 0.6 }], 90)!
    const first = speedSigns(net, LINE_160)
    const builds = speedSignStats.builds
    expect(speedSigns(net, LINE_160)).toBe(first)
    expect(speedSigns(net, { ...LINE_160 })).toBe(first)
    expect(speedSignStats.builds).toBe(builds)

    // Another line speed: other distances
    const faster = speedSigns(net, { lineSpeed: 220, lineType: 'classic' })
    expect(faster).not.toBe(first)
    expect(faster[0].fromSpeed).toBe(220)
    expect(faster[0].distance).toBeCloseTo(announcementDistance(220, 90), 6)

    // Another speed for the zone
    const back = speedSigns(net, LINE_160)
    setSpeedZoneSpeed(net, zone.id, 120)
    const slower = speedSigns(net, LINE_160)
    expect(slower).not.toBe(back)
    expect(slower[0].speed).toBe(120)

    // The track moved: the rail is longer, the signs stand elsewhere on it
    const before = speedSigns(net, LINE_160)
    nodes[1].pos = { x: 8000, y: 0 }
    networkChanged()
    const moved = speedSigns(net, LINE_160)
    expect(moved).not.toBe(before)
    expect(moved.find((sign) => sign.forward)!.distance).toBeCloseTo(announcementDistance(160, 120), 6)

    removeSpeedZone(net, zone.id)
    expect(speedSigns(net, LINE_160)).toEqual([])
  })
})
