import { describe, it, expect } from 'vitest'
import {
  SCALE_PRESETS,
  formatDistance,
  formatRadius,
  formatAngle,
  parseDistance,
  toUnitValue,
} from './units'

describe('Units and Scale System', () => {
  it('has valid scale presets', () => {
    expect(SCALE_PRESETS['1:1'].defaultGauge).toBe(1.435)
    expect(SCALE_PRESETS['HO'].defaultGauge).toBe(0.0165)
    expect(SCALE_PRESETS['HO'].defaultBoardWidth).toBe(2.40)
    expect(SCALE_PRESETS['HO'].defaultBoardHeight).toBe(1.20)
    expect(SCALE_PRESETS['N'].defaultGauge).toBe(0.009)
    expect(SCALE_PRESETS['N'].defaultBoardWidth).toBe(1.60)
    expect(SCALE_PRESETS['TT'].defaultGauge).toBe(0.012)
    expect(SCALE_PRESETS['O'].defaultGauge).toBe(0.032)
    expect(SCALE_PRESETS['Z'].defaultGauge).toBe(0.0065)
  })

  it('formats distances correctly in meters, centimeters and millimeters', () => {
    expect(formatDistance(12.3456, 'm')).toBe('12.35 m')
    expect(formatDistance(0.248, 'mm', 0)).toBe('248 mm')
    expect(formatDistance(0.248, 'cm', 1)).toBe('24.8 cm')
    expect(formatDistance(Infinity, 'm')).toBe('—')
  })

  it('formats radii correctly', () => {
    expect(formatRadius(500, 'm')).toBe('R 500.00 m')
    expect(formatRadius(0.4375, 'mm')).toBe('R 438 mm')
    expect(formatRadius(Infinity, 'm')).toBe('R ∞')
  })

  it('formats angles correctly', () => {
    expect(formatAngle(45)).toBe('45.0°')
    expect(formatAngle(22.567, 2)).toBe('22.57°')
  })

  it('parses distance correctly into world meters', () => {
    expect(parseDistance('248', 'mm')).toBeCloseTo(0.248)
    expect(parseDistance('24.8', 'cm')).toBeCloseTo(0.248)
    expect(parseDistance('12.5', 'm')).toBeCloseTo(12.5)
    expect(parseDistance('12,5', 'm')).toBeCloseTo(12.5)
  })

  it('converts world meters to numeric unit value', () => {
    expect(toUnitValue(1.5, 'm')).toBe(1.5)
    expect(toUnitValue(1.5, 'cm')).toBe(150)
    expect(toUnitValue(1.5, 'mm')).toBe(1500)
  })
})
