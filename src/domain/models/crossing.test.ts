import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment } from './network'
import { reconcileNetworkIntersections } from '../geometry/reconcile'
import { detectCrossings, computeCrossingFrogs, intersectSegments, MIN_CROSSING_ANGLE_DEG } from './crossing'

describe('crossing detection', () => {
  it('detects intersection of two orthogonal crossing straight segments', () => {
    const p1 = { x: -100, y: 0 }
    const p2 = { x: 100, y: 0 }
    const p3 = { x: 0, y: -100 }
    const p4 = { x: 0, y: 100 }

    const res = intersectSegments(p1, p2, p3, p4)
    expect(res).not.toBeNull()
    expect(res!.point.x).toBeCloseTo(0)
    expect(res!.point.y).toBeCloseTo(0)
    expect(res!.t1).toBeCloseTo(0.5)
    expect(res!.t2).toBeCloseTo(0.5)
  })

  it('computes 4 frog crossing points for an X crossing', () => {
    const center = { x: 0, y: 0 }
    const u1 = { x: 1, y: 0 }
    const u2 = { x: 0, y: 1 }

    const frogs = computeCrossingFrogs(center, u1, u2, 16.5)
    expect(frogs).not.toBeNull()
    // For 90 degree crossing of gauge 16.5mm, frogs are at (+-8.25, +-8.25)
    expect(Math.abs(frogs!.p1.x)).toBeCloseTo(8.25)
    expect(Math.abs(frogs!.p1.y)).toBeCloseTo(8.25)
    expect(Math.abs(frogs!.p2.x)).toBeCloseTo(8.25)
    expect(Math.abs(frogs!.p3.x)).toBeCloseTo(8.25)
    expect(Math.abs(frogs!.p4.x)).toBeCloseTo(8.25)
  })

  it('auto-detects crossing between intersecting segments in network', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: -100, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const n3 = addNode(net, { x: 0, y: -100 })
    const n4 = addNode(net, { x: 0, y: 100 })

    addSegment(net, n1.id, n2.id)
    addSegment(net, n3.id, n4.id)

    const crossings = detectCrossings(net)
    expect(crossings.length).toBe(1)
    expect(crossings[0].center.x).toBeCloseTo(0)
    expect(crossings[0].center.y).toBeCloseTo(0)
    expect(crossings[0].angleDeg).toBeCloseTo(90)
    expect(crossings[0].frogs).toBeDefined()
  })

  it('auto-detects diamond crossing at a degree-4 node', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const w1 = addNode(net, { x: -100, y: 0 })
    const e1 = addNode(net, { x: 100, y: 0 })
    const s2 = addNode(net, { x: 0, y: -100 })
    const n2 = addNode(net, { x: 0, y: 100 })

    addSegment(net, apex.id, w1.id)
    addSegment(net, apex.id, e1.id)
    addSegment(net, apex.id, s2.id)
    addSegment(net, apex.id, n2.id)

    const crossings = detectCrossings(net)
    expect(crossings.length).toBe(1)
    expect(crossings[0].nodeId).toBe(apex.id)
    expect(crossings[0].angleDeg).toBeCloseTo(90)
  })

  it('reports a shallow crossing produced by reconcile', () => {
    for (const angleDeg of [30, 8, 3]) {
      const net = createNetwork()
      const r = (angleDeg * Math.PI) / 180
      const w = addNode(net, { x: -100, y: 0 })
      const e = addNode(net, { x: 100, y: 0 })
      const a = addNode(net, { x: -100 * Math.cos(r), y: -100 * Math.sin(r) })
      const b = addNode(net, { x: 100 * Math.cos(r), y: 100 * Math.sin(r) })
      addSegment(net, w.id, e.id)
      addSegment(net, a.id, b.id)
      reconcileNetworkIntersections(net)

      const crossings = detectCrossings(net)
      expect(crossings).toHaveLength(1)
      expect(crossings[0].nodeId).toBeDefined()
      expect(net.adjacency.get(crossings[0].nodeId!)).toHaveLength(4)
      expect(crossings[0].angleDeg).toBeCloseTo(angleDeg, 6)
      expect(crossings[0].center.x).toBeCloseTo(0, 6)
      expect(crossings[0].center.y).toBeCloseTo(0, 6)
    }
  })

  it('reports both crossings of a curve over a straight, each with the directions of the two tracks', () => {
    const net = createNetwork()
    const w = addNode(net, { x: -100, y: 0 })
    const e = addNode(net, { x: 100, y: 0 })
    addSegment(net, w.id, e.id)
    const a = addNode(net, { x: -60, y: -40 })
    const b = addNode(net, { x: 60, y: -40 })
    addCurveSegment(net, a.id, b.id, { x: 0, y: 80 })
    reconcileNetworkIntersections(net)

    const crossings = detectCrossings(net)
    expect(crossings).toHaveLength(2)
    for (const c of crossings) {
      expect(net.adjacency.get(c.nodeId!)).toHaveLength(4)
      expect(c.center.y).toBeCloseTo(0, 6)
      // One of the two tracks is the straight along x
      expect(Math.max(Math.abs(c.track1Dir.x), Math.abs(c.track2Dir.x))).toBeCloseTo(1, 6)
      expect(c.angleDeg).toBeGreaterThan(30)
    }
    expect(crossings[0].center.x).toBeCloseTo(-crossings[1].center.x, 6)
  })

  it('agrees with reconcile on which shallow X is a crossing, right at the minimum angle', () => {
    const angles = [0.2, 0.9, 0.999, MIN_CROSSING_ANGLE_DEG, 1.001, 1.1, 2]
    for (let a = 0.99; a <= 1.01; a += 0.0005) angles.push(a)
    for (const angleDeg of angles) {
      for (const flip of [false, true]) {
        const net = createNetwork()
        const r = (angleDeg * Math.PI) / 180
        const w = addNode(net, { x: -300, y: 0 })
        const e = addNode(net, { x: 300, y: 0 })
        addSegment(net, w.id, e.id)
        const a = addNode(net, { x: -300 * Math.cos(r), y: -300 * Math.sin(r) })
        const b = addNode(net, { x: 300 * Math.cos(r), y: 300 * Math.sin(r) })
        if (flip) addSegment(net, b.id, a.id)
        else addSegment(net, a.id, b.id)

        // Before reconcile (bare intersection) and after it (node or not): same verdict
        const bare = detectCrossings(net).length
        reconcileNetworkIntersections(net)
        const nodes = [...net.adjacency.values()].filter((adj) => adj.length === 4).length
        expect(detectCrossings(net).length, `X at ${angleDeg}°`).toBe(nodes)
        expect(bare, `bare X at ${angleDeg}°`).toBeLessThanOrEqual(nodes)
      }
    }
  })
})
