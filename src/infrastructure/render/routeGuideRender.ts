import { positionOnSegment } from '@domain/models/locomotive'
import type { Network, Point, TrackSpan } from '@domain/models/types'
import type { Camera } from './camera'

// The way of the driven train to its next station, drawn on the track under the driving aid: a
// wide soft band with a line in it, apart from the short stretch `renderDrivingRoute` draws as
// the points lie (which may leave it: that is what the driver has to see).

export const ROUTE_GUIDE_COLOR = '#a855f7'
/** Screen length (px) of one chord of a stretch: a long rail may curve */
const CHORD_PX = 24
const MAX_CHORDS = 32

/** How far ahead (m) the way is worth drawing for a view: twice its diagonal, two kilometres at least */
export function routeGuideReach(cam: Camera, vw: number, vh: number): number {
  return Math.max(2000, (2 * Math.hypot(vw, vh)) / cam.scale)
}

/** Draw the stretches of a way, in order; those wholly off one side of the view are passed over */
export function renderRouteGuide(ctx: CanvasRenderingContext2D, cam: Camera, vw: number, vh: number, net: Network, spans: readonly TrackSpan[]): void {
  if (spans.length === 0) return
  const sx = (p: Point) => (p.x - cam.x) * cam.scale + vw / 2
  const sy = (p: Point) => (p.y - cam.y) * cam.scale + vh / 2
  const margin = 12
  ctx.beginPath()
  let drawn = false
  let pen: Point | null = null
  for (const span of spans) {
    const a = positionOnSegment(net, span.segId, span.t0)
    const b = positionOnSegment(net, span.segId, span.t1)
    if (!a || !b) continue
    const ax = sx(a)
    const ay = sy(a)
    const bx = sx(b)
    const by = sy(b)
    if ((ax < -margin && bx < -margin) || (ax > vw + margin && bx > vw + margin) || (ay < -margin && by < -margin) || (ay > vh + margin && by > vh + margin)) {
      pen = null
      continue
    }
    if (!pen || pen.x !== a.x || pen.y !== a.y) ctx.moveTo(ax, ay)
    const chords = Math.max(1, Math.min(MAX_CHORDS, Math.ceil(Math.hypot(bx - ax, by - ay) / CHORD_PX)))
    for (let k = 1; k < chords; k++) {
      const p = positionOnSegment(net, span.segId, span.t0 + ((span.t1 - span.t0) * k) / chords)
      if (p) ctx.lineTo(sx(p), sy(p))
    }
    ctx.lineTo(bx, by)
    pen = b
    drawn = true
  }
  if (!drawn) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = ROUTE_GUIDE_COLOR
  ctx.globalAlpha = 0.22
  ctx.lineWidth = 11
  ctx.stroke()
  ctx.globalAlpha = 0.85
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}
