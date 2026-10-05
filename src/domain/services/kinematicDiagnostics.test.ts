import { describe, it, expect } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment, segmentGradient } from '../models/network'
import { analyzeKinematics, computeTransitionAngleDeg } from './kinematicDiagnostics'
import { MAX_TRANSITION_DEFLECTION_DEG } from '../geometry/tangent'
import { placementThresholds } from '../geometry/scale'
import { autoDetectJunctions } from '../models/junction'
import { isTransitionAllowed } from './pathfinding'

describe('kinematicDiagnostics', () => {
  it('calculates deflection angle correctly', () => {
    // Two opposite vectors (straight line): d1 = (1, 0), d2 = (-1, 0)
    // Train continues straight ahead => deflection should be 0°
    expect(computeTransitionAngleDeg({ x: 1, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(0, 1)

    // Right turn: d1 = (1, 0), d2 = (0, 1)
    expect(computeTransitionAngleDeg({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 1)

    // Complete reversal / hairpin: d1 = (1, 0), d2 = (1, 0)
    expect(computeTransitionAngleDeg({ x: 1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180, 1)
  })

  it('detects no issue on a smooth straight track', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const n3 = addNode(net, { x: 200, y: 0 })
    addSegment(net, n1.id, n2.id)
    addSegment(net, n2.id, n3.id)

    const issues = analyzeKinematics(net)
    expect(issues).toHaveLength(0)
  })

  it('detects a sharp turn (broken joint) between two segments', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    // 90° sharp turn at n2
    const n3 = addNode(net, { x: 100, y: 100 })
    addSegment(net, n1.id, n2.id)
    addSegment(net, n2.id, n3.id)

    const issues = analyzeKinematics(net)
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('sharp_turn')
    expect(issues[0].nodeId).toBe(n2.id)
    expect(issues[0].angleDeg).toBe(90)
    expect(issues[0].severity).toBe('error')
  })

  it('detects an invalid 3-rail intersection with no continuous route', () => {
    const net = createNetwork()
    // 3 tracks entering from right in a sharp fan (e.g. 0°, 30°, 60°) meeting at center
    const center = addNode(net, { x: 0, y: 0 })
    const b1 = addNode(net, { x: 100, y: 0 })
    const b2 = addNode(net, { x: 100, y: 50 })
    const b3 = addNode(net, { x: 100, y: 100 })

    addSegment(net, center.id, b1.id)
    addSegment(net, center.id, b2.id)
    addSegment(net, center.id, b3.id)

    const issues = analyzeKinematics(net)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some(i => i.kind === 'invalid_turnout')).toBe(true)
  })

  it('validates a correct railway turnout', () => {
    const net = createNetwork()
    // Stem from left: (-100, 0) -> (0, 0)
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    // Straight route: (0, 0) -> (100, 0)
    const straight = addNode(net, { x: 100, y: 0 })
    // Diverging route with gentle angle (e.g. 10°): (0, 0) -> (100, 17.6)
    const diverging = addNode(net, { x: 100, y: 17.6 })

    addSegment(net, stem.id, apex.id)
    addSegment(net, apex.id, straight.id)
    addSegment(net, apex.id, diverging.id)

    const issues = analyzeKinematics(net)
    // A gentle turnout has through angle = 0° and diverging angle = 10°, no error!
    expect(issues).toHaveLength(0)
  })

  it('validates a diamond crossing (X intersection of 2 lines) without kinematic errors', () => {
    const net = createNetwork()
    // Center crossing node
    const center = addNode(net, { x: 0, y: 0 })
    // Horizontal line
    const w = addNode(net, { x: -100, y: 0 })
    const e = addNode(net, { x: 100, y: 0 })
    addSegment(net, w.id, center.id)
    addSegment(net, center.id, e.id)

    // Vertical line (or 45° line)
    const s = addNode(net, { x: 0, y: -100 })
    const n = addNode(net, { x: 0, y: 100 })
    addSegment(net, s.id, center.id)
    addSegment(net, center.id, n.id)

    const issues = analyzeKinematics(net)
    // Both lines continue straight ahead, crossing is valid and traversable!
    expect(issues).toHaveLength(0)
  })

  it('validates an incomplete 2-rail turnout apex (co-directional branches without stem) without false 180° sharp_turn error', () => {
    const net = createNetwork()
    // Apex at (0, 0), two tracks going right: straight (100, 0) and diverging ~10° (100, 17.6)
    // The stem from the left has NOT been constructed yet.
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 100, y: 0 })
    const diverging = addNode(net, { x: 100, y: 17.6 })

    addSegment(net, apex.id, straight.id)
    addSegment(net, apex.id, diverging.id)

    const issues = analyzeKinematics(net)
    // Must NOT flag a 180° hairpin cassure! It is reported as what it is: a fork still missing its stem,
    // which no train can pass through.
    expect(issues.some((i) => i.kind === 'sharp_turn' || i.severity === 'error')).toBe(false)
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('invalid_turnout')
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].nodeId).toBe(apex.id)
  })

  it('validates a complete 3-way turnout (degree 4) without false excess-rails or invalid_turnout error', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 100, y: 0 })
    const left = addNode(net, { x: 98, y: 17 })
    const right = addNode(net, { x: 98, y: -17 })

    addSegment(net, stem.id, apex.id)
    addSegment(net, apex.id, straight.id)
    addSegment(net, apex.id, left.id)
    addSegment(net, apex.id, right.id)

    const issues = analyzeKinematics(net)
    expect(issues).toHaveLength(0)
  })

  it('flags an incomplete 3-branch fan without stem as invalid_turnout', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 100, y: 0 })
    const left = addNode(net, { x: 98, y: 17 })
    const right = addNode(net, { x: 98, y: -17 })

    addSegment(net, apex.id, straight.id)
    addSegment(net, apex.id, left.id)
    addSegment(net, apex.id, right.id)

    const issues = analyzeKinematics(net)
    expect(issues.some(i => i.kind === 'invalid_turnout')).toBe(true)
  })

  it('flags an incoherent 4-rail node as excess-rails when it is neither crossing nor 3-way turnout', () => {
    const net = createNetwork()
    const center = addNode(net, { x: 0, y: 0 })
    // 4 branches: 0°, 60°, 120°, 200° (no collinear pairs, not co-directional)
    const n1 = addNode(net, { x: 100, y: 0 })
    const n2 = addNode(net, { x: 50, y: 86 })
    const n3 = addNode(net, { x: -50, y: 86 })
    const n4 = addNode(net, { x: -94, y: -34 })

    addSegment(net, center.id, n1.id)
    addSegment(net, center.id, n2.id)
    addSegment(net, center.id, n3.id)
    addSegment(net, center.id, n4.id)

    const issues = analyzeKinematics(net)
    expect(issues.some(i => i.id.startsWith('excess-rails'))).toBe(true)
  })

  describe('transition deflection limit', () => {
    /** Two rails joined at the origin, the second one turned by `angleDeg` */
    function corner(angleDeg: number) {
      const net = createNetwork()
      const a = addNode(net, { x: -100, y: 0 })
      const c = addNode(net, { x: 0, y: 0 })
      const r = (angleDeg * Math.PI) / 180
      const e = addNode(net, { x: 100 * Math.cos(r), y: 100 * Math.sin(r) })
      addSegment(net, a.id, c.id)
      addSegment(net, c.id, e.id)
      return { net, cornerId: c.id }
    }

    it('reports every corner sharper than the limit, and none within it', () => {
      for (const angle of [0, 5, MAX_TRANSITION_DEFLECTION_DEG]) {
        expect(analyzeKinematics(corner(angle).net)).toHaveLength(0)
      }
      for (const angle of [MAX_TRANSITION_DEFLECTION_DEG + 1, 20, 30, 45, 90]) {
        const { net, cornerId } = corner(angle)
        const issues = analyzeKinematics(net)
        expect(issues).toHaveLength(1)
        expect(issues[0].kind).toBe('sharp_turn')
        expect(issues[0].nodeId).toBe(cornerId)
        expect(issues[0].angleDeg).toBe(angle)
      }
    })

    it('reports the branch of a perpendicular T', () => {
      const net = createNetwork()
      const w = addNode(net, { x: -200, y: 0 })
      const c = addNode(net, { x: 0, y: 0 })
      const e = addNode(net, { x: 200, y: 0 })
      const n = addNode(net, { x: 0, y: 200 })
      addSegment(net, w.id, c.id)
      addSegment(net, c.id, e.id)
      addSegment(net, c.id, n.id)

      const issues = analyzeKinematics(net)
      expect(issues).toHaveLength(1)
      expect(issues[0].kind).toBe('sharp_turn')
      expect(issues[0].nodeId).toBe(c.id)
      expect(issues[0].angleDeg).toBe(90)
    })
  })

  describe('gap between two facing rail ends', () => {
    /** Two collinear rails along y=0 whose facing ends are `gap` apart, lengths in units of `k` */
    function facingEnds(gap: number, k = 1) {
      const net = createNetwork()
      const a = addNode(net, { x: -100 * k, y: 0 })
      const b = addNode(net, { x: 0, y: 0 })
      const c = addNode(net, { x: gap, y: 0 })
      const d = addNode(net, { x: gap + 100 * k, y: 0 })
      const s1 = addSegment(net, a.id, b.id)!
      const s2 = addSegment(net, c.id, d.id)!
      return { net, b, c, s1, s2 }
    }

    it('reports a gap on both ends when they face each other within the heal tolerance', () => {
      const { net, b, c, s1, s2 } = facingEnds(0.5)
      const gaps = analyzeKinematics(net).filter((i) => i.kind === 'track_gap')
      expect(gaps.map((i) => i.nodeId).sort()).toEqual([b.id, c.id].sort())
      for (const issue of gaps) {
        expect(issue.gapMeters).toBeCloseTo(0.5)
        expect([...issue.involvedSegmentIds].sort()).toEqual([s1.id, s2.id].sort())
      }
    })

    it('says nothing when the ends are further apart than the heal tolerance', () => {
      const { healTolerance } = placementThresholds()
      expect(analyzeKinematics(facingEnds(healTolerance + 0.5).net)).toHaveLength(0)
      expect(analyzeKinematics(facingEnds(healTolerance - 0.5).net).filter((i) => i.kind === 'track_gap')).toHaveLength(2)
    })

    it('scales the distance with the gauge of the layout', () => {
      const hoGauge = 0.0165
      const { k, healTolerance } = placementThresholds(hoGauge)
      // 0.5 m is a real gap at 1:1 but far beyond the heal distance of an HO layout
      expect(analyzeKinematics(facingEnds(0.5, k).net, hoGauge)).toHaveLength(0)
      expect(analyzeKinematics(facingEnds(healTolerance / 2, k).net, hoGauge).filter((i) => i.kind === 'track_gap')).toHaveLength(2)
    })

    it('ignores ends that are close but do not face each other', () => {
      // Two parallel dead ends side by side, 0.5 m apart
      const side = createNetwork()
      const a = addNode(side, { x: -100, y: 0 })
      const b = addNode(side, { x: 0, y: 0 })
      const c = addNode(side, { x: -100, y: 0.5 })
      const d = addNode(side, { x: 0, y: 0.5 })
      addSegment(side, a.id, b.id)
      addSegment(side, c.id, d.id)
      expect(analyzeKinematics(side)).toHaveLength(0)

      // The two ends of one short rail
      const single = createNetwork()
      const e = addNode(single, { x: 0, y: 0 })
      const f = addNode(single, { x: 1, y: 0 })
      addSegment(single, e.id, f.id)
      expect(analyzeKinematics(single)).toHaveLength(0)
    })
  })

  it('reports every two-rail node a train cannot pass, fold-backs included', () => {
    for (let angle = 0; angle <= 180; angle += 1) {
      const net = createNetwork()
      const a = addNode(net, { x: -100, y: 0 })
      const c = addNode(net, { x: 0, y: 0 })
      const r = (angle * Math.PI) / 180
      const e = addNode(net, { x: 100 * Math.cos(r), y: 100 * Math.sin(r) })
      addSegment(net, a.id, c.id)
      addSegment(net, c.id, e.id)
      autoDetectJunctions(net)

      const passable = isTransitionAllowed(net, a.id, c.id, e.id) && isTransitionAllowed(net, e.id, c.id, a.id)
      const reported = analyzeKinematics(net).some((i) => i.nodeId === c.id)
      expect(reported, `corner of ${angle}°`).toBe(!passable)
    }
  })

  describe('steep gradients', () => {
    const limits = { levelHeight: 6, maxGradient: 35 }

    /** One straight rail of `length` m from height `from` (at x = 0) to height `to` */
    function ramp(length: number, from: number, to: number) {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 }, from)
      const b = addNode(net, { x: length, y: 0 }, to)
      return { net, a, b, seg: addSegment(net, a.id, b.id)! }
    }
    const steep = (net: Parameters<typeof analyzeKinematics>[0], l = limits) =>
      analyzeKinematics(net, undefined, l).filter((i) => i.kind === 'steep_gradient')

    it('reports a ramp steeper than the limit, with its slope, at its lower end', () => {
      // One level (6 m) over 100 m: 60 ‰
      const up = ramp(100, 0, 1)
      const issues = steep(up.net)
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({
        id: `steep-${up.seg.id}`,
        nodeId: up.a.id,
        severity: 'warning',
        gradientPermille: 60,
        involvedSegmentIds: [up.seg.id],
      })
      expect(issues[0].message).toBe('Pente de 60 ‰, au-delà du maximum de 35 ‰')

      // Going down: same slope, still reported at the bottom, which is now the `to` end
      const down = ramp(100, 1, 0)
      expect(steep(down.net)[0]).toMatchObject({ nodeId: down.b.id, gradientPermille: 60 })
      // A descent into a tunnel is a slope like any other
      const tunnel = ramp(100, 0, -1)
      expect(steep(tunnel.net)[0]).toMatchObject({ nodeId: tunnel.b.id, gradientPermille: 60 })
    })

    it('says nothing below the limit, nor exactly at it', () => {
      expect(steep(ramp(200, 0, 1).net)).toHaveLength(0) // 30 ‰
      // 6 m over 6 / 0.035 m is 35 ‰, the limit itself
      const atLimit = ramp(6 / 0.035, 0, 1)
      expect(segmentGradient(atLimit.net, atLimit.seg, 6)).toBeCloseTo(35, 9)
      expect(steep(atLimit.net)).toHaveLength(0)
      // Just above it, the slope shown is not rounded down to the limit
      const above = steep(ramp(6 / 0.0354, 0, 1).net)
      expect(above).toHaveLength(1)
      expect(above[0].gradientPermille).toBe(35.4)
      expect(above[0].message).toBe('Pente de 35,4 ‰, au-delà du maximum de 35 ‰')
    })

    it('says nothing about a flat track, on the ground or on a bridge', () => {
      expect(steep(ramp(1, 0, 0).net)).toHaveLength(0)
      expect(steep(ramp(1, 2, 2).net)).toHaveLength(0)
    })

    it('measures the slope against the height of a level and the limit it is given', () => {
      // HO: a level is 6 m / 87, so the same 60 ‰ needs a ramp 87 times shorter
      const ho = { levelHeight: 6 / 87, maxGradient: 35 }
      expect(steep(ramp(100 / 87, 0, 1).net, ho)[0].gradientPermille).toBe(60)
      expect(steep(ramp(2, 0, 1).net, ho)).toHaveLength(0) // 34.5 ‰
      expect(steep(ramp(100, 0, 1).net, { levelHeight: 6, maxGradient: 80 })).toHaveLength(0)
    })

    it('measures a curved ramp along its arc, not along its chord', () => {
      // Quarter turn of radius 100: chord 141.4 m, arc about 157 m
      const net = createNetwork()
      const a = addNode(net, { x: 100, y: 0 })
      const b = addNode(net, { x: 0, y: 100 }, 1)
      const curve = addCurveSegment(net, a.id, b.id, { x: 100, y: 100 })!
      const permille = segmentGradient(net, curve, 6)
      expect(permille).toBeLessThan((6 / Math.hypot(100, 100)) * 1000) // 42.4 ‰ along the chord
      expect(permille).toBeGreaterThan(35)
      const issues = steep(net)
      expect(issues).toHaveLength(1)
      expect(issues[0].nodeId).toBe(a.id)
      expect(issues[0].gradientPermille).toBeCloseTo(permille, 1)
      // Reported along the arc: a limit between the two values tells them apart
      expect(steep(net, { levelHeight: 6, maxGradient: 40 })).toHaveLength(0)
    })

    it('is not looked for when no limit is given', () => {
      expect(analyzeKinematics(ramp(10, 0, 1).net).filter((i) => i.kind === 'steep_gradient')).toHaveLength(0)
    })
  })
})
