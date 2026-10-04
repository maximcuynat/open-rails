import { describe, expect, it } from 'vitest'
import {
  bezierPoint,
  computeParallelCurve,
  curveDeflection,
  curvePiecesLength,
  minCurveRadius,
  splitCurveIntoArcPieces,
  MAX_ARC_PIECE_DEG,
} from './curve'
import { computeCurvePiece, computeFreeformCurve } from '../profiles/profiles'
import { addArcCurve, addCurveChain, addNode, addSegment, createNetwork } from '../models/network'
import { computeTrackSections } from '../models/sections'
import { analyzeKinematics } from '../services/kinematicDiagnostics'
import { applyFreeformParallelTurnout, computeFreeformParallelTurnout } from './constructionTemplates'

const R = 500
/** Curve of radius 500 leaving the origin heading east and turning towards +y: centre (0, 500). */
const arc = (angleDeg: number) => computeCurvePiece({ x: 0, y: 0 }, { x: 1, y: 0 }, R, 1, angleDeg)
const centre = { x: 0, y: R }
const distToCentre = (p: { x: number; y: number }) => Math.hypot(p.x - centre.x, p.y - centre.y)

describe('splitCurveIntoArcPieces', () => {
  it('documents the defect: a single Bezier is far from the circle at 90°', () => {
    const { end, via } = arc(90)
    expect(minCurveRadius({ x: 0, y: 0 }, via, end)).toBeCloseTo(R * Math.cos(Math.PI / 4), 0) // ≈ 354 m
  })

  it('cuts a 90° R500 curve into 6 pieces within 1% of the nominal radius, joints on the circle', () => {
    const { end, via } = arc(90)
    const pieces = splitCurveIntoArcPieces({ x: 0, y: 0 }, via, end)
    expect(pieces.length).toBe(90 / MAX_ARC_PIECE_DEG)

    for (const p of pieces) {
      const r = minCurveRadius(p.start, p.via, p.end)
      expect(Math.abs(r - R) / R).toBeLessThan(0.01)
      expect(distToCentre(p.start)).toBeCloseTo(R, 6)
      expect(distToCentre(p.end)).toBeCloseTo(R, 6)
      // Every sampled point of the piece stays within 0.01% of the circle
      for (let i = 0; i <= 16; i++) {
        const pt = bezierPoint(i / 16, p.start, p.via, p.end)
        expect(Math.abs(distToCentre(pt) - R) / R).toBeLessThan(1e-4)
      }
    }
  })

  it('chains the pieces: shared joints, exact ends, G1 continuity, equal deflection', () => {
    const { end, via } = arc(90)
    const pieces = splitCurveIntoArcPieces({ x: 0, y: 0 }, via, end)
    expect(pieces[0].start).toEqual({ x: 0, y: 0 })
    expect(pieces[pieces.length - 1].end).toEqual(end)
    for (let i = 0; i < pieces.length; i++) {
      expect((curveDeflection(pieces[i].start, pieces[i].via, pieces[i].end) * 180) / Math.PI).toBeCloseTo(15, 6)
      if (i === 0) continue
      const prev = pieces[i - 1]
      const cur = pieces[i]
      expect(cur.start).toEqual(prev.end)
      // prev.via, joint and cur.via aligned
      const cross = (prev.end.x - prev.via.x) * (cur.via.y - cur.start.y) - (prev.end.y - prev.via.y) * (cur.via.x - cur.start.x)
      expect(cross / (R * R)).toBeCloseTo(0, 9)
    }
    // Start and end tangents of the whole curve preserved
    expect(pieces[0].via.y).toBeCloseTo(0, 9)
    const last = pieces[pieces.length - 1]
    expect(last.end.x - last.via.x).toBeCloseTo(0, 6)
  })

  it('uses n = ceil(θ / 15°) equal pieces and handles both turning sides', () => {
    for (const [deg, n] of [[15, 1], [16, 2], [30, 2], [45, 3], [100, 7], [120, 8]] as const) {
      for (const side of [1, -1] as const) {
        const { end, via } = computeCurvePiece({ x: 10, y: -4 }, { x: 0.6, y: 0.8 }, R, side, deg)
        const pieces = splitCurveIntoArcPieces({ x: 10, y: -4 }, via, end)
        expect(pieces.length).toBe(n)
        for (const p of pieces) {
          expect(Math.abs(minCurveRadius(p.start, p.via, p.end) - R) / R).toBeLessThan(0.01)
        }
      }
    }
  })

  it('returns the curve unchanged when it is within one piece, straight or degenerate', () => {
    const { end, via } = arc(15)
    expect(splitCurveIntoArcPieces({ x: 0, y: 0 }, via, end)).toEqual([{ start: { x: 0, y: 0 }, via, end }])
    // Straight "curve": via at the chord midpoint
    expect(splitCurveIntoArcPieces({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }).length).toBe(1)
    expect(splitCurveIntoArcPieces({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }).length).toBe(1)
  })

  it('falls back to De Casteljau subdivision for a non-symmetric curve, preserving its shape', () => {
    // computeFreeformCurve clamps alpha at 85°: the control point is no longer symmetric
    const start = { x: 0, y: 0 }
    const { end, via } = computeFreeformCurve(start, { x: 1, y: 0 }, { x: -20, y: 100 })
    const a = Math.hypot(via.x - start.x, via.y - start.y)
    const b = Math.hypot(end.x - via.x, end.y - via.y)
    expect(Math.abs(a - b) / Math.max(a, b)).toBeGreaterThan(0.01)

    const pieces = splitCurveIntoArcPieces(start, via, end)
    expect(pieces.length).toBeGreaterThan(1)
    const n = pieces.length
    pieces.forEach((p, i) => {
      for (let s = 0; s <= 8; s++) {
        const local = bezierPoint(s / 8, p.start, p.via, p.end)
        const original = bezierPoint((i + s / 8) / n, start, via, end)
        expect(local.x).toBeCloseTo(original.x, 8)
        expect(local.y).toBeCloseTo(original.y, 8)
      }
    })
    expect(pieces[n - 1].end).toEqual(end)
  })

  it('measures the true arc length', () => {
    const { end, via } = arc(90)
    const pieces = splitCurveIntoArcPieces({ x: 0, y: 0 }, via, end)
    expect(curvePiecesLength(pieces)).toBeCloseTo((R * Math.PI) / 2, 0)
  })

  it('offsetting each piece gives a concentric companion with shared radial joints', () => {
    const { end, via } = arc(90)
    const pieces = splitCurveIntoArcPieces({ x: 0, y: 0 }, via, end)
    const offset = 3.8
    const par = pieces.map((p) => computeParallelCurve(p.start, p.via, p.end, offset))
    for (let i = 0; i < par.length; i++) {
      // offset > 0 is the left normal of travel: here the centre side, so radius R - offset
      expect(distToCentre(par[i].start)).toBeCloseTo(R - offset, 6)
      expect(distToCentre(par[i].end)).toBeCloseTo(R - offset, 6)
      expect(Math.abs(minCurveRadius(par[i].start, par[i].via, par[i].end) - (R - offset)) / R).toBeLessThan(0.01)
      if (i > 0) {
        expect(par[i].start.x).toBeCloseTo(par[i - 1].end.x, 9)
        expect(par[i].start.y).toBeCloseTo(par[i - 1].end.y, 9)
      }
      // Radial joint: centre, companion joint and main joint aligned
      const m = pieces[i].end
      const c = par[i].end
      expect(((m.x - centre.x) * (c.y - centre.y) - (m.y - centre.y) * (c.x - centre.x)) / (R * R)).toBeCloseTo(0, 9)
    }
  })
})

describe('addCurveChain / addArcCurve', () => {
  function build90() {
    const net = createNetwork()
    const lead = addNode(net, { x: -200, y: 0 })
    const from = addNode(net, { x: 0, y: 0 })
    addSegment(net, lead.id, from.id)
    const { end, via } = arc(90)
    const to = addNode(net, end)
    const tail = addNode(net, { x: end.x, y: end.y + 200 })
    addSegment(net, to.id, tail.id)
    const res = addArcCurve(net, from.id, to.id, via)!
    return { net, from, to, res }
  }

  it('inserts chained curve segments with intermediate nodes between two existing nodes', () => {
    const { net, from, to, res } = build90()
    expect(res.segments.length).toBe(6)
    expect(res.nodes.length).toBe(5)
    expect(res.segments[0].from).toBe(from.id)
    expect(res.segments[5].to).toBe(to.id)
    for (let i = 1; i < res.segments.length; i++) {
      expect(res.segments[i].from).toBe(res.segments[i - 1].to)
      expect(res.segments[i].kind).toBe('curve')
    }
    for (const n of res.nodes) {
      expect(net.adjacency.get(n.id)?.length).toBe(2)
      expect(distToCentre(n.pos)).toBeCloseTo(R, 6)
    }
    for (const s of res.segments) {
      const a = net.nodes.get(s.from)!.pos
      const b = net.nodes.get(s.to)!.pos
      expect(Math.abs(minCurveRadius(a, s.via!, b) - R) / R).toBeLessThan(0.01)
    }
  })

  it('refuses a chain between the same node or unknown nodes', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    expect(addCurveChain(net, a.id, a.id, [{ start: a.pos, via: a.pos, end: a.pos }])).toBeNull()
    expect(addArcCurve(net, a.id, 'nope', { x: 1, y: 1 })).toBeNull()
    expect(net.nodes.size).toBe(1)
  })

  it('computeTrackSections keeps the whole chain (and its straight leads) in one section', () => {
    const { net, res } = build90()
    const sections = computeTrackSections(net)
    expect(sections.length).toBe(1)
    for (const s of res.segments) expect(sections[0].segmentIds).toContain(s.id)
    expect(sections[0].segmentIds.length).toBe(8)
  })

  it('analyzeKinematics does not flag the degree-2 joints of the chain', () => {
    const { net } = build90()
    expect(analyzeKinematics(net)).toEqual([])
  })

  it('applyFreeformParallelTurnout inserts both halves as arc pieces', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    addSegment(net, a.id, b.id)
    // Wide S: each half deflects ~53°
    const geom = computeFreeformParallelTurnout(b.pos, { x: 1, y: 0 }, { x: 180, y: 40 })!
    expect(geom.valid).toBe(true)
    const res = applyFreeformParallelTurnout(net, b.id, geom)
    const curves = [...net.segments.values()].filter((s) => s.kind === 'curve')
    expect(curves.length).toBe(8) // 2 halves × 4 pieces
    for (const s of curves) {
      const p0 = net.nodes.get(s.from)!.pos
      const p2 = net.nodes.get(s.to)!.pos
      expect(Math.abs(minCurveRadius(p0, s.via!, p2) - geom.radius) / geom.radius).toBeLessThan(0.01)
    }
    expect(res.endNode.pos).toEqual({ x: 180, y: 40 })
    expect(computeTrackSections(net).length).toBe(1)
    expect(analyzeKinematics(net)).toEqual([])
  })
})
