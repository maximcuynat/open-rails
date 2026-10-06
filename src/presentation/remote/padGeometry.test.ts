import { describe, expect, it } from 'vitest'
import {
  BRAKE_LEVER_NEUTRAL,
  brakeCommandAtRatio,
  notchAtRatio,
  ratioOfNotch,
} from '@presentation/components/console/leverGeometry'
import { MIN_BRAKE_TRAVEL, MIN_SLIDE_PER_NOTCH, padRatioAfterDrag, padTravel } from './padGeometry'

describe('padRatioAfterDrag', () => {
  it('does not move the lever when the thumb lands', () => {
    expect(padRatioAfterDrag(0.3, 0, 400)).toBeCloseTo(0.3)
  })

  it('follows the thumb one for one: up raises, down lowers', () => {
    expect(padRatioAfterDrag(0.5, -100, 400)).toBeCloseTo(0.75)
    expect(padRatioAfterDrag(0.5, 100, 400)).toBeCloseTo(0.25)
  })

  it('stops at the two ends of the travel', () => {
    expect(padRatioAfterDrag(0.9, -400, 400)).toBe(1)
    expect(padRatioAfterDrag(0.1, 400, 400)).toBe(0)
  })

  it('stays put on a pad that has no size yet', () => {
    expect(padRatioAfterDrag(0.4, -50, 0)).toBeCloseTo(0.4)
    expect(padRatioAfterDrag(0.4, Number.NaN, 400)).toBeCloseTo(0.4)
  })
})

describe('a traction pad', () => {
  const min = -5
  const max = 5
  const travel = 400
  const notchAfter = (start: number, dy: number) =>
    notchAtRatio(padRatioAfterDrag(ratioOfNotch(start, min, max), dy, travel), min, max)

  it('keeps its notch wherever the thumb lands, and under half a notch of slide', () => {
    expect(notchAfter(2, 0)).toBe(2)
    expect(notchAfter(2, -15)).toBe(2)
    expect(notchAfter(2, 15)).toBe(2)
  })

  it('moves one notch per notch of travel', () => {
    // 400 px for 10 notches: 40 px each
    expect(notchAfter(2, -40)).toBe(3)
    expect(notchAfter(2, -120)).toBe(5)
    expect(notchAfter(2, 80)).toBe(0)
    expect(notchAfter(0, 200)).toBe(-5)
  })

  it('does not go past the last notch', () => {
    expect(notchAfter(4, -400)).toBe(5)
    expect(notchAfter(-4, 400)).toBe(-5)
  })
})

describe('a brake pad', () => {
  const travel = 400
  const commandAfter = (dy: number) => brakeCommandAtRatio(padRatioAfterDrag(BRAKE_LEVER_NEUTRAL, dy, travel))

  it('holds where the thumb lands and around it', () => {
    expect(commandAfter(0)).toBe('hold')
    expect(commandAfter(40)).toBe('hold')
    expect(commandAfter(-40)).toBe('hold')
  })

  it('applies when pulled down and releases when pushed up', () => {
    expect(commandAfter(80)).toBe('apply')
    expect(commandAfter(-80)).toBe('release')
    expect(commandAfter(1000)).toBe('apply')
  })
})

describe('padTravel', () => {
  it('is the drawn travel on a tall pad: the lever follows the thumb one for one', () => {
    expect(padTravel(420, 10 * MIN_SLIDE_PER_NOTCH)).toBe(420)
  })

  it('never asks for less than a deliberate slide on a short pad', () => {
    const travel = padTravel(135, 10 * MIN_SLIDE_PER_NOTCH)
    expect(travel).toBe(280)
    // 13 px was a notch of the drawing: it no longer moves the lever, a full slide does
    const notchAfter = (dy: number) => notchAtRatio(padRatioAfterDrag(ratioOfNotch(0, -5, 5), dy, travel), -5, 5)
    expect(notchAfter(-13)).toBe(0)
    expect(notchAfter(-MIN_SLIDE_PER_NOTCH)).toBe(1)
  })

  it('keeps the dead zone of a short brake pad wider than a resting thumb', () => {
    const travel = padTravel(135, MIN_BRAKE_TRAVEL)
    expect(brakeCommandAtRatio(padRatioAfterDrag(BRAKE_LEVER_NEUTRAL, 30, travel))).toBe('hold')
    expect(brakeCommandAtRatio(padRatioAfterDrag(BRAKE_LEVER_NEUTRAL, 45, travel))).toBe('apply')
  })

  it('survives a pad that has no size yet', () => {
    expect(padTravel(Number.NaN, 240)).toBe(240)
  })
})
