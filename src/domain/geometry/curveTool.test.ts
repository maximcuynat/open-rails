import { describe, expect, it } from 'vitest'
import { computeCurveToolGeometry, curveSide, type CurveToolInput } from './curveTool'
import { minCurveRadius, MAX_ARC_PIECE_DEG } from './curve'
import { placementThresholds } from './scale'
import { computeTurnoutIntersectionLock, computeReverseFreeNodeLock } from './tangent'
import { computeCurvePiece, computeFreeformCurve, computeReverseFreeformCurve } from '../profiles/profiles'

const base: CurveToolInput = {
  startPos: { x: 0, y: 0 },
  startTangent: { x: 1, y: 0 },
  fallbackTangent: { x: 1, y: 0 },
  trackTarget: null,
  cursor: { x: 100, y: 40 },
  trackMode: 'catalog',
  radius: 500,
  angle: 90,
  side: 'auto',
}

describe('curveSide', () => {
  it('returns 1 for a target on the +y side of the direction and -1 on the other', () => {
    expect(curveSide({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 5 })).toBe(1)
    expect(curveSide({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 10, y: -5 })).toBe(-1)
  })
})

describe('computeCurveToolGeometry', () => {
  it('catalog mode: selected radius and angle, side towards the cursor, same geometry as computeCurvePiece', () => {
    const geom = computeCurveToolGeometry(base)
    const ref = computeCurvePiece(base.startPos, { x: 1, y: 0 }, 500, 1, 90)
    expect(geom.kind).toBe('catalog')
    expect(geom.side).toBe(1)
    expect(geom.end).toEqual(ref.end)
    expect(geom.via).toEqual(ref.via)
    expect(geom.radius).toBe(500)
    expect(geom.angle).toBe(90)
    expect(geom.valid).toBe(true)

    expect(computeCurveToolGeometry({ ...base, cursor: { x: 100, y: -40 } }).side).toBe(-1)
    expect(computeCurveToolGeometry({ ...base, cursor: { x: 100, y: -40 }, side: 1 }).side).toBe(1)
  })

  it('returns the arc pieces that will be inserted: 90° at R500 within 1% of the circle', () => {
    const geom = computeCurveToolGeometry(base)
    expect(geom.pieces.length).toBe(90 / MAX_ARC_PIECE_DEG)
    for (const p of geom.pieces) {
      expect(Math.abs(minCurveRadius(p.start, p.via, p.end) - 500) / 500).toBeLessThan(0.01)
    }
    expect(geom.pieces[0].start).toEqual(base.startPos)
    expect(geom.pieces[geom.pieces.length - 1].end).toEqual(geom.end)
    expect(geom.length).toBeCloseTo((500 * Math.PI) / 2, 0)
  })

  it('freeform mode: arc from the start tangent through the cursor', () => {
    const geom = computeCurveToolGeometry({ ...base, trackMode: 'freeform', cursor: { x: 100, y: 100 } })
    const ref = computeFreeformCurve(base.startPos, { x: 1, y: 0 }, { x: 100, y: 100 })
    expect(geom.kind).toBe('freeform')
    expect(geom.via).toEqual(ref.via)
    expect(geom.radius).toBeCloseTo(100)
    expect(geom.angle).toBeCloseTo(90)
    expect(geom.valid).toBe(true)
  })

  it('uses the fallback tangent when the start is free', () => {
    const geom = computeCurveToolGeometry({
      ...base,
      startTangent: null,
      fallbackTangent: { x: 0, y: 1 },
      trackMode: 'freeform',
      cursor: { x: 100, y: 100 },
    })
    expect(geom.via.x).toBeCloseTo(0)
    expect(geom.via.y).toBeCloseTo(100)
  })

  it('track under the cursor with a start tangent: tangent lock on both ends', () => {
    const trackTarget = { pointOnTrack: { x: 300, y: 250 }, tangent: { x: 0, y: 1 } }
    const geom = computeCurveToolGeometry({ ...base, trackTarget })
    const lock = computeTurnoutIntersectionLock(base.startPos, { x: 1, y: 0 }, trackTarget.pointOnTrack, trackTarget.tangent)!
    expect(geom.kind).toBe('lock')
    expect(geom.end).toEqual(lock.lockPoint)
    expect(geom.via).toEqual(lock.via)
    expect(geom.radius).toBeCloseTo(300)
    expect(geom.angle).toBeCloseTo(90)
    expect(geom.valid).toBe(true)
  })

  it('free start in catalog mode locks on the rail with the selected radius, not in freeform mode', () => {
    const trackTarget = { pointOnTrack: { x: 200, y: 0 }, tangent: { x: 1, y: 0 } }
    const input = { ...base, startPos: { x: 0, y: 50 }, startTangent: null, trackTarget, radius: 300 }
    const catalog = computeCurveToolGeometry(input)
    const lock = computeReverseFreeNodeLock(input.startPos, trackTarget.pointOnTrack, trackTarget.tangent, 300)!
    expect(catalog.kind).toBe('lock')
    expect(catalog.end).toEqual(lock.lockPoint)
    expect(catalog.radius).toBe(300)

    const freeform = computeCurveToolGeometry({ ...input, trackMode: 'freeform' })
    const ref = computeReverseFreeformCurve(input.startPos, trackTarget.pointOnTrack, trackTarget.tangent)
    expect(freeform.kind).toBe('reverse')
    expect(freeform.end).toEqual(ref.end)
    expect(freeform.via).toEqual(ref.via)
  })

  it('falls back to the reverse curve when no lock exists (parallel tracks)', () => {
    const trackTarget = { pointOnTrack: { x: 200, y: 60 }, tangent: { x: 1, y: 0 } }
    const geom = computeCurveToolGeometry({ ...base, trackTarget })
    expect(geom.kind).toBe('reverse')
    expect(geom.end).toEqual(trackTarget.pointOnTrack)
  })

  it('refuses a curve below the minimum radius in every mode', () => {
    // Catalog radius under the 1:1 minimum (15 m)
    const catalog = computeCurveToolGeometry({ ...base, radius: 10, angle: 30 })
    expect(catalog.valid).toBe(false)
    expect(computeCurveToolGeometry({ ...base, radius: 15, angle: 30 }).valid).toBe(true)

    // Freeform: 90° arc of radius 8 m
    const freeform = computeCurveToolGeometry({ ...base, trackMode: 'freeform', cursor: { x: 8, y: 8 } })
    expect(freeform.radius).toBeCloseTo(8)
    expect(freeform.valid).toBe(false)

    // Track target whose lock would be 10 m: the lock is rejected and the fallback is too tight as well
    const trackTarget = { pointOnTrack: { x: 10, y: 10 }, tangent: { x: 0, y: 1 } }
    const onTrack = computeCurveToolGeometry({ ...base, trackTarget })
    expect(onTrack.kind).toBe('reverse')
    expect(onTrack.valid).toBe(false)
  })

  it('a straight result (no deflection) is always valid', () => {
    const geom = computeCurveToolGeometry({ ...base, trackMode: 'freeform', cursor: { x: 50, y: 0 } })
    expect(geom.radius).toBe(Infinity)
    expect(geom.valid).toBe(true)
    expect(geom.pieces.length).toBe(1)
  })

  it('checks the real radius of the pieces when the curve is not a true arc', () => {
    // Cursor behind the start: computeFreeformCurve clamps the tangent-chord angle at 85°,
    // the nominal radius is ~15.4 m but the resulting parabola is much tighter
    const geom = computeCurveToolGeometry({ ...base, trackMode: 'freeform', cursor: { x: -25, y: 18 } })
    expect(geom.radius).toBeGreaterThan(15)
    expect(Math.min(...geom.pieces.map((p) => minCurveRadius(p.start, p.via, p.end)))).toBeLessThan(15)
    expect(geom.valid).toBe(false)
  })

  it('scales with the gauge: an HO curve of radius 36 cm is valid, 10 cm is not', () => {
    const limits = placementThresholds(0.0165)
    const ho = { ...base, trackMode: 'freeform' as const, limits }
    const ok = computeCurveToolGeometry({ ...ho, cursor: { x: 0.36, y: 0.36 } })
    expect(ok.radius).toBeCloseTo(0.36)
    expect(ok.angle).toBeCloseTo(90)
    expect(ok.pieces.length).toBe(6)
    expect(ok.valid).toBe(true)

    const tooTight = computeCurveToolGeometry({ ...ho, cursor: { x: 0.1, y: 0.1 } })
    expect(tooTight.radius).toBeCloseTo(0.1)
    expect(tooTight.valid).toBe(false)

    // Without the scaled limits the same HO curve degenerates into a straight line
    const unscaled = computeCurveToolGeometry({ ...ho, limits: undefined, cursor: { x: 0.36, y: 0.36 } })
    expect(unscaled.radius).toBe(Infinity)
  })
})
