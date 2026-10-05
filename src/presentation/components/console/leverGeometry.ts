import type { BrakeCommand } from '@domain/models/trainDynamics'

/**
 * Geometry of the on-screen levers. A lever is read as a ratio along its travel: 0 at the bottom
 * stop, 1 at the top stop. Everything here is pure, the component only feeds it pointer positions.
 */

/** Travel of the levers in the units of their drawing (SVG user units, y grows downwards) */
export const LEVER_VIEW_HEIGHT = 290
export const LEVER_TRACK_TOP = 22
export const LEVER_TRACK_BOTTOM = 268

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

/**
 * Where a pointer stands along the travel of a lever drawn in a box that starts at `boxTop` and is
 * `boxHeight` tall (screen pixels, any zoom): 0 at the bottom stop, 1 at the top stop, clamped.
 */
export function leverRatioAt(clientY: number, boxTop: number, boxHeight: number): number {
  if (!(boxHeight > 0)) return 0
  const y = ((clientY - boxTop) / boxHeight) * LEVER_VIEW_HEIGHT
  return clamp01((LEVER_TRACK_BOTTOM - y) / (LEVER_TRACK_BOTTOM - LEVER_TRACK_TOP))
}

/** Height of a ratio in the drawing of the lever */
export function leverY(ratio: number): number {
  return LEVER_TRACK_BOTTOM - (LEVER_TRACK_BOTTOM - LEVER_TRACK_TOP) * clamp01(ratio)
}

/** The notch a traction lever snaps to: `minNotch` at the bottom stop, `maxNotch` at the top */
export function notchAtRatio(ratio: number, minNotch: number, maxNotch: number): number {
  const notch = Math.round(minNotch + clamp01(ratio) * (maxNotch - minNotch))
  // No "-0"
  return notch === 0 ? 0 : notch
}

/** Where a notch sits along the travel */
export function ratioOfNotch(notch: number, minNotch: number, maxNotch: number): number {
  if (!(maxNotch > minNotch)) return 0
  return clamp01((notch - minNotch) / (maxNotch - minNotch))
}

export const BRAKE_LEVER_NEUTRAL = 0.5
/** Share of the travel, either side of the centre, where the brake lever does nothing */
export const BRAKE_LEVER_DEAD_ZONE = 0.15

/** What a spring-centred brake lever commands: pushed up it releases, pulled down it applies */
export function brakeCommandAtRatio(ratio: number): BrakeCommand {
  const offset = clamp01(ratio) - BRAKE_LEVER_NEUTRAL
  if (offset > BRAKE_LEVER_DEAD_ZONE) return 'release'
  if (offset < -BRAKE_LEVER_DEAD_ZONE) return 'apply'
  return 'hold'
}

/** Where the brake lever rests for a command: the keyboard and the buttons move it too */
export function ratioOfBrakeCommand(command: BrakeCommand): number {
  return command === 'release' ? 1 : command === 'apply' ? 0 : BRAKE_LEVER_NEUTRAL
}
