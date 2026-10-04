import { describe, expect, it } from 'vitest'
import { wheelIntent, type WheelLike } from './wheelIntent'

const wheel = (over: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...over,
})

describe('wheelIntent', () => {
  it('zooms on a mouse wheel notch', () => {
    expect(wheelIntent(wheel({ deltaY: 100, wheelDeltaY: -120 }))).toBe('zoom')
    expect(wheelIntent(wheel({ deltaY: -200, wheelDeltaY: 240 }))).toBe('zoom')
    // Scaled display: fractional deltaY, but still whole notches
    expect(wheelIntent(wheel({ deltaY: 83.3, wheelDeltaY: -120 }))).toBe('zoom')
  })

  it('zooms on a mouse wheel that scrolls in lines or pages', () => {
    expect(wheelIntent(wheel({ deltaY: 3, deltaMode: 1 }))).toBe('zoom')
    expect(wheelIntent(wheel({ deltaY: 1, deltaMode: 2 }))).toBe('zoom')
  })

  it('zooms on a mouse wheel when the browser gives no notch count', () => {
    expect(wheelIntent(wheel({ deltaY: 100 }))).toBe('zoom')
    expect(wheelIntent(wheel({ deltaY: -120 }))).toBe('zoom')
  })

  it('zooms on a trackpad pinch and on Ctrl/Cmd + wheel', () => {
    expect(wheelIntent(wheel({ deltaY: -2.5, ctrlKey: true }))).toBe('zoom')
    expect(wheelIntent(wheel({ deltaX: 4, deltaY: 6, metaKey: true }))).toBe('zoom')
  })

  it('pans on a two-finger trackpad slide', () => {
    expect(wheelIntent(wheel({ deltaY: 4, wheelDeltaY: -12 }))).toBe('pan')
    expect(wheelIntent(wheel({ deltaY: -37, wheelDeltaY: 111 }))).toBe('pan')
    expect(wheelIntent(wheel({ deltaX: 12, deltaY: 3, wheelDeltaY: -9 }))).toBe('pan')
    expect(wheelIntent(wheel({ deltaY: 1.25 }))).toBe('pan')
  })

  it('pans on a sideways scroll (trackpad, or Shift + wheel)', () => {
    expect(wheelIntent(wheel({ deltaX: 100 }))).toBe('pan')
    expect(wheelIntent(wheel({ deltaX: -8, deltaY: 0 }))).toBe('pan')
  })
})
