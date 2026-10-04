import { describe, expect, it } from 'vitest'
import { placementThresholds, scaleFactor } from './scale'
import { reconcileNetworkIntersections } from './reconcile'
import { computeReverseFreeNodeLock, computeTurnoutIntersectionLock } from './tangent'
import { computeFreeformParallelTurnout } from './constructionTemplates'
import { computeFreeformCurve, computeReverseFreeformCurve, STANDARD_GAUGE } from '../profiles/profiles'
import { addNode, addSegment, createNetwork, getStepPointsAlongSegment } from '../models/network'

const HO_GAUGE = 0.0165

describe('placementThresholds', () => {
  it('returns the historical 1:1 values at standard gauge', () => {
    const th = placementThresholds()
    expect(th.k).toBe(1)
    expect(th.reconcileTolerance).toBeCloseTo(0.1)
    expect(th.minChord).toBe(5)
    expect(th.minRadius).toBe(15)
    expect(th.minReverseLockRadius).toBe(20)
    expect(th.minLockAdvance).toBe(0.5)
    expect(th.minLockPerp).toBeCloseTo(0.2)
    expect(th.minTurnoutAdvance).toBe(2)
    expect(th.minTurnoutOffset).toBeCloseTo(0.2)
    expect(th.stepMargin).toBeCloseTo(0.2)
    expect(placementThresholds(STANDARD_GAUGE)).toEqual(th)
  })

  it('scales every threshold with the gauge', () => {
    const k = HO_GAUGE / STANDARD_GAUGE
    const th = placementThresholds(HO_GAUGE)
    expect(scaleFactor(HO_GAUGE)).toBeCloseTo(k)
    expect(th.reconcileTolerance).toBeCloseTo(0.1 * k)
    expect(th.minChord).toBeCloseTo(5 * k)
    expect(th.minRadius).toBeCloseTo(15 * k)
    expect(th.stepMargin).toBeCloseTo(0.2 * k)
  })

  it('keeps the detach gap strictly above the reconcile tolerance at any scale', () => {
    for (const gauge of [STANDARD_GAUGE, HO_GAUGE, 0.009, 0.0065]) {
      const th = placementThresholds(gauge)
      expect(th.detachGap).toBeGreaterThan(th.reconcileTolerance)
    }
  })

  it('falls back to 1:1 for a non-positive or invalid gauge', () => {
    expect(scaleFactor(0)).toBe(1)
    expect(scaleFactor(NaN)).toBe(1)
  })
})

describe('model-scale behaviour (HO)', () => {
  const th = placementThresholds(HO_GAUGE)

  it('computeFreeformCurve produces a real curve at HO sizes with the scaled chord guard', () => {
    // 30 cm chord, 45° off the tangent: a 90° arc of radius ~21 cm
    const target = { x: 0.2121, y: 0.2121 }
    const withDefault = computeFreeformCurve({ x: 0, y: 0 }, { x: 1, y: 0 }, target)
    expect(withDefault.radius).toBe(Infinity) // the 1:1 guard (5 m) swallows it

    const scaled = computeFreeformCurve({ x: 0, y: 0 }, { x: 1, y: 0 }, target, th.minChord)
    expect(scaled.radius).toBeCloseTo(0.2121, 3)
    expect(scaled.angle).toBeCloseTo(90, 3)
  })

  it('computeReverseFreeformCurve produces a real curve at HO sizes with the scaled chord guard', () => {
    const scaled = computeReverseFreeformCurve({ x: 0, y: 0 }, { x: 0.2121, y: 0.2121 }, { x: 0, y: 1 }, th.minChord)
    expect(Number.isFinite(scaled.radius)).toBe(true)
    expect(scaled.angle).toBeCloseTo(90, 3)
  })

  it('reconcile leaves two parallel tracks 5 cm apart alone with the scaled tolerance', () => {
    const build = () => {
      const net = createNetwork()
      const a1 = addNode(net, { x: 0, y: 0 })
      const a2 = addNode(net, { x: 1, y: 0 })
      addSegment(net, a1.id, a2.id)
      // Second track 50 mm away, its ends facing the interior of the first one
      const b1 = addNode(net, { x: 0.3, y: 0.05 })
      const b2 = addNode(net, { x: 0.7, y: 0.05 })
      addSegment(net, b1.id, b2.id)
      return net
    }

    const broken = build()
    const resDefault = reconcileNetworkIntersections(broken)
    expect(resDefault.splitCount + resDefault.weldedCount).toBeGreaterThan(0) // the defect, with the 1:1 tolerance

    const net = build()
    const res = reconcileNetworkIntersections(net, th.reconcileTolerance)
    expect(res).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(net.segments.size).toBe(2)
    expect(net.nodes.size).toBe(4)
  })

  it('reconcile still welds a node lying on a track at HO', () => {
    const net = createNetwork()
    const a1 = addNode(net, { x: 0, y: 0 })
    const a2 = addNode(net, { x: 1, y: 0 })
    addSegment(net, a1.id, a2.id)
    const b1 = addNode(net, { x: 0.5, y: 0.0005 })
    const b2 = addNode(net, { x: 0.7, y: 0.2 })
    addSegment(net, b1.id, b2.id)
    const res = reconcileNetworkIntersections(net, th.reconcileTolerance)
    expect(res.splitCount).toBe(1)
    expect(net.adjacency.get(b1.id)?.length).toBe(3)
  })

  it('computeTurnoutIntersectionLock accepts an HO-sized lock with scaled limits only', () => {
    // Start heading east, rail running north 30 cm ahead: 90° lock of radius 30 cm
    const args = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.3, y: 0.3 }, { x: 0, y: 1 }] as const
    expect(computeTurnoutIntersectionLock(...args)).toBeNull() // t = 0.3 < 0.5 m
    const lock = computeTurnoutIntersectionLock(...args, th)
    expect(lock).not.toBeNull()
    expect(lock!.radius).toBeCloseTo(0.3, 6)
    expect(lock!.valid).toBe(true)
  })

  it('computeTurnoutIntersectionLock rejects a radius below the scaled minimum', () => {
    const lock = computeTurnoutIntersectionLock({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.1, y: 0.1 }, { x: 0, y: 1 }, th)
    expect(lock).not.toBeNull()
    expect(lock!.radius).toBeLessThan(th.minRadius)
    expect(lock!.valid).toBe(false)
  })

  it('computeReverseFreeNodeLock works 10 cm away from the rail with scaled limits only', () => {
    const args = [{ x: 0, y: 0.1 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, 0.4] as const
    expect(computeReverseFreeNodeLock(...args)).toBeNull() // 0.1 m < 0.2 m
    const lock = computeReverseFreeNodeLock(...args, th)
    expect(lock).not.toBeNull()
    expect(lock!.radius).toBeCloseTo(0.4, 6) // not forced up to 20 m
  })

  it('computeFreeformParallelTurnout follows the cursor at HO with scaled limits', () => {
    // 30 cm advance, 5 cm offset
    const unscaled = computeFreeformParallelTurnout({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.3, y: 0.05 })
    expect(unscaled!.dx).toBe(2) // clamped to 2 m: unusable
    const geom = computeFreeformParallelTurnout({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.3, y: 0.05 }, th)
    expect(geom!.dx).toBeCloseTo(0.3, 6)
    expect(geom!.offset).toBeCloseTo(0.05, 6)
    expect(geom!.valid).toBe(true)
  })

  it('getStepPointsAlongSegment yields steps on a 15 cm segment with the scaled margin', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0.01, y: 0 })
    const b = addNode(net, { x: 0.16, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    expect(getStepPointsAlongSegment(seg.id, net, 0.05, { x: 0.08, y: 0 }).points.length).toBe(0)
    const res = getStepPointsAlongSegment(seg.id, net, 0.05, { x: 0.08, y: 0 }, th.stepMargin)
    expect(res.points.length).toBeGreaterThan(0)
    expect(res.nearest).not.toBeNull()
  })
})
