import { describe, expect, it, vi } from 'vitest'
import type { DatasetIndex, IndexLine } from '@domain/dataset/datasetIndex'
import { LINE_CATEGORY_COLORS, railTintOf, renderDatasetOverview } from './datasetOverview'

function mockContext() {
  const strokes: string[] = []
  const ctx = {
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), save: vi.fn(), restore: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), arc: vi.fn(), closePath: vi.fn(),
    roundRect: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 40 })), rect: vi.fn(), setLineDash: vi.fn(),
    strokeStyle: '', fillStyle: '', lineWidth: 0, globalAlpha: 1, lineCap: '', lineJoin: '', font: '', textAlign: '', textBaseline: '',
    stroke: vi.fn(() => { strokes.push(ctx.strokeStyle) }),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes }
}

const line = (id: string, highSpeed: boolean, outline: number[][], box: [number, number, number, number]): IndexLine => ({
  id, name: id, highSpeed, file: `${id}.json`, bytes: 1, rails: 1, lengthKm: 1, stations: [], outline,
  bbox: { minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] },
})

const index = (lines: IndexLine[], stations: DatasetIndex['stations'] = []): DatasetIndex => ({
  version: 1, dataDate: '', generatedAt: '', attribution: [], frame: 'lambert93', origin: { lat: 0, lon: 0 }, lines, connections: [], stations,
})

// 1 px for 100 m, the view 800 × 600 on the origin: 80 km by 60 km
const CAM = { x: 0, y: 0, scale: 0.01 }

describe('the lines of a dataset that are not loaded', () => {
  it('draws their outlines in the colour of their kind, not those that are loaded nor those out of view', () => {
    const { ctx, strokes } = mockContext()
    const lgv = line('lgv', true, [[-30_000, 0, 0, 5000, 30_000, 0]], [-30_000, 0, 30_000, 5000])
    const approach = line('racc', false, [[0, 0, 0, 20_000]], [0, 0, 0, 20_000])
    const loaded = line('here', true, [[0, 0, 10_000, 10_000]], [0, 0, 10_000, 10_000])
    const far = line('far', true, [[900_000, 0, 950_000, 0]], [900_000, 0, 950_000, 0])
    const count = renderDatasetOverview(ctx, CAM, 800, 600, index([lgv, approach, loaded, far]), new Set(['here']))
    expect(count).toBe(2)
    expect(strokes).toEqual([LINE_CATEGORY_COLORS.highSpeed, LINE_CATEGORY_COLORS.main])
    expect(vi.mocked(ctx.moveTo).mock.calls).toEqual([[100, 300], [400, 300]])
  })

  it('passes over the points of a stroke that fall on the last one drawn, but for its end', () => {
    const { ctx } = mockContext()
    // A point every 50 m: half a pixel apart
    const dense = Array.from({ length: 201 }, (_, i) => [i * 50, 0]).flat()
    renderDatasetOverview(ctx, CAM, 800, 600, index([line('lgv', true, [dense], [0, 0, 10_000, 0])]), new Set())
    const xs = vi.mocked(ctx.lineTo).mock.calls.map((c) => c[0])
    expect(xs.length).toBeLessThan(60)
    expect(xs[xs.length - 1]).toBe(500)
  })

  it('marks the stations of lines not loaded, and leaves the others to the network', () => {
    const { ctx } = mockContext()
    const stations = [
      { id: 'a', name: 'Ailleurs', x: 5000, y: 0, lines: ['lgv'] },
      { id: 'b', name: 'Ici', x: -5000, y: 0, lines: ['here', 'lgv'] },
    ]
    renderDatasetOverview(ctx, CAM, 800, 600, index([line('lgv', true, [[0, 0, 10, 10]], [0, 0, 10, 10])], stations), new Set(['here']))
    const written = vi.mocked(ctx.fillText).mock.calls.map((c) => c[0])
    expect(written).toEqual(['Ailleurs'])
  })

  it('draws nothing of an index without outlines', () => {
    const { ctx, strokes } = mockContext()
    const old = line('old', true, [], [0, 0, 10, 10])
    delete old.outline
    expect(renderDatasetOverview(ctx, CAM, 800, 600, index([old]), new Set())).toBe(0)
    expect(strokes).toEqual([])
  })

  it('gives each rail of the loaded lines the colour of the kind of its line', () => {
    const lgv = line('lgv', true, [], [0, 0, 1, 1])
    const approach = { ...line('racc', false, [], [0, 0, 1, 1]), category: 'main' as const }
    const files = new Map([
      ['lgv', { segments: [{ id: 's_1' }, { id: 's_2' }] }],
      // s_2 is on the border: it keeps the kind of the first line that holds it
      ['racc', { segments: [{ id: 's_2' }, { id: 's_3' }] }],
    ])
    const tint = railTintOf(index([lgv, approach, line('absent', true, [], [0, 0, 1, 1])]), files)
    expect(tint('s_1')).toBe(LINE_CATEGORY_COLORS.highSpeed)
    expect(tint('s_2')).toBe(LINE_CATEGORY_COLORS.highSpeed)
    expect(tint('s_3')).toBe(LINE_CATEGORY_COLORS.main)
    expect(tint('s_4')).toBeUndefined()
  })
})
