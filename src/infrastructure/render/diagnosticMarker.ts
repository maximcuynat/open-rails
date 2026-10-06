import { gaugeOnScreen } from './lod'
import { DIAGNOSTIC_LABEL_FROM_PX } from './lodOverlays'
import { textWidth } from './textWidth'

/** Gauge the rails of the network are drawn with (m): the one the tiers are read against */
const STANDARD_GAUGE = 1.435

/** Screen rectangle of the label of a marker */
export interface DiagnosticLabelBox {
  x: number
  y: number
  w: number
  h: number
}

export interface DiagnosticMarkerOptions {
  /**
   * Unit vector (screen) of the side the label goes to: away from what stands beside the track
   * there. Absent: above the marker
   */
  away?: { x: number; y: number }
  /**
   * Labels already written this frame. A label that would cover one of them is left out (the
   * marker itself is always drawn); the one written is added to the list
   */
  taken?: DiagnosticLabelBox[]
}

/** Half the width of the diamond of a marker at a zoom, px */
export function diagnosticMarkerRadius(scale: number): number {
  return Math.max(8, Math.min(13, 1.6 * scale))
}

/**
 * The diagnostic marker of the construction view: a warning diamond on a place of the track, with
 * a short text above it once the zoom allows. Shared by every diagnostic drawn on the network.
 */
export function drawDiagnosticMarker(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  scale: number,
  severity: 'error' | 'warning',
  label: string,
  options: DiagnosticMarkerOptions = {},
): void {
  ctx.save()
  const isErr = severity === 'error'
  const badgeColor = isErr ? '#ef4444' : '#f59e0b'
  const signR = diagnosticMarkerRadius(scale)

  // Pulse halo
  ctx.fillStyle = isErr ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.25)'
  ctx.beginPath()
  ctx.arc(sx, sy, signR + 4, 0, Math.PI * 2)
  ctx.fill()

  // Diamond badge (shape of a warning diamond / losange de danger ferroviaire)
  ctx.fillStyle = badgeColor
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(sx, sy - signR)
  ctx.lineTo(sx + signR, sy)
  ctx.lineTo(sx, sy + signR)
  ctx.lineTo(sx - signR, sy)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Exclamation point or angle
  ctx.fillStyle = '#ffffff'
  ctx.font = '900 11px Archivo, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('!', sx, sy)

  // Label badge above if zoom is reasonable
  if (gaugeOnScreen(scale, STANDARD_GAUGE) >= DIAGNOSTIC_LABEL_FROM_PX) {
    ctx.font = '600 10px Archivo, system-ui, sans-serif'
    const tw = textWidth(ctx, label)
    // Above the marker, or below it when what stands beside the track is above
    const below = options.away !== undefined && options.away.y > 0.5
    const ty = below ? sy + signR + 11 : sy - signR - 10
    const box: DiagnosticLabelBox = { x: sx - tw / 2 - 5, y: ty - 7, w: tw + 10, h: 15 }
    const covered = options.taken?.some((o) => box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h)
    if (!covered) {
      options.taken?.push(box)
      ctx.fillStyle = badgeColor
      ctx.beginPath()
      ctx.roundRect(box.x, box.y, box.w, box.h, 3)
      ctx.fill()

      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, sx, ty)
    }
  }

  ctx.restore()
}
