import { describe, expect, it } from 'vitest'
import { CURVE_RADII, CURVE_PROFILES, snapRadius, radiusFromSagitta, arcToVia } from './profiles'

describe('CURVE_RADII', () => {
  it('is ordered from tightest to widest', () => {
    for (let i = 1; i < CURVE_RADII.length; i++) {
      expect(CURVE_RADII[i]).toBeGreaterThanOrEqual(CURVE_RADII[i - 1])
    }
  })

  it('includes Infinity (straight) as last', () => {
    expect(CURVE_RADII[CURVE_RADII.length - 1]).toBe(Infinity)
  })

  it('includes HO standard radii', () => {
    expect(CURVE_RADII).toContain(430)
    expect(CURVE_RADII).toContain(550)
    expect(CURVE_RADII).toContain(867)
  })
})

describe('CURVE_PROFILES', () => {
  it('has labels matching radii', () => {
    expect(CURVE_PROFILES[0].label).toBe('R430')
    expect(CURVE_PROFILES[CURVE_PROFILES.length - 1].label).toBe('Straight')
  })
})

describe('snapRadius', () => {
  it('snaps to closest predefined radius', () => {
    expect(snapRadius(440)).toBe(430)
    expect(snapRadius(470)).toBe(490)
    expect(snapRadius(560)).toBe(550)
    expect(snapRadius(800)).toBe(790)
  })

  it('returns Infinity for very large values', () => {
    expect(snapRadius(1e9)).toBe(Infinity)
  })

  it('returns Infinity for Infinity input', () => {
    expect(snapRadius(Infinity)).toBe(Infinity)
  })
})

describe('radiusFromSagitta', () => {
  it('returns Infinity for zero sagitta (straight)', () => {
    expect(radiusFromSagitta(100, 0)).toBe(Infinity)
  })

  it('returns Infinity for zero chord', () => {
    expect(radiusFromSagitta(0, 10)).toBe(Infinity)
  })

  it('computes correct radius for known arc', () => {
    // Chord = 10, sagitta = 1 → R = (1 + 25) / 2 = 13
    const r = radiusFromSagitta(10, 1)
    expect(r).toBeCloseTo(13)
  })
})

describe('arcToVia', () => {
  it('returns midpoint for straight (Infinity radius)', () => {
    const via = arcToVia({ x: 0, y: 0 }, { x: 10, y: 0 }, Infinity, 1)
    expect(via.x).toBeCloseTo(5)
    expect(via.y).toBeCloseTo(0)
  })

  it('returns midpoint for zero chord', () => {
    const via = arcToVia({ x: 5, y: 5 }, { x: 5, y: 5 }, 200, 1)
    expect(via).toEqual({ x: 5, y: 5 })
  })

  it('offsets via perpendicular to chord for curved arc', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 10, y: 0 }
    const via = arcToVia(start, end, 200, 1)
    // Via should be above the chord (negative y is up in world coords, but
    // perpendicular to (1,0) is (0,1) for side=1, so via.y should be positive)
    expect(via.x).toBeCloseTo(5)
    expect(via.y).toBeGreaterThan(0)
  })

  it('side -1 flips the offset direction', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 10, y: 0 }
    const viaPos = arcToVia(start, end, 200, 1)
    const viaNeg = arcToVia(start, end, 200, -1)
    expect(viaPos.y).toBeGreaterThan(0)
    expect(viaNeg.y).toBeLessThan(0)
    expect(viaPos.x).toBeCloseTo(viaNeg.x)
  })

  it('clamps when chord exceeds diameter', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 500, y: 0 }
    const via = arcToVia(start, end, 150, 1)
    // Should not crash, via should be offset but clamped
    expect(via.x).toBeCloseTo(250)
    expect(via.y).toBeGreaterThan(0)
  })
})
