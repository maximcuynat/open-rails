/**
 * Geometry of the thumb pads of the phone desk. A pad is a lever as large as its zone, moved by a
 * relative gesture: the thumb lands anywhere, nothing moves, then the lever follows the slide — one
 * for one on a tall pad, slower on a short one so that a notch always takes a deliberate slide.
 * Positions are ratios along the travel, as in `leverGeometry.ts`: 0 at the bottom stop, 1 at the
 * top stop.
 */

/** The least a thumb slides to move a traction lever by one notch, px */
export const MIN_SLIDE_PER_NOTCH = 28
/** The least travel a brake pad is read on, px: its dead zone is a share of it (`BRAKE_LEVER_DEAD_ZONE`) */
export const MIN_BRAKE_TRAVEL = 240

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

/**
 * Where a lever that stood at `startRatio` is once the thumb has slid `dy` pixels (downwards
 * positive, as on screen) over a travel `travel` pixels tall. Clamped to the two stops.
 */
export function padRatioAfterDrag(startRatio: number, dy: number, travel: number): number {
  const start = clamp01(startRatio)
  if (!(travel > 0) || !Number.isFinite(dy)) return start
  return clamp01(start - dy / travel)
}

/**
 * The travel a slide is measured on: the height of the drawn travel, or `minTravel` when a small
 * screen leaves less. The thumb can let go and take the pad again to carry on.
 */
export function padTravel(trackHeight: number, minTravel: number): number {
  return Math.max(Number.isFinite(trackHeight) ? trackHeight : 0, minTravel)
}
