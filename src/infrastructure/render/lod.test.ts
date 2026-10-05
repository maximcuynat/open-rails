import { describe, expect, it } from 'vitest'
import { GAUGE } from './renderer'
import { LOD_LINE_BELOW_PX, LOD_RAILS_BELOW_PX, LOD_SCHEMATIC_BELOW_PX, gaugeOnScreen, nodeMarkerShown, trackLod } from './lod'

describe('trackLod (palier de détail selon l\'écartement à l\'écran)', () => {
  it('still draws the two rails at the default 1:1 zoom, and every detail one notch closer', () => {
    expect(trackLod(2.5, GAUGE)).toBe('rails')
    expect(trackLod(3.5, GAUGE)).toBe('detail')
  })

  it('switches on the pixels between the rails, whatever the gauge', () => {
    for (const gauge of [GAUGE, 0.0165, 0.009]) {
      // A hair above each threshold: dividing by the gauge and multiplying back may round below it
      expect(trackLod((LOD_RAILS_BELOW_PX * 1.0001) / gauge, gauge)).toBe('detail')
      expect(trackLod((LOD_RAILS_BELOW_PX * 0.99) / gauge, gauge)).toBe('rails')
      expect(trackLod((LOD_LINE_BELOW_PX * 1.0001) / gauge, gauge)).toBe('rails')
      expect(trackLod((LOD_LINE_BELOW_PX * 0.99) / gauge, gauge)).toBe('line')
      expect(trackLod(LOD_SCHEMATIC_BELOW_PX / gauge, gauge)).toBe('line')
      expect(trackLod((LOD_SCHEMATIC_BELOW_PX * 0.99) / gauge, gauge)).toBe('schematic')
    }
  })

  it('measures the gauge on screen', () => {
    expect(gaugeOnScreen(2, 1.5)).toBe(3)
  })
})

describe('nodeMarkerShown', () => {
  it('shows every node in the detailed and rails drawings', () => {
    expect(nodeMarkerShown('detail', { selected: false, degree: 2 })).toBe(true)
    expect(nodeMarkerShown('rails', { selected: false, degree: 2 })).toBe(true)
  })

  it('keeps the ends of track and the selection in the line drawing', () => {
    expect(nodeMarkerShown('line', { selected: false, degree: 1 })).toBe(true)
    expect(nodeMarkerShown('line', { selected: true, degree: 2 })).toBe(true)
    expect(nodeMarkerShown('line', { selected: false, degree: 2 })).toBe(false)
    expect(nodeMarkerShown('line', { selected: false, degree: 3 })).toBe(false)
  })

  it('keeps only the selection in the schematic drawing', () => {
    expect(nodeMarkerShown('schematic', { selected: false, degree: 1 })).toBe(false)
    expect(nodeMarkerShown('schematic', { selected: true, degree: 1 })).toBe(true)
  })
})
