import type { Camera } from '@infrastructure/render/camera'
import type { Network, Point, SegmentId } from '@domain/models/types'
import type { GradientRamp } from '@domain/models/network'
import { positionOnSegment, tangentOnSegment } from '@domain/models/locomotive'
import type { TrackPiece } from './levelPieces'
import type { RampIndex } from './networkDerived'
import type { BadgeBox } from './lodOverlays'

// ─────────────────── Slopes on the canvas ───────────────────
//
// A ramp shows as chevrons between its rails, their point towards the top, and as one label giving
// its slope (« 35 ‰ »). The chevrons are drawn with the rails of their level, so they follow
// bridges and tunnels; the labels come with the overlays and never cover a section badge. A ramp
// steeper than the limit of the project is drawn in the alert colour. Slopes do not depend on the
// scale of the project: they show on a model railway as at full size.

/** Half width of a chevron, in track gauges, and its bounds on screen (px) */
const CHEVRON_HALF_GAUGES = 0.34
export const CHEVRON_HALF_PX = { min: 4.5, max: 7 }
/** Distance between two chevrons along a ramp, in half widths of a chevron, and its bounds on screen (px) */
const CHEVRON_SPACING_HALVES = 7
export const CHEVRON_SPACING_PX = { min: 32, max: 48 }
/** A chevron is never drawn with a thinner line than this (px) */
export const CHEVRON_MIN_LINE_PX = 1.6
const CHEVRON_ALPHA = 0.9

/**
 * Size of the chevrons at a zoom, all in screen pixels: their half width (they follow the gauge
 * close up, and keep a readable size where the two rails are 3 px apart — they then stand out
 * beyond the rails), the pitch they are laid at and the width of their line.
 */
export function chevronMetrics(scale: number, gauge: number): { half: number; spacing: number; line: number } {
  const half = Math.max(CHEVRON_HALF_PX.min, Math.min(CHEVRON_HALF_PX.max, CHEVRON_HALF_GAUGES * gauge * scale))
  const spacing = Math.max(CHEVRON_SPACING_PX.min, Math.min(CHEVRON_SPACING_PX.max, CHEVRON_SPACING_HALVES * half))
  return { half, spacing, line: Math.max(CHEVRON_MIN_LINE_PX, half * 0.32) }
}
/** A ramp shorter than this on screen (px) gets no label */
export const GRADIENT_LABEL_MIN_LENGTH = 40
/** Distance (px) from the axis of the track down to the middle of the label */
const LABEL_OFFSET = 16
const LABEL_HEIGHT = 16
/** Places tried along each rail of a ramp for its label, as parameters of the rail */
const LABEL_SAMPLES = [0.1, 0.3, 0.5, 0.7, 0.9]

/** A slope in ‰ as shown to the user: one decimal at most, with a decimal comma */
export function gradientLabel(permille: number): string {
  return `${String(Math.round(Math.abs(permille) * 10) / 10).replace('.', ',')} ‰`
}

export interface GradientColors {
  /** Chevrons and labels of a ramp within the limit */
  ink: string
  /** …and of a ramp steeper than the limit */
  alert: string
  /** Background of the labels */
  paper: string
}

/**
 * Chevrons of the ramps over the pieces of rail of one level, their point towards the top of the
 * ramp whichever way each rail runs. They are counted from the foot of the ramp at a constant pitch
 * on screen, so they neither bunch nor jump from one rail to the next. Called from the rail pass of
 * the detailed drawing, after the rails; one path each for the plain and the alert chevrons,
 * stroked twice (a rim in the background colour, then the chevron).
 */
export function renderGradientChevrons(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  pieces: readonly TrackPiece[],
  index: RampIndex,
  steepRails: ReadonlySet<SegmentId>,
  gauge: number,
  levelAlpha: number,
  colors: GradientColors,
): void {
  if (index.ramps.length === 0) return
  const metrics = chevronMetrics(cam.scale, gauge)
  const half = metrics.half
  const step = metrics.spacing / cam.scale
  const margin = half * 2
  /** Chevrons as screen triplets: one arm end, the point, the other arm end */
  const plain: number[] = []
  const alert: number[] = []

  for (const piece of pieces) {
    const entry = index.ofSegment.get(piece.seg.id)
    if (!entry || !(entry.rail.length > 0)) continue
    const { rail } = entry
    const up = rail.climbsForward ? 1 : -1
    // Part of the ramp this piece covers, as distances from its foot
    const d0 = rail.offset + (rail.climbsForward ? piece.t0 : 1 - piece.t1) * rail.length
    const d1 = rail.offset + (rail.climbsForward ? piece.t1 : 1 - piece.t0) * rail.length
    const target = steepRails.has(piece.seg.id) ? alert : plain
    for (let k = Math.ceil(d0 / step - 0.5); (k + 0.5) * step < d1; k++) {
      const along = ((k + 0.5) * step - rail.offset) / rail.length
      const t = rail.climbsForward ? along : 1 - along
      const pos = positionOnSegment(net, piece.seg.id, t)
      const tangent = tangentOnSegment(net, piece.seg.id, t)
      if (!pos || !tangent) continue
      const x = (pos.x - cam.x) * cam.scale + vw / 2
      const y = (pos.y - cam.y) * cam.scale + vh / 2
      if (x < -margin || x > vw + margin || y < -margin || y > vh + margin) continue
      // Unit vector towards the top of the ramp, and across the track
      const ux = tangent.x * up
      const uy = tangent.y * up
      const backX = x - ux * half
      const backY = y - uy * half
      target.push(backX - uy * half, backY + ux * half, x + ux * half * 0.6, y + uy * half * 0.6, backX + uy * half, backY - ux * half)
    }
  }
  if (plain.length + alert.length === 0) return

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = CHEVRON_ALPHA * levelAlpha
  const stroke = (points: number[], color: string): void => {
    if (points.length === 0) return
    ctx.beginPath()
    for (let i = 0; i < points.length; i += 6) {
      ctx.moveTo(points[i], points[i + 1])
      ctx.lineTo(points[i + 2], points[i + 3])
      ctx.lineTo(points[i + 4], points[i + 5])
    }
    // A rim in the background colour first: the chevron reads over the rails and the centreline
    ctx.strokeStyle = colors.paper
    ctx.lineWidth = metrics.line + 2.4
    ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = metrics.line
    ctx.stroke()
  }
  stroke(plain, colors.ink)
  stroke(alert, colors.alert)
  ctx.restore()
}

/** The label of a ramp, measured and placed on screen, before the overlap check */
export interface GradientLabelBox extends BadgeBox {
  ramp: GradientRamp
  text: string
  /** Middle of the label */
  cx: number
  cy: number
  steep: boolean
}

/**
 * One label per ramp long enough on screen, under the track at the place of the ramp in view that
 * is nearest to its middle. The caller keeps the ones that fit (`placeBadges`) and draws them with
 * `drawGradientLabels`. `ctx` must carry the font of the labels (`GRADIENT_LABEL_FONT`).
 */
export function gradientLabelBoxes(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  index: RampIndex,
  steepRails: ReadonlySet<SegmentId>,
): GradientLabelBox[] {
  const boxes: GradientLabelBox[] = []
  for (const ramp of index.ramps) {
    if (ramp.length * cam.scale < GRADIENT_LABEL_MIN_LENGTH) continue
    let best: Point | null = null
    let bestGap = Infinity
    for (const rail of ramp.rails) {
      for (const along of LABEL_SAMPLES) {
        const gap = Math.abs(rail.offset + along * rail.length - ramp.length / 2)
        if (gap >= bestGap) continue
        const pos = positionOnSegment(net, rail.segId, rail.climbsForward ? along : 1 - along)
        if (!pos) continue
        const x = (pos.x - cam.x) * cam.scale + vw / 2
        const y = (pos.y - cam.y) * cam.scale + vh / 2
        if (x < 0 || x > vw || y < 0 || y > vh) continue
        best = { x, y }
        bestGap = gap
      }
    }
    if (!best) continue
    const text = gradientLabel(ramp.gradient)
    const w = ctx.measureText(text).width + 10
    const cy = best.y + LABEL_OFFSET
    boxes.push({
      x: best.x - w / 2, y: cy - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT,
      selected: false, renamed: false, length: ramp.length,
      ramp, text, cx: best.x, cy,
      steep: ramp.rails.some((rail) => steepRails.has(rail.segId)),
    })
  }
  return boxes
}

export const GRADIENT_LABEL_FONT = '600 10px Archivo, system-ui, sans-serif'

/** Draw the labels kept: a small pill on the background colour, outlined and written in the ink — or the alert colour */
export function drawGradientLabels(ctx: CanvasRenderingContext2D, labels: readonly GradientLabelBox[], colors: GradientColors): void {
  if (labels.length === 0) return
  ctx.save()
  ctx.font = GRADIENT_LABEL_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const label of labels) {
    const color = label.steep ? colors.alert : colors.ink
    ctx.globalAlpha = 0.92
    ctx.fillStyle = colors.paper
    ctx.beginPath()
    ctx.roundRect(label.x, label.y, label.w, label.h, 3)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = label.steep ? 1.5 : 1
    ctx.stroke()
    ctx.fillStyle = color
    ctx.fillText(label.text, label.cx, label.cy + 0.5)
  }
  ctx.restore()
}
