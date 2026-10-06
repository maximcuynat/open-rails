/** Ink of a drawing on a light sheet: what the posts and the masts are drawn with where there is no stylesheet */
export const DEFAULT_INK = '#111827'

/**
 * The ink of the theme a canvas is drawn in (the colour of its rails), for the thin strokes that
 * stand on the sheet itself — the mast of a signal, the post of a board: dark on a light sheet,
 * light on a dark one. `DEFAULT_INK` where there is no stylesheet (tests).
 */
export function themeInk(ctx: CanvasRenderingContext2D): string {
  try {
    if (typeof window !== 'undefined' && window.getComputedStyle && ctx.canvas) {
      return window.getComputedStyle(ctx.canvas).getPropertyValue('--rail').trim() || DEFAULT_INK
    }
  } catch {
    // No stylesheet: the default ink
  }
  return DEFAULT_INK
}
