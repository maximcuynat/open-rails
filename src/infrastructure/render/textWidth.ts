/**
 * Width of a text in the current font of a canvas, measured once: `measureText` is among the
 * dearest calls of the 2D canvas, and the labels of the network say the same things frame after
 * frame. Kept per canvas context, so two canvases (or two test doubles) never share a measure.
 */
const widths = new WeakMap<CanvasRenderingContext2D, Map<string, number>>()

/** Past this many texts the measures of a canvas are dropped: lengths in a label change as a rail is dragged */
const MAX_KEPT_WIDTHS = 4000

export function textWidth(ctx: CanvasRenderingContext2D, text: string): number {
  let kept = widths.get(ctx)
  if (!kept) {
    kept = new Map()
    widths.set(ctx, kept)
  }
  const key = `${ctx.font}\n${text}`
  let width = kept.get(key)
  if (width === undefined) {
    if (kept.size >= MAX_KEPT_WIDTHS) kept.clear()
    width = ctx.measureText(text).width
    kept.set(key, width)
  }
  return width
}
