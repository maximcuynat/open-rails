import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Point } from '../models/types'
import { bezierPoint } from './curve'
import { distanceToPath, fitPath, pathLength, pieceEnd, pointOnPath, type ArcFitOptions, type FittedPiece } from './arcFit'

const DEG = Math.PI / 180

/** A small seeded generator (linear congruential): the same noise at every run */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** An alignment as a list of [length, curvature], laid from a start pose: the truth the points are taken from */
function alignment(elements: [number, number][], x = 0, y = 0, heading = 0.3): FittedPiece[] {
  const pieces: FittedPiece[] = []
  let pose = { x, y, heading }
  for (const [length, curvature] of elements) {
    const piece = { x: pose.x, y: pose.y, heading: pose.heading, curvature, length }
    pieces.push(piece)
    pose = pieceEnd(piece)
  }
  return pieces
}

/** Points along a path, one every `step()` metres and one at its end, each moved sideways by `noise()` */
function sample(truth: FittedPiece[], step: () => number, noise: () => number = () => 0): Point[] {
  const total = pathLength(truth)
  const points: Point[] = []
  for (let s = 0; ; s += step()) {
    const pose = pointOnPath(truth, Math.min(s, total))
    const off = noise()
    points.push({ x: pose.x - Math.sin(pose.heading) * off, y: pose.y + Math.cos(pose.heading) * off })
    if (s >= total) return points
  }
}

/** Sideways noise of ±0.3 m, what a line traced on aerial imagery carries */
function osmNoise(seed: number): () => number {
  const random = seeded(seed)
  return () => (random() - 0.5) * 0.6
}

function distanceToPolyline(points: readonly Point[], p: Point): number {
  let best = Infinity
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]
    const b = points[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y))
  }
  return best
}

/** Requirement 2: every piece starts where the one before ends, along the same direction */
function expectG1(pieces: readonly FittedPiece[]): void {
  expect(pieces.length).toBeGreaterThan(0)
  for (const piece of pieces) {
    expect(piece.length).toBeGreaterThan(0)
    expect(Number.isFinite(piece.x + piece.y + piece.heading + piece.curvature + piece.length)).toBe(true)
  }
  for (let i = 1; i < pieces.length; i++) {
    const end = pieceEnd(pieces[i - 1])
    expect(Math.hypot(end.x - pieces[i].x, end.y - pieces[i].y)).toBeLessThan(1e-6)
    expect(Math.abs(end.heading - pieces[i].heading)).toBeLessThan(1e-9)
  }
}

/** Requirement 1: the path starts on the first point and ends on the last one */
function expectEnds(pieces: readonly FittedPiece[], points: readonly Point[]): void {
  const first = points[0]
  const last = points[points.length - 1]
  const end = pieceEnd(pieces[pieces.length - 1])
  expect(Math.hypot(pieces[0].x - first.x, pieces[0].y - first.y)).toBeLessThan(1e-6)
  expect(Math.hypot(end.x - last.x, end.y - last.y)).toBeLessThan(1e-6)
}

/**
 * Requirement 3: every point is within `tolerance` of the path, and the path, walked every metre
 * or so, never strays more than `chordTolerance` from the polyline. Returns the two largest
 * distances found.
 */
function expectWithin(
  pieces: readonly FittedPiece[],
  points: readonly Point[],
  tolerance: number,
  chordTolerance = tolerance,
): { points: number; path: number } {
  let worstPoint = 0
  for (const p of points) worstPoint = Math.max(worstPoint, distanceToPath(pieces, p))
  expect(worstPoint).toBeLessThanOrEqual(tolerance + 1e-9)
  let worstPath = 0
  if (chordTolerance !== Infinity) {
    const total = pathLength(pieces)
    const step = Math.max(1, total / 4000)
    for (let s = 0; s <= total; s += step) worstPath = Math.max(worstPath, distanceToPolyline(points, pointOnPath(pieces, s)))
    expect(worstPath).toBeLessThanOrEqual(chordTolerance + 1e-9)
  }
  return { points: worstPoint, path: worstPath }
}

/** The three requirements at once */
function expectSound(pieces: readonly FittedPiece[], points: readonly Point[], options: ArcFitOptions): void {
  expectG1(pieces)
  expectEnds(pieces, points)
  expectWithin(pieces, points, options.tolerance, options.chordTolerance ?? options.tolerance)
}

/** Radius of the longest arc of a path that turns the given way */
function longestArcRadius(pieces: readonly FittedPiece[], sign: number): number {
  let best: FittedPiece | null = null
  for (const piece of pieces) {
    if (piece.curvature * sign > 0 && (!best || piece.length > best.length)) best = piece
  }
  return best ? Math.abs(1 / best.curvature) : NaN
}

const every = (metres: number) => () => metres

// The shapes of the tests, as [length, curvature]
const STRAIGHT: [number, number][] = [[1000, 0]]
const ARC: [number, number][] = [[500 * 60 * DEG, 1 / 500]]
const STRAIGHT_ARC_STRAIGHT: [number, number][] = [
  [400, 0],
  [500 * 40 * DEG, 1 / 500],
  [300, 0],
]
const S_CURVE: [number, number][] = [
  [300, 0],
  [300, 1 / 400],
  [300, -1 / 400],
  [200, 0],
]

describe('pieces — closed forms', () => {
  it('ends a straight piece along its heading', () => {
    const end = pieceEnd({ x: 10, y: 20, heading: Math.PI / 2, curvature: 0, length: 30 })
    expect(end.x).toBeCloseTo(10, 12)
    expect(end.y).toBeCloseTo(50, 12)
    expect(end.heading).toBeCloseTo(Math.PI / 2, 12)
  })

  it('ends a quarter circle one radius ahead and one radius to the side', () => {
    const left = pieceEnd({ x: 0, y: 0, heading: 0, curvature: 1 / 100, length: 50 * Math.PI })
    expect(left.x).toBeCloseTo(100, 10)
    expect(left.y).toBeCloseTo(100, 10)
    expect(left.heading).toBeCloseTo(Math.PI / 2, 12)
    // Negative curvature turns towards decreasing heading
    const right = pieceEnd({ x: 0, y: 0, heading: 0, curvature: -1 / 100, length: 50 * Math.PI })
    expect(right.x).toBeCloseTo(100, 10)
    expect(right.y).toBeCloseTo(-100, 10)
    expect(right.heading).toBeCloseTo(-Math.PI / 2, 12)
  })

  it('keeps its digits on an arc that is almost straight', () => {
    // R = 10 000 km over 1 km: 5 cm of sagitta at the end, to be found to the nanometre
    const end = pieceEnd({ x: 0, y: 0, heading: 0, curvature: 1e-7, length: 1000 })
    expect(end.y).toBeCloseTo(0.05, 9)
    expect(end.x).toBeCloseTo(1000 - 1000 ** 3 * 1e-14 / 6, 9)
  })

  it('measures and walks a path piece after piece', () => {
    const path = alignment(
      [
        [100, 0],
        [50 * Math.PI, 1 / 100],
        [40, 0],
      ],
      0,
      0,
      0,
    )
    expect(pathLength(path)).toBeCloseTo(140 + 50 * Math.PI, 12)
    expect(pointOnPath(path, 60)).toMatchObject({ x: 60, y: 0, heading: 0 })
    // Half-way round the quarter circle of centre (100, 100)
    const mid = pointOnPath(path, 100 + 25 * Math.PI)
    expect(mid.x).toBeCloseTo(100 + 100 * Math.sin(Math.PI / 4), 10)
    expect(mid.y).toBeCloseTo(100 - 100 * Math.cos(Math.PI / 4), 10)
    expect(mid.heading).toBeCloseTo(Math.PI / 4, 12)
    // On the last straight, heading up
    const late = pointOnPath(path, 100 + 50 * Math.PI + 10)
    expect(late.x).toBeCloseTo(200, 10)
    expect(late.y).toBeCloseTo(110, 10)
    // Held within the two ends
    expect(pointOnPath(path, -5)).toMatchObject({ x: 0, y: 0 })
    expect(pointOnPath(path, 1e6).y).toBeCloseTo(140, 10)
    expect(pointOnPath([], 3)).toEqual({ x: 0, y: 0, heading: 0 })
  })

  it('gives the distance from a point to a path', () => {
    const path = alignment(
      [
        [100, 0],
        [50 * Math.PI, 1 / 100],
      ],
      0,
      0,
      0,
    )
    // Beside the straight, and before its start
    expect(distanceToPath(path, { x: 50, y: 7 })).toBeCloseTo(7, 12)
    expect(distanceToPath(path, { x: -3, y: 4 })).toBeCloseTo(5, 12)
    // Inside and outside the arc of centre (100, 100), along the radius at 45°
    const c = Math.SQRT1_2
    expect(distanceToPath(path, { x: 100 + 90 * c, y: 100 - 90 * c })).toBeCloseTo(10, 10)
    expect(distanceToPath(path, { x: 100 + 125 * c, y: 100 - 125 * c })).toBeCloseTo(25, 10)
    // Past the end of the arc, at (200, 100) heading up: the end point is the closest
    expect(distanceToPath(path, { x: 203, y: 104 })).toBeCloseTo(5, 10)
    // On the far side of the circle the arc does not cover: the closer of its two ends
    expect(distanceToPath(path, { x: 0, y: 100 })).toBeCloseTo(100, 10)
    expect(distanceToPath([], { x: 0, y: 0 })).toBe(Infinity)
  })
})

describe('fitPath — exact shapes', () => {
  it('fits a straight line by one piece, however many points it has', () => {
    const truth = alignment(STRAIGHT)
    const points = sample(truth, every(20))
    const pieces = fitPath(points, { tolerance: 0.5 })
    expect(pieces).toHaveLength(1)
    expect(pieces[0].curvature).toBe(0)
    expect(pieces[0].length).toBeCloseTo(1000, 6)
    expect(pieces[0].heading).toBeCloseTo(0.3, 9)
    expectSound(pieces, points, { tolerance: 0.5 })
  })

  it('fits a curve of constant radius by one arc, its radius within 0.1 %', () => {
    const points = sample(alignment(ARC), every(20))
    const pieces = fitPath(points, { tolerance: 0.5 })
    expect(pieces).toHaveLength(1)
    expect(1 / pieces[0].curvature).toBeGreaterThan(500 * 0.999)
    expect(1 / pieces[0].curvature).toBeLessThan(500 * 1.001)
    expect(pieces[0].length).toBeCloseTo(500 * 60 * DEG, 3)
    expectSound(pieces, points, { tolerance: 0.5 })
  })

  it('fits the same arc turning the other way with a negative curvature', () => {
    const points = sample(alignment([[500 * 60 * DEG, -1 / 500]]), every(20))
    const pieces = fitPath(points, { tolerance: 0.5 })
    expect(pieces).toHaveLength(1)
    expect(1 / pieces[0].curvature).toBeCloseTo(-500, 3)
  })

  it('fits straight – arc – straight by three pieces', () => {
    const points = sample(alignment(STRAIGHT_ARC_STRAIGHT), every(20))
    const pieces = fitPath(points, { tolerance: 0.5 })
    expect(pieces.map((p) => Math.sign(p.curvature))).toEqual([0, 1, 0])
    expect(pieces[0].length).toBeCloseTo(400, 0)
    expect(1 / pieces[1].curvature).toBeCloseTo(500, 0)
    expect(pieces[1].length).toBeCloseTo(500 * 40 * DEG, 0)
    expect(pieces[2].length).toBeCloseTo(300, 0)
    expectSound(pieces, points, { tolerance: 0.5 })
  })

  it('fits an S-curve by its two straights and two arcs', () => {
    const points = sample(alignment(S_CURVE), every(20))
    const pieces = fitPath(points, { tolerance: 0.5 })
    expect(pieces.map((p) => Math.sign(p.curvature))).toEqual([0, 1, -1, 0])
    expect(1 / pieces[1].curvature).toBeCloseTo(400, 0)
    expect(1 / pieces[2].curvature).toBeCloseTo(-400, 0)
    expectSound(pieces, points, { tolerance: 0.5 })
  })

  it('fits a curve of more than half a turn', () => {
    const truth = alignment([
      [100, 0],
      [200 * 300 * DEG, 1 / 200],
      [100, 0],
    ])
    const points = sample(truth, every(10))
    const pieces = fitPath(points, { tolerance: 0.5 })
    expect(pieces.map((p) => Math.sign(p.curvature))).toEqual([0, 1, 0])
    expect(pieces[1].length).toBeCloseTo(200 * 300 * DEG, 0)
    expectSound(pieces, points, { tolerance: 0.5 })
  })

  it('turns a transition curve into a few arcs of decreasing radius', () => {
    // Straight, 120 m of curvature rising evenly to 1/600, the full curve, and back
    const ramp = (from: number, to: number): [number, number][] =>
      Array.from({ length: 60 }, (_, i) => [2, (from + ((to - from) * (i + 0.5)) / 60) / 600] as [number, number])
    const truth = alignment([[500, 0], ...ramp(0, 1), [400, 1 / 600], ...ramp(1, 0), [500, 0]])
    const points = sample(truth, every(15))
    const pieces = fitPath(points, { tolerance: 0.5 })
    expectSound(pieces, points, { tolerance: 0.5 })
    expect(pieces.length).toBeLessThanOrEqual(7)
    expect(longestArcRadius(pieces, 1)).toBeGreaterThan(590)
    expect(longestArcRadius(pieces, 1)).toBeLessThan(610)
  })
})

describe('fitPath — points 0.3 m off at random, tolerance 0.5 m', () => {
  // The path must pass through its two end points, which are as noisy as the others: when they
  // are far off, one short arc at that end brings the path onto them. So the bound on the number
  // of pieces is the true number plus two.
  const SEEDS = Array.from({ length: 25 }, (_, i) => 1000 + 37 * i)
  const options = { tolerance: 0.5 }

  it('keeps a straight line in at most 3 pieces', () => {
    for (const seed of SEEDS) {
      const points = sample(alignment(STRAIGHT), every(10), osmNoise(seed))
      const pieces = fitPath(points, options)
      expectSound(pieces, points, options)
      expect(pieces.length).toBeLessThanOrEqual(3)
    }
  })

  it('keeps an arc in at most 3 pieces, its radius within 3 %', () => {
    for (const seed of SEEDS) {
      const points = sample(alignment(ARC), every(10), osmNoise(seed))
      const pieces = fitPath(points, options)
      expectSound(pieces, points, options)
      expect(pieces.length).toBeLessThanOrEqual(3)
      expect(Math.abs(longestArcRadius(pieces, 1) / 500 - 1)).toBeLessThan(0.03)
    }
  })

  it('keeps straight – arc – straight in at most 5 pieces, its radius within 3 %', () => {
    for (const seed of SEEDS) {
      const points = sample(alignment(STRAIGHT_ARC_STRAIGHT), every(10), osmNoise(seed))
      const pieces = fitPath(points, options)
      expectSound(pieces, points, options)
      expect(pieces.length).toBeLessThanOrEqual(5)
      expect(Math.abs(longestArcRadius(pieces, 1) / 500 - 1)).toBeLessThan(0.03)
    }
  })

  it('keeps an S-curve in at most 6 pieces, both radii within 3 %', () => {
    for (const seed of SEEDS) {
      const points = sample(alignment(S_CURVE), every(10), osmNoise(seed))
      const pieces = fitPath(points, options)
      expectSound(pieces, points, options)
      expect(pieces.length).toBeLessThanOrEqual(6)
      expect(Math.abs(longestArcRadius(pieces, 1) / 400 - 1)).toBeLessThan(0.03)
      expect(Math.abs(longestArcRadius(pieces, -1) / 400 - 1)).toBeLessThan(0.03)
    }
  })

  it('gives the same pieces for the same points', () => {
    const points = sample(alignment(S_CURVE), every(10), osmNoise(5))
    expect(fitPath(points, options)).toEqual(fitPath(points, options))
  })

  it('follows a station throat: curves of 150 m radius between short straights', () => {
    const truth = alignment([
      [80, 0],
      [60, 1 / 150],
      [40, 0],
      [60, -1 / 150],
      [100, 0],
    ])
    for (const seed of SEEDS) {
      const points = sample(truth, every(4), osmNoise(seed))
      const pieces = fitPath(points, options)
      expectSound(pieces, points, options)
      expect(pieces.length).toBeLessThanOrEqual(12)
    }
  })

  it('follows a high-speed curve of 10 km radius', () => {
    const truth = alignment([
      [3000, 0],
      [2500, 1 / 10000],
      [3000, 0],
    ])
    for (const seed of SEEDS.slice(0, 8)) {
      const points = sample(truth, every(25), osmNoise(seed))
      const pieces = fitPath(points, options)
      expectSound(pieces, points, options)
      expect(pieces.length).toBeLessThanOrEqual(5)
      expect(Math.abs(longestArcRadius(pieces, 1) / 10000 - 1)).toBeLessThan(0.03)
    }
  })
})

describe('fitPath — awkward inputs', () => {
  it('joins two points by one straight piece', () => {
    const pieces = fitPath(
      [
        { x: 10, y: 5 },
        { x: 310, y: 405 },
      ],
      { tolerance: 0.5 },
    )
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({ x: 10, y: 5, curvature: 0 })
    expect(pieces[0].length).toBeCloseTo(500, 9)
    expect(pieces[0].heading).toBeCloseTo(Math.atan2(4, 3), 12)
  })

  it('gives no piece for fewer than two distinct points', () => {
    expect(fitPath([], { tolerance: 0.5 })).toEqual([])
    expect(fitPath([{ x: 1, y: 2 }], { tolerance: 0.5 })).toEqual([])
    expect(
      fitPath(
        [
          { x: 1, y: 2 },
          { x: 1, y: 2 },
        ],
        { tolerance: 0.5 },
      ),
    ).toEqual([])
  })

  it('ignores points repeated in a row', () => {
    const points = sample(alignment(STRAIGHT_ARC_STRAIGHT), every(20))
    const repeated = points.flatMap((p, i) => (i % 3 === 0 ? [p, { ...p }, { ...p }] : [p]))
    const pieces = fitPath(repeated, { tolerance: 0.5 })
    expect(pieces).toEqual(fitPath(points, { tolerance: 0.5 }))
    expectSound(pieces, repeated, { tolerance: 0.5 })
  })

  it('turns a kink of 3° between two straights of 500 m into a short arc', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500 + 500 * Math.cos(3 * DEG), y: 500 * Math.sin(3 * DEG) },
    ]
    const pieces = fitPath(points, { tolerance: 0.5 })
    expect(pieces.map((p) => Math.sign(p.curvature))).toEqual([0, 1, 0])
    // The arc turns by the 3° of the kink and stays within the tolerance of the corner
    expect(pieces[1].curvature * pieces[1].length).toBeCloseTo(3 * DEG, 9)
    expect(pieces[1].length).toBeLessThan(100)
    expectSound(pieces, points, { tolerance: 0.5 })
  })

  it('rounds every corner of a polygon', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 150, y: 80 },
      { x: 260, y: 60 },
      { x: 300, y: -40 },
    ]
    const pieces = fitPath(points, { tolerance: 0.5 })
    expect(pieces.map((p) => Math.sign(p.curvature))).toEqual([0, 1, 0, -1, 0, -1, 0])
    expectSound(pieces, points, { tolerance: 0.5 })
  })

  it('takes points from 5 m to 400 m apart', () => {
    // 400 m of chord on a curve of 10 km radius cuts 2 m inside it: the chord tolerance says the
    // polyline is that coarse, and the curve comes out as one arc
    const truth = alignment([
      [3000, 0],
      [2500, 1 / 10000],
      [1500, 0],
      [600, -1 / 2000],
      [2000, 0],
    ])
    const options = { tolerance: 0.5, chordTolerance: 2.5 }
    for (const seed of [3, 4, 5, 6, 7, 8]) {
      const random = seeded(seed)
      // On the tighter curve a mapper puts its points closer
      let at = 0
      const points = sample(
        truth,
        () => {
          const step = at > 7000 && at < 7600 ? 5 + random() * 95 : 5 + random() * random() * 395
          at += step
          return step
        },
        osmNoise(seed + 50),
      )
      const pieces = fitPath(points, options)
      expectSound(pieces, points, options)
      // Five true pieces; where three points in a row are all that tell of a curve, a few more
      expect(pieces.length).toBeLessThanOrEqual(11)
      expect(Math.abs(longestArcRadius(pieces, 1) / 10000 - 1)).toBeLessThan(0.05)
      expect(Math.abs(longestArcRadius(pieces, -1) / 2000 - 1)).toBeLessThan(0.05)
    }
  })

  it('follows the sides of a coarse polyline unless told how coarse it is', () => {
    // An arc of 500 m radius drawn with a point every 100 m: each side cuts 2.5 m inside the arc
    const points = sample(alignment(ARC), every(100))
    const strict = fitPath(points, { tolerance: 0.5 })
    expectSound(strict, points, { tolerance: 0.5 })
    expect(strict.length).toBeGreaterThan(points.length)
    const loose = fitPath(points, { tolerance: 0.5, chordTolerance: 3 })
    expect(loose).toHaveLength(1)
    expect(1 / loose[0].curvature).toBeCloseTo(500, 3)
    expectSound(loose, points, { tolerance: 0.5, chordTolerance: 3 })
  })

  it('lays a curve flatter than maxRadius as a straight line', () => {
    // 1 km of a curve of 400 km radius: 0.3 m of sagitta
    const points = sample(alignment([[1000, 1 / 400_000]]), every(25))
    expect(fitPath(points, { tolerance: 0.5 }).map((p) => p.curvature)).toEqual([0])
    const curved = fitPath(points, { tolerance: 0.05, maxRadius: 1e6 })
    expect(curved).toHaveLength(1)
    expect(1 / curved[0].curvature).toBeCloseTo(400_000, -2)
  })

  it('rounds a corner no tighter than minRadius, the tolerance giving way', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200 + 200 * Math.cos(20 * DEG), y: 200 * Math.sin(20 * DEG) },
    ]
    // Within the tolerance the corner takes an arc of 26 m radius
    const tight = fitPath(points, { tolerance: 0.5 })
    expectSound(tight, points, { tolerance: 0.5 })
    expect(longestArcRadius(tight, 1)).toBeLessThan(30)
    const wide = fitPath(points, { tolerance: 0.5, minRadius: 300 })
    expectG1(wide)
    expectEnds(wide, points)
    for (const piece of wide) {
      if (piece.curvature !== 0) expect(Math.abs(1 / piece.curvature)).toBeGreaterThan(300 - 1e-6)
    }
    // 300 m of radius over 20° passes 4.6 m inside the corner
    expect(distanceToPath(wide, points[1])).toBeCloseTo(300 * (1 / Math.cos(10 * DEG) - 1), 6)
  })
})

describe('fitPath — imposed directions', () => {
  const unit = (heading: number): Point => ({ x: Math.cos(heading), y: Math.sin(heading) })
  const endHeading = (pieces: FittedPiece[]) => pieceEnd(pieces[pieces.length - 1]).heading
  /** Difference between two directions, whole turns apart or not */
  const turnBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

  it('leaves and arrives along the directions of the track itself without one more piece', () => {
    const truth = alignment(STRAIGHT_ARC_STRAIGHT)
    const last = 0.3 + 40 * DEG
    for (const noise of [() => 0, osmNoise(42)]) {
      const points = sample(truth, every(20), noise)
      const options = { tolerance: 0.5, startTangent: unit(0.3), endTangent: unit(last) }
      const pieces = fitPath(points, options)
      expect(pieces).toHaveLength(3)
      expect(turnBetween(pieces[0].heading, 0.3)).toBeLessThan(1e-9)
      expect(turnBetween(endHeading(pieces), last)).toBeLessThan(1e-9)
      expectSound(pieces, points, options)
    }
  })

  it('leaves along a direction 4° off the points by two short arcs', () => {
    const points = sample(alignment(STRAIGHT_ARC_STRAIGHT), every(20), osmNoise(42))
    const options = { tolerance: 0.5, startTangent: unit(0.3 + 4 * DEG) }
    const pieces = fitPath(points, options)
    expect(turnBetween(pieces[0].heading, 0.3 + 4 * DEG)).toBeLessThan(1e-9)
    expectSound(pieces, points, options)
    expect(pieces.length).toBeLessThanOrEqual(7)
    // The correction is over within a few dozen metres
    expect(pieces[0].length + pieces[1].length).toBeLessThan(60)
  })

  it('arrives along a direction 4° off the points', () => {
    const points = sample(alignment(STRAIGHT_ARC_STRAIGHT), every(20), osmNoise(42))
    const wanted = 0.3 + 40 * DEG - 4 * DEG
    const options = { tolerance: 0.5, endTangent: unit(wanted) }
    const pieces = fitPath(points, options)
    expect(turnBetween(endHeading(pieces), wanted)).toBeLessThan(1e-9)
    expectSound(pieces, points, options)
    expect(pieces.length).toBeLessThanOrEqual(7)
  })

  it('joins two points and two directions by two tangent arcs', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
    ]
    // Both directions 0.2° to the same side of the chord: an S that stays 0.2 m from it
    const tangent = unit(0.2 * DEG)
    const options = { tolerance: 0.5, startTangent: { x: 2 * tangent.x, y: 2 * tangent.y }, endTangent: tangent }
    const pieces = fitPath(points, options)
    expect(pieces.map((p) => Math.sign(p.curvature))).toEqual([-1, 1])
    expect(pieces[0].heading).toBeCloseTo(0.2 * DEG, 12)
    expect(turnBetween(endHeading(pieces), 0.2 * DEG)).toBeLessThan(1e-9)
    expectSound(pieces, points, options)
  })

  it('joins two points by one arc when the two directions are those of an arc', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
    ]
    const options = { tolerance: 0.5, startTangent: unit(0.2 * DEG), endTangent: unit(-0.2 * DEG) }
    const pieces = fitPath(points, options)
    expect(pieces).toHaveLength(1)
    expect(1 / pieces[0].curvature).toBeCloseTo(-250 / Math.sin(0.2 * DEG), 3)
    expectSound(pieces, points, options)
  })

  it('keeps to the chord of two points whose directions are far off it', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 500, y: 100 },
    ]
    const options = { tolerance: 0.5, startTangent: { x: 1, y: 0 }, endTangent: { x: 1, y: 0 } }
    const pieces = fitPath(points, options)
    // Two arcs at each end, a few metres long, and the chord between them
    expect(pieces.map((p) => Math.sign(p.curvature))).toEqual([1, -1, 0, 1, -1])
    expect(pieces[0].heading).toBeCloseTo(0, 12)
    expect(turnBetween(endHeading(pieces), 0)).toBeLessThan(1e-9)
    expect(pieces[2].length).toBeGreaterThan(480)
    expectSound(pieces, points, options)
  })

  it('needs no arc when the direction is the one of the points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 300, y: 400 },
    ]
    const pieces = fitPath(points, { tolerance: 0.5, startTangent: { x: 3, y: 4 }, endTangent: { x: 3, y: 4 } })
    expect(pieces).toHaveLength(1)
    expect(pieces[0].curvature).toBe(0)
  })
})

describe('fitPath — a long line', () => {
  /** About 40 km: straights of 0.8 to 3.3 km, curves of 4 to 7 km radius and short ones of 800 m */
  function longLine(): FittedPiece[] {
    const random = seeded(3)
    const elements: [number, number][] = []
    for (let length = 0; length < 40_000; ) {
      const straight = 800 + random() * 2500
      const tight = random() < 0.3
      const radius = tight ? 800 : 4000 + random() * 3000
      const arc = (tight ? 250 : 900) + random() * 800
      elements.push([straight, 0], [arc, (random() < 0.5 ? 1 : -1) / radius])
      length += straight + arc
    }
    return alignment(elements)
  }

  it('reduces 40 km sampled every 30 to 100 m with noise to its straights and arcs (654 points → 28 pieces)', () => {
    const truth = longLine()
    const random = seeded(11)
    const points = sample(
      truth,
      () => 30 + random() * 70,
      () => (random() - 0.5) * 0.6,
    )
    // 100 m of chord on a curve of 800 m radius cuts 1.6 m inside it
    const options = { tolerance: 0.5, chordTolerance: 2 }
    const pieces = fitPath(points, options)
    expectSound(pieces, points, options)
    expect(truth).toHaveLength(26)
    expect(points.length).toBeGreaterThan(600)
    // The 26 true pieces, and an arc at each end to reach the noisy end points
    expect(pieces.length).toBeLessThanOrEqual(30)
    expect(points.length / pieces.length).toBeGreaterThan(20)
    // Every true curve is found again, its radius within 2 %
    for (const curve of truth.filter((p) => p.curvature !== 0)) {
      const middle = pointOnPath([curve], curve.length / 2)
      const found = pieces.reduce((a, b) => (distanceToPath([a], middle) <= distanceToPath([b], middle) ? a : b))
      expect(Math.abs(curve.curvature / found.curvature - 1)).toBeLessThan(0.02)
    }
  })

  it('stays within the tolerance of the sides of the same polyline when not told how coarse it is', () => {
    const random = seeded(11)
    const points = sample(
      longLine(),
      () => 30 + random() * 70,
      () => (random() - 0.5) * 0.6,
    )
    const pieces = fitPath(points, { tolerance: 0.5 })
    expectSound(pieces, points, { tolerance: 0.5 })
    // The curves are followed side by side: more pieces, still far fewer than points
    expect(pieces.length).toBeLessThan(points.length / 3)
  })

  it('fits 5 000 points in well under a second', () => {
    const random = seeded(5)
    const line = longLine()
    const truth = alignment([...line, ...line, ...line, ...line].map((p) => [p.length, p.curvature / 4] as [number, number]))
    const points = sample(
      truth,
      () => 5 + random() * 55,
      () => (random() - 0.5) * 0.6,
    )
    expect(points.length).toBeGreaterThan(5000)
    const options = { tolerance: 0.5, chordTolerance: 2 }
    const started = performance.now()
    const pieces = fitPath(points, options)
    const elapsed = performance.now() - started
    expectG1(pieces)
    expectEnds(pieces, points)
    expect(pieces.length).toBeLessThanOrEqual(110)
    // 0.2 to 0.5 s on a laptop; the bound leaves room for a machine busy with the rest of the suite
    expect(elapsed).toBeLessThan(2000)
  })
})

describe('fitPath — real track (Marseille Saint-Charles, from OpenStreetMap)', () => {
  interface RawSegment {
    id: string
    from: string
    to: string
    kind?: string
    via?: Point
  }

  /** Every run of rails between two nodes that are not plain joints, as the points of its rails */
  function chains(): { rails: number; points: Point[] }[] {
    const file = fileURLToPath(new URL('../../examples/marseille-saint-charles.json', import.meta.url))
    const project = JSON.parse(readFileSync(file, 'utf8')) as { nodes: (Point & { id: string })[]; segments: RawSegment[] }
    const nodes = new Map(project.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
    const around = new Map<string, RawSegment[]>()
    for (const seg of project.segments) {
      for (const id of [seg.from, seg.to]) around.set(id, [...(around.get(id) ?? []), seg])
    }
    const used = new Set<string>()
    const out: { rails: number; points: Point[] }[] = []
    for (const [start, segs] of around) {
      if (segs.length === 2) continue
      for (const first of segs) {
        if (used.has(first.id)) continue
        const points: Point[] = [nodes.get(start) as Point]
        let rails = 0
        let at = start
        let seg = first
        for (;;) {
          used.add(seg.id)
          rails++
          const forward = seg.from === at
          const a = nodes.get(forward ? seg.from : seg.to) as Point
          const b = nodes.get(forward ? seg.to : seg.from) as Point
          // A curved rail is sampled: a point every eighth of its parameter
          if (seg.kind === 'curve' && seg.via) {
            for (let k = 1; k < 8; k++) points.push(bezierPoint(k / 8, a, seg.via, b))
          }
          points.push(b)
          at = forward ? seg.to : seg.from
          const next = around.get(at) as RawSegment[]
          if (next.length !== 2) break
          seg = next[0].id === seg.id ? next[1] : next[0]
          if (used.has(seg.id)) break
        }
        out.push({ rails, points })
      }
    }
    return out
  }

  it('turns its chains of rails into fewer pieces within 0.3 m (1 503 rails → 786 pieces; chains of 15 rails and more: 487 → 159)', () => {
    const options = { tolerance: 0.3 }
    let rails = 0
    let pieces = 0
    let longRails = 0
    let longPieces = 0
    const all = chains()
    for (const chain of all) {
      const fitted = fitPath(chain.points, options)
      expectSound(fitted, chain.points, options)
      rails += chain.rails
      pieces += fitted.length
      if (chain.rails >= 15) {
        longRails += chain.rails
        longPieces += fitted.length
      }
    }
    // The station is mostly points and crossings: 288 chains, most of them of one to three rails,
    // each already a curve through several mapped points. The long chains are where rails are saved.
    expect(all).toHaveLength(288)
    expect(rails).toBe(1503)
    expect(pieces).toBeLessThan(rails * 0.6)
    expect(longRails).toBe(487)
    expect(longPieces).toBeLessThan(longRails / 2.5)
  })
})
