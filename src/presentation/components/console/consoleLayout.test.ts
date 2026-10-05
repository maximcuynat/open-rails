import { describe, expect, it } from 'vitest'
import {
  BAND_MIN_WIDTH,
  MIN_CONSOLE_SCALE,
  SCREEN_MIN_HEIGHT,
  SCREEN_MIN_WIDTH,
  arrangeConsole,
  chooseConsoleLayout,
  consolePlacement,
  consoleScale,
} from './consoleLayout'

describe('chooseConsoleLayout', () => {
  it('uses the thresholds of the plan', () => {
    expect([SCREEN_MIN_WIDTH, SCREEN_MIN_HEIGHT, BAND_MIN_WIDTH]).toEqual([1100, 720, 1000])
  })

  it('picks the on-board screen in a window wide and tall enough', () => {
    expect(chooseConsoleLayout(1100, 720, 'auto')).toBe('screen')
    expect(chooseConsoleLayout(1920, 920, 'auto')).toBe('screen')
  })

  it('picks the band in a wide window that is too low for the screen', () => {
    expect(chooseConsoleLayout(1100, 719, 'auto')).toBe('band')
    expect(chooseConsoleLayout(1366, 610, 'auto')).toBe('band')
    expect(chooseConsoleLayout(1000, 400, 'auto')).toBe('band')
  })

  it('picks the band between the two width thresholds, whatever the height', () => {
    expect(chooseConsoleLayout(1099, 720, 'auto')).toBe('band')
    expect(chooseConsoleLayout(1000, 1200, 'auto')).toBe('band')
  })

  it('picks the levers in a narrow window', () => {
    expect(chooseConsoleLayout(999, 719, 'auto')).toBe('levers')
    expect(chooseConsoleLayout(999, 1200, 'auto')).toBe('levers')
    expect(chooseConsoleLayout(900, 560, 'auto')).toBe('levers')
    expect(chooseConsoleLayout(390, 800, 'auto')).toBe('levers')
  })

  it('obeys an explicit choice at any size', () => {
    for (const [w, h] of [[390, 300], [1366, 610], [2560, 1400]]) {
      expect(chooseConsoleLayout(w, h, 'band')).toBe('band')
      expect(chooseConsoleLayout(w, h, 'screen')).toBe('screen')
      expect(chooseConsoleLayout(w, h, 'levers')).toBe('levers')
    }
  })
})

describe('consoleScale', () => {
  it('draws each console at full size in the window it is picked for', () => {
    expect(consoleScale('screen', 1100, 720)).toBe(1)
    expect(consoleScale('band', 1000, 610)).toBe(1)
    expect(consoleScale('band', 1366, 610)).toBe(1)
    expect(consoleScale('levers', 900, 560)).toBe(1)
    // The narrowest and lowest window the automatic choice gives the band
    expect(consoleScale('band', 1000, 300)).toBe(1)
  })

  it('shrinks a console forced into a window too small, in proportion', () => {
    // The on-board screen needs 468 + 2 × 12 px of height
    expect(consoleScale('screen', 1366, 492)).toBe(1)
    expect(consoleScale('screen', 1366, 443)).toBeCloseTo(0.9, 2)
    expect(consoleScale('screen', 440, 900)).toBeCloseTo(440 / 494)
    const band = consoleScale('band', 860, 610)
    expect(band).toBeLessThan(1)
    expect(band).toBeGreaterThan(MIN_CONSOLE_SCALE)
  })

  it('never goes under the minimum scale', () => {
    expect(consoleScale('screen', 300, 200)).toBe(MIN_CONSOLE_SCALE)
    expect(consoleScale('band', 300, 200)).toBe(MIN_CONSOLE_SCALE)
    expect(consoleScale('levers', 300, 200)).toBe(MIN_CONSOLE_SCALE)
    expect(consoleScale('levers', 0, 0)).toBe(MIN_CONSOLE_SCALE)
  })
})

describe('consolePlacement', () => {
  it('moves nothing when nobody drives and the debug panel is closed', () => {
    expect(consolePlacement(null, 1, 1366, 600, false)).toEqual({
      scaleBar: { right: 0, bottom: 0 },
      minimapLift: 0,
      debug: { right: 12, bottom: 12 },
    })
  })

  it('moves the scale bar left of the debug panel in the editor', () => {
    expect(consolePlacement(null, 1, 1366, 600, true).scaleBar).toEqual({ right: 232, bottom: 0 })
  })

  it('lifts the scale bar, the mini-map and the debug panel above the band', () => {
    const placement = consolePlacement('band', 1, 1366, 610, true)
    expect(placement.minimapLift).toBe(188)
    expect(placement.scaleBar).toEqual({ right: 232, bottom: 188 })
    expect(placement.debug).toEqual({ right: 12, bottom: 194 })
    // In a narrow window the debug panel pushes the scale bar onto the tools: it goes over them
    expect(consolePlacement('band', 1, 1000, 610, true).scaleBar).toEqual({ right: 232, bottom: 228 })
    expect(consolePlacement('band', 1, 1000, 610, false).scaleBar).toEqual({ right: 0, bottom: 188 })
    // Scaled down, the band is lower
    expect(consolePlacement('band', 0.8, 1366, 610, false).minimapLift).toBeCloseTo(150.4)
  })

  it('moves the scale bar left of the on-board screen and leaves the mini-map alone', () => {
    const placement = consolePlacement('screen', 1, 1920, 920, true)
    expect(placement.scaleBar).toEqual({ right: 482, bottom: 0 })
    expect(placement.minimapLift).toBe(0)
    // Room above the screen: the debug panel stacks on it
    expect(placement.debug).toEqual({ right: 12, bottom: 486 })
  })

  it('puts the debug panel beside the on-board screen in a window too low to stack them', () => {
    const placement = consolePlacement('screen', 1, 1366, 600, true)
    expect(placement.debug).toEqual({ right: 488, bottom: 12 })
    expect(placement.scaleBar.right).toBe(482 + 6 + 220)
    // Closed, the debug panel pushes nothing
    expect(consolePlacement('screen', 1, 1366, 600, false).scaleBar.right).toBe(482)
  })

  it('keeps the scale bar and the mini-map clear of both blocks of the levers console', () => {
    const tall = consolePlacement('levers', 1, 900, 900, true)
    expect(tall.scaleBar.right).toBe(326)
    expect(tall.scaleBar.bottom).toBe(tall.minimapLift)
    expect(tall.minimapLift).toBeGreaterThan(102)
    expect(tall.debug.right).toBe(12)

    const low = consolePlacement('levers', 1, 900, 560, true)
    expect(low.debug.right).toBe(332)
    expect(low.debug.bottom).toBeGreaterThan(low.minimapLift)
    expect(low.scaleBar.right).toBe(332 + 220)
  })
})

describe('arrangeConsole', () => {
  it('shows no console outside driving', () => {
    expect(arrangeConsole(1920, 920, 'auto', false, false)).toMatchObject({ layout: null, scale: 1 })
  })

  it('gives the console of each reference window at full size', () => {
    expect(arrangeConsole(1920, 920, 'auto', true, false)).toMatchObject({ layout: 'screen', scale: 1 })
    expect(arrangeConsole(1366, 610, 'auto', true, false)).toMatchObject({ layout: 'band', scale: 1 })
    expect(arrangeConsole(900, 560, 'auto', true, false)).toMatchObject({ layout: 'levers', scale: 1 })
  })

  it('shrinks a forced console and places the rest around its real size', () => {
    const forced = arrangeConsole(900, 460, 'screen', true, false)
    expect(forced.layout).toBe('screen')
    expect(forced.scale).toBeCloseTo(460 / 492)
    expect(forced.placement.scaleBar.right).toBeCloseTo(482 * forced.scale)
  })
})
