import { describe, expect, it } from 'vitest'
import { applyNodeTransform, collectAffectedVias } from './nodeTransform'
import { viaFromArc } from './tangent'
import { addCurveSegment, addNode, addSegment, createNetwork } from '../models/network'
import type { Network, NodeId, Point } from '../models/types'

function snapshot(net: Network, ids: NodeId[]) {
  const nodes = new Map<NodeId, Point>()
  for (const id of ids) nodes.set(id, { ...net.nodes.get(id)!.pos })
  return { nodes, vias: collectAffectedVias(net, ids) }
}

/** straight A(-100,0)→B(0,0), 90° curve B→C(50,50) via (50,0), straight C→D(50,150) */
function buildLayout() {
  const net = createNetwork()
  const a = addNode(net, { x: -100, y: 0 })
  const b = addNode(net, { x: 0, y: 0 })
  const c = addNode(net, { x: 50, y: 50 })
  const d = addNode(net, { x: 50, y: 150 })
  const s1 = addSegment(net, a.id, b.id)!
  const curve = addCurveSegment(net, b.id, c.id, { x: 50, y: 0 })!
  const s2 = addSegment(net, c.id, d.id)!
  return { net, a, b, c, d, s1, curve, s2 }
}

describe('viaFromArc sign conventions', () => {
  it('places the control point ahead of the start along the incoming direction', () => {
    // Heading east, end up-right at 45°: quarter circle of radius 10
    const via = viaFromArc({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 1, y: 0 })
    expect(via.x).toBeCloseTo(10)
    expect(via.y).toBeCloseTo(0)
    // Mirror image
    const viaDown = viaFromArc({ x: 0, y: 0 }, { x: 10, y: -10 }, { x: 1, y: 0 })
    expect(viaDown.x).toBeCloseTo(10)
    expect(viaDown.y).toBeCloseTo(0)
  })

  it('returns a point behind the start when the end is behind the tangent', () => {
    const via = viaFromArc({ x: 0, y: 0 }, { x: -10, y: 5 }, { x: 1, y: 0 })
    expect(via.x).toBeLessThan(0)
  })
})

describe('collectAffectedVias', () => {
  it('collects every curve touching the node set, selected or not', () => {
    const { net, b, a, curve } = buildLayout()
    expect([...collectAffectedVias(net, [b.id]).keys()]).toEqual([curve.id])
    expect(collectAffectedVias(net, [a.id]).size).toBe(0)
    const vias = collectAffectedVias(net, [b.id])
    vias.get(curve.id)!.x = 999
    expect(net.segments.get(curve.id)!.via!.x).toBe(50) // a copy, not a reference
  })
})

describe('applyNodeTransform', () => {
  it('translates the control point of a curve whose both ends move', () => {
    const { net, b, c, curve } = buildLayout()
    const snap = snapshot(net, [b.id, c.id])
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 10, y: -5 } })
    expect(net.nodes.get(b.id)!.pos).toEqual({ x: 10, y: -5 })
    expect(net.nodes.get(c.id)!.pos).toEqual({ x: 60, y: 45 })
    expect(net.segments.get(curve.id)!.via).toEqual({ x: 60, y: -5 })
  })

  it('is computed from the snapshot, not incrementally', () => {
    const { net, b, c, curve } = buildLayout()
    const snap = snapshot(net, [b.id, c.id])
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 10, y: 0 } })
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 3, y: 0 } })
    expect(net.nodes.get(b.id)!.pos.x).toBe(3)
    expect(net.segments.get(curve.id)!.via!.x).toBe(53)
  })

  it('rotates the control point rigidly when both ends rotate about the anchor', () => {
    const { net, b, c, curve } = buildLayout()
    const snap = snapshot(net, [b.id, c.id])
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'rotate', center: { x: 0, y: 0 }, angleRad: Math.PI / 2 })
    expect(net.nodes.get(b.id)!.pos.x).toBeCloseTo(0)
    expect(net.nodes.get(c.id)!.pos.x).toBeCloseTo(-50)
    expect(net.nodes.get(c.id)!.pos.y).toBeCloseTo(50)
    const via = net.segments.get(curve.id)!.via!
    expect(via.x).toBeCloseTo(0)
    expect(via.y).toBeCloseTo(50)
  })

  it('refits a curve with one moved end as an arc keeping the tangent at the fixed end', () => {
    const { net, b, c, curve } = buildLayout()
    const snap = snapshot(net, [c.id])
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 20, y: 20 } })
    // C is now (70,70): quarter circle of radius 70 leaving B heading east
    const via = net.segments.get(curve.id)!.via!
    expect(via.x).toBeCloseTo(70)
    expect(via.y).toBeCloseTo(0)
    // Tangent at the fixed end B unchanged (still along +x)
    expect(via.y - net.nodes.get(b.id)!.pos.y).toBeCloseTo(0)
    // Arc-like: both control legs have the same length
    const cPos = net.nodes.get(c.id)!.pos
    expect(Math.hypot(via.x, via.y)).toBeCloseTo(Math.hypot(cPos.x - via.x, cPos.y - via.y))
  })

  it('takes the fixed-end tangent from the initial snapshot on every call', () => {
    const { net, c, curve } = buildLayout()
    const snap = snapshot(net, [c.id])
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 0, y: 40 } })
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 20, y: 20 } })
    const via = net.segments.get(curve.id)!.via!
    expect(via.x).toBeCloseTo(70)
    expect(via.y).toBeCloseTo(0)
  })

  it('restores the exact initial control point when the delta comes back to zero', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 60, y: 40 })
    // Deliberately asymmetric control point: not an arc
    const curve = addCurveSegment(net, a.id, b.id, { x: 20, y: 0 })!
    const snap = snapshot(net, [b.id])
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 5, y: 5 } })
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 0, y: 0 } })
    expect(net.segments.get(curve.id)!.via).toEqual({ x: 20, y: 0 })
  })

  it('keeps the last valid control point instead of folding the curve into a cusp', () => {
    const { net, c, curve } = buildLayout()
    const snap = snapshot(net, [c.id])
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 20, y: 20 } })
    const lastValid = { ...net.segments.get(curve.id)!.via! }
    // Drag C far behind B's tangent: no arc leaves B heading east and reaches it
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: -200, y: -40 } })
    expect(net.nodes.get(c.id)!.pos).toEqual({ x: -150, y: 10 })
    expect(net.segments.get(curve.id)!.via).toEqual(lastValid)
  })

  it('leaves curves that do not touch a moved node alone', () => {
    const { net, a, curve } = buildLayout()
    const snap = snapshot(net, [a.id])
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 0, y: 30 } })
    expect(net.segments.get(curve.id)!.via).toEqual({ x: 50, y: 0 })
  })

  describe('rotation of a single node', () => {
    it('does not move the node and pivots the tangent of the adjacent curve', () => {
      const { net, b, c, curve } = buildLayout()
      const snap = snapshot(net, [b.id])
      const angle = (20 * Math.PI) / 180
      applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'rotate', center: { x: 0, y: 0 }, angleRad: angle })

      expect(net.nodes.get(b.id)!.pos).toEqual({ x: 0, y: 0 })
      expect(net.nodes.get(c.id)!.pos).toEqual({ x: 50, y: 50 })

      const via = net.segments.get(curve.id)!.via!
      // Tangent at B rotated by +20°
      expect(Math.atan2(via.y, via.x)).toBeCloseTo(angle)
      // Tangent at the far end C preserved: via still on the vertical line x = 50, on the B side of C
      expect(via.x).toBeCloseTo(50)
      expect(via.y).toBeLessThan(50)
    })

    it('leaves adjacent straight segments untouched', () => {
      const { net, a, b } = buildLayout()
      const snap = snapshot(net, [b.id])
      applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'rotate', center: { x: 0, y: 0 }, angleRad: 0.3 })
      expect(net.nodes.get(a.id)!.pos).toEqual({ x: -100, y: 0 })
      expect(net.nodes.get(b.id)!.pos).toEqual({ x: 0, y: 0 })
    })

    it('keeps the last valid control point when the tangents become parallel or cross behind an end', () => {
      const { net, b, curve } = buildLayout()
      const snap = snapshot(net, [b.id])
      const rotate = (deg: number) =>
        applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'rotate', center: { x: 0, y: 0 }, angleRad: (deg * Math.PI) / 180 })

      rotate(30)
      const lastValid = { ...net.segments.get(curve.id)!.via! }
      expect(lastValid.x).toBeCloseTo(50)

      rotate(90) // tangent at B now parallel to the tangent at C
      expect(net.segments.get(curve.id)!.via).toEqual(lastValid)

      rotate(60) // intersection at (50, 86.6): beyond C, behind its tangent
      expect(net.segments.get(curve.id)!.via).toEqual(lastValid)

      rotate(-120) // intersection behind B
      expect(net.segments.get(curve.id)!.via).toEqual(lastValid)

      rotate(0)
      expect(net.segments.get(curve.id)!.via!.x).toBeCloseTo(50)
      expect(net.segments.get(curve.id)!.via!.y).toBeCloseTo(0)
    })

    it('rotates the tangent of both curves through the node together (stays G1)', () => {
      const net = createNetwork()
      const a = addNode(net, { x: -50, y: 50 })
      const b = addNode(net, { x: 0, y: 0 })
      const c = addNode(net, { x: 50, y: 50 })
      const c1 = addCurveSegment(net, a.id, b.id, { x: -50, y: 0 })!
      const c2 = addCurveSegment(net, b.id, c.id, { x: 50, y: 0 })!
      const snap = snapshot(net, [b.id])
      applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'rotate', center: { x: 0, y: 0 }, angleRad: 0.2 })
      const v1 = net.segments.get(c1.id)!.via!
      const v2 = net.segments.get(c2.id)!.via!
      // v1, B and v2 aligned, on opposite sides of B
      expect(v1.x * v2.y - v1.y * v2.x).toBeCloseTo(0)
      expect(v1.x * v2.x + v1.y * v2.y).toBeLessThan(0)
      expect(Math.atan2(v2.y, v2.x)).toBeCloseTo(0.2)
    })
  })

  it('restoring from the snapshot covers every modified control point', () => {
    const { net, b, curve } = buildLayout()
    const snap = snapshot(net, [b.id])
    applyNodeTransform(net, snap.nodes, snap.vias, { kind: 'translate', delta: { x: 5, y: 12 } })
    expect(net.segments.get(curve.id)!.via).not.toEqual({ x: 50, y: 0 })
    // Same loop as EditorStore.cancelInteraction
    for (const [sid, initVia] of snap.vias) {
      const seg = net.segments.get(sid)!
      seg.via!.x = initVia.x
      seg.via!.y = initVia.y
    }
    expect(net.segments.get(curve.id)!.via).toEqual({ x: 50, y: 0 })
  })
})
