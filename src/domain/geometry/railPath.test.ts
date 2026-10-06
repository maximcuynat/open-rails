import { describe, expect, it } from 'vitest'
import type { PathPiece } from '../models/types'
import {
  pathAt,
  pathClosest,
  pathCurvatureAt,
  pathDrawnPieces,
  pathOf,
  pathPolyline,
  pathSlice,
  pathTightestCurve,
  pieceAt,
  pieceEnd,
  railPath,
  reversedPieces,
} from './railPath'

/** 100 m straight along +x, then a quarter turn of radius 100 m, then 50 m straight along +y */
function track(): PathPiece[] {
  const straight: PathPiece = { x: 0, y: 0, heading: 0, curvature: 0, length: 100 }
  const arc: PathPiece = { x: 100, y: 0, heading: 0, curvature: 0.01, length: 50 * Math.PI }
  const end = pieceEnd(arc)
  return [straight, arc, { x: end.x, y: end.y, heading: end.heading, curvature: 0, length: 50 }]
}

describe('a piece of path', () => {
  it('a straight piece runs along its heading', () => {
    const at = pieceAt({ x: 10, y: 5, heading: Math.PI / 2, curvature: 0, length: 30 }, 20)
    expect(at.x).toBeCloseTo(10)
    expect(at.y).toBeCloseTo(25)
    expect(at.heading).toBe(Math.PI / 2)
  })

  it('an arc turns towards increasing heading for a positive curvature, the other way for a negative one', () => {
    const left = pieceEnd({ x: 0, y: 0, heading: 0, curvature: 0.01, length: 50 * Math.PI })
    expect(left.x).toBeCloseTo(100)
    expect(left.y).toBeCloseTo(100)
    expect(left.heading).toBeCloseTo(Math.PI / 2)
    const right = pieceEnd({ x: 0, y: 0, heading: 0, curvature: -0.01, length: 50 * Math.PI })
    expect(right.x).toBeCloseTo(100)
    expect(right.y).toBeCloseTo(-100)
    expect(right.heading).toBeCloseTo(-Math.PI / 2)
  })
})

describe('a path', () => {
  const path = pathOf(track())

  it('is as long as its pieces, and each starts where the one before ends', () => {
    expect(path.length).toBeCloseTo(100 + 50 * Math.PI + 50)
    expect([...path.starts]).toEqual([0, 100, 100 + 50 * Math.PI, path.length])
    const corner = pathAt(path, 100 + 50 * Math.PI)
    expect(corner.x).toBeCloseTo(200)
    expect(corner.y).toBeCloseTo(100)
    const end = pathAt(path, path.length)
    expect(end.x).toBeCloseTo(200)
    expect(end.y).toBeCloseTo(150)
  })

  it('knows its curvature and its tightest curve', () => {
    expect(pathCurvatureAt(path, 50)).toBe(0)
    expect(pathCurvatureAt(path, 150)).toBe(0.01)
    expect(pathTightestCurve(path)).toEqual({ radius: 100, hand: 1 })
    expect(pathTightestCurve(pathOf([track()[0]]))).toBeNull()
  })

  it('finds the place closest to a point, on a straight piece and on an arc', () => {
    expect(pathClosest(path, { x: 40, y: -7 })).toEqual({ s: 40, distance: 7 })
    // 10 m inside the middle of the quarter turn (its centre is at 100, 100)
    const inside = { x: 100 + 90 * Math.SQRT1_2, y: 100 - 90 * Math.SQRT1_2 }
    const found = pathClosest(path, inside)
    expect(found.s).toBeCloseTo(100 + 25 * Math.PI)
    expect(found.distance).toBeCloseTo(10)
    // Beyond the end: the end itself
    expect(pathClosest(path, { x: 200, y: 400 }).s).toBeCloseTo(path.length)
  })

  it('its box holds every point of it', () => {
    for (let s = 0; s <= path.length; s += 5) {
      const at = pathAt(path, s)
      expect(at.x).toBeGreaterThanOrEqual(path.box.minX - 1e-9)
      expect(at.x).toBeLessThanOrEqual(path.box.maxX + 1e-9)
      expect(at.y).toBeGreaterThanOrEqual(path.box.minY - 1e-9)
      expect(at.y).toBeLessThanOrEqual(path.box.maxY + 1e-9)
    }
  })

  it('is drawn as lines and quadratic curves that stay within millimetres of it', () => {
    const drawn = pathDrawnPieces(path, 0, path.length)
    expect(drawn[0]).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, via: undefined })
    // The quarter turn in five curves of 18°, each control point on the tangents of its ends
    const curves = drawn.filter((piece) => piece.via)
    expect(curves).toHaveLength(5)
    for (const { a, b, via } of curves) {
      const mid = { x: 0.25 * a.x + 0.5 * via!.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * via!.y + 0.25 * b.y }
      expect(Math.abs(Math.hypot(mid.x - 100, mid.y - 100) - 100)).toBeLessThan(0.01)
    }
    expect(drawn[drawn.length - 1].b.x).toBeCloseTo(200)
    expect(drawn[drawn.length - 1].b.y).toBeCloseTo(150)
  })

  it('a stretch walked backwards is the same pieces the other way round', () => {
    const forwards = pathDrawnPieces(path, 60, 220)
    const backwards = pathDrawnPieces(path, 220, 60)
    expect(backwards).toHaveLength(forwards.length)
    expect(backwards[0].a.x).toBeCloseTo(forwards[forwards.length - 1].b.x)
    expect(backwards[backwards.length - 1].b.x).toBeCloseTo(forwards[0].a.x)
    expect(pathPolyline(path, 220, 60, 0.02, 16)[0].x).toBeCloseTo(pathAt(path, 220).x)
  })

  it('as a polyline: the ends of its pieces, and chords on its arcs', () => {
    const pts = pathPolyline(path, 0, path.length, 0.1, 100)
    // 2 ends of the first straight, 16 chords on the quarter turn (π/2 ÷ 0.1), 1 for the last straight
    expect(pts).toHaveLength(1 + 1 + 16 + 1)
    expect(pathPolyline(path, 0, path.length, 0.1, 4)).toHaveLength(1 + 1 + 4 + 1)
  })

  it('cut in two, its halves are the same track', () => {
    const cut = 100 + 20 * Math.PI
    const first = pathOf(pathSlice(path, 0, cut))
    const second = pathOf(pathSlice(path, cut, path.length))
    expect(first.length + second.length).toBeCloseTo(path.length)
    expect(first.pieces).toHaveLength(2)
    expect(second.pieces).toHaveLength(2)
    for (const s of [10, 99, 130, cut - 1]) {
      expect(pathAt(first, s).x).toBeCloseTo(pathAt(path, s).x)
      expect(pathAt(first, s).y).toBeCloseTo(pathAt(path, s).y)
    }
    for (const s of [cut + 1, 250, path.length]) {
      expect(pathAt(second, s - cut).x).toBeCloseTo(pathAt(path, s).x)
      expect(pathAt(second, s - cut).heading).toBeCloseTo(pathAt(path, s).heading)
    }
  })

  it('walked from its other end, it is the same track', () => {
    const back = pathOf(reversedPieces(path.pieces))
    expect(back.length).toBeCloseTo(path.length)
    for (const s of [0, 60, 150, 280]) {
      expect(pathAt(back, path.length - s).x).toBeCloseTo(pathAt(path, s).x)
      expect(pathAt(back, path.length - s).y).toBeCloseTo(pathAt(path, s).y)
    }
    expect(pathCurvatureAt(back, path.length - 150)).toBe(-0.01)
  })
})

describe('a path between its two nodes', () => {
  const pieces = track()

  it('is the pieces as they are while the nodes are where it starts and ends', () => {
    const path = railPath(pieces, { x: 0, y: 0 }, { x: 200, y: 150 })
    expect(path.pieces).toBe(pieces)
    expect(railPath(pieces, { x: 0, y: 0 }, { x: 200, y: 150 })).toBe(path)
  })

  it('follows a node that is moved: turned and scaled onto its ends, tangent to tangent as before', () => {
    const a = { x: 10, y: -5 }
    const b = { x: 310, y: 220 }
    const path = railPath(pieces, a, b)
    const start = pathAt(path, 0)
    const end = pathAt(path, path.length)
    expect(start.x).toBeCloseTo(a.x)
    expect(start.y).toBeCloseTo(a.y)
    expect(end.x).toBeCloseTo(b.x)
    expect(end.y).toBeCloseTo(b.y)
    // 1.5 times as far apart: 1.5 times as long, with a radius 1.5 times as large
    expect(path.length).toBeCloseTo(1.5 * (150 + 50 * Math.PI))
    expect(pathCurvatureAt(path, path.length / 2)).toBeCloseTo(0.01 / 1.5)
    path.pieces.slice(1).forEach((piece, i) => {
      const before = pieceEnd(path.pieces[i])
      expect(piece.x).toBeCloseTo(before.x)
      expect(piece.y).toBeCloseTo(before.y)
      expect(piece.heading).toBeCloseTo(before.heading)
    })
  })
})
