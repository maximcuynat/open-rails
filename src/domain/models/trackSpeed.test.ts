import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { addCurveChain, addNode, addSegment, createNetwork, resetIdCounter } from './network'
import { tangentArcPieces } from '../geometry/curve'
import { snapToNearestTrack } from './locomotive'
import type { Network, RailNode, Segment } from './types'
import { addSpeedZone, removeSpeedZone, setSpeedZoneSpeed } from './speedZones'
import { addSpeedZoneBetween } from '../services/speedZoneLayout'
import { curveCant, overlapsOfZone, speedZoneOverlaps, type LineSettings } from './speedLimits'
import { cantRampLength } from './cant'
import {
  curveSpeedLimit,
  limitAhead,
  localCant,
  rakeCantDeficiency,
  rakeSpeedLimit,
  speedLimitAt,
  trackGeometryRevision,
  trackProfile,
  trackSpeedStats,
} from './trackSpeed'
import { advanceTrainSet, createVehicle, makeTrainSet, trainOccupancy, type TrainSet } from './train'
import { BRAKE_PIPE_RELEASED, trainDynamics } from './trainDynamics'
import { declareTurnout, setJunctionBranch } from './junction'
import { performTrackCut } from '../geometry/constructionTemplates'
import { networkChanged, verifyNetworkRevisions } from '@domain/models/networkWatch'

beforeEach(() => resetIdCounter(0))

const CLASSIC_160: LineSettings = { lineSpeed: 160, lineType: 'classic' }
const LGV_300: LineSettings = { lineSpeed: 300, lineType: 'highSpeed' }

/** Lays track piece by piece from the origin, heading +x */
class Layout {
  net = createNetwork()
  node: RailNode
  heading = 0
  /** Rails of each piece laid, in order */
  pieces: Segment[][] = []

  constructor() {
    this.node = addNode(this.net, { x: 0, y: 0 })
  }

  straight(length: number, rails = 1): this {
    const laid: Segment[] = []
    for (let i = 0; i < rails; i++) {
      const next = addNode(this.net, {
        x: this.node.pos.x + (Math.cos(this.heading) * length) / rails,
        y: this.node.pos.y + (Math.sin(this.heading) * length) / rails,
      })
      laid.push(addSegment(this.net, this.node.id, next.id)!)
      this.node = next
    }
    this.pieces.push(laid)
    return this
  }

  /** Arc of `radius` m turning by `degrees` (positive = to the left) */
  arc(radius: number, degrees: number): this {
    const side = Math.sign(degrees)
    const theta = (Math.abs(degrees) * Math.PI) / 180
    const centre = {
      x: this.node.pos.x - Math.sin(this.heading) * side * radius,
      y: this.node.pos.y + Math.cos(this.heading) * side * radius,
    }
    const endHeading = this.heading + side * theta
    const end = addNode(this.net, {
      x: centre.x + Math.sin(endHeading) * side * radius,
      y: centre.y - Math.cos(endHeading) * side * radius,
    })
    const arc = tangentArcPieces(this.node.pos, { x: Math.cos(this.heading), y: Math.sin(this.heading) }, end.pos)!
    this.pieces.push(addCurveChain(this.net, this.node.id, end.id, arc.pieces)!.segments)
    this.node = end
    this.heading = endHeading
    return this
  }
}

function at(net: Network, x: number, y = 0) {
  const hit = snapToNearestTrack(net, { x, y }, 0.5)!
  return { segId: hit.segId, t: hit.t }
}

/** A rake whose lead front bogie stands at `t` of rail `segId`, head towards the `to` node of the rail */
function rakeOn(net: Network, segId: string, t: number, kinds: ('loco' | 'wagon')[] = ['loco', 'wagon', 'wagon', 'loco']): TrainSet {
  const lead = createVehicle(net, segId, t, kinds[0], 1)!
  const train = makeTrainSet('T', [lead])
  kinds.slice(1).forEach((kind, i) => {
    train.vehicles.push({ id: `v${i}`, kind, front: { ...lead.rear }, rear: { ...lead.rear }, ...(kind === 'loco' ? { flipped: true } : {}) })
  })
  expect(advanceTrainSet(net, train, 0)).toBe(true)
  return train
}

function running(train: TrainSet, kmh: number): TrainSet {
  train.currentSpeed = kmh / 3.6
  train.reverser = 'forward'
  train.brakePipe = BRAKE_PIPE_RELEASED
  train.brakeCylinder = 0
  return train
}

/** x of the front end of the train on a track along y = 0 */
function headX(net: Network, train: TrainSet): number {
  const spans = trainOccupancy(net, train).spans
  let best = -Infinity
  for (const span of spans) {
    const seg = net.segments.get(span.segId)!
    const a = net.nodes.get(seg.from)!.pos.x
    const b = net.nodes.get(seg.to)!.pos.x
    best = Math.max(best, a + (b - a) * span.t0, a + (b - a) * span.t1)
  }
  return best
}

describe('curves read from the track', () => {
  it('pieces of one arc make one curve, with the radius of the arc', () => {
    const layout = new Layout().straight(500).arc(1000, 60).straight(500)
    const profile = trackProfile(layout.net, CLASSIC_160)
    expect(layout.pieces[1]).toHaveLength(4)
    expect(profile.curves).toHaveLength(1)
    expect(profile.curves[0].rails.map((r) => r.segId)).toEqual(layout.pieces[1].map((s) => s.id))
    expect(profile.curves[0].length).toBeCloseTo((1000 * Math.PI) / 3, 0)
    for (const seg of layout.pieces[1]) expect(profile.rails.get(seg.id)!.radius).toBeCloseTo(1000, 3)
    expect(profile.rails.has(layout.pieces[0][0].id)).toBe(false)
  })

  it('an arc the other way, or of another radius, is another curve', () => {
    const layout = new Layout().arc(1000, 30).arc(1000, -30).arc(400, -30)
    const curves = trackProfile(layout.net, CLASSIC_160).curves
    expect(curves.map((c) => c.rails.length)).toEqual([2, 2, 2])
  })

  it('a curve stops at a node where a third rail leaves', () => {
    const layout = new Layout().arc(1000, 30)
    const middle = layout.net.segments.get(layout.pieces[0][0].id)!.to
    const side = addNode(layout.net, { x: 300, y: -200 })
    addSegment(layout.net, middle, side.id)
    expect(trackProfile(layout.net, CLASSIC_160).curves.map((c) => c.rails.length)).toEqual([1, 1])
  })

  it('a closed circle is one curve', () => {
    const layout = new Layout().arc(500, 180)
    const back = tangentArcPieces(layout.node.pos, { x: -1, y: 0 }, { x: 0, y: 0 })!
    addCurveChain(layout.net, layout.node.id, layout.net.nodes.keys().next().value!, back.pieces)
    const profile = trackProfile(layout.net, CLASSIC_160)
    expect(profile.curves).toHaveLength(1)
    expect(profile.curves[0].rails).toHaveLength(24)
    expect(profile.ramps.size).toBe(0)
  })
})

describe('cant and speed of a curved rail', () => {
  it('1 000 m on a conventional line at 160: 155 mm, automatic, no restriction', () => {
    const layout = new Layout().straight(500).arc(1000, 60).straight(500)
    expect(curveCant(layout.net, layout.pieces[0][0], CLASSIC_160)).toBeNull()
    const cant = curveCant(layout.net, layout.pieces[1][1], CLASSIC_160)!
    expect(cant.radius).toBeCloseTo(1000, 3)
    expect(cant).toMatchObject({ cant: 155, automatic: true, maxSpeed: 160, appliedSpeed: 160 })
    expect(speedLimitAt(layout.net, layout.pieces[1][1].id, 0.5, CLASSIC_160)).toBe(160)
  })

  it('4 000 m on a high-speed line at 300: 180 mm, 300 km/h', () => {
    const layout = new Layout().straight(1000).arc(4000, 30).straight(1000)
    expect(curveCant(layout.net, layout.pieces[1][0], LGV_300)).toMatchObject({ cant: 180, maxSpeed: 300 })
  })

  it('a curve tighter than the line allows lowers the limit of its rails', () => {
    const layout = new Layout().straight(500).arc(500, 60).straight(500)
    const curve = layout.pieces[1][1]
    // 160 mm of cant (the most of the line) and 160 mm of deficiency: 116 km/h, rounded down
    expect(curveCant(layout.net, curve, CLASSIC_160)).toMatchObject({ cant: 160, maxSpeed: 115, appliedSpeed: 160 })
    expect(curveSpeedLimit(500, 160, 'classic')).toBe(115)
    expect(speedLimitAt(layout.net, curve.id, 0.5, CLASSIC_160)).toBe(115)
    expect(speedLimitAt(layout.net, layout.pieces[0][0].id, 0.5, CLASSIC_160)).toBe(160)
  })

  it('a cant set by hand changes the speed of the curve', () => {
    const layout = new Layout().straight(500).arc(500, 60).straight(500)
    const curve = layout.pieces[1][1]
    curve.cant = 80
    networkChanged()
    expect(curveCant(layout.net, curve, CLASSIC_160)).toMatchObject({ cant: 80, automatic: false, maxSpeed: 100 })
    expect(curveCant(layout.net, layout.pieces[1][0], CLASSIC_160)).toMatchObject({ cant: 160, automatic: true, maxSpeed: 115 })
    delete curve.cant
    networkChanged()
    expect(curveCant(layout.net, curve, CLASSIC_160)).toMatchObject({ cant: 160, automatic: true, maxSpeed: 115 })
  })

  it('the automatic cant is worked out for the zone laid on the curve, not for the line speed', () => {
    const layout = new Layout().straight(500).arc(500, 60).straight(500)
    const net = layout.net
    const [first, , , last] = layout.pieces[1]
    addSpeedZone(net, [{ segId: layout.pieces[0][0].id, t0: 0.5, t1: 1 }, ...layout.pieces[1].map((s) => ({ segId: s.id, t0: 0, t1: 1 }))], 90)
    // 191 mm of equilibrium at 90: 51 % of it, 95 mm
    expect(curveCant(net, first, CLASSIC_160)).toMatchObject({ cant: 95, appliedSpeed: 90, maxSpeed: 100 })
    expect(curveCant(net, last, CLASSIC_160)).toMatchObject({ cant: 95, appliedSpeed: 90 })
    expect(speedLimitAt(net, first.id, 0.5, CLASSIC_160)).toBe(90)
  })

  it('a cut hands the cant set by hand down to both halves', () => {
    const layout = new Layout().straight(500).arc(1000, 15).straight(500)
    const net = layout.net
    const curve = layout.pieces[1][0]
    curve.cant = 120
    networkChanged()
    const middle = { x: 500 + 1000 * Math.sin(Math.PI / 24), y: 1000 * (1 - Math.cos(Math.PI / 24)) }
    expect(snapToNearestTrack(net, middle, 1)!.segId).toBe(curve.id)
    expect(performTrackCut(net, middle)).toBe(true)
    const halves = [...net.segments.values()].filter((s) => s.kind === 'curve')
    expect(halves).toHaveLength(2)
    expect(halves.map((s) => s.cant)).toEqual([120, 120])
    expect(halves.every((s) => s.id !== curve.id)).toBe(true)
    // Straight rails never carry one
    expect([...net.segments.values()].filter((s) => s.kind === 'straight').every((s) => s.cant === undefined)).toBe(true)
    expect(trackProfile(net, CLASSIC_160).curves).toHaveLength(1)
  })
})

describe('cant ramps', () => {
  it('the cant is run in astride the tangent point: half of it there, all of it half a ramp further', () => {
    const layout = new Layout().straight(500).arc(1000, 60).straight(500)
    const net = layout.net
    const straight = layout.pieces[0][0]
    const first = layout.pieces[1][0]
    const half = cantRampLength(155, 160) / 2
    expect(half).toBeCloseTo(68.9, 1)
    const railLength = (1000 * Math.PI) / 12
    expect(localCant(net, straight.id, 0.5, CLASSIC_160)).toBe(0)
    expect(localCant(net, straight.id, 1 - half / 500, CLASSIC_160)).toBeCloseTo(0, 6)
    expect(localCant(net, straight.id, 1 - half / 1000, CLASSIC_160)).toBeCloseTo(155 / 4, 3)
    expect(localCant(net, straight.id, 1, CLASSIC_160)).toBeCloseTo(155 / 2, 6)
    expect(localCant(net, first.id, 0, CLASSIC_160)).toBeCloseTo(155 / 2, 6)
    expect(localCant(net, first.id, half / railLength, CLASSIC_160)).toBeCloseTo(155, 3)
    expect(localCant(net, first.id, 0.9, CLASSIC_160)).toBe(155)
    // Same at the far end
    const last = layout.pieces[1][3]
    const after = layout.pieces[2][0]
    expect(localCant(net, last.id, 1, CLASSIC_160)).toBeCloseTo(155 / 2, 6)
    expect(localCant(net, after.id, half / 1000, CLASSIC_160)).toBeCloseTo(155 / 4, 3)
    expect(localCant(net, after.id, 0.5, CLASSIC_160)).toBe(0)
  })

  it('a curve too short for its ramps gets the cant that fits, and a lower speed', () => {
    const long = new Layout().straight(500).arc(700, 30).straight(500)
    expect(curveCant(long.net, long.pieces[1][0], CLASSIC_160)).toMatchObject({ cant: 160, maxSpeed: 135 })
    // 5° of the same radius: 61 m, room for 180 × 61 / 160 = 68 mm
    const short = new Layout().straight(500).arc(700, 5).straight(500)
    const cant = curveCant(short.net, short.pieces[1][0], CLASSIC_160)!
    expect(cant.cant).toBe(65)
    expect(cant.maxSpeed).toBe(115)
    // The ramps meet in the middle of the curve, where the cant is whole
    expect(localCant(short.net, short.pieces[1][0].id, 0.5, CLASSIC_160)).toBeCloseTo(65, 3)
    expect(localCant(short.net, short.pieces[1][0].id, 0, CLASSIC_160)).toBeLessThan(65)
  })

  it('no ramp between two curves that turn the same way: the cant steps from one to the other', () => {
    const layout = new Layout().arc(1000, 30).arc(600, 30)
    const net = layout.net
    const a = layout.pieces[0][1]
    const b = layout.pieces[1][0]
    expect(localCant(net, a.id, 1, CLASSIC_160)).toBe(curveCant(net, a, CLASSIC_160)!.cant)
    expect(localCant(net, b.id, 0, CLASSIC_160)).toBe(curveCant(net, b, CLASSIC_160)!.cant)
  })
})

describe('limit under a train: head and tail', () => {
  it('lower as soon as the head is in, higher only once the tail is out', () => {
    const layout = new Layout().straight(3000)
    const net = layout.net
    const rail = layout.pieces[0][0]
    addSpeedZoneBetween(net, at(net, 1000), at(net, 1500), 90)
    const train = rakeOn(net, rail.id, 0.2)
    const limitWithHeadAt = (x: number): number => {
      expect(advanceTrainSet(net, train, x - headX(net, train))).toBe(true)
      return rakeSpeedLimit(net, train, CLASSIC_160)
    }
    expect(limitWithHeadAt(990)).toBe(160)
    expect(limitWithHeadAt(1001)).toBe(90) // head just in
    expect(limitWithHeadAt(1400)).toBe(90)
    expect(limitWithHeadAt(1510)).toBe(90) // head out, tail in
    const tail = Math.min(...trainOccupancy(net, train).spans.map((s) => Math.min(s.t0, s.t1) * 3000))
    expect(tail).toBeLessThan(1500)
    expect(limitWithHeadAt(1499 + (1510 - tail))).toBe(90) // tail one metre short of the end
    expect(limitWithHeadAt(1501 + (1510 - tail))).toBe(160) // tail out
  })

  it('is what trainDynamics reports, in m/s, and never above the maximum speed of the stock', () => {
    const layout = new Layout().straight(3000)
    const net = layout.net
    const train = rakeOn(net, layout.pieces[0][0].id, 0.5)
    expect(trainDynamics(net, train, { levelHeight: 6, line: CLASSIC_160 }).speedLimit).toBeCloseTo(160 / 3.6, 9)
    expect(trainDynamics(net, train, { levelHeight: 6 }).speedLimit).toBeCloseTo(160 / 3.6, 9)
    expect(trainDynamics(net, train, { levelHeight: 6, line: { lineSpeed: 360, lineType: 'highSpeed' } }).speedLimit).toBeCloseTo(320 / 3.6, 9)
    addSpeedZoneBetween(net, at(net, 1400), at(net, 1600), 30)
    expect(trainDynamics(net, train, { levelHeight: 6, line: CLASSIC_160 }).speedLimit).toBeCloseTo(30 / 3.6, 9)
  })

  it('a curve under any vehicle counts', () => {
    const layout = new Layout().straight(600).arc(500, 60).straight(600)
    const net = layout.net
    const train = rakeOn(net, layout.pieces[2][0].id, 0.1)
    expect(rakeSpeedLimit(net, train, CLASSIC_160)).toBe(115) // tail still in the curve
    expect(advanceTrainSet(net, train, 200)).toBe(true)
    expect(rakeSpeedLimit(net, train, CLASSIC_160)).toBe(160)
  })
})

describe('overlapping zones', () => {
  it('the lower speed applies on the shared stretch, which is reported with its length', () => {
    const layout = new Layout().straight(3000, 3)
    const net = layout.net
    const a = addSpeedZoneBetween(net, at(net, 800), at(net, 1700), 90)!
    const b = addSpeedZoneBetween(net, at(net, 2200), at(net, 1500), 60)!
    const c = addSpeedZoneBetween(net, at(net, 2500), at(net, 2800), 30)!
    const limit = (x: number): number => speedLimitAt(net, at(net, x).segId, at(net, x).t, CLASSIC_160)
    expect(limit(1200)).toBe(90)
    expect(limit(1600)).toBe(60)
    expect(limit(2000)).toBe(60)
    expect(limit(2300)).toBe(160)

    const overlaps = speedZoneOverlaps(net)
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0].a).toBe(a)
    expect(overlaps[0].b).toBe(b)
    expect(overlaps[0].length).toBeCloseTo(200, 6)
    expect(overlaps[0].spans).toHaveLength(1)
    expect(overlapsOfZone(net, b.id)).toHaveLength(1)
    expect(overlapsOfZone(net, c.id)).toHaveLength(0)

    expect(speedZoneOverlaps(net)).toEqual(overlaps)
    removeSpeedZone(net, a.id)
    expect(speedZoneOverlaps(net)).toHaveLength(0)
  })

  it('a shared stretch that runs over several rails is one overlap', () => {
    const layout = new Layout().straight(3000, 3)
    const net = layout.net
    addSpeedZoneBetween(net, at(net, 500), at(net, 2500), 90)
    addSpeedZoneBetween(net, at(net, 900), at(net, 2100), 60)
    const overlaps = speedZoneOverlaps(net)
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0].length).toBeCloseTo(1200, 6)
    expect(overlaps[0].spans).toHaveLength(3)
  })
})

describe('limit ahead', () => {
  it('a train at 300 km/h is told of a zone at 160 five kilometres ahead, and the distance runs down with it', () => {
    const layout = new Layout().straight(12000, 12)
    const net = layout.net
    const env = { levelHeight: 6, line: LGV_300 }
    const train = running(rakeOn(net, layout.pieces[0][0].id, 0.5), 300)
    const head = headX(net, train)
    addSpeedZoneBetween(net, at(net, head + 5000), at(net, head + 6000), 160)

    const dynamics = trainDynamics(net, train, env)
    expect(dynamics.speedLimit).toBeCloseTo(300 / 3.6, 9)
    // The reach is one and a half times the stopping distance: more than the 5 km here
    expect(dynamics.stoppingDistance * 1.5).toBeGreaterThan(5000)
    expect(dynamics.nextSpeedLimit!.speed).toBe(160)
    expect(dynamics.nextSpeedLimit!.distance).toBeCloseTo(5000, 3)

    // One second at 300 km/h
    expect(advanceTrainSet(net, train, 300 / 3.6)).toBe(true)
    expect(trainDynamics(net, train, env).nextSpeedLimit!.distance).toBeCloseTo(5000 - 300 / 3.6, 3)
    expect(advanceTrainSet(net, train, 3000)).toBe(true)
    expect(trainDynamics(net, train, env).nextSpeedLimit!.distance).toBeCloseTo(2000 - 300 / 3.6, 3)

    // Head in the zone: it is the limit in force, nothing lower is ahead
    expect(advanceTrainSet(net, train, 2000)).toBe(true)
    const inside = trainDynamics(net, train, env)
    expect(inside.speedLimit).toBeCloseTo(160 / 3.6, 9)
    expect(inside.nextSpeedLimit).toBeNull()
  })

  it('looks at least 2 km ahead even at rest, and no further than asked', () => {
    const layout = new Layout().straight(12000, 12)
    const net = layout.net
    const train = rakeOn(net, layout.pieces[0][0].id, 0.5)
    const head = headX(net, train)
    addSpeedZoneBetween(net, at(net, head + 1900), at(net, head + 2500), 60)
    addSpeedZoneBetween(net, at(net, head + 4000), at(net, head + 4500), 30)
    expect(trainDynamics(net, train, { levelHeight: 6, line: CLASSIC_160 }).nextSpeedLimit).toEqual({ speed: 60, distance: expect.closeTo(1900, 3) })
    expect(limitAhead(net, train, 160, 1000, CLASSIC_160)).toBeNull()
    // Only limits lower than the one in force are announced
    expect(limitAhead(net, train, 60, 5000, CLASSIC_160)).toEqual({ speed: 30, distance: expect.closeTo(4000, 3) })
    expect(limitAhead(net, train, 30, 5000, CLASSIC_160)).toBeNull()
  })

  it('announces a curve tighter than the line allows', () => {
    const layout = new Layout().straight(1500).arc(500, 60).straight(500)
    const net = layout.net
    const train = rakeOn(net, layout.pieces[0][0].id, 0.4)
    const head = headX(net, train)
    expect(limitAhead(net, train, 160, 2000, CLASSIC_160)).toEqual({ speed: 115, distance: expect.closeTo(1500 - head, 3) })
  })

  it('in reverse, looks behind the tail', () => {
    const layout = new Layout().straight(6000, 6)
    const net = layout.net
    const train = rakeOn(net, layout.pieces[0][3].id, 0.5)
    addSpeedZoneBetween(net, at(net, 800), at(net, 1500), 60)
    addSpeedZoneBetween(net, at(net, 4800), at(net, 5000), 90)
    const tail = Math.min(...trainOccupancy(net, train).spans.map((s) => 3000 + Math.min(s.t0, s.t1) * 1000))
    expect(limitAhead(net, train, 160, 3000, CLASSIC_160)).toEqual({ speed: 90, distance: expect.closeTo(4800 - headX(net, train), 3) })
    train.direction = -1
    expect(limitAhead(net, train, 160, 3000, CLASSIC_160)).toEqual({ speed: 60, distance: expect.closeTo(tail - 1500, 3) })
  })

  it('follows the points as they are set', () => {
    // Stem 0 → 1000, then straight on to 3000 or diverging to (3000, 150)
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const apex = addNode(net, { x: 1000, y: 0 })
    const b = addNode(net, { x: 3000, y: 0 })
    const c = addNode(net, { x: 3000, y: 150 })
    const stem = addSegment(net, a.id, apex.id)!
    const through = addSegment(net, apex.id, b.id)!
    const diverging = addSegment(net, apex.id, c.id)!
    addSpeedZone(net, [{ segId: diverging.id, t0: 0.25, t1: 0.75 }], 30)
    const junction = declareTurnout(net, { nodeId: apex.id, stemSegmentId: stem.id, straightSegmentId: through.id, divergingSegmentId: diverging.id })
    const train = rakeOn(net, stem.id, 0.5)

    setJunctionBranch(junction, 'straight')
    expect(limitAhead(net, train, 160, 3000, CLASSIC_160)).toBeNull()
    setJunctionBranch(junction, 'diverging')
    const ahead = limitAhead(net, train, 160, 3000, CLASSIC_160)!
    expect(ahead.speed).toBe(30)
    expect(ahead.distance).toBeCloseTo(1000 - headX(net, train) + Math.hypot(2000, 150) / 4, 2)
    setJunctionBranch(junction, 'straight')
    expect(limitAhead(net, train, 160, 3000, CLASSIC_160)).toBeNull()
  })

  it('a mild limit does not hide the low one right behind it: the one to brake for first is announced', () => {
    // 30 m at 150 km/h, then 60 km/h: what a short curve ahead of a station makes
    const layout = new Layout().straight(6000, 12)
    const net = layout.net
    const env = { levelHeight: 6, line: CLASSIC_160 }
    const train = rakeOn(net, layout.pieces[0][0].id, 0.5)
    const head = headX(net, train)
    addSpeedZoneBetween(net, at(net, head + 1000), at(net, head + 1030), 150)
    addSpeedZoneBetween(net, at(net, head + 1030), at(net, head + 1600), 60)

    // At rest there is nothing to brake for: the nearest
    expect(trainDynamics(net, train, env).nextSpeedLimit).toEqual({ speed: 150, distance: expect.closeTo(1000, 3) })
    // Under 60 km/h neither asks for anything yet
    expect(trainDynamics(net, running(train, 55), env).nextSpeedLimit).toEqual({ speed: 150, distance: expect.closeTo(1000, 3) })
    // At 160 km/h the 60 is what the driver has to brake for, and the distance is its own
    const fast = trainDynamics(net, running(train, 160), env)
    expect(fast.stoppingDistance).toBeGreaterThan(30)
    expect(fast.nextSpeedLimit).toEqual({ speed: 60, distance: expect.closeTo(1030, 3) })
    // …all the way to it
    expect(advanceTrainSet(net, train, 900)).toBe(true)
    expect(trainDynamics(net, train, env).nextSpeedLimit).toEqual({ speed: 60, distance: expect.closeTo(130, 3) })
    // Head in the 150: only the 60 is left
    expect(advanceTrainSet(net, train, 110)).toBe(true)
    const inside = trainDynamics(net, running(train, 150), env)
    expect(inside.speedLimit).toBeCloseTo(150 / 3.6, 9)
    expect(inside.nextSpeedLimit).toEqual({ speed: 60, distance: expect.closeTo(20, 3) })
  })

  it('a low limit far behind a mild one waits its turn, and a higher one behind a lower is never announced', () => {
    const layout = new Layout().straight(12000, 12)
    const net = layout.net
    const env = { levelHeight: 6, line: LGV_300 }
    const train = running(rakeOn(net, layout.pieces[0][0].id, 0.5), 300)
    const head = headX(net, train)
    addSpeedZoneBetween(net, at(net, head + 500), at(net, head + 5300), 270)
    addSpeedZoneBetween(net, at(net, head + 5300), at(net, head + 5600), 60)
    addSpeedZoneBetween(net, at(net, head + 5600), at(net, head + 6000), 160)
    const dynamics = trainDynamics(net, train, env)
    // Both are within reach, and the 270 comes long before the braking for the 60 has to start
    expect(dynamics.stoppingDistance * 1.5).toBeGreaterThan(5300)
    expect(dynamics.stoppingDistance * 1.5).toBeLessThan(6000)
    expect(dynamics.nextSpeedLimit).toEqual({ speed: 270, distance: expect.closeTo(500, 3) })
    // A train that needs half as much again to stop has to brake for the 60 already
    const heavy = { speed: 300, stoppingDistance: dynamics.stoppingDistance * 1.5 }
    expect(limitAhead(net, { ...train }, 300, 6000, LGV_300, {}, heavy)).toEqual({ speed: 60, distance: expect.closeTo(5300, 3) })
    // Running under the 270, the 60 is the only lower limit left: the 160 behind it is not one to brake for
    expect(advanceTrainSet(net, train, 1000)).toBe(true)
    expect(trainDynamics(net, running(train, 270), env).nextSpeedLimit).toEqual({ speed: 60, distance: expect.closeTo(4300, 3) })
    expect(limitAhead(net, train, 60, 6000, LGV_300)).toBeNull()
  })
})

describe('what is kept from one frame to the next', () => {
  it('the profile is built once, and again when a curve, a cant, a zone or the settings change', () => {
    const layout = new Layout().straight(500).arc(1000, 60).straight(500)
    const net = layout.net
    const curve = layout.pieces[1][1]
    const builds = (): number => trackSpeedStats.profileBuilds
    const profile = trackProfile(net, CLASSIC_160)
    const before = builds()
    for (let i = 0; i < 50; i++) expect(trackProfile(net, CLASSIC_160)).toBe(profile)
    expect(curveCant(net, curve, CLASSIC_160)!.cant).toBe(155)
    expect(builds()).toBe(before)

    // A node of the curve is moved: the radius is read again
    const revision = trackGeometryRevision(net)
    curve.via = { x: curve.via!.x, y: curve.via!.y + 5 }
    networkChanged()
    expect(trackGeometryRevision(net)).toBe(revision + 1)
    expect(curveCant(net, curve, CLASSIC_160)!.radius).not.toBeCloseTo(1000, 0)
    expect(builds()).toBe(before + 1)

    // A cant set by hand
    curve.cant = 60
    networkChanged()
    expect(curveCant(net, curve, CLASSIC_160)).toMatchObject({ cant: 60, automatic: false })
    expect(builds()).toBe(before + 2)

    // A zone laid on the curve, then given another speed
    const other = layout.pieces[1][2]
    const zone = addSpeedZone(net, [{ segId: other.id, t0: 0, t1: 1 }], 100)!
    expect(curveCant(net, other, CLASSIC_160)!.appliedSpeed).toBe(100)
    expect(builds()).toBe(before + 3)
    setSpeedZoneSpeed(net, zone.id, 80)
    expect(curveCant(net, other, CLASSIC_160)!.appliedSpeed).toBe(80)
    expect(builds()).toBe(before + 4)

    // Other settings
    expect(curveCant(net, layout.pieces[1][0], { lineSpeed: 120, lineType: 'classic' })!.appliedSpeed).toBe(120)
    expect(builds()).toBe(before + 5)

    // A straight rail added elsewhere: a new profile (the track changed), with the curves and ramps kept
    const kept = trackProfile(net, { lineSpeed: 120, lineType: 'classic' })
    addSegment(net, addNode(net, { x: 0, y: -50 }).id, addNode(net, { x: 100, y: -50 }).id)
    const after = trackProfile(net, { lineSpeed: 120, lineType: 'classic' })
    expect(after).not.toBe(kept)
    expect(after.rails).toBe(kept.rails)
    expect(after.ramps).toBe(kept.ramps)
    for (let i = 0; i < 20; i++) expect(trackProfile(net, { lineSpeed: 120, lineType: 'classic' })).toBe(after)
    expect(builds()).toBe(before + 5)
  })

  it('the route ahead is walked once per rail entered, not once per frame', () => {
    const layout = new Layout().straight(20000, 40) // rails of 500 m
    const net = layout.net
    const env = { levelHeight: 6, line: LGV_300 }
    const train = running(rakeOn(net, layout.pieces[0][0].id, 0.5), 300)
    // Ten seconds at 60 frames per second: 833 m, so two rails entered
    const tenSeconds = (): { walks: number; occupancy: number; builds: number; distances: number[] } => {
      trainDynamics(net, train, env)
      const walks = trackSpeedStats.lookAheadWalks
      const occupancy = trackSpeedStats.occupancyWalks
      const builds = trackSpeedStats.profileBuilds
      const distances: number[] = []
      for (let frame = 0; frame < 600; frame++) {
        expect(advanceTrainSet(net, train, 300 / 3.6 / 60)).toBe(true)
        const ahead = trainDynamics(net, train, env).nextSpeedLimit
        // A second call in the same frame costs no walk at all
        trainDynamics(net, train, env)
        if (ahead) distances.push(ahead.distance)
      }
      return {
        walks: trackSpeedStats.lookAheadWalks - walks,
        occupancy: trackSpeedStats.occupancyWalks - occupancy,
        builds: trackSpeedStats.profileBuilds - builds,
        distances,
      }
    }
    // Nothing lower within reach
    const clear = tenSeconds()
    expect(clear.distances).toHaveLength(0)
    expect(clear.walks).toBeLessThanOrEqual(3)
    expect(clear.occupancy).toBe(600)
    expect(clear.builds).toBe(0)

    // A zone ahead, announced at every frame with a distance that only goes down
    addSpeedZoneBetween(net, at(net, 6000), at(net, 7000), 160)
    const announced = tenSeconds()
    expect(announced.distances).toHaveLength(600)
    expect(announced.distances.every((d, i) => i === 0 || d < announced.distances[i - 1])).toBe(true)
    expect(announced.distances[0] - announced.distances[599]).toBeCloseTo((599 * 300) / 3.6 / 60, 1)
    expect(announced.walks).toBeLessThanOrEqual(3)
    expect(announced.builds).toBe(0)
  })

  it('the kept route gives the same answer as a fresh walk', () => {
    const layout = new Layout().straight(2000, 4).arc(500, 45).straight(3000, 3)
    const net = layout.net
    const train = rakeOn(net, layout.pieces[0][0].id, 0.5)
    addSpeedZone(net, [{ segId: layout.pieces[2][1].id, t0: 0.2, t1: 0.8 }], 60)
    for (let step = 0; step < 300; step++) {
      if (!advanceTrainSet(net, train, 17)) break
      const limit = rakeSpeedLimit(net, train, CLASSIC_160)
      const kept = limitAhead(net, train, limit, 2500, CLASSIC_160)
      const fresh = limitAhead(net, { ...train }, limit, 2500, CLASSIC_160)
      if (fresh === null) expect(kept).toBeNull()
      else expect(kept).toEqual({ speed: fresh.speed, distance: expect.closeTo(fresh.distance, 2) })
    }
  })

  it('costs little: a frame on a network of 4 000 rails', () => {
    // Timed as the editor runs: without the check of the revisions the tests add
    verifyNetworkRevisions(false)
    onTestFinished(() => verifyNetworkRevisions(true))
    const layout = new Layout()
    for (let i = 0; i < 400; i++) layout.straight(900, 3).arc(1500, i % 2 === 0 ? 30 : -30).straight(300, 5)
    const net = layout.net
    expect(net.segments.size).toBe(4000)
    const env = { levelHeight: 6, line: LGV_300 }
    const train = running(rakeOn(net, layout.pieces[0][0].id, 0.9), 300)
    const time = (run: () => void, times: number): number => {
      const start = performance.now()
      for (let i = 0; i < times; i++) run()
      return ((performance.now() - start) / times) * 1000
    }
    const build = time(() => {
      layout.pieces[1][0].cant = layout.pieces[1][0].cant === 100 ? 105 : 100
      networkChanged()
      trackProfile(net, LGV_300)
    }, 20)
    delete layout.pieces[1][0].cant
    networkChanged()
    const unchanged = time(() => trackProfile(net, LGV_300), 500)
    const standing = time(() => trainDynamics(net, train, env), 200)
    const moving = time(() => {
      advanceTrainSet(net, train, 300 / 3.6 / 60)
      trainDynamics(net, train, env)
    }, 600)
    const advance = time(() => advanceTrainSet(net, train, 300 / 3.6 / 60), 600)
    const deficiency = time(() => rakeCantDeficiency(net, train.vehicles, 300, LGV_300), 500)
    // eslint-disable-next-line no-console
    console.log(
      `[trackSpeed cost, 4 000 rails, µs] profile rebuilt ${build.toFixed(0)} · profile unchanged ${unchanged.toFixed(1)} · ` +
        `trainDynamics standing ${standing.toFixed(0)} · advance + trainDynamics ${moving.toFixed(0)} (advance alone ${advance.toFixed(0)}) · ` +
        `deficiency check of a tick ${deficiency.toFixed(1)}`,
    )
    expect(unchanged).toBeLessThan(2000)
    expect(moving).toBeLessThan(20000)
  })
})

describe('off the real scale', () => {
  const HO: LineSettings = { lineSpeed: 160, lineType: 'classic', gauge: 0.0165, realScale: false }

  it('no cant, no curve speed: only the line speed and the zones', () => {
    const layout = new Layout().straight(5).arc(0.73, 90).straight(5)
    const net = layout.net
    const curve = layout.pieces[1][2]
    expect(curveCant(net, curve, HO)).toBeNull()
    expect(localCant(net, curve.id, 0.5, HO)).toBe(0)
    expect(speedLimitAt(net, curve.id, 0.5, HO)).toBe(160)
    expect(trackProfile(net, HO).curves).toHaveLength(0)
    addSpeedZone(net, [{ segId: curve.id, t0: 0, t1: 1 }], 40)
    expect(speedLimitAt(net, curve.id, 0.5, HO)).toBe(40)
    // The same track at full size is a very tight curve
    expect(speedLimitAt(net, layout.pieces[1][0].id, 0.5, CLASSIC_160)).toBe(5)
  })
})
