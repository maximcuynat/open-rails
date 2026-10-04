import type { Camera } from '@infrastructure/render/camera'
import type { Point } from '@domain/models/types'
import { formatDistance, formatRadius, formatAngle, type Unit } from '@domain/models/units'

/**
 * High-precision CAD dimensioning overlays for OpenRails.
 * Draws professional technical drawing witness lines, arrowheads, and measurement callout pills.
 */

interface ScreenPoint {
  x: number
  y: number
}

function toScreen(p: Point, cam: Camera, vw: number, vh: number): ScreenPoint {
  return {
    x: (p.x - cam.x) * cam.scale + vw / 2,
    y: (p.y - cam.y) * cam.scale + vh / 2,
  }
}

/**
 * Draw an arrow head at (x, y) pointing in direction (dirX, dirY).
 */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  size: number = 7,
): void {
  const norm = Math.hypot(dirX, dirY)
  if (norm < 1e-4) return
  const ux = dirX / norm
  const uy = dirY / norm
  const nx = -uy
  const ny = ux

  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - ux * size + nx * (size * 0.4), y - uy * size + ny * (size * 0.4))
  ctx.lineTo(x - ux * (size * 0.7), y - uy * (size * 0.7))
  ctx.lineTo(x - ux * size - nx * (size * 0.4), y - uy * size - ny * (size * 0.4))
  ctx.closePath()
  ctx.fill()
}

/**
 * Draw a clean CAD dimension badge (pill) with text.
 */
function drawDimensionBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  primaryText: string,
  secondaryText?: string,
  badgeBg: string = 'rgba(15, 23, 42, 0.88)',
  accentColor: string = '#38bdf8',
): void {
  ctx.save()
  ctx.font = '600 11px system-ui, -apple-system, sans-serif'
  const text1 = primaryText
  const text2 = secondaryText ? ` (${secondaryText})` : ''
  const fullText = text1 + text2
  const textWidth = ctx.measureText(fullText).width
  const paddingX = 9
  const height = 22
  const width = textWidth + paddingX * 2
  const radius = 11

  const bx = cx - width / 2
  const by = cy - height / 2

  // Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2

  // Background pill
  ctx.fillStyle = badgeBg
  ctx.beginPath()
  ctx.roundRect(bx, by, width, height, radius)
  ctx.fill()

  // Border
  ctx.shadowColor = 'transparent'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Text
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = accentColor
  ctx.fillText(text1, bx + paddingX, cy)

  if (secondaryText) {
    const primaryW = ctx.measureText(text1).width
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(text2, bx + paddingX + primaryW, cy)
  }

  ctx.restore()
}

/**
 * Render a live CAD dimension line for a straight track.
 */
export function renderStraightDimension(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  start: Point,
  end: Point,
  lengthMeters: number,
  unit: Unit,
  options?: {
    side?: 1 | -1
    offsetPx?: number
    showAngle?: boolean
  },
): void {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lenWorld = Math.hypot(dx, dy)
  if (lenWorld < 1e-4) return

  const p1 = toScreen(start, cam, vw, vh)
  const p2 = toScreen(end, cam, vw, vh)

  const screenLen = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  if (screenLen < 15) return // Too small on screen to draw clear dimension

  const ux = (p2.x - p1.x) / screenLen
  const uy = (p2.y - p1.y) / screenLen
  const side = options?.side ?? 1
  const nx = -uy * side
  const ny = ux * side
  const offset = options?.offsetPx ?? 24

  // Offset points for dimension line
  const d1 = { x: p1.x + nx * offset, y: p1.y + ny * offset }
  const d2 = { x: p2.x + nx * offset, y: p2.y + ny * offset }

  ctx.save()

  // 1. Witness extension lines (lignes d'attache)
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)'
  ctx.lineWidth = 1
  ctx.setLineDash([2, 2])
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(d1.x + nx * 4, d1.y + ny * 4)
  ctx.moveTo(p2.x, p2.y)
  ctx.lineTo(d2.x + nx * 4, d2.y + ny * 4)
  ctx.stroke()
  ctx.setLineDash([])

  // 2. Dimension line
  ctx.strokeStyle = '#38bdf8'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(d1.x, d1.y)
  ctx.lineTo(d2.x, d2.y)
  ctx.stroke()

  // 3. Arrow heads at both ends
  ctx.fillStyle = '#38bdf8'
  drawArrowHead(ctx, d1.x, d1.y, ux, uy, 6)
  drawArrowHead(ctx, d2.x, d2.y, -ux, -uy, 6)

  // 4. Center badge with measurement
  const midX = (d1.x + d2.x) / 2
  const midY = (d1.y + d2.y) / 2

  const lengthStr = formatDistance(lengthMeters, unit)
  let angleStr: string | undefined
  if (options?.showAngle) {
    const angleDeg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
    angleStr = `∠ ${formatAngle(angleDeg, 1)}`
  }

  drawDimensionBadge(ctx, midX, midY, lengthStr, angleStr)

  ctx.restore()
}

/**
 * Render CAD live dimension overlay for a curve piece.
 */
export function renderCurveDimension(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  start: Point,
  via: Point,
  end: Point,
  radiusMeters: number,
  angleDeg: number,
  arcLengthMeters: number,
  unit: Unit,
): void {
  const pStart = toScreen(start, cam, vw, vh)
  const pVia = toScreen(via, cam, vw, vh)
  const pEnd = toScreen(end, cam, vw, vh)

  // Midpoint along curve (approx quadratic Bezier at t=0.5)
  const midX = 0.25 * pStart.x + 0.5 * pVia.x + 0.25 * pEnd.x
  const midY = 0.25 * pStart.y + 0.5 * pVia.y + 0.25 * pEnd.y

  ctx.save()

  // Radius text + Arc length text + Angle
  const radiusStr = formatRadius(radiusMeters, unit)
  const angleStr = `${formatAngle(angleDeg, 1)} • ${formatDistance(arcLengthMeters, unit)}`

  drawDimensionBadge(ctx, midX, midY - 14, radiusStr, angleStr, 'rgba(15, 23, 42, 0.90)', '#10b981')

  ctx.restore()
}
