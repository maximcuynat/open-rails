import { describe, it, expect } from 'vitest'
import { createNetwork, addNode, addSegment } from '../models/network'
import { analyzeKinematics, computeTransitionAngleDeg } from './kinematicDiagnostics'

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
})
