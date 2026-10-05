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
): void {
  ctx.save()
  const isErr = severity === 'error'
  const badgeColor = isErr ? '#ef4444' : '#f59e0b'
  const signR = Math.max(8, Math.min(13, 1.6 * scale))

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
  if (scale >= 0.9) {
    ctx.font = '600 10px Archivo, system-ui, sans-serif'
    const tw = ctx.measureText(label).width
    const ty = sy - signR - 10

    ctx.fillStyle = badgeColor
    ctx.beginPath()
    ctx.roundRect(sx - tw / 2 - 5, ty - 7, tw + 10, 15, 3)
    ctx.fill()

    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, sx, ty)
  }

  ctx.restore()
}
