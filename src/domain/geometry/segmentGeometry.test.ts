import { describe, expect, it } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork } from '../models/network'
import { bezierDerivative1, bezierPoint, curveLength, curveLengthBetween, curveParamAtDistance, discretizeCurve } from './curve'
import {
  derivativeOnShape,
  pointOnShape,
  reversedShape,
  segmentBounds,
  segmentEnds,
  segmentShapeLength,
  segmentShapeLengthBetween,
  shapeBounds,
  shapeBoundsMeet,
  shapeChordCount,
  shapeLengthBetween,
  shapeParamAtDistance,
  shapePieces,
  shapePolyline,
  tangentOnShape,
} from './segmentGeometry'

/** Length of a quadratic curve as a sum of very many chords: what the integral must agree with */
function chordLength(p0: { x: number; y: number }, via: { x: number; y: number }, p2: { x: number; y: number }, t0 = 0, t1 = 1): number {
  const n = 20000
  let length = 0
  let prev = bezierPoint(t0, p0, via, p2)
  for (let i = 1; i <= n; i++) {
    const p = bezierPoint(t0 + ((t1 - t0) * i) / n, p0, via, p2)
    length += Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  return length
}

describe('length of a quadratic curve', () => {
  const p0 = { x: 0, y: 0 }
  const via = { x: 60, y: 0 }
  const p2 = { x: 110, y: 30 }

  it('is the length of the curve, not of a few chords under it', () => {
    expect(curveLength(p0, via, p2)).toBeCloseTo(chordLength(p0, via, p2), 6)
    expect(curveLengthBetween(p0, via, p2, 0.2, 0.7)).toBeCloseTo(chordLength(p0, via, p2, 0.2, 0.7), 6)
  })

  it('does not depend on the order of the two parameters, and adds up', () => {
    expect(curveLengthBetween(p0, via, p2, 0.7, 0.2)).toBe(curveLengthBetween(p0, via, p2, 0.2, 0.7))
    expect(curveLengthBetween(p0, via, p2, 0, 0.4) + curveLengthBetween(p0, via, p2, 0.4, 1)).toBeCloseTo(curveLength(p0, via, p2), 9)
    expect(curveLengthBetween(p0, via, p2, 0.3, 0.3)).toBe(0)
  })

  it('a curve whose control point is in the middle of its ends is a straight line', () => {
    expect(curveLength({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(100, 9)
  })

  it('a sharp quarter turn is still measured to the millimetre', () => {
    const a = { x: 0, y: 0 }
    const v = { x: 100, y: 0 }
    const b = { x: 100, y: 100 }
    expect(curveLength(a, v, b)).toBeCloseTo(chordLength(a, v, b), 3)
  })
})

describe('parameter a distance along a curve', () => {
  const p0 = { x: 0, y: 0 }
  const via = { x: 60, y: 0 }
  const p2 = { x: 110, y: 30 }

  it('is the place that far along the curve, both ways', () => {
    for (const [t, d] of [[0, 25], [0.3, 40], [0.9, -70], [0.5, -10], [0.5, 0]] as const) {
      const u = curveParamAtDistance(p0, via, p2, t, d)
      expect(curveLengthBetween(p0, via, p2, t, u)).toBeCloseTo(Math.abs(d), 6)
      expect(Math.sign(u - t)).toBe(Math.sign(d))
    }
  })

  it('stops at the end of the curve when it is shorter than the distance', () => {
    expect(curveParamAtDistance(p0, via, p2, 0.5, 1e6)).toBe(1)
    expect(curveParamAtDistance(p0, via, p2, 0.5, -1e6)).toBe(0)
  })
})

describe('a rail as a polyline', () => {
  const straight = { a: { x: 3, y: -2 }, b: { x: 43, y: 28 } }
  const curve = { a: { x: 0.1, y: 0.2 }, b: { x: 110.3, y: 30.7 }, via: { x: 60.9, y: -4.4 } }

  it('gives a curve the points the flatteners it replaces gave, at each count in use', () => {
    for (const chords of [8, 16, 24, 32]) {
      expect(shapePolyline(curve, chords)).toEqual(discretizeCurve(curve.a, curve.via, curve.b, chords))
      expect(shapePolyline(curve, chords)).toEqual(
        Array.from({ length: chords + 1 }, (_, i) => bezierPoint(i / chords, curve.a, curve.via, curve.b)),
      )
    }
  })

  it('gives a straight rail its two ends themselves, whatever the count', () => {
    for (const chords of [1, 8, 16, 24, 32]) {
      const pts = shapePolyline(straight, chords)
      expect(pts).toHaveLength(2)
      expect(pts[0]).toBe(straight.a)
      expect(pts[1]).toBe(straight.b)
    }
  })

  it('flattens a stretch from its first parameter to its second', () => {
    const pts = shapePolyline(curve, 4, 0.2, 0.6)
    expect(pts).toHaveLength(5)
    pts.forEach((p, i) => {
      const expected = bezierPoint(0.2 + 0.1 * i, curve.a, curve.via, curve.b)
      expect(p.x).toBeCloseTo(expected.x, 12)
      expect(p.y).toBeCloseTo(expected.y, 12)
    })
    expect(shapePolyline(straight, 4, 0.75, 0.25)).toEqual([{ x: 33, y: 20.5 }, { x: 13, y: 5.5 }])
  })

  it('counts the chords that keep the line within a tolerance of the curve', () => {
    // The count the schematic drawing worked out by itself before
    const sagitta = Math.hypot(curve.via.x - (curve.a.x + curve.b.x) / 2, curve.via.y - (curve.a.y + curve.b.y) / 2) / 2
    for (const tolerance of [0.01, 0.5, 5, 500]) {
      const chords = shapeChordCount(curve, tolerance)
      expect(chords).toBe(Math.max(1, Math.ceil(Math.sqrt(sagitta / tolerance))))
      // No point of the curve is further than the tolerance from the polyline
      const line = shapePolyline(curve, chords)
      for (let k = 0; k <= 400; k++) {
        const p = bezierPoint(k / 400, curve.a, curve.via, curve.b)
        let nearest = Infinity
        for (let i = 1; i < line.length; i++) {
          const dx = line[i].x - line[i - 1].x
          const dy = line[i].y - line[i - 1].y
          const u = Math.max(0, Math.min(1, ((p.x - line[i - 1].x) * dx + (p.y - line[i - 1].y) * dy) / (dx * dx + dy * dy)))
          nearest = Math.min(nearest, Math.hypot(p.x - line[i - 1].x - u * dx, p.y - line[i - 1].y - u * dy))
        }
        expect(nearest).toBeLessThanOrEqual(tolerance)
      }
    }
    expect(shapeChordCount(straight, 0.01)).toBe(1)
    expect(shapeChordCount({ a: curve.a, b: curve.b, via: { x: 55.2, y: 15.45 } }, 0.01)).toBe(1)
  })

  it('reads a rail from its other end', () => {
    const back = reversedShape(curve)
    expect(back).toEqual({ a: curve.b, b: curve.a, via: curve.via })
    expect(reversedShape(straight)).toEqual({ a: straight.b, b: straight.a })
    for (const t of [0, 0.25, 0.5, 1]) {
      const there = pointOnShape(back, t)
      const here = pointOnShape(curve, 1 - t)
      expect(there.x).toBeCloseTo(here.x, 12)
      expect(there.y).toBeCloseTo(here.y, 12)
    }
    // The schematic walks a rail backwards this way: the same points as from the far node
    expect(shapePolyline(back, 8)).toEqual(discretizeCurve(curve.b, curve.via, curve.a, 8))
    expect(shapeChordCount(back, 0.5)).toBe(shapeChordCount(curve, 0.5))
  })
})

describe('box of a rail', () => {
  const straight = { a: { x: 43, y: -2 }, b: { x: 3, y: 28 } }
  const curve = { a: { x: 0, y: 0 }, b: { x: 110, y: 30 }, via: { x: 130, y: -40 } }

  it('is the box of the ends and of the control point', () => {
    expect(shapeBounds(straight)).toEqual({ minX: 3, maxX: 43, minY: -2, maxY: 28 })
    expect(shapeBounds(curve)).toEqual({ minX: 0, maxX: 130, minY: -40, maxY: 30 })
  })

  it('holds every point of the curve', () => {
    const box = shapeBounds(curve)
    for (let k = 0; k <= 200; k++) {
      const p = pointOnShape(curve, k / 200)
      expect(p.x).toBeGreaterThanOrEqual(box.minX)
      expect(p.x).toBeLessThanOrEqual(box.maxX)
      expect(p.y).toBeGreaterThanOrEqual(box.minY)
      expect(p.y).toBeLessThanOrEqual(box.maxY)
    }
  })

  it('tells whether it meets another box, as comparing the two boxes does', () => {
    const others = [
      { minX: -50, maxX: -1, minY: -100, maxY: 100 },
      { minX: -50, maxX: 0, minY: -100, maxY: 100 },
      { minX: 131, maxX: 200, minY: -100, maxY: 100 },
      { minX: 40, maxX: 60, minY: 31, maxY: 80 },
      { minX: 40, maxX: 60, minY: -80, maxY: -40 },
      { minX: 40, maxX: 60, minY: -80, maxY: -41 },
      { minX: 120, maxX: 125, minY: -35, maxY: -30 },
    ]
    expect(others.map((box) => shapeBoundsMeet(curve, box))).toEqual([false, true, false, false, true, false, true])
    for (const shape of [straight, curve]) {
      const own = shapeBounds(shape)
      for (const box of others) {
        const apart = own.maxX < box.minX || own.minX > box.maxX || own.maxY < box.minY || own.minY > box.maxY
        expect(shapeBoundsMeet(shape, box)).toBe(!apart)
      }
    }
  })

  it('is read from the network, and is null when a node is missing', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const seg = addCurveSegment(net, a.id, b.id, { x: 50, y: 25 })!
    expect(segmentBounds(net, seg)).toEqual({ minX: 0, maxX: 100, minY: 0, maxY: 25 })
    net.nodes.delete(b.id)
    expect(segmentBounds(net, seg)).toBeNull()
  })
})

describe('pieces a rail is drawn from', () => {
  const straight = { a: { x: 3.3, y: -2.1 }, b: { x: 43.7, y: 28.9 } }
  const curve = { a: { x: 0.1, y: 0.2 }, b: { x: 110.3, y: 30.7 }, via: { x: 60.9, y: -4.4 } }
  const stretches: [number, number][] = [[0, 0.5], [0.25, 0.8], [0.3, 1], [1, 0], [0.7, 0.1]]

  it('hands back the rail itself when the stretch is all of it', () => {
    for (const shape of [straight, curve]) {
      expect(shapePieces(shape)).toEqual([shape])
      expect(shapePieces(shape)[0]).toBe(shape)
      expect(shapePieces(shape, -0.2, 1.5)[0]).toBe(shape)
    }
  })

  it('gives the part of a straight rail as one line, as `subdivideStraight` computed it', () => {
    const dx = straight.b.x - straight.a.x
    const dy = straight.b.y - straight.a.y
    for (const [t0, t1] of stretches) {
      expect(shapePieces(straight, t0, t1)).toEqual([
        {
          a: { x: straight.a.x + t0 * dx, y: straight.a.y + t0 * dy },
          b: { x: straight.a.x + t1 * dx, y: straight.a.y + t1 * dy },
        },
      ])
    }
  })

  it('gives the part of a curve as one exact sub-curve, as `subdivideCurve` computed it', () => {
    for (const [t0, t1] of stretches) {
      const subP0 = bezierPoint(t0, curve.a, curve.via, curve.b)
      const subP2 = bezierPoint(t1, curve.a, curve.via, curve.b)
      const d0 = bezierDerivative1(t0, curve.a, curve.via, curve.b)
      const dt = t1 - t0
      const pieces = shapePieces(curve, t0, t1)
      expect(pieces).toEqual([{ a: subP0, b: subP2, via: { x: subP0.x + (dt / 2) * d0.x, y: subP0.y + (dt / 2) * d0.y } }])
      // The piece runs along the rail: its point at u is the point of the rail at t0 + u (t1 − t0)
      for (const u of [0.25, 0.5, 0.75]) {
        const onPiece = pointOnShape(pieces[0], u)
        const onRail = pointOnShape(curve, t0 + u * (t1 - t0))
        expect(onPiece.x).toBeCloseTo(onRail.x, 10)
        expect(onPiece.y).toBeCloseTo(onRail.y, 10)
      }
    }
  })

  it('gives the velocity of a rail, of which the tangent is the direction', () => {
    expect(derivativeOnShape(straight, 0.3)).toEqual({ x: straight.b.x - straight.a.x, y: straight.b.y - straight.a.y })
    for (const t of [0, 0.3, 1]) {
      const d = derivativeOnShape(curve, t)
      expect(d).toEqual(bezierDerivative1(t, curve.a, curve.via, curve.b))
      const unit = tangentOnShape(curve, t)
      expect(d.x / Math.hypot(d.x, d.y)).toBeCloseTo(unit.x, 12)
      expect(d.y / Math.hypot(d.x, d.y)).toBeCloseTo(unit.y, 12)
    }
  })
})

describe('shape of a rail', () => {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 80, y: 60 })
  const c = addNode(net, { x: 160, y: 60 })
  const straight = addSegment(net, a.id, b.id)!
  const curve = addCurveSegment(net, b.id, c.id, { x: 120, y: 90 })!

  it('straight rail: length, point, direction and distances are those of the line', () => {
    const ends = segmentEnds(net, straight)!
    expect(ends.via).toBeUndefined()
    expect(segmentShapeLength(net, straight)).toBeCloseTo(100)
    expect(segmentShapeLengthBetween(net, straight, 0.25, 0.75)).toBeCloseTo(50)
    expect(pointOnShape(ends, 0.5)).toEqual({ x: 40, y: 30 })
    expect(tangentOnShape(ends, 0.3).x).toBeCloseTo(0.8)
    expect(tangentOnShape(ends, 0.3).y).toBeCloseTo(0.6)
    expect(shapeParamAtDistance(ends, 0.5, 20)).toBeCloseTo(0.7)
    expect(shapeParamAtDistance(ends, 0.5, -20)).toBeCloseTo(0.3)
  })

  it('curved rail: the same questions, answered along the curve', () => {
    const ends = segmentEnds(net, curve)!
    expect(ends.via).toEqual({ x: 120, y: 90 })
    const length = segmentShapeLength(net, curve)
    expect(length).toBeGreaterThan(80)
    expect(pointOnShape(ends, 0.5)).toEqual(bezierPoint(0.5, ends.a, ends.via!, ends.b))
    // Leaves b towards the control point, arrives at c from it
    expect(tangentOnShape(ends, 0).y).toBeGreaterThan(0)
    expect(tangentOnShape(ends, 1).y).toBeLessThan(0)
    const u = shapeParamAtDistance(ends, 0, length / 2)
    expect(shapeLengthBetween(ends, 0, u)).toBeCloseTo(length / 2, 6)
    expect(u).toBeCloseTo(0.5, 6)
  })

  it('a curve that lost its control point is read as the line between its ends', () => {
    const lost = { ...curve, via: undefined }
    expect(segmentEnds(net, lost)!.via).toBeUndefined()
    expect(segmentShapeLength(net, lost)).toBeCloseTo(80)
  })

  it('a rail whose node is missing has no shape and no length', () => {
    const orphan = { ...straight, to: 'n_missing' }
    expect(segmentEnds(net, orphan)).toBeNull()
    expect(segmentShapeLength(net, orphan)).toBe(0)
  })
})
