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
}
