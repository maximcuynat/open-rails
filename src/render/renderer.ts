import type { Camera } from './camera'
import type { Network, Selection } from '../core/types'

/** Choose a grid spacing (in world units) that keeps cells ~40–80 px on screen. */
export function pickSpacing(scale: number): number {
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

// --- Rail rendering ---

/** Standard gauge in world units: 1 unit = 1 meter, gauge = 1.435 m. */
const GAUGE = 1.435
/** Sleeper spacing in world units (~60 cm). */
const SLEEPER_SPACING = 0.6
/** Sleeper length (extends past the rails). */
const SLEEPER_LENGTH = GAUGE + 0.5
/** Sleeper width in world units. */
const SLEEPER_WIDTH = 0.25
/** Rail head width in world units. */
const RAIL_WIDTH = 0.07

/** Below this scale (px/world), render as a single simplified line. */
const SIMPLIFY_THRESHOLD = 8

export function renderNetwork(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  selection: Selection,
): void {
  const ink = getComputedStyle(ctx.canvas).getPropertyValue('--ink').trim() || '#1a1a1a'
  const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const sleeperColor = getComputedStyle(ctx.canvas).getPropertyValue('--sleeper').trim() || '#8a7a6a'

  const simplified = cam.scale < SIMPLIFY_THRESHOLD

  // Draw segments
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) continue

    const ax = (a.pos.x - cam.x) * cam.scale + vw / 2
    const ay = (a.pos.y - cam.y) * cam.scale + vh / 2
    const bx = (b.pos.x - cam.x) * cam.scale + vw / 2
    const by = (b.pos.y - cam.y) * cam.scale + vh / 2

    const selected = selection.segments.has(seg.id)

    if (simplified) {
      // Single line mode — fast
      ctx.strokeStyle = selected ? accent : ink
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.stroke()
    } else {
      renderDetailedRail(ctx, cam, a.pos, b.pos, vw, vh, selected, ink, accent, sleeperColor)
    }
  }

  // Draw nodes on top
  for (const node of net.nodes.values()) {
    const sx = (node.pos.x - cam.x) * cam.scale + vw / 2
    const sy = (node.pos.y - cam.y) * cam.scale + vh / 2
    const selected = selection.nodes.has(node.id)

    // Cull off-screen
    if (sx < -20 || sx > vw + 20 || sy < -20 || sy > vh + 20) continue

    const r = Math.max(3, 0.3 * cam.scale)

    // Outer ring
    ctx.fillStyle = selected ? accent : ink
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, Math.PI * 2)
    ctx.fill()

    // Inner dot
    ctx.fillStyle = getComputedStyle(ctx.canvas).getPropertyValue('--paper').trim() || '#fff'
    ctx.beginPath()
    ctx.arc(sx, sy, r * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

function renderDetailedRail(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  a: { x: number; y: number },
  b: { x: number; y: number },
  vw: number,
  vh: number,
  selected: boolean,
  ink: string,
  accent: string,
  sleeperColor: string,
): void {
  const s = cam.scale

  // Direction vector and perpendicular
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return
  const nx = -dy / len
  const ny = dx / len

  // Half-gauge in world units
  const hg = GAUGE / 2

  // Rail endpoints (screen space)
  const r1ax = (a.x + nx * hg - cam.x) * s + vw / 2
  const r1ay = (a.y + ny * hg - cam.y) * s + vh / 2
  const r1bx = (b.x + nx * hg - cam.x) * s + vw / 2
  const r1by = (b.y + ny * hg - cam.y) * s + vh / 2
  const r2ax = (a.x - nx * hg - cam.x) * s + vw / 2
  const r2ay = (a.y - ny * hg - cam.y) * s + vh / 2
  const r2bx = (b.x - nx * hg - cam.x) * s + vw / 2
  const r2by = (b.y - ny * hg - cam.y) * s + vh / 2

  const railPx = Math.max(1, RAIL_WIDTH * s)
  const railColor = selected ? accent : ink

  // --- Sleepers + ballast (drawn in rotated space) ---
  const sleeperLen = SLEEPER_LENGTH * s
  const sleeperW = Math.max(2, SLEEPER_WIDTH * s)
  const totalSleepers = Math.max(1, Math.floor(len / SLEEPER_SPACING))
  const step = len / totalSleepers

  ctx.save()
  ctx.translate((a.x - cam.x) * s + vw / 2, (a.y - cam.y) * s + vh / 2)
  ctx.rotate(Math.atan2(dy, dx))

  // Ballast / track bed
  ctx.fillStyle = selected ? 'rgba(37, 99, 235, 0.08)' : 'rgba(0,0,0,0.03)'
  ctx.fillRect(0, -sleeperLen / 2, len * s, sleeperLen)

  // Sleepers
  ctx.fillStyle = sleeperColor
  for (let i = 0; i <= totalSleepers; i++) {
    const t = i * step
    ctx.fillRect(t * s - sleeperW / 2, -sleeperLen / 2, sleeperW, sleeperLen)
  }

  ctx.restore()

  // --- Two rails ---
  ctx.strokeStyle = railColor
  ctx.lineWidth = railPx
  ctx.lineCap = 'round'

  ctx.beginPath()
  ctx.moveTo(r1ax, r1ay)
  ctx.lineTo(r1bx, r1by)
  ctx.moveTo(r2ax, r2ay)
  ctx.lineTo(r2bx, r2by)
  ctx.stroke()

  // Highlight overlay if selected
  if (selected) {
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.3
    ctx.lineWidth = railPx + 4
    ctx.beginPath()
    ctx.moveTo(r1ax, r1ay)
    ctx.lineTo(r1bx, r1by)
    ctx.moveTo(r2ax, r2ay)
    ctx.lineTo(r2bx, r2by)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

// --- Scale bar ---

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

export function renderScaleBar(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
): void {
  const ink = getComputedStyle(ctx.canvas).getPropertyValue('--ink').trim() || '#1a1a1a'
  const panel = getComputedStyle(ctx.canvas).getPropertyValue('--panel').trim() || '#f5f5f5'

  const targetWorld = 100 / cam.scale
  const worldDist = niceNumber(targetWorld)
  const barPx = worldDist * cam.scale

  const margin = 16
  const barH = 8
  const x = vw - barPx - margin
  const y = vh - margin

  ctx.save()

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

  ctx.strokeStyle = ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y - barH)
  ctx.lineTo(x, y)
  ctx.lineTo(x + barPx, y)
  ctx.lineTo(x + barPx, y - barH)
  ctx.stroke()

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
