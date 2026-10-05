import { describe, expect, it } from 'vitest'
import {
  BRAKE_LEVER_DEAD_ZONE,
  LEVER_TRACK_BOTTOM,
  LEVER_TRACK_TOP,
  LEVER_VIEW_HEIGHT,
  brakeCommandAtRatio,
  leverRatioAt,
  leverY,
  notchAtRatio,
  ratioOfBrakeCommand,
  ratioOfNotch,
} from './leverGeometry'

describe('lever geometry', () => {
  it('reads a pointer along the travel: 0 at the bottom stop, 1 at the top', () => {
    // A lever drawn at its natural size, its box starting 100 px down the page
    const at = (y: number) => leverRatioAt(100 + y, 100, LEVER_VIEW_HEIGHT)
    expect(at(LEVER_TRACK_BOTTOM)).toBe(0)
    expect(at(LEVER_TRACK_TOP)).toBe(1)
    expect(at((LEVER_TRACK_TOP + LEVER_TRACK_BOTTOM) / 2)).toBeCloseTo(0.5)
  })

  it('clamps a pointer dragged past the stops', () => {
    expect(leverRatioAt(-500, 100, LEVER_VIEW_HEIGHT)).toBe(1)
    expect(leverRatioAt(5000, 100, LEVER_VIEW_HEIGHT)).toBe(0)
  })

  it('reads the same position whatever the scale the lever is drawn at', () => {
    for (const scale of [0.8, 1, 1.6]) {
      const height = LEVER_VIEW_HEIGHT * scale
      expect(leverRatioAt(40 + LEVER_TRACK_BOTTOM * scale, 40, height)).toBeCloseTo(0)
      expect(leverRatioAt(40 + LEVER_TRACK_TOP * scale, 40, height)).toBeCloseTo(1)
      expect(leverRatioAt(40 + 145 * scale, 40, height)).toBeCloseTo(0.5)
    }
  })

  it('survives a lever that is not laid out yet', () => {
    expect(leverRatioAt(10, 0, 0)).toBe(0)
    expect(leverRatioAt(NaN, 0, 290)).toBe(0)
  })

  it('draws a ratio back where the pointer read it', () => {
    expect(leverY(0)).toBe(LEVER_TRACK_BOTTOM)
    expect(leverY(1)).toBe(LEVER_TRACK_TOP)
    expect(leverRatioAt(leverY(0.3), 0, LEVER_VIEW_HEIGHT)).toBeCloseTo(0.3)
    expect(leverY(7)).toBe(LEVER_TRACK_TOP)
  })
})

describe('traction lever', () => {
  it('snaps to the notches from B5 at the bottom to P5 at the top', () => {
    expect(notchAtRatio(0, -5, 5)).toBe(-5)
    expect(notchAtRatio(0.5, -5, 5)).toBe(0)
    expect(notchAtRatio(1, -5, 5)).toBe(5)
    expect(notchAtRatio(0.8, -5, 5)).toBe(3)
    expect(notchAtRatio(0.2, -5, 5)).toBe(-3)
  })

  it('changes notch half-way between two stops', () => {
    // P1 sits at 0.6, P2 at 0.7
    expect(notchAtRatio(0.649, -5, 5)).toBe(1)
    expect(notchAtRatio(0.651, -5, 5)).toBe(2)
    // Around N: never a negative zero
    expect(Object.is(notchAtRatio(0.49, -5, 5), 0)).toBe(true)
  })

  it('stays within the stops', () => {
    expect(notchAtRatio(3, -5, 5)).toBe(5)
    expect(notchAtRatio(-3, -5, 5)).toBe(-5)
    expect(notchAtRatio(NaN, -5, 5)).toBe(-5)
  })

  it('handles the three positions of the legacy throttle', () => {
    expect([0, 0.2, 0.5, 0.8, 1].map((r) => notchAtRatio(r, -1, 1))).toEqual([-1, -1, 0, 1, 1])
  })

  it('puts each notch back on its stop', () => {
    for (let notch = -5; notch <= 5; notch++) {
      expect(notchAtRatio(ratioOfNotch(notch, -5, 5), -5, 5)).toBe(notch)
    }
    expect(ratioOfNotch(0, -5, 5)).toBe(0.5)
    expect(ratioOfNotch(9, -5, 5)).toBe(1)
    expect(ratioOfNotch(0, 0, 0)).toBe(0)
  })
})

describe('brake lever', () => {
  it('holds around the centre, releases pushed up, applies pulled down', () => {
    expect(brakeCommandAtRatio(0.5)).toBe('hold')
    expect(brakeCommandAtRatio(1)).toBe('release')
    expect(brakeCommandAtRatio(0)).toBe('apply')
  })

  it('does nothing inside the dead zone', () => {
    expect(brakeCommandAtRatio(0.5 + BRAKE_LEVER_DEAD_ZONE - 0.01)).toBe('hold')
    expect(brakeCommandAtRatio(0.5 - BRAKE_LEVER_DEAD_ZONE + 0.01)).toBe('hold')
    expect(brakeCommandAtRatio(0.5 + BRAKE_LEVER_DEAD_ZONE + 0.01)).toBe('release')
    expect(brakeCommandAtRatio(0.5 - BRAKE_LEVER_DEAD_ZONE - 0.01)).toBe('apply')
  })

  it('clamps a drag past the stops', () => {
    expect(brakeCommandAtRatio(4)).toBe('release')
    expect(brakeCommandAtRatio(-4)).toBe('apply')
  })

  it('rests where its command is, so the keys move it too', () => {
    expect(ratioOfBrakeCommand('hold')).toBe(0.5)
    for (const command of ['apply', 'hold', 'release'] as const) {
      expect(brakeCommandAtRatio(ratioOfBrakeCommand(command))).toBe(command)
    }
  })
})
