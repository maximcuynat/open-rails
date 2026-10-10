import type { Camera } from './camera'

// What the dispatcher reads on the canvas while trains run: a mark on every set of points, at
// every zoom (the track itself no longer shows which way they lie once it is a line), and the
// name of its driver above each driven train.

/** A set of points as the canvas marks it */
export interface PointsMark {
  x: number
  y: number
  /** Not in its first position (the diverging route of a turnout) */
  thrown: boolean
  /** A train stands on it or holds it: it cannot be thrown */
  locked: boolean
}

/** The driver of a train, written above its leading end */
export interface DriverMark {
  x: number
  y: number
  label: string
  /** Driven from this screen */
  host: boolean
}

/** How close to a mark (px) a click throws its points */
export const POINTS_HIT_RADIUS_PX = 12

const MARK = 5
const FONT = '600 11px Archivo, system-ui, sans-serif'
const NORMAL = '#16a34a'
const THROWN = '#f59e0b'
const LOCKED = '#94a3b8'
const INK = '#0f172a'
const HOST = '#2563eb'

export function renderDispatchOverlay(ctx: CanvasRenderingContext2D, cam: Camera, vw: number, vh: number, points: readonly PointsMark[], drivers: readonly DriverMark[]): void {
  if (points.length === 0 && drivers.length === 0) return
  const sx = (x: number): number => (x - cam.x) * cam.scale + vw / 2
  const sy = (y: number): number => (y - cam.y) * cam.scale + vh / 2
  ctx.save()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#ffffff'
  for (const mark of points) {
    const x = sx(mark.x)
    const y = sy(mark.y)
    if (x < -MARK || x > vw + MARK || y < -MARK || y > vh + MARK) continue
    ctx.fillStyle = mark.locked ? LOCKED : mark.thrown ? THROWN : NORMAL
    ctx.beginPath()
    ctx.moveTo(x, y - MARK)
    ctx.lineTo(x + MARK, y)
    ctx.lineTo(x, y + MARK)
    ctx.lineTo(x - MARK, y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const mark of drivers) {
    const x = sx(mark.x)
    const y = sy(mark.y) - 22
    if (x < -80 || x > vw + 80 || y < -20 || y > vh + 20) continue
    const w = ctx.measureText(mark.label).width + 14
    ctx.fillStyle = mark.host ? HOST : INK
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - 9, w, 18, 9)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.fillText(mark.label, x, y)
  }
  ctx.restore()
}
