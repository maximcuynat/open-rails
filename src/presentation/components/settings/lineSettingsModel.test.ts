import { describe, expect, it } from 'vitest'
import { LINE_PRESETS, LINE_SPEED_RANGE } from '@domain/models/speedLimits'
import { LINE_CHOICES, applyLineChoice, lineChoiceId, parseLineSpeed } from './lineSettingsModel'

describe('line settings of the project', () => {
  it('offers every real line type, then one « other speed » entry per kind of line', () => {
    expect(LINE_CHOICES.slice(0, LINE_PRESETS.length).map((c) => c.id)).toEqual(LINE_PRESETS.map((p) => p.id))
    expect(LINE_CHOICES.slice(LINE_PRESETS.length).map((c) => c.id)).toEqual(['custom-classic', 'custom-highSpeed'])
  })

  it('recognises the preset the settings match, else the kind of line', () => {
    for (const preset of LINE_PRESETS) expect(lineChoiceId(preset)).toBe(preset.id)
    expect(lineChoiceId({ lineType: 'classic', lineSpeed: 140 })).toBe('custom-classic')
    expect(lineChoiceId({ lineType: 'highSpeed', lineSpeed: 270 })).toBe('custom-highSpeed')
    // A classic line at the speed of a high-speed preset is not that preset
    expect(lineChoiceId({ lineType: 'classic', lineSpeed: 300 })).toBe('custom-classic')
    expect(lineChoiceId({ lineType: 'classic', lineSpeed: NaN })).toBe('custom-classic')
  })

  it('a preset sets the speed and the kind of line, « other speed » keeps the speed', () => {
    const current = { lineType: 'classic', lineSpeed: 140 } as const
    expect(applyLineChoice('lgv300', current)).toEqual({ lineType: 'highSpeed', lineSpeed: 300 })
    expect(applyLineChoice('service30', current)).toEqual({ lineType: 'classic', lineSpeed: 30 })
    expect(applyLineChoice('custom-highSpeed', current)).toEqual({ lineType: 'highSpeed', lineSpeed: 140 })
    expect(applyLineChoice('unknown', current)).toEqual(current)
  })

  it('reads a typed line speed within the range of the line', () => {
    expect(parseLineSpeed('160')).toBe(160)
    expect(parseLineSpeed('159,6')).toBe(160)
    expect(parseLineSpeed(String(LINE_SPEED_RANGE.min))).toBe(LINE_SPEED_RANGE.min)
    expect(parseLineSpeed(String(LINE_SPEED_RANGE.max))).toBe(LINE_SPEED_RANGE.max)
    expect(parseLineSpeed(String(LINE_SPEED_RANGE.max + 10))).toBeNull()
    expect(parseLineSpeed('0')).toBeNull()
    expect(parseLineSpeed('')).toBeNull()
    expect(parseLineSpeed('vite')).toBeNull()
  })
})
