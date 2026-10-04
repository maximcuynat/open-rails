/** The fields of a WheelEvent the classification relies on (`wheelDeltaY` is non-standard: Chrome, Edge, Safari). */
export interface WheelLike {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  metaKey: boolean
  wheelDeltaY?: number
}

export type WheelIntent = 'zoom' | 'pan'

/**
 * Tell a mouse wheel or a trackpad pinch (zoom) from a two-finger trackpad slide (pan).
 * Browsers do not expose the device, so this is a heuristic:
 *  - a pinch arrives as a wheel event with ctrlKey set (Ctrl/Cmd + wheel zooms as well);
 *  - a mouse wheel scrolls in lines (Firefox) or in whole notches along Y only;
 *  - anything else is a trackpad slide, with small pixel deltas on both axes.
 */
export function wheelIntent(e: WheelLike): WheelIntent {
  if (e.ctrlKey || e.metaKey) return 'zoom'
  if (e.deltaMode !== 0) return 'zoom'
  if (e.deltaX !== 0) return 'pan'
  const notches = e.wheelDeltaY
  if (typeof notches === 'number' && notches !== 0) {
    return Math.abs(notches) % 120 === 0 ? 'zoom' : 'pan'
  }
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100 ? 'zoom' : 'pan'
}
