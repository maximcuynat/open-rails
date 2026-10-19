import type { Camera } from '@infrastructure/render/camera'
import type { Network, Platform, Point, TrackSpan } from '@domain/models/types'
import { edgeLine, platformOutline, type PlatformDimensions } from '@domain/models/platforms'

// ─────────────────── Platform tool: the platform being laid ───────────────────
//
// Only the preview of the tool: the platforms already laid are drawn by `platformRender.ts`.

/** Colour of the platform being laid */
export const PLATFORM_PREVIEW_COLOR = '#0d9488'
const REFUSED_COLOR = '#dc2626'

export interface PlatformPreviewDrawing {
  /** Start of the platform (after the first click), or the place the first click would take */
  start: Point | null
  /** The start was caught by something near it */
  startSnapped: boolean
  /** End under the cursor, once the start is set */
  end: Point | null
  /** What the end was caught by, and where that stands */
  endSnap: { kind: string; from: Point } | null
  /** The track walked from the start to the end, even when nothing would be laid */
  track: readonly TrackSpan[] | null
  /** The platforms the click would lay, each as its edges */
  platforms: readonly Platform['edges'][]
  dims: PlatformDimensions
  /** The click would lay nothing */
  refused: boolean
  /** One text near the cursor: length and kind, or why not */
  label: string | null
  labelAt: Point
}

export function renderPlatformPreview(ctx: CanvasRenderingContext2D, cam: Camera, vw: number, vh: number, net: Network, drawing: PlatformPreviewDrawing): void {
  const toScreen = (p: Point): Point => ({ x: (p.x - cam.x) * cam.scale + vw / 2, y: (p.y - cam.y) * cam.scale + vh / 2 })
  const tolerance = 0.5 / cam.scale
  const polyline = (points: readonly Point[], close = false): void => {
    ctx.beginPath()
    points.forEach((p, i) => {
      const s = toScreen(p)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    })
    if (close) ctx.closePath()
  }
  const colour = drawing.refused ? REFUSED_COLOR : PLATFORM_PREVIEW_COLOR

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // The track the platform runs along
  if (drawing.track && drawing.track.length > 0) {
    const line = edgeLine(net, { track: [...drawing.track], side: 'left' }, 0, tolerance)
    if (line.length >= 2) {
      ctx.strokeStyle = colour
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 4
      ctx.setLineDash([8, 6])
      polyline(line)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // The platforms themselves: body, and the edge along the track drawn stronger
  for (const edges of drawing.platforms) {
    const platform: Platform = { id: 'preview', stationId: '', edges, width: drawing.dims.width, markers: [] }
    const outline = platformOutline(net, platform, drawing.dims)
    if (!outline || outline.length < 3) continue
    ctx.globalAlpha = 0.28
    ctx.fillStyle = PLATFORM_PREVIEW_COLOR
    polyline(outline, true)
    ctx.fill()
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = PLATFORM_PREVIEW_COLOR
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.lineWidth = 3
    for (const edge of edges) {
      const nose = edgeLine(net, edge, drawing.dims.edgeOffset, tolerance)
      if (nose.length < 2) continue
      polyline(nose)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  // Alignment with what the end was caught by: a dashed line across the track
  if (drawing.end && drawing.endSnap) {
    const a = toScreen(drawing.endSnap.from)
    const b = toScreen(drawing.end)
    if (Math.hypot(a.x - b.x, a.y - b.y) > 2) {
      ctx.strokeStyle = PLATFORM_PREVIEW_COLOR
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  const mark = (p: Point, snapped: boolean): void => {
    const s = toScreen(p)
    ctx.fillStyle = colour
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    if (snapped) {
      ctx.strokeStyle = colour
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(s.x, s.y, 9, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  if (drawing.start) mark(drawing.start, drawing.startSnapped)
  if (drawing.end) mark(drawing.end, drawing.endSnap !== null)

  if (drawing.label) {
    const at = toScreen(drawing.labelAt)
    ctx.font = '600 11px Archivo, system-ui, sans-serif'
    const lw = ctx.measureText(drawing.label).width
    ctx.fillStyle = drawing.refused ? 'rgba(220, 38, 38, 0.92)' : 'rgba(15, 23, 42, 0.92)'
    ctx.beginPath()
    ctx.roundRect(at.x - lw / 2 - 6, at.y - 34, lw + 12, 18, 4)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(drawing.label, at.x, at.y - 24)
  }
  ctx.restore()
}

// ─────────────────── Platform tool: a station template ───────────────────

export interface PlatformTemplateDrawing {
  /** The place of the track the template is laid around */
  at: Point
  /** The rails the click would lay (a quadratic curve when `via` is given) */
  rails: readonly { from: Point; to: Point; via?: Point }[]
  /** The platforms the click would lay, as closed outlines */
  outlines: readonly (readonly Point[])[]
  /** The click would lay nothing */
  refused: boolean
  label: string
  labelAt: Point
}

export function renderPlatformTemplatePreview(ctx: CanvasRenderingContext2D, cam: Camera, vw: number, vh: number, drawing: PlatformTemplateDrawing): void {
  const toScreen = (p: Point): Point => ({ x: (p.x - cam.x) * cam.scale + vw / 2, y: (p.y - cam.y) * cam.scale + vh / 2 })
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // The new track
  ctx.strokeStyle = PLATFORM_PREVIEW_COLOR
  ctx.globalAlpha = 0.75
  ctx.lineWidth = 3
  ctx.setLineDash([8, 6])
  for (const rail of drawing.rails) {
    const a = toScreen(rail.from)
    const b = toScreen(rail.to)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    if (rail.via) {
      const c = toScreen(rail.via)
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y)
    } else {
      ctx.lineTo(b.x, b.y)
    }
    ctx.stroke()
  }
  ctx.setLineDash([])

  // The platforms
  for (const outline of drawing.outlines) {
    if (outline.length < 3) continue
    ctx.beginPath()
    outline.forEach((p, i) => {
      const s = toScreen(p)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    })
    ctx.closePath()
    ctx.globalAlpha = 0.28
    ctx.fillStyle = PLATFORM_PREVIEW_COLOR
    ctx.fill()
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = PLATFORM_PREVIEW_COLOR
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // Where it stands on the track
  const at = toScreen(drawing.at)
  ctx.fillStyle = drawing.refused ? REFUSED_COLOR : PLATFORM_PREVIEW_COLOR
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(at.x, at.y, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  const labelAt = toScreen(drawing.labelAt)
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const lw = ctx.measureText(drawing.label).width
  ctx.fillStyle = drawing.refused ? 'rgba(220, 38, 38, 0.92)' : 'rgba(15, 23, 42, 0.92)'
  ctx.beginPath()
  ctx.roundRect(labelAt.x - lw / 2 - 6, labelAt.y - 34, lw + 12, 18, 4)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(drawing.label, labelAt.x, labelAt.y - 24)
  ctx.restore()
}
