import { describe, expect, it } from 'vitest'
import { trackLod } from '@infrastructure/render/lod'
import { levelScales, percentile, summarise, zoomSweep } from './frameStats'

describe('figures of the frame bench', () => {
  it('reads percentiles by nearest rank, NaN when nothing was measured', () => {
    const samples = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10]
    expect(percentile(samples, 0.5)).toBe(5)
    expect(percentile(samples, 0.95)).toBe(10)
    expect(percentile([7], 0.95)).toBe(7)
    expect(percentile([], 0.5)).toBeNaN()
  })

  it('sums up paint times and the gaps between paints', () => {
    const summary = summarise([2, 4, 3], [100, 116, 150])
    expect(summary).toEqual({ frames: 3, drawP50: 3, drawP95: 4, gapP50: 16, gapP95: 34 })
  })

  it('puts the line and detail views inside their level of detail, at any gauge', () => {
    for (const gauge of [1.435, 0.0165]) {
      const { line, detail } = levelScales(gauge)
      expect(trackLod(line, gauge)).toBe('line')
      expect(trackLod(detail, gauge)).toBe('detail')
    }
  })

  it('zooms at a steady pace from one scale to the other', () => {
    const sweep = zoomSweep(0.01, 10, 4)
    expect(sweep[0]).toBeCloseTo(0.01)
    expect(sweep[3]).toBeCloseTo(10)
    expect(sweep[2] / sweep[1]).toBeCloseTo(sweep[1] / sweep[0])
  })
})
