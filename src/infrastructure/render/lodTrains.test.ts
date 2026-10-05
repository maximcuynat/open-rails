import { describe, expect, it, vi } from 'vitest'
import { getViewportBounds, renderLocomotive, renderTrainSet, TUNNEL_VEHICLE_ALPHA } from './renderer'
import {
  drawTrainMarker,
  pointsInBounds,
  vehiclesInBounds,
  TRAIN_MARKER_DOT_RADIUS_PX,
  TRAIN_MARKER_WIDTH_PX,
} from './lodTrains'
import { trackLod } from './lod'
import { addNode, addSegment, createNetwork } from '@domain/models/network'
import { createTrainSet, findCouplerSnap, vehicleRearEndPos, type TrainSet } from '@domain/models/train'
import { createLocomotive } from '@domain/models/locomotive'
import type { Network } from '@domain/models/types'

const METHODS = [
  'save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'rect', 'roundRect',
  'fillRect', 'strokeRect', 'setLineDash', 'translate', 'rotate', 'closePath', 'quadraticCurveTo', 'fillText',
] as const

function createMockContext(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
    measureText: vi.fn().mockReturnValue({ width: 60 }),
  }
  for (const m of METHODS) ctx[m] = vi.fn()
  return ctx as unknown as CanvasRenderingContext2D
}

/** Number of calls of every drawing method that was called at all */
function callCounts(ctx: CanvasRenderingContext2D): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const m of METHODS) {
    const n = vi.mocked(ctx[m] as (...args: unknown[]) => unknown).mock.calls.length
    if (n > 0) counts[m] = n
  }
  return counts
}

interface StrokeRecord {
  color: unknown
  width: number
  alpha: number | undefined
}

/** Style in force at each `stroke()` */
function recordStrokes(ctx: CanvasRenderingContext2D): StrokeRecord[] {
  const strokes: StrokeRecord[] = []
  vi.mocked(ctx.stroke).mockImplementation(() => {
    strokes.push({ color: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha })
  })
  return strokes
}

function recordFills(ctx: CanvasRenderingContext2D): unknown[] {
  const fills: unknown[] = []
  vi.mocked(ctx.fill).mockImplementation(() => { fills.push(ctx.fillStyle) })
  return fills
}

const BODY_FILL = 'rgba(14, 165, 233, 0.09)'
const BOGIE_FILL = '#1e293b'

/** A 400 m straight with a power car and three trailers on it, from x ≈ 223 (tail) to x ≈ 305 (nose) */
function straightWithTrain(level = 0): { net: Network; ts: TrainSet; segId: string } {
  const net = createNetwork()
  const n1 = addNode(net, { x: 0, y: 0 })
  const n2 = addNode(net, { x: 400, y: 0 })
  if (level !== 0) {
    n1.level = level
    n2.level = level
  }
  const seg = addSegment(net, n1.id, n2.id)!
  const ts = createTrainSet(net, { x: 300, y: 0 }, 'loco')!
  for (let i = 0; i < 3; i++) {
    const tail = vehicleRearEndPos(net, ts.vehicles[ts.vehicles.length - 1])!
    ts.vehicles.push(findCouplerSnap(net, [ts], tail, 'wagon')!.snappedVehicle)
  }
  return { net, ts, segId: seg.id }
}

// One camera per tier, all centred on the train
const DETAIL = { x: 270, y: 0, scale: 8 }
const LINE = { x: 270, y: 0, scale: 1 }
const SCHEMATIC = { x: 270, y: 0, scale: 0.2 }

describe('train level of detail', () => {
  it('the test cameras fall in the three tiers', () => {
    expect(trackLod(DETAIL.scale, 1.435)).toBe('detail')
    expect(trackLod(LINE.scale, 1.435)).toBe('line')
    expect(trackLod(SCHEMATIC.scale, 1.435)).toBe('schematic')
  })

  describe('pointsInBounds', () => {
    const b = { minX: 0, maxX: 10, minY: 0, maxY: 10 }
    it('keeps a shape inside, one that straddles an edge and one larger than the view', () => {
      expect(pointsInBounds([{ x: 2, y: 2 }, { x: 3, y: 3 }], b)).toBe(true)
      // No corner inside, but the box crosses the edge
      expect(pointsInBounds([{ x: -5, y: 5 }, { x: 5, y: 5 }], b)).toBe(true)
      // Every corner outside, the view inside the box
      expect(pointsInBounds([{ x: -5, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 15 }, { x: -5, y: 15 }], b)).toBe(true)
    })
    it('drops a shape wholly outside, and an empty one', () => {
      expect(pointsInBounds([{ x: 11, y: 2 }, { x: 14, y: 3 }], b)).toBe(false)
      expect(pointsInBounds([{ x: 2, y: -4 }, { x: 3, y: -1 }], b)).toBe(false)
      expect(pointsInBounds([], b)).toBe(false)
    })
  })

  describe('culling', () => {
    it('vehiclesInBounds follows the pivots of the vehicles', () => {
      const { net, ts } = straightWithTrain()
      expect(vehiclesInBounds(net, ts.vehicles, getViewportBounds(DETAIL, 800, 600))).toBe(true)
      expect(vehiclesInBounds(net, ts.vehicles, getViewportBounds({ ...DETAIL, x: 5000 }, 800, 600))).toBe(false)
      // A vehicle that cannot be located is not thrown away
      const lost = [{ front: { segId: 'gone', t: 0, forward: true }, rear: { segId: 'gone', t: 0, forward: true } }]
      expect(vehiclesInBounds(net, lost, getViewportBounds(DETAIL, 800, 600))).toBe(true)
    })

    it.each([['detail', DETAIL], ['line', LINE], ['schematic', SCHEMATIC]] as const)(
      'a train out of view draws nothing in the %s tier',
      (_tier, cam) => {
        const { net, ts } = straightWithTrain()
        const ctx = createMockContext()
        // Far enough for the widest of the three views
        renderTrainSet(ctx, { ...cam, x: 50000 }, 800, 600, net, ts, true, false, false, undefined, ts.vehicles[1].id, ts.vehicles[2].id)
        expect(callCounts(ctx)).toEqual({})
      },
    )

    it('draws only the vehicles in view of a train that straddles the edge', () => {
      const { net, ts } = straightWithTrain()
      // View from x = 290 (50 m of screen + 60 m of margin left of 400): the power car only
      const cam = { x: 400, y: 0, scale: 8 }
      const ctx = createMockContext()
      const fills = recordFills(ctx)
      renderTrainSet(ctx, cam, 800, 600, net, ts, false, false, false)
      expect(fills.filter(f => f === BODY_FILL)).toHaveLength(1)
      // The front bogie of the power car (two side beams), not the five behind it
      expect(fills.filter(f => f === BOGIE_FILL)).toHaveLength(2)
    })

    it('still draws the debug overlay of a train out of view (it reaches beyond the train)', () => {
      const { net, ts } = straightWithTrain()
      const ctx = createMockContext()
      renderTrainSet(ctx, { ...DETAIL, x: 5000 }, 800, 600, net, ts, false, false, true)
      expect(vi.mocked(ctx.fillText).mock.calls.length).toBeGreaterThan(0)
    })

    it('the legacy consist out of view draws nothing', () => {
      const { net, segId } = straightWithTrain()
      const loco = createLocomotive(net, segId, 0.7)!
      const ctx = createMockContext()
      renderLocomotive(ctx, { ...DETAIL, x: 5000 }, 800, 600, net, loco, false, false, true, undefined, true)
      expect(callCounts(ctx)).toEqual({})
    })
  })

  describe('detail tier', () => {
    // Call counts recorded on the drawing as it was before the tiers existed, same scene and camera
    it.each([
      ['plain', [false, false, false], { save: 3, restore: 3, beginPath: 109, moveTo: 96, lineTo: 252, stroke: 108, fill: 87, arc: 12, roundRect: 1, closePath: 75, fillText: 1 }],
      ['selected', [true, false, false], { save: 4, restore: 4, beginPath: 113, moveTo: 100, lineTo: 270, stroke: 112, fill: 87, arc: 12, roundRect: 1, closePath: 79, fillText: 1 }],
      ['debug', [true, false, true], { save: 13, restore: 13, beginPath: 123, moveTo: 104, lineTo: 302, stroke: 122, fill: 94, arc: 18, roundRect: 1, fillRect: 11, strokeRect: 6, setLineDash: 12, closePath: 76, fillText: 12 }],
      ['ghost', [false, true, false], { save: 1, restore: 1, beginPath: 106, moveTo: 94, lineTo: 246, stroke: 106, fill: 85, arc: 12, closePath: 73 }],
    ] as const)('draws a train in view exactly as before (%s)', (_name, [isSelected, isGhost, isDebug], expected) => {
      const { net, ts } = straightWithTrain()
      const ctx = createMockContext()
      renderTrainSet(ctx, DETAIL, 800, 600, net, ts, isSelected, isGhost, isDebug, undefined, ts.vehicles[1].id, ts.vehicles[2].id)
      expect(callCounts(ctx)).toEqual(expected)
    })

    it.each([
      [false, { save: 3, restore: 3, beginPath: 86, moveTo: 71, lineTo: 215, stroke: 83, fill: 65, arc: 16, roundRect: 1, closePath: 52, fillText: 1 }],
      [true, { save: 17, restore: 17, beginPath: 111, moveTo: 83, lineTo: 255, stroke: 110, fill: 77, arc: 27, roundRect: 1, fillRect: 25, strokeRect: 8, setLineDash: 12, closePath: 51, fillText: 26 }],
    ] as const)('draws the legacy consist in view exactly as before (debug %s)', (isDebug, expected) => {
      const { net, segId } = straightWithTrain()
      const loco = createLocomotive(net, segId, 0.7)!
      const ctx = createMockContext()
      renderLocomotive(ctx, DETAIL, 800, 600, net, loco, false, isDebug, true, undefined, true)
      expect(callCounts(ctx)).toEqual(expected)
    })
  })

  describe('line tier', () => {
    it('draws each vehicle as its silhouette, without bogies nor gangways', () => {
      const { net, ts } = straightWithTrain()
      const ctx = createMockContext()
      const fills = recordFills(ctx)
      renderTrainSet(ctx, LINE, 800, 600, net, ts, false, false, false)
      // Four bodies with today's colours and nothing else
      expect(fills).toEqual([BODY_FILL, BODY_FILL, BODY_FILL, BODY_FILL])
      expect(callCounts(ctx)).toMatchObject({ beginPath: 4, stroke: 4, fill: 4 })
      // Bogie pivots are the only circles of a train
      expect(ctx.arc).not.toHaveBeenCalled()
    })

    it('keeps the selection and the delete highlights', () => {
      const { net, ts } = straightWithTrain()
      const ctx = createMockContext()
      const strokes = recordStrokes(ctx)
      renderTrainSet(ctx, LINE, 800, 600, net, ts, true, false, false, undefined, ts.vehicles[1].id, ts.vehicles[2].id)
      const colors = strokes.map(s => s.color)
      expect(colors.filter(c => c === '#38bdf8')).toHaveLength(4) // outline of the selected train
      expect(colors.filter(c => c === '#f59e0b')).toHaveLength(1) // targeted vehicle
      expect(colors.filter(c => c === '#ef4444')).toHaveLength(1) // delete hover
      expect(ctx.fillText).toHaveBeenCalledWith('✕ Supprimer', expect.any(Number), expect.any(Number))
    })
  })

  describe('schematic tier', () => {
    it('draws a train as one thick stroke of constant width, whatever the zoom', () => {
      for (const scale of [0.2, 0.3]) {
        const { net, ts } = straightWithTrain()
        const ctx = createMockContext()
        const strokes = recordStrokes(ctx)
        renderTrainSet(ctx, { ...SCHEMATIC, scale }, 800, 600, net, ts, false, false, false)
        // One path through the six bogies, stroked twice: the halo then the marker
        expect(callCounts(ctx)).toEqual({ save: 1, restore: 1, beginPath: 1, moveTo: 1, lineTo: 5, stroke: 2 })
        expect(strokes.map(s => s.width)).toEqual([TRAIN_MARKER_WIDTH_PX + 3, TRAIN_MARKER_WIDTH_PX])
        expect(ctx.lineCap).toBe('round')
      }
    })

    it('runs the stroke from the lead bogie to the last one', () => {
      const { net, ts } = straightWithTrain()
      const ctx = createMockContext()
      renderTrainSet(ctx, SCHEMATIC, 800, 600, net, ts, false, false, false)
      const toSx = (x: number): number => (x - SCHEMATIC.x) * SCHEMATIC.scale + 400
      const tail = ts.vehicles[ts.vehicles.length - 1].rear
      expect(vi.mocked(ctx.moveTo).mock.calls[0][0]).toBeCloseTo(toSx(400 * ts.vehicles[0].front.t), 6)
      const lineTos = vi.mocked(ctx.lineTo).mock.calls
      expect(lineTos[lineTos.length - 1][0]).toBeCloseTo(toSx(400 * tail.t), 6)
    })

    it('draws a train too short on screen as a dot at its lead vehicle', () => {
      const { net, ts } = straightWithTrain()
      const cam = { ...SCHEMATIC, scale: 0.05 }
      const ctx = createMockContext()
      renderTrainSet(ctx, cam, 800, 600, net, ts, false, false, false)
      expect(callCounts(ctx)).toEqual({ save: 1, restore: 1, beginPath: 1, arc: 1, fill: 1, stroke: 1 })
      const [sx, sy, r] = vi.mocked(ctx.arc).mock.calls[0]
      expect(sx).toBeCloseTo((400 * ts.vehicles[0].front.t - cam.x) * cam.scale + 400, 6)
      expect(sy).toBeCloseTo(300, 6)
      expect(r).toBe(TRAIN_MARKER_DOT_RADIUS_PX)
    })

    it('takes the accent colour when selected and red under the delete tool', () => {
      const colorOf = (isSelected: boolean, deleting: boolean): unknown => {
        const { net, ts } = straightWithTrain()
        const ctx = createMockContext()
        const strokes = recordStrokes(ctx)
        renderTrainSet(ctx, SCHEMATIC, 800, 600, net, ts, isSelected, false, false, undefined, null, deleting ? ts.vehicles[0].id : null)
        return strokes[strokes.length - 1].color
      }
      expect(colorOf(false, false)).toBe('#1a1a1a')
      expect(colorOf(true, false)).toBe('#2563eb')
      expect(colorOf(true, true)).toBe('#ef4444')
    })

    it('follows the level band of the pass and is dimmed in a tunnel', () => {
      const ground = straightWithTrain()
      const skipped = createMockContext()
      renderTrainSet(skipped, SCHEMATIC, 800, 600, ground.net, ground.ts, false, false, false, undefined, null, null, { above: 0, upTo: 1 })
      expect(skipped.stroke).not.toHaveBeenCalled()

      const tunnel = straightWithTrain(-1)
      const ctx = createMockContext()
      const strokes = recordStrokes(ctx)
      renderTrainSet(ctx, SCHEMATIC, 800, 600, tunnel.net, tunnel.ts, false, false, false, undefined, null, null, { above: -2, upTo: -1 })
      expect(strokes).toHaveLength(2)
      expect(strokes.every(s => s.alpha === TUNNEL_VEHICLE_ALPHA)).toBe(true)
    })

    it('leaves the debug overlay as it is', () => {
      const { net, ts } = straightWithTrain()
      const ctx = createMockContext()
      renderTrainSet(ctx, SCHEMATIC, 800, 600, net, ts, false, false, true)
      const labels = vi.mocked(ctx.fillText).mock.calls.map(c => c[0]).filter((t): t is string => typeof t === 'string' && / m$/.test(t))
      expect(labels).toEqual(['14.00 m', '6.29 m', '18.70 m', '18.70 m', '18.70 m'])
    })

    it('draws the legacy consist as the same marker', () => {
      const { net, segId } = straightWithTrain()
      const loco = createLocomotive(net, segId, 0.7, 20, 14, 3)!
      const ctx = createMockContext()
      const strokes = recordStrokes(ctx)
      renderLocomotive(ctx, SCHEMATIC, 800, 600, net, loco, false, false, true)
      expect(ctx.fill).not.toHaveBeenCalled()
      expect(strokes.map(s => [s.color, s.width])).toEqual([['#ffffff', TRAIN_MARKER_WIDTH_PX + 3], ['#2563eb', TRAIN_MARKER_WIDTH_PX]])
    })
  })

  describe('drawTrainMarker', () => {
    it('splits the stroke where the train changes level, each run drawn at its own level', () => {
      const ctx = createMockContext()
      const levels: number[] = []
      drawTrainMarker(
        ctx, p => p.x, () => 0,
        [{ pos: { x: 0, y: 0 }, level: 0 }, { pos: { x: 20, y: 0 }, level: 0 }, { pos: { x: 40, y: 0 }, level: 1 }, { pos: { x: 60, y: 0 }, level: 1 }],
        { color: 'red', halo: 'white' },
        (level, draw) => { levels.push(level); draw() },
      )
      // The stretch that climbs follows the higher end, like a gangway
      expect(levels).toEqual([0, 1])
      expect(vi.mocked(ctx.moveTo).mock.calls.map(c => c[0])).toEqual([0, 20])
      expect(vi.mocked(ctx.lineTo).mock.calls.map(c => c[0])).toEqual([20, 40, 60])
    })

    it('draws nothing without a stop', () => {
      const ctx = createMockContext()
      drawTrainMarker(ctx, p => p.x, p => p.y, [], { color: 'red', halo: 'white' }, (_l, draw) => draw())
      expect(callCounts(ctx)).toEqual({})
    })
  })
})
