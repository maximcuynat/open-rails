import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment } from './network'
import { detectCrossings, computeCrossingFrogs, intersectSegments } from './crossing'

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
})
