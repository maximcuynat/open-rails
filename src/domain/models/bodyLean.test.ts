import { beforeEach, describe, expect, it } from 'vitest'
import { addCurveChain, addNode, addSegment, createNetwork, resetIdCounter } from './network'
import { tangentArcPieces } from '../geometry/curve'
import { positionOnSegment, snapToNearestTrack, type TrackPosition } from './locomotive'
import type { Network, Point, RailNode, Segment } from './types'
import type { LineSettings } from './speedLimits'
import { contactSpacing, equilibriumCant } from './cant'
import { ROLLING_STOCK } from './rollingStock'
import { localCant, trackCantOn, trackProfile } from './trackSpeed'
import { createVehicle, getTrainSetVisuals, makeTrainSet, type TrainSet } from './train'
import { bodyLeanAngle, leanAt, leanedOutline, rakeLean, roofOffset, vehicleLean } from './bodyLean'
import { networkChanged } from '@domain/models/networkWatch'

beforeEach(() => resetIdCounter(0))

const CLASSIC_160: LineSettings = { lineSpeed: 160, lineType: 'classic' }
const ROLL = ROLLING_STOCK.duplex.rollCoefficient
const RADIUS = 500
const CANT = 150
/** Angle of 150 mm of cant across the 1 500 mm between the wheel contacts */
const CANT_ANGLE = Math.asin(CANT / contactSpacing())

/** Lays track piece by piece from `start`, heading `heading` (rad) */
class Layout {
  net = createNetwork()
  node: RailNode
  pieces: Segment[][] = []

  constructor(start: Point = { x: 0, y: 0 }, public heading = 0) {
    this.node = addNode(this.net, start)
  }

  straight(length: number): this {
    const next = addNode(this.net, {
      x: this.node.pos.x + Math.cos(this.heading) * length,
      y: this.node.pos.y + Math.sin(this.heading) * length,
    })
    this.pieces.push([addSegment(this.net, this.node.id, next.id)!])
    this.node = next
    return this
  }

  /** Arc of `radius` m turning by `degrees` (positive = towards +y for a heading along +x), laid with `cant` mm by hand */
  arc(radius: number, degrees: number, cant?: number): this {
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
    const rails = addCurveChain(this.net, this.node.id, end.id, arc.pieces)!.segments
    if (cant !== undefined) for (const rail of rails) rail.cant = cant
    networkChanged()
    this.pieces.push(rails)
    this.node = end
    this.heading = endHeading
    return this
  }
}

/** 500 m of straight track, a quarter turn of 500 m radius to `side` with 150 mm of cant, 500 m of straight track */
function curveLayout(side: 1 | -1 = 1, cant = CANT): Layout {
  return new Layout().straight(500).arc(RADIUS, 90 * side, cant).straight(500)
}

/** Centre of the curve of `curveLayout` */
const centreOf = (side: 1 | -1): Point => ({ x: 500, y: RADIUS * side })

function place(net: Network, world: Point, forward = true): TrackPosition {
  const hit = snapToNearestTrack(net, world, 1)!
  return { segId: hit.segId, t: hit.t, forward }
}

/** Point of the curve of `curveLayout` after `degrees` of turn */
function onCurve(side: 1 | -1, degrees: number): Point {
  const a = (degrees * Math.PI) / 180
  return { x: 500 + RADIUS * Math.sin(a), y: side * RADIUS * (1 - Math.cos(a)) }
}

/** Speed (km/h) at which a curve of 500 m asks for `cant` mm */
const speedFor = (cant: number): number => Math.sqrt((cant * 9.81 * RADIUS) / contactSpacing()) * 3.6

const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y

describe('lean of a body over a bogie', () => {
  it('stands upright on plain straight track', () => {
    const { net } = curveLayout()
    const profile = trackProfile(net, CLASSIC_160)
    const lean = leanAt(net, profile, place(net, { x: 100, y: 0 }), 120, ROLL)
    expect(lean.angle).toBe(0)
    expect(lean.inside).toBeNull()
    expect(roofOffset(lean, 4.32)).toEqual({ x: 0, y: 0 })
  })

  it('at a stand in a curve leans inwards: the angle of the cant, and the roll of the body on top', () => {
    const { net } = curveLayout()
    const profile = trackProfile(net, CLASSIC_160)
    const world = onCurve(1, 45)
    const pos = place(net, world)
    expect(localCant(net, pos.segId, pos.t, CLASSIC_160)).toBe(CANT)
    const lean = leanAt(net, profile, pos, 0, ROLL)
    // The whole cant is in excess: the body rolls inwards by its share of that angle
    expect(lean.angle).toBeCloseTo(CANT_ANGLE * (1 + ROLL), 10)
    expect(lean.angle).toBeGreaterThan(CANT_ANGLE)
    const towardsCentre = { x: centreOf(1).x - world.x, y: centreOf(1).y - world.y }
    expect(dot(lean.inside!, towardsCentre)).toBeCloseTo(RADIUS, 3)
    // The roof of a 4.32 m body moves by its height times the sine of the lean, towards the centre
    const off = roofOffset(lean, 4.32)
    expect(Math.hypot(off.x, off.y)).toBeCloseTo(4.32 * Math.sin(lean.angle), 10)
    expect(dot(off, towardsCentre)).toBeGreaterThan(0)
    // Real figures: about half a metre, not more
    expect(Math.hypot(off.x, off.y)).toBeGreaterThan(0.4)
    expect(Math.hypot(off.x, off.y)).toBeLessThan(0.6)
  })

  it('at the equilibrium speed stands square on the canted track: the angle of the cant exactly', () => {
    const { net } = curveLayout()
    const speed = speedFor(CANT)
    expect(equilibriumCant(speed, RADIUS)).toBeCloseTo(CANT, 9)
    const lean = leanAt(net, trackProfile(net, CLASSIC_160), place(net, onCurve(1, 45)), speed, ROLL)
    expect(lean.angle).toBeCloseTo(CANT_ANGLE, 10)
  })

  it('straightens up as the speed rises above equilibrium', () => {
    const { net } = curveLayout()
    const profile = trackProfile(net, CLASSIC_160)
    const pos = place(net, onCurve(1, 45))
    const slow = leanAt(net, profile, pos, 60, ROLL).angle
    const balanced = leanAt(net, profile, pos, speedFor(CANT), ROLL).angle
    const fast = leanAt(net, profile, pos, speedFor(CANT + 300), ROLL).angle
    expect(slow).toBeGreaterThan(balanced)
    expect(fast).toBeLessThan(balanced)
    expect(fast).toBeCloseTo(CANT_ANGLE - ROLL * Math.asin(300 / contactSpacing()), 10)
  })

  it('in strong overspeed leans outwards once the roll outweighs the cant', () => {
    // 40 mm of cant and 400 mm of deficiency: 0.2 × 400 mm of roll against 40 mm of cant
    const { net } = curveLayout(1, 40)
    const world = onCurve(1, 45)
    const lean = leanAt(net, trackProfile(net, CLASSIC_160), place(net, world), speedFor(440), ROLL)
    expect(lean.angle).toBeLessThan(0)
    const off = roofOffset(lean, 4.32)
    const towardsCentre = { x: centreOf(1).x - world.x, y: centreOf(1).y - world.y }
    expect(dot(off, towardsCentre)).toBeLessThan(0)
  })

  it('with the real roll of a TGV a body on 150 mm of cant is still leaning inwards when it overturns', () => {
    // Not exaggerated: 0.2 × 525 mm of deficiency is less than the 150 mm of cant
    const angle = bodyLeanAngle(CANT, ROLLING_STOCK.duplex.overturningDeficiency, ROLL)
    expect(angle).toBeGreaterThan(0)
    expect(angle).toBeLessThan(CANT_ANGLE / 2)
  })

  it('curves to the left and to the right are mirror images', () => {
    const left = curveLayout(1)
    const right = curveLayout(-1)
    const a = leanAt(left.net, trackProfile(left.net, CLASSIC_160), place(left.net, onCurve(1, 30)), 90, ROLL)
    const b = leanAt(right.net, trackProfile(right.net, CLASSIC_160), place(right.net, onCurve(-1, 30)), 90, ROLL)
    expect(b.angle).toBeCloseTo(a.angle, 12)
    expect(b.inside!.x).toBeCloseTo(a.inside!.x, 9)
    expect(b.inside!.y).toBeCloseTo(-a.inside!.y, 9)
    // Each one towards its own centre
    expect(a.inside!.y).toBeGreaterThan(0)
    expect(b.inside!.y).toBeLessThan(0)
  })

  it('does not depend on the way the rail is run, nor on the way it was laid', () => {
    const { net } = curveLayout()
    const profile = trackProfile(net, CLASSIC_160)
    const world = onCurve(1, 60)
    const ascending = leanAt(net, profile, place(net, world, true), 90, ROLL)
    const descending = leanAt(net, profile, place(net, world, false), 90, ROLL)
    expect(descending).toEqual(ascending)

    // The same track laid from its other end: every rail runs the other way
    const end = { x: 500 + RADIUS, y: RADIUS + 500 }
    const reversed = new Layout(end, -Math.PI / 2).straight(500).arc(RADIUS, -90, CANT).straight(500)
    const back = leanAt(reversed.net, trackProfile(reversed.net, CLASSIC_160), place(reversed.net, world), 90, ROLL)
    expect(back.angle).toBeCloseTo(ascending.angle, 9)
    expect(back.inside!.x).toBeCloseTo(ascending.inside!.x, 6)
    expect(back.inside!.y).toBeCloseTo(ascending.inside!.y, 6)
  })

  it('on the cant ramp of the straight track leans to the side of the curve it leads to', () => {
    for (const side of [1, -1] as const) {
      const layout = curveLayout(side)
      const profile = trackProfile(layout.net, CLASSIC_160)
      for (const world of [{ x: 480, y: 0 }, { x: 500 + RADIUS, y: side * (RADIUS + 20) }]) {
        const pos = place(layout.net, world)
        const cant = trackCantOn(profile, pos.segId, pos.t)
        expect(cant.cant).toBeGreaterThan(0)
        expect(cant.cant).toBeLessThan(CANT / 2)
        expect(cant.radius).toBe(Infinity)
        const lean = leanAt(layout.net, profile, pos, 0, ROLL)
        expect(lean.angle).toBeGreaterThan(0)
        expect(dot(lean.inside!, { x: centreOf(side).x - world.x, y: centreOf(side).y - world.y })).toBeGreaterThan(0)
      }
    }
  })

  it('nothing leans off the real scale', () => {
    const { net } = curveLayout()
    const model: LineSettings = { ...CLASSIC_160, realScale: false }
    const profile = trackProfile(net, model)
    expect(leanAt(net, profile, place(net, onCurve(1, 45)), 0, ROLL)).toEqual({ angle: 0, inside: null })
    const veh = createVehicle(net, place(net, onCurve(1, 45)).segId, 0.5, 'wagon', 1)!
    expect(vehicleLean(net, profile, veh, 0)).toBeNull()
    expect(rakeLean(net, profile, { vehicles: [veh], currentSpeed: 0 })).toBeNull()
  })
})

describe('lean of a vehicle', () => {
  it('entering a curve, the front leans before the rear', () => {
    const { net } = curveLayout()
    const profile = trackProfile(net, CLASSIC_160)
    // Front bogie just past the tangent point, rear bogie 18.7 m behind on the straight track
    const front = place(net, onCurve(1, 1))
    const veh = createVehicle(net, front.segId, front.t, 'wagon', 1)!
    const lean = vehicleLean(net, profile, veh, 0)!
    expect(positionOnSegment(net, veh.rear.segId, veh.rear.t)!.x).toBeLessThan(500)
    expect(lean.front.angle).toBeGreaterThan(lean.rear.angle)
    expect(lean.rear.angle).toBeGreaterThan(0)
  })

  it('is null on straight track', () => {
    const { net } = curveLayout()
    const pos = place(net, { x: 200, y: 0 })
    const veh = createVehicle(net, pos.segId, pos.t, 'wagon', 1)!
    expect(vehicleLean(net, trackProfile(net, CLASSIC_160), veh, 100)).toBeNull()
  })
})

describe('derailed rake', () => {
  it('lies on its side, tipped over to the outside of the curve, and stays so once out of the curve', () => {
    for (const side of [1, -1] as const) {
      const { net } = curveLayout(side)
      const profile = trackProfile(net, CLASSIC_160)
      const world = onCurve(side, 45)
      const pos = place(net, world)
      const veh = createVehicle(net, pos.segId, pos.t, 'wagon', 1)!
      const derailed = { speed: 250, limit: 110 }
      const leans = rakeLean(net, profile, { vehicles: [veh], currentSpeed: 30, derailed })!
      const lean = leans[0]!
      const off = roofOffset(lean.front, 4.32)
      expect(Math.hypot(off.x, off.y)).toBeCloseTo(4.32, 9)
      expect(dot(off, { x: centreOf(side).x - world.x, y: centreOf(side).y - world.y })).toBeLessThan(0)

      // Slid on to the straight track beyond the curve: same side of the vehicle
      const beyond = place(net, { x: 500 + RADIUS, y: side * (RADIUS + 300) })
      const later = createVehicle(net, beyond.segId, beyond.t, 'wagon', 1)!
      const after = rakeLean(net, profile, { vehicles: [later], currentSpeed: 0, derailed })![0]!
      // The outside of the curve was on the +x side there
      expect(roofOffset(after.front, 4.32).x).toBeCloseTo(4.32, 6)
    }
  })

  it('is left upright when nothing tells which side it fell to', () => {
    const { net } = curveLayout()
    const pos = place(net, { x: 100, y: 0 })
    const veh = createVehicle(net, pos.segId, pos.t, 'wagon', 1)!
    expect(rakeLean(net, trackProfile(net, CLASSIC_160), { vehicles: [veh], currentSpeed: 0, derailed: {} })).toBeNull()
  })
})

describe('leaning body seen from above', () => {
  const footprint = (): Point[] => [{ x: 10, y: 1.45 }, { x: 10, y: -1.45 }, { x: 0, y: -1.45 }, { x: 0, y: 1.45 }]
  const rear = { x: 0, y: 0 }
  const front = { x: 10, y: 0 }

  it('moves the roof by the offset of each end and shows the flank on the other side', () => {
    const polygon = footprint()
    const lean = { front: { angle: 0.12, inside: { x: 0, y: 1 } }, rear: { angle: 0.06, inside: { x: 0, y: 1 } } }
    const outline = leanedOutline(polygon, rear, front, lean, 4)!
    expect(polygon).toEqual(footprint())
    const half = (angle: number): number => 1.45 * Math.cos(angle)
    expect(outline.roof[0].y).toBeCloseTo(half(0.12) + 4 * Math.sin(0.12), 9)
    expect(outline.roof[1].y).toBeCloseTo(-half(0.12) + 4 * Math.sin(0.12), 9)
    expect(outline.roof[2].y).toBeCloseTo(-half(0.06) + 4 * Math.sin(0.06), 9)
    expect(outline.roof[3].y).toBeCloseTo(half(0.06) + 4 * Math.sin(0.06), 9)
    expect(outline.roof.map((p) => p.x)).toEqual([10, 10, 0, 0])
    // The flank: the −y side of the body, from its sole bar to the edge of the roof
    expect(outline.flank).toHaveLength(4)
    expect(outline.flank[0].y).toBeCloseTo(-half(0.12), 9)
    expect(outline.flank[1].y).toBeCloseTo(-half(0.06), 9)
    expect(outline.flank[2]).toEqual(outline.roof[2])
    expect(outline.flank[3]).toEqual(outline.roof[1])
  })

  it('is null for an upright body', () => {
    const upright = { angle: 0, inside: null }
    expect(leanedOutline(footprint(), rear, front, { front: upright, rear: upright }, 4)).toBeNull()
  })
})

describe('visuals of a train', () => {
  function trainAt(net: Network, world: Point, kinds: ('loco' | 'wagon')[] = ['loco', 'wagon']): TrainSet {
    const pos = place(net, world)
    const lead = createVehicle(net, pos.segId, pos.t, kinds[0], 1)!
    return makeTrainSet('T', [lead])
  }

  it('keep the footprint as it is and add the roof beside it in a curve', () => {
    const { net } = curveLayout()
    for (const kind of ['loco', 'wagon'] as const) {
      const train = trainAt(net, onCurve(1, 45), [kind])
      const plain = getTrainSetVisuals(net, train)!
      const leaning = getTrainSetVisuals(net, train, CLASSIC_160)!
      expect(plain.vehicles[0].roof).toBeUndefined()
      expect(leaning.vehicles[0].polygon).toEqual(plain.vehicles[0].polygon)
      const roof = leaning.vehicles[0].roof!
      expect(roof).toHaveLength(plain.vehicles[0].polygon.length)
      // Stopped on 150 mm of cant: every point of the roof is nearer the centre than the footprint
      const centre = centreOf(1)
      const mean = (points: Point[]): number => points.reduce((sum, p) => sum + Math.hypot(p.x - centre.x, p.y - centre.y), 0) / points.length
      const height = kind === 'loco' ? 4.1 : 4.32
      expect(mean(plain.vehicles[0].polygon) - mean(roof)).toBeCloseTo(height * Math.sin(CANT_ANGLE * (1 + ROLL)), 1)
      expect(leaning.vehicles[0].flank!.length).toBeGreaterThan(0)
    }
  })

  it('are what they were on straight track, and off the real scale', () => {
    const { net } = curveLayout()
    const straight = trainAt(net, { x: 200, y: 0 })
    expect(getTrainSetVisuals(net, straight, CLASSIC_160)).toEqual(getTrainSetVisuals(net, straight))
    const curve = trainAt(net, onCurve(1, 45))
    expect(getTrainSetVisuals(net, curve, { ...CLASSIC_160, realScale: false })).toEqual(getTrainSetVisuals(net, curve))
  })
})
