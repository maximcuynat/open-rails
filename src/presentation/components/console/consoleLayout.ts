import type { ConsoleLayout, ConsolePreference } from '@application/console/consolePreference'

/**
 * Which console for which window, how much it is shrunk to fit, and what it pushes aside.
 * Widths and heights are those of the canvas area (not of the screen), in CSS pixels.
 */

/** From this width and height the on-board screen fits and leaves the track clear */
export const SCREEN_MIN_WIDTH = 1100
export const SCREEN_MIN_HEIGHT = 720
/** From this width the band fits along the bottom */
export const BAND_MIN_WIDTH = 1000

/** A console that does not fit is shrunk, down to this scale and no further */
export const MIN_CONSOLE_SCALE = 0.8

export function chooseConsoleLayout(width: number, height: number, preference: ConsolePreference): ConsoleLayout {
  if (preference !== 'auto') return preference
  if (width >= SCREEN_MIN_WIDTH && height >= SCREEN_MIN_HEIGHT) return 'screen'
  if (width >= BAND_MIN_WIDTH) return 'band'
  return 'levers'
}

/** Gap between a console and the edge of the canvas area, as in `.console-stage` */
export const CONSOLE_MARGIN = 12
/** Row of tools (train switcher, turnout, debug, quit) above the band and above the speed block */
const TOOLS = { width: 380, height: 40 }
/** Narrower than this, the figures either side of the band's dial run into it */
const BAND = { minWidth: 960, height: 176 }
const SCREEN = { width: 470, height: 468 }
/** The two levers and the emergency button, and the narrowest the speed block gets */
const LEVERS = { width: 314, height: 398, speedHeight: 102, speedMinWidth: 530 }
/** The debug panel (`.debug-panel` in the dock), which keeps its size whatever the console */
const DEBUG_PANEL = { width: 220, height: 206 }
const DOCK_GAP = 6
/** Room the scale bar takes at the bottom-right of the canvas, its margin included */
const SCALE_BAR_WIDTH = 160

/** Space a console needs at full size, margins included */
function naturalSize(layout: ConsoleLayout): { width: number; height: number } {
  const m = 2 * CONSOLE_MARGIN
  switch (layout) {
    case 'band':
      return { width: BAND.minWidth + m, height: BAND.height + TOOLS.height + m }
    case 'screen':
      return { width: SCREEN.width + m, height: SCREEN.height + m }
    case 'levers':
      return { width: LEVERS.speedMinWidth + CONSOLE_MARGIN + LEVERS.width + m, height: LEVERS.height + m }
  }
}

/** Scale at which a console is drawn: 1 when it fits, less in a window too small, never under the minimum */
export function consoleScale(layout: ConsoleLayout, width: number, height: number): number {
  const natural = naturalSize(layout)
  const fit = Math.min(1, width / natural.width, height / natural.height)
  return Number.isFinite(fit) ? Math.max(MIN_CONSOLE_SCALE, fit) : 1
}

export interface ConsolePlacement {
  /** Pixels the scale bar leaves free on the right and at the bottom of the canvas */
  scaleBar: { right: number; bottom: number }
  /** Pixels the mini-map is lifted by */
  minimapLift: number
  /** Where the debug panel docks, from the bottom-right corner of the canvas area */
  debug: { right: number; bottom: number }
}

/**
 * What moves out of the way of a console drawn at `scale` (`layout` null: nobody is driving).
 * The debug panel sits above whatever is in the bottom-right corner, or beside it when the
 * window is too low for both.
 */
export function consolePlacement(
  layout: ConsoleLayout | null,
  scale: number,
  width: number,
  height: number,
  debugShown: boolean,
): ConsolePlacement {
  const corner = { right: CONSOLE_MARGIN, bottom: CONSOLE_MARGIN }
  const debugWidth = debugShown ? DEBUG_PANEL.width + CONSOLE_MARGIN : 0
  if (layout === null) {
    return { scaleBar: { right: debugWidth, bottom: 0 }, minimapLift: 0, debug: corner }
  }
  if (layout === 'band') {
    // Everything rides above the band
    const top = (CONSOLE_MARGIN + BAND.height) * scale
    // The tools sit above the middle of the band: pushed that far left, the scale bar goes over them
    const overTools = width - debugWidth - SCALE_BAR_WIDTH < (width + TOOLS.width * scale) / 2
    return {
      scaleBar: { right: debugWidth, bottom: overTools ? top + TOOLS.height * scale : top },
      minimapLift: top,
      debug: { right: CONSOLE_MARGIN, bottom: top + DOCK_GAP },
    }
  }
  // A block in the bottom-right corner: the on-board screen, or the levers
  const block = layout === 'screen' ? SCREEN : LEVERS
  const blockWidth = (CONSOLE_MARGIN + block.width) * scale
  const blockTop = (CONSOLE_MARGIN + block.height) * scale
  // The speed block of the levers console runs along the bottom, with its tools above
  const floor = layout === 'levers' ? (CONSOLE_MARGIN + LEVERS.speedHeight + TOOLS.height) * scale : 0
  const debugAbove = blockTop + DOCK_GAP + DEBUG_PANEL.height + CONSOLE_MARGIN <= height
  if (!debugShown || debugAbove) {
    return {
      scaleBar: { right: blockWidth, bottom: floor },
      minimapLift: floor,
      debug: { right: CONSOLE_MARGIN, bottom: blockTop + DOCK_GAP },
    }
  }
  return {
    scaleBar: { right: blockWidth + DOCK_GAP + DEBUG_PANEL.width, bottom: floor },
    minimapLift: floor,
    debug: { right: blockWidth + DOCK_GAP, bottom: floor + (floor > 0 ? DOCK_GAP : CONSOLE_MARGIN) },
  }
}

export interface ConsoleArrangement {
  /** `null` when nobody is driving */
  layout: ConsoleLayout | null
  scale: number
  placement: ConsolePlacement
}

/** The whole decision for a canvas area: the console shown, its scale, and what it pushes aside */
export function arrangeConsole(
  width: number,
  height: number,
  preference: ConsolePreference,
  driving: boolean,
  debugShown: boolean,
): ConsoleArrangement {
  const layout = driving ? chooseConsoleLayout(width, height, preference) : null
  const scale = layout ? consoleScale(layout, width, height) : 1
  return { layout, scale, placement: consolePlacement(layout, scale, width, height, debugShown) }
}
