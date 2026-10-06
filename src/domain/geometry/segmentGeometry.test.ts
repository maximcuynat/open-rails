import { describe, expect, it } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork } from '../models/network'
import { bezierPoint, curveLength, curveLengthBetween, curveParamAtDistance } from './curve'
import {
  pointOnShape,
  segmentEnds,
  segmentShapeLength,
  segmentShapeLengthBetween,
  shapeLengthBetween,
  shapeParamAtDistance,
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
