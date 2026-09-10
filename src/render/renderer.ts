import type { Camera } from './camera'

/** Choose a grid spacing (in world units) that keeps cells ~40–80 px on screen. */
function pickSpacing(scale: number): number {
  const target = 60 / scale // desired cell size in world units
  const power = Math.floor(Math.log10(target))
  const base = target / 10 ** power
  let step: number
  if (base < 1.5) step = 1
  else if (base < 3.5) step = 2
  else if (base < 7.5) step = 5
  else step = 10
  return step * 10 ** power
}

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
): void {
  ctx.save()

  // Fill background
  const bg = getComputedStyle(ctx.canvas).getPropertyValue('--paper').trim() || '#fff'
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, vw, vh)

  const minor = getComputedStyle(ctx.canvas).getPropertyValue('--grid').trim() || 'rgba(0,0,0,0.06)'
  const major = getComputedStyle(ctx.canvas).getPropertyValue('--grid-major').trim() || 'rgba(0,0,0,0.12)'

  const spacing = pickSpacing(cam.scale)
  const halfW = vw / 2 / cam.scale
  const halfH = vh / 2 / cam.scale

  const left = cam.x - halfW
  const right = cam.x + halfW
  const top = cam.y - halfH
  const bottom = cam.y + halfH

  const startX = Math.floor(left / spacing) * spacing
  const endX = Math.ceil(right / spacing) * spacing
  const startY = Math.floor(top / spacing) * spacing
  const endY = Math.ceil(bottom / spacing) * spacing

  ctx.lineWidth = 1

  // Minor grid lines
  ctx.strokeStyle = minor
  ctx.beginPath()
  for (let wx = startX; wx <= endX; wx += spacing) {
    const sx = (wx - cam.x) * cam.scale + vw / 2
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, vh)
  }
  for (let wy = startY; wy <= endY; wy += spacing) {
    const sy = (wy - cam.y) * cam.scale + vh / 2
    ctx.moveTo(0, sy)
    ctx.lineTo(vw, sy)
  }
  ctx.stroke()

  // Major grid lines (every 5th)
  ctx.strokeStyle = major
  ctx.beginPath()
  const majorSpacing = spacing * 5
  for (let wx = Math.floor(left / majorSpacing) * majorSpacing; wx <= endX; wx += majorSpacing) {
    const sx = (wx - cam.x) * cam.scale + vw / 2
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, vh)
  }
  for (let wy = Math.floor(top / majorSpacing) * majorSpacing; wy <= endY; wy += majorSpacing) {
    const sy = (wy - cam.y) * cam.scale + vh / 2
    ctx.moveTo(0, sy)
    ctx.lineTo(vw, sy)
  }
  ctx.stroke()

  // Origin marker
  const ox = (0 - cam.x) * cam.scale + vw / 2
  const oy = (0 - cam.y) * cam.scale + vh / 2
  if (ox >= -10 && ox <= vw + 10 && oy >= -10 && oy <= vh + 10) {
    ctx.strokeStyle = major
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(ox - 8, oy)
    ctx.lineTo(ox + 8, oy)
    ctx.moveTo(ox, oy - 8)
    ctx.lineTo(ox, oy + 8)
    ctx.stroke()
  }

  ctx.restore()

  renderScaleBar(ctx, cam, vw, vh)
}

/** Round to a "nice" number (1, 2, 5 × 10^n) closest to `value`. */
function niceNumber(value: number): number {
  const power = Math.floor(Math.log10(value))
  const base = value / 10 ** power
  let step: number
  if (base < 1.5) step = 1
  else if (base < 3.5) step = 2
  else if (base < 7.5) step = 5
  else step = 10
  return step * 10 ** power
}

/** Draw a scale bar in the bottom-right corner, adapted to the current zoom. */
function renderScaleBar(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
): void {
  const ink = getComputedStyle(ctx.canvas).getPropertyValue('--ink').trim() || '#1a1a1a'
  const panel = getComputedStyle(ctx.canvas).getPropertyValue('--panel').trim() || '#f5f5f5'

  // Target a bar ~80–120 px; pick a round world distance.
  const targetWorld = 100 / cam.scale
  const worldDist = niceNumber(targetWorld)
  const barPx = worldDist * cam.scale

  const margin = 16
  const barH = 8
  const x = vw - barPx - margin
  const y = vh - margin

  ctx.save()

  // Background pill behind the bar + label
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const label = formatDistance(worldDist)
  const labelW = ctx.measureText(label).width
  const pillW = Math.max(barPx, labelW) + 16
  const pillH = barH + 24
  const pillX = vw - pillW - margin / 2
  const pillY = vh - pillH - margin / 2
  ctx.fillStyle = panel
  ctx.globalAlpha = 0.85
  roundRect(ctx, pillX, pillY, pillW, pillH, 6)
  ctx.fill()
  ctx.globalAlpha = 1

  // Bar line with end ticks
  ctx.strokeStyle = ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y - barH)
  ctx.lineTo(x, y)
  ctx.lineTo(x + barPx, y)
  ctx.lineTo(x + barPx, y - barH)
  ctx.stroke()

  // Label
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(label, x + barPx / 2, y + 4)

  ctx.restore()
}

function formatDistance(world: number): string {
  if (world >= 1000) return `${world / 1000}k`
  if (Number.isInteger(world)) return `${world}`
  return `${world.toFixed(world < 1 ? 2 : 1)}`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
