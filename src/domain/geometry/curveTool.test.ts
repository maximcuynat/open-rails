import { describe, expect, it } from 'vitest'
import { computeCurveToolGeometry, checkCurveJoins, curvePiecesTo, curveSide, MAX_FREEFORM_TURN_DEG, type CurveEndJoin, type CurveToolInput } from './curveTool'
import type { Network } from '../models/types'
import { createNetwork, addNode, addSegment, addCurveSegment, addCurveChain, hitNode, hitSegment } from '../models/network'
import { splitSegment } from '../models/junction'
import { minCurveRadius, MAX_ARC_PIECE_DEG } from './curve'
import { placementThresholds } from './scale'
import {
  computeTurnoutIntersectionLock,
  computeReverseFreeNodeLock,
  getTangentForPlacement,
  getTrackTangentAt,
  segmentTangentAt,
  transitionDeflectionDeg,
  MAX_TRANSITION_DEFLECTION_DEG,
} from './tangent'
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

  it('freeform mode: a cursor behind the start gives a true arc turning past a half-circle', () => {
    // Tangent-chord angle ~144°: a 288° turn, which no single control point describes
    const geom = computeCurveToolGeometry({ ...base, trackMode: 'freeform', cursor: { x: -25, y: 18 } })
    const radius = (25 ** 2 + 18 ** 2) / (2 * 18)
    expect(geom.radius).toBeCloseTo(radius, 9)
    expect(geom.angle).toBeGreaterThan(180)
    expect(geom.pieces.length).toBe(Math.ceil(geom.angle / MAX_ARC_PIECE_DEG))
    expect(geom.length).toBeCloseTo((radius * geom.angle * Math.PI) / 180, 1)
    // Every piece follows the circle, so the real radius is the announced one
    const tightest = Math.min(...geom.pieces.map((p) => minCurveRadius(p.start, p.via, p.end)))
    expect(tightest).toBeGreaterThan(radius * 0.99)
    expect(geom.startDeflection).toBeCloseTo(0, 6)
    expect(geom.valid).toBe(true)
  })

  it('freeform mode: refuses an arc closing on a full turn, whose radius is out of proportion', () => {
    // Cursor almost straight behind the start: a ~359° turn of radius ~5 km for a 180 m chord
    const geom = computeCurveToolGeometry({ ...base, trackMode: 'freeform', cursor: { x: -180, y: 3 } })
    expect(geom.angle).toBeGreaterThan(MAX_FREEFORM_TURN_DEG)
    expect(geom.radius).toBeGreaterThan(1000)
    expect(geom.valid).toBe(false)
  })

  it('freeform mode: the radius of a wide arc is still checked against the minimum', () => {
    const geom = computeCurveToolGeometry({ ...base, trackMode: 'freeform', cursor: { x: -5, y: 12 } })
    expect(geom.angle).toBeGreaterThan(180)
    expect(geom.radius).toBeLessThan(15)
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

  it('never offers a curve that leaves connected track at a corner a train cannot take', () => {
    // Parallel target 60 m to the side: no tangent lock exists, the reverse curve leaves at ~33°
    const kinked = computeCurveToolGeometry({ ...base, trackTarget: { pointOnTrack: { x: 200, y: 60 }, tangent: { x: 1, y: 0 } } })
    expect(kinked.kind).toBe('reverse')
    expect(kinked.startDeflection).toBeGreaterThan(MAX_TRANSITION_DEFLECTION_DEG)
    expect(kinked.valid).toBe(false)

    // Whatever the target, a curve from connected track that is valid starts within the limit
    for (let x = 40; x <= 400; x += 40) {
      for (let y = -200; y <= 200; y += 25) {
        for (const deg of [0, 20, 45, 90, 135]) {
          const tangent = { x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) }
          for (const trackMode of ['catalog', 'freeform'] as const) {
            const geom = computeCurveToolGeometry({ ...base, trackMode, trackTarget: { pointOnTrack: { x, y }, tangent } })
            if (geom.valid) expect(geom.startDeflection).toBeLessThanOrEqual(MAX_TRANSITION_DEFLECTION_DEG + 1e-6)
            if (geom.kind === 'lock') expect(geom.startDeflection).toBeLessThan(1e-3)
          }
        }
      }
    }
  })

  it('a free start has no join to break, and tangent constructions start at 0°', () => {
    const trackTarget = { pointOnTrack: { x: 200, y: 60 }, tangent: { x: 1, y: 0 } }
    const free = computeCurveToolGeometry({ ...base, startTangent: null, trackMode: 'freeform', trackTarget })
    expect(free.kind).toBe('reverse')
    expect(free.startDeflection).toBe(0)
    expect(free.valid).toBe(true)

    expect(computeCurveToolGeometry(base).startDeflection).toBeCloseTo(0, 6)
    expect(computeCurveToolGeometry({ ...base, trackMode: 'freeform' }).startDeflection).toBeCloseTo(0, 6)
  })
})

describe('curve tool joins with existing track', () => {
  const leave = (net: Network, segId: string, nodeId: string) => {
    const seg = net.segments.get(segId)!
    const tan = segmentTangentAt(net, seg, nodeId)!
    return seg.from === nodeId ? tan : { x: -tan.x, y: -tan.y }
  }
  /** Smallest deflection between the rail `segId` and any other rail at the node (Infinity if alone) */
  const bestJoin = (net: Network, nodeId: string, segId: string) =>
    Math.min(
      Infinity,
      ...net.adjacency.get(nodeId)!.filter((s) => s !== segId).map((s) => transitionDeflectionDeg(leave(net, s, nodeId), leave(net, segId, nodeId))),
    )

  it('from a dead end, the placement tangent continues the rail whatever side the cursor is on', () => {
    const net = createNetwork()
    const a = addNode(net, { x: -200, y: 0 })
    const b = addNode(net, { x: 0, y: 0 })
    addSegment(net, a.id, b.id)
    for (const cursor of [{ x: 100, y: 30 }, { x: -100, y: 30 }, { x: -50, y: -1 }]) {
      const tan = getTangentForPlacement(net, b.id, cursor)!
      expect(tan.x).toBeCloseTo(1, 9)
      expect(tan.y).toBeCloseTo(0, 9)
    }
    // At a through node both directions continue a rail: the cursor picks one
    const c = addNode(net, { x: 200, y: 0 })
    addSegment(net, b.id, c.id)
    expect(getTangentForPlacement(net, b.id, { x: 100, y: 30 })!.x).toBeCloseTo(1, 9)
    expect(getTangentForPlacement(net, b.id, { x: -100, y: 30 })!.x).toBeCloseTo(-1, 9)
  })

  it('refuses a curve whose end meets a track at an angle, and accepts a tangent arrival', () => {
    const net = createNetwork()
    const a = addNode(net, { x: -200, y: 0 })
    const b = addNode(net, { x: 0, y: 0 })
    addSegment(net, a.id, b.id)
    const c = addNode(net, { x: -300, y: 40 })
    const e = addNode(net, { x: 500, y: 40 })
    const parallel = addSegment(net, c.id, e.id)!

    // Catalog piece R150/45° from the dead end: it reaches the parallel track at an angle
    const geom = computeCurveToolGeometry({ ...base, startPos: b.pos, cursor: { x: 100, y: 40 }, radius: 150, angle: 45 })
    expect(geom.valid).toBe(true)
    const hitsTrack = checkCurveJoins(net, b.id, { ...geom, end: { x: geom.end.x, y: 40 } }, { segId: parallel.id })
    expect(hitsTrack.endDeflection).toBeGreaterThan(MAX_TRANSITION_DEFLECTION_DEG)
    expect(hitsTrack.valid).toBe(false)
    // The same piece ending in open space is fine
    expect(checkCurveJoins(net, b.id, geom, null).valid).toBe(true)

    // Snapped to the end node of that track: judged against the rails attached to it
    const onNode = checkCurveJoins(net, b.id, geom, { nodeId: e.id })
    expect(onNode.valid).toBe(false)
  })

  it('whatever the cursor, a curve reported valid can be driven at both of its ends once laid', () => {
    const layouts: ((net: Network) => string)[] = [
      (n) => { const a = addNode(n, { x: -200, y: 0 }); const b = addNode(n, { x: 0, y: 0 }); addSegment(n, a.id, b.id); return b.id },
      (n) => {
        const a = addNode(n, { x: -200, y: 0 }); const b = addNode(n, { x: 0, y: 0 }); addSegment(n, a.id, b.id)
        const c = addNode(n, { x: -300, y: 40 }); const e = addNode(n, { x: 500, y: 40 }); addSegment(n, c.id, e.id)
        return b.id
      },
      (n) => {
        const a = addNode(n, { x: -200, y: 0 }); const b = addNode(n, { x: 0, y: 0 }); addSegment(n, a.id, b.id)
        const c = addNode(n, { x: 50, y: -200 }); const e = addNode(n, { x: 350, y: 250 }); addSegment(n, e.id, c.id)
        return b.id
      },
      (n) => {
        const s = addNode(n, { x: 0, y: 0 })
        const c = addNode(n, { x: -300, y: 60 }); const e = addNode(n, { x: 500, y: 60 }); addSegment(n, c.id, e.id)
        return s.id
      },
      (n) => {
        const a = addNode(n, { x: -200, y: 0 }); const b = addNode(n, { x: 0, y: 0 }); const c = addNode(n, { x: 300, y: 0 })
        addSegment(n, a.id, b.id); addSegment(n, b.id, c.id)
        const g = addNode(n, { x: -100, y: 70 }); const m = addNode(n, { x: 200, y: 50 }); const e = addNode(n, { x: 500, y: 30 })
        addSegment(n, g.id, m.id); addCurveSegment(n, m.id, e.id, { x: 350, y: 40 })
        return b.id
      },
    ]
    const hitTol = 6
    let valid = 0
    let refusedForJoin = 0
    for (const build of layouts) {
      for (const trackMode of ['catalog', 'freeform'] as const) {
        for (const [radius, angle] of [[150, 45], [300, 15], [60, 90]] as const) {
          for (let cx = -260; cx <= 520; cx += 40) {
            for (let cy = -220; cy <= 260; cy += 20) {
              const net = createNetwork()
              const startId = build(net)
              const start = net.nodes.get(startId)!
              const cursor = { x: cx + 0.37, y: cy + 0.21 }
              const len = Math.hypot(cursor.x - start.pos.x, cursor.y - start.pos.y)
              if (len < 6) continue
              const trackTarget = getTrackTangentAt(net, cursor, hitTol, startId)
              const raw = computeCurveToolGeometry({
                startPos: start.pos,
                startTangent: getTangentForPlacement(net, startId, cursor),
                fallbackTangent: { x: (cursor.x - start.pos.x) / len, y: (cursor.y - start.pos.y) / len },
                trackTarget,
                cursor,
                trackMode,
                radius,
                angle,
                side: 'auto',
                limits: placementThresholds(),
              })
              // End join resolved as the canvas does: target node, node under the end, else segment
              let endJoin: CurveEndJoin | null = null
              const nodeUnderEnd = hitNode(net, raw.end, 0.8)
              if (trackTarget?.nodeId && trackTarget.nodeId !== startId) endJoin = { nodeId: trackTarget.nodeId }
              else if (nodeUnderEnd && nodeUnderEnd !== startId) endJoin = { nodeId: nodeUnderEnd }
              else {
                const segId = trackTarget?.segId ?? hitSegment(net, raw.end, hitTol)
                if (segId) endJoin = { segId }
              }
              const geom = checkCurveJoins(net, startId, raw, endJoin)
              if (!geom.valid) {
                if (raw.valid) refusedForJoin++
                continue
              }
              valid++

              // Lay it
              const startHadRails = net.adjacency.get(startId)!.length > 0
              const endId = endJoin?.nodeId ?? (endJoin?.segId ? splitSegment(net, endJoin.segId, geom.end)!.midNode.id : addNode(net, geom.end).id)
              const chain = addCurveChain(net, startId, endId, curvePiecesTo(geom, start.pos, net.nodes.get(endId)!.pos))!
              const first = chain.segments[0]
              const last = chain.segments[chain.segments.length - 1]
              const where = `${trackMode} R${radius}/${angle}° cursor (${cx},${cy}) kind=${geom.kind}`
              if (startHadRails) expect(bestJoin(net, startId, first.id), `start, ${where}`).toBeLessThanOrEqual(MAX_TRANSITION_DEFLECTION_DEG + 1e-3)
              if (endJoin) expect(bestJoin(net, endId, last.id), `end, ${where}`).toBeLessThanOrEqual(MAX_TRANSITION_DEFLECTION_DEG + 1e-3)
            }
          }
        }
      }
    }
    // The sweep exercises both outcomes
    expect(valid).toBeGreaterThan(5000)
    expect(refusedForJoin).toBeGreaterThan(100)
  })
})
