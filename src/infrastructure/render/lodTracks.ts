import type { Network, Point } from '@domain/models/types'
import type { TrackSection } from '@domain/models/sections'
import type { Camera } from './camera'
import { isWholePiece, type TrackPiece } from './levelPieces'
import type { SectionPolyline } from './networkDerived'
import {
  GAUGE,
  RAIL_WIDTH,
  TUNNEL_ALPHA,
  TUNNEL_DASH,
  getSegmentRenderIntervals,
  subdivideCurve,
  subdivideStraight,
  type ViewportBounds,
} from './renderer'

// ─────────────────── Tracks of the zoomed-out tiers (see `lod.ts`) ───────────────────
//
// `renderer.ts` and this file import each other. Nothing here reads the renderer while the modules
// load — only inside the functions — so the order they load in does not matter.

/** Opacity of the part of a rail the points are set against, as in the detailed drawing */
export const CLOSED_BRANCH_ALPHA = 0.4
/** The line of a rail never gets thinner than this, in pixels */
export const LINE_MIN_WIDTH = 1.5
/** How much wider than the line the edging of a rail above ground is, in pixels */
export const LINE_HALO_EXTRA = 4
/** Width of the line of a section in the schematic, in pixels */
export const SCHEMATIC_LINE_WIDTH = 2
/** Points of a schematic line closer than this to the last one kept are dropped, in pixels */
export const SCHEMATIC_MIN_STEP = 1

/**
 * Width of the single line of a rail: what its two rails covered (the gauge plus one rail, drawn
 * as in `renderDetailedRailLines`), so that nothing jumps when the drawing changes tier.
 */
export function lineTrackWidth(scale: number, gauge: number = GAUGE): number {
  const railWidthRatio = Math.max(0.25, Math.min(2.5, gauge / GAUGE))
  const railPx = Math.max(1.2, RAIL_WIDTH * railWidthRatio * scale)
  return Math.max(LINE_MIN_WIDTH, gauge * scale + railPx)
}

export interface LineTrackColors {
  rail: string
  accent: string
  /** Background colour: the edging of a rail above ground */
  paper: string
}

/** Screen coordinates of the lines of one style: `ax ay bx by NaN NaN` or `ax ay bx by vx vy` per line */
type LineBatch = number[]

function strokeBatch(ctx: CanvasRenderingContext2D, batch: LineBatch): void {
  if (batch.length === 0) return
  ctx.beginPath()
  for (let i = 0; i < batch.length; i += 6) {
    ctx.moveTo(batch[i], batch[i + 1])
    const vx = batch[i + 4]
    if (vx === vx) ctx.quadraticCurveTo(vx, batch[i + 5], batch[i + 2], batch[i + 3])
    else ctx.lineTo(batch[i + 2], batch[i + 3])
  }
  ctx.stroke()
}

/**
 * Line tier — and rails tier with `hollow` — : the pieces of rail of one level, each as ONE stroke along its centre line. The lines
 * are gathered by style and every style is stroked once, whatever the number of rails; round caps
 * close the joints, so there is no joint pass. A level above ground gets an edging in the
 * background colour instead of a bridge deck; a level below ground is dimmed and dashed.
 */
export function renderLineTracks(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  pieces: TrackPiece[],
  level: number,
  selectedSegments: ReadonlySet<string>,
  colors: LineTrackColors,
  gauge: number = GAUGE,
  hollow = false,
): void {
  if (pieces.length === 0) return
  const s = cam.scale
  const ox = vw / 2 - cam.x * s
  const oy = vh / 2 - cam.y * s

  const normal: LineBatch = []
  const selected: LineBatch = []
  const closed: LineBatch = []
  const selectedClosed: LineBatch = []
  // Whole pieces, whatever their style: the edging runs under all of them
  const halo: LineBatch = []

  const add = (batch: LineBatch, a: Point, b: Point, via?: Point): void => {
    batch.push(a.x * s + ox, a.y * s + oy, b.x * s + ox, b.y * s + oy)
    if (via) batch.push(via.x * s + ox, via.y * s + oy)
    else batch.push(NaN, NaN)
  }
  const addPart = (batch: LineBatch, a: Point, b: Point, via: Point | undefined, t0: number, t1: number): void => {
    if (via) {
      const sub = subdivideCurve(a, via, b, t0, t1)
      add(batch, sub.p0, sub.p2, sub.via)
    } else {
      const sub = subdivideStraight(a, b, t0, t1)
      add(batch, sub.a, sub.b)
    }
  }

  for (const piece of pieces) {
    const seg = piece.seg
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) continue
    const via = seg.kind === 'curve' ? seg.via : undefined
    const isSelected = selectedSegments.has(seg.id)
    const whole = isWholePiece(piece)

    if (level > 0) addPart(halo, a.pos, b.pos, via, piece.t0, piece.t1)

    for (const inter of getSegmentRenderIntervals(net, seg, a.pos, b.pos)) {
      const t0 = whole ? inter.t0 : Math.max(inter.t0, piece.t0)
      const t1 = whole ? inter.t1 : Math.min(inter.t1, piece.t1)
      if (t1 <= t0) continue
      const batch = inter.isTurnout ? (isSelected ? selectedClosed : closed) : isSelected ? selected : normal
      addPart(batch, a.pos, b.pos, via, t0, t1)
    }
  }

  const lineW = lineTrackWidth(s, gauge)
  const tunnel = level < 0
  const alpha = tunnel ? TUNNEL_ALPHA : 1

  ctx.save()
  ctx.lineJoin = 'round'
  if (halo.length > 0) {
    // Butt ends: the edging must not bite into the rail that carries on at the same level
    ctx.lineCap = 'butt'
    ctx.strokeStyle = colors.paper
    ctx.lineWidth = lineW + LINE_HALO_EXTRA
    strokeBatch(ctx, halo)
  }
  ctx.lineCap = 'round'
  ctx.lineWidth = lineW
  if (tunnel) ctx.setLineDash(TUNNEL_DASH)

  // Rails tier: the line is as wide as the track, and its inside is taken out again, which leaves
  // the two rails — the way a map draws the edges of a road. Where tracks meet, their insides run
  // into each other, as the rails of a turnout do.
  const insideW = hollow ? Math.max(0, 2 * gauge * s - lineW) : 0
  const inside = (first: LineBatch, second: LineBatch): void => {
    if (insideW <= 0) return
    ctx.globalAlpha = 1
    ctx.strokeStyle = colors.paper
    ctx.lineWidth = insideW
    strokeBatch(ctx, first)
    strokeBatch(ctx, second)
    ctx.lineWidth = lineW
  }

  // Closed branches first: an open rail ending at the same points stays whole
  ctx.globalAlpha = alpha * CLOSED_BRANCH_ALPHA
  ctx.strokeStyle = colors.rail
  strokeBatch(ctx, closed)
  ctx.strokeStyle = colors.accent
  strokeBatch(ctx, selectedClosed)
  inside(closed, selectedClosed)
  ctx.globalAlpha = alpha
  ctx.strokeStyle = colors.rail
  strokeBatch(ctx, normal)
  ctx.strokeStyle = colors.accent
  strokeBatch(ctx, selected)
  inside(normal, selected)
  ctx.restore()
}

export interface DetailRailColors {
  rail: string
  accent: string
  /** Polished top of the rail */
  head: string
}

/** A quadratic curve turning more than this (radians) is cut in two before its rails are offset */
const MAX_OFFSET_TURN = 0.3

/**
 * Adds to `batch` the curve that runs `offset` world units to the left of the quadratic
 * p0 → via → p2, in screen coordinates. A parallel of a quadratic is not one, but over the gentle
 * turn of a rail the quadratic through the two offset ends, tangent to the track at both, lies
 * within a hundredth of the offset from it; a sharper curve is cut in two first.
 */
function addOffsetCurve(
  batch: LineBatch, p0: Point, via: Point, p2: Point, offset: number, s: number, ox: number, oy: number, depth = 0,
): void {
  const d0x = via.x - p0.x
  const d0y = via.y - p0.y
  const d2x = p2.x - via.x
  const d2y = p2.y - via.y
  const l0 = Math.hypot(d0x, d0y)
  const l2 = Math.hypot(d2x, d2y)
  if (l0 < 1e-9 || l2 < 1e-9) {
    addOffsetLine(batch, p0, p2, offset, s, ox, oy)
    return
  }
  const cross = (d0x * d2y - d0y * d2x) / (l0 * l2)
  const dot = (d0x * d2x + d0y * d2y) / (l0 * l2)
  if (depth < 4 && (dot < 0 || Math.abs(cross) > Math.sin(MAX_OFFSET_TURN))) {
    const first = subdivideCurve(p0, via, p2, 0, 0.5)
    const second = subdivideCurve(p0, via, p2, 0.5, 1)
    addOffsetCurve(batch, first.p0, first.via, first.p2, offset, s, ox, oy, depth + 1)
    addOffsetCurve(batch, second.p0, second.via, second.p2, offset, s, ox, oy, depth + 1)
    return
  }
  // Ends moved along the normal of the track there (the same normal as `bezierNormal`)
  const ax = p0.x - (d0y / l0) * offset
  const ay = p0.y + (d0x / l0) * offset
  const bx = p2.x - (d2y / l2) * offset
  const by = p2.y + (d2x / l2) * offset
  // Control point: where the tangents at the two offset ends meet; the middle for a straight one
  let vx = (ax + bx) / 2
  let vy = (ay + by) / 2
  const det = d0x * d2y - d0y * d2x
  if (Math.abs(cross) > 1e-9) {
    const k = ((bx - ax) * d2y - (by - ay) * d2x) / det
    vx = ax + d0x * k
    vy = ay + d0y * k
  }
  batch.push(ax * s + ox, ay * s + oy, bx * s + ox, by * s + oy, vx * s + ox, vy * s + oy)
}

function addOffsetLine(batch: LineBatch, a: Point, b: Point, offset: number, s: number, ox: number, oy: number): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return
  const nx = (-dy / len) * offset
  const ny = (dx / len) * offset
  batch.push((a.x + nx) * s + ox, (a.y + ny) * s + oy, (b.x + nx) * s + ox, (b.y + ny) * s + oy, NaN, NaN)
}

/**
 * Detail tier: the two rails of the pieces of one level, with their polished head — what
 * `renderDetailedRailLines` and `renderDetailedCurveRails` draw one rail at a time, gathered by
 * style and stroked once per style. The part of a rail the points are set against is dimmed; a
 * level below ground is dimmed and dashed.
 */
export function renderDetailRails(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  pieces: TrackPiece[],
  level: number,
  selectedSegments: ReadonlySet<string>,
  colors: DetailRailColors,
  gauge: number = GAUGE,
): void {
  if (pieces.length === 0) return
  const s = cam.scale
  const ox = vw / 2 - cam.x * s
  const oy = vh / 2 - cam.y * s
  const hg = gauge / 2

  const normal: LineBatch = []
  const selected: LineBatch = []
  const closed: LineBatch = []
  const selectedClosed: LineBatch = []

  for (const piece of pieces) {
    const seg = piece.seg
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) continue
    const via = seg.kind === 'curve' ? seg.via : undefined
    const isSelected = selectedSegments.has(seg.id)
    const whole = isWholePiece(piece)
    for (const inter of getSegmentRenderIntervals(net, seg, a.pos, b.pos)) {
      const t0 = whole ? inter.t0 : Math.max(inter.t0, piece.t0)
      const t1 = whole ? inter.t1 : Math.min(inter.t1, piece.t1)
      if (t1 <= t0) continue
      const batch = inter.isTurnout ? (isSelected ? selectedClosed : closed) : isSelected ? selected : normal
      if (via) {
        const sub = subdivideCurve(a.pos, via, b.pos, t0, t1)
        addOffsetCurve(batch, sub.p0, sub.via, sub.p2, hg, s, ox, oy)
        addOffsetCurve(batch, sub.p0, sub.via, sub.p2, -hg, s, ox, oy)
      } else {
        const sub = subdivideStraight(a.pos, b.pos, t0, t1)
        addOffsetLine(batch, sub.a, sub.b, hg, s, ox, oy)
        addOffsetLine(batch, sub.a, sub.b, -hg, s, ox, oy)
      }
    }
  }

  const railWidthRatio = Math.max(0.25, Math.min(2.5, gauge / GAUGE))
  const railPx = Math.max(1.2, RAIL_WIDTH * railWidthRatio * s)
  const headPx = Math.max(0.8, railPx * 0.42)
  const tunnel = level < 0
  const levelAlpha = tunnel ? TUNNEL_ALPHA : 1

  ctx.save()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  if (tunnel) ctx.setLineDash(TUNNEL_DASH)
  const rails = (plain: LineBatch, picked: LineBatch, alpha: number): void => {
    // Base of the rails, then their head on top
    ctx.globalAlpha = alpha
    ctx.lineWidth = railPx
    ctx.strokeStyle = colors.rail
    strokeBatch(ctx, plain)
    ctx.strokeStyle = colors.accent
    strokeBatch(ctx, picked)
    ctx.lineWidth = headPx
    ctx.strokeStyle = colors.head
    strokeBatch(ctx, plain)
    ctx.strokeStyle = '#ffffff'
    strokeBatch(ctx, picked)
    if (picked.length > 0) {
      // Glow of the selected rails
      ctx.strokeStyle = colors.accent
      ctx.globalAlpha = 0.35 * alpha
      ctx.lineWidth = railPx + 5
      strokeBatch(ctx, picked)
    }
  }
  // Closed branches first: an open rail ending at the same points stays whole
  rails(closed, selectedClosed, levelAlpha * CLOSED_BRANCH_ALPHA)
  rails(normal, selected, levelAlpha)
  ctx.restore()
}

/** How the stripe of a section is drawn along the middle of its track */
export interface SectionStripeStyle {
  color: string
  /** A platform track: wider, dashed */
  station: boolean
  selected: boolean
}

/**
 * Rails tier: the coloured stripe that tells the sections apart, along the middle of each piece
 * of rail — as in the detailed drawing, but one stroke per colour and kind instead of one per rail.
 */
export function renderSectionStripes(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  pieces: TrackPiece[],
  level: number,
  styleOf: (segId: string) => SectionStripeStyle,
): void {
  if (pieces.length === 0) return
  const s = cam.scale
  const ox = vw / 2 - cam.x * s
  const oy = vh / 2 - cam.y * s
  const batches = new Map<string, { style: SectionStripeStyle; lines: LineBatch }>()
  for (const piece of pieces) {
    const seg = piece.seg
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) continue
    const style = styleOf(seg.id)
    const key = `${style.color}|${style.station}|${style.selected}`
    let batch = batches.get(key)
    if (!batch) {
      batch = { style, lines: [] }
      batches.set(key, batch)
    }
    const via = seg.kind === 'curve' ? seg.via : undefined
    if (via) {
      const sub = subdivideCurve(a.pos, via, b.pos, piece.t0, piece.t1)
      batch.lines.push(sub.p0.x * s + ox, sub.p0.y * s + oy, sub.p2.x * s + ox, sub.p2.y * s + oy, sub.via.x * s + ox, sub.via.y * s + oy)
    } else {
      const sub = subdivideStraight(a.pos, b.pos, piece.t0, piece.t1)
      batch.lines.push(sub.a.x * s + ox, sub.a.y * s + oy, sub.b.x * s + ox, sub.b.y * s + oy, NaN, NaN)
    }
  }

  const levelAlpha = level < 0 ? TUNNEL_ALPHA : 1
  ctx.save()
  ctx.lineCap = 'round'
  for (const { style, lines } of batches.values()) {
    ctx.strokeStyle = style.color
    ctx.lineWidth = style.station ? Math.max(2.5, Math.min(5.0, 0.6 * s)) : Math.max(1.5, Math.min(3.5, 0.4 * s))
    ctx.globalAlpha = (style.selected ? 0.95 : style.station ? 0.8 : 0.45) * levelAlpha
    ctx.setLineDash(style.station ? [8, 4] : [])
    strokeBatch(ctx, lines)
  }
  ctx.restore()
}

/**
 * The points of a polyline as drawn: projected to the screen, those closer than `minStep` pixels
 * to the last one kept left out. The two ends are always kept, so that sections still meet.
 * Returns x, y pairs appended to `out`, and the number of points appended.
 */
export function decimatePolyline(
  points: ArrayLike<number>,
  scale: number,
  ox: number,
  oy: number,
  out: number[],
  minStep: number = SCHEMATIC_MIN_STEP,
): number {
  const n = points.length >> 1
  if (n === 0) return 0
  const min2 = minStep * minStep
  let lastX = points[0] * scale + ox
  let lastY = points[1] * scale + oy
  out.push(lastX, lastY)
  let kept = 1
  for (let i = 1; i < n; i++) {
    const x = points[2 * i] * scale + ox
    const y = points[2 * i + 1] * scale + oy
    const dx = x - lastX
    const dy = y - lastY
    if (i < n - 1 && dx * dx + dy * dy < min2) continue
    out.push(x, y)
    lastX = x
    lastY = y
    kept++
  }
  return kept
}

export interface SchematicTrackColors {
  accent: string
}

/**
 * Schematic tier: one polyline per section in the colour of the section (the accent colour when
 * it is selected), one path per colour. The cost follows the number of sections in view and of
 * pixels they cover, not the number of rails. Levels are not layered here: a section wholly below
 * ground is only dimmed.
 */
export function renderSchematicTracks(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  polylines: readonly SectionPolyline[],
  bounds: ViewportBounds,
  selectedSections: ReadonlySet<TrackSection>,
  colors: SchematicTrackColors,
): void {
  const s = cam.scale
  const ox = vw / 2 - cam.x * s
  const oy = vh / 2 - cam.y * s

  // Lines in view, gathered by style. Selected sections come last, on top of the others.
  const batches = new Map<string, { color: string; tunnel: boolean; lines: SectionPolyline[] }>()
  const selected: SectionPolyline[] = []
  for (const line of polylines) {
    if (line.maxX < bounds.minX || line.minX > bounds.maxX || line.maxY < bounds.minY || line.minY > bounds.maxY) continue
    if (selectedSections.has(line.section)) {
      selected.push(line)
      continue
    }
    const key = line.tunnel ? `${line.section.color}|t` : line.section.color
    const batch = batches.get(key)
    if (batch) batch.lines.push(line)
    else batches.set(key, { color: line.section.color, tunnel: line.tunnel, lines: [line] })
  }
  if (batches.size === 0 && selected.length === 0) return

  const pts: number[] = []
  const strokeLines = (lines: SectionPolyline[]): void => {
    ctx.beginPath()
    for (const line of lines) {
      pts.length = 0
      const kept = decimatePolyline(line.points, s, ox, oy, pts)
      ctx.moveTo(pts[0], pts[1])
      for (let i = 1; i < kept; i++) ctx.lineTo(pts[2 * i], pts[2 * i + 1])
    }
    ctx.stroke()
  }

  ctx.save()
  ctx.lineWidth = SCHEMATIC_LINE_WIDTH
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const batch of batches.values()) {
    ctx.strokeStyle = batch.color
    ctx.globalAlpha = batch.tunnel ? TUNNEL_ALPHA : 1
    strokeLines(batch.lines)
  }
  if (selected.length > 0) {
    ctx.strokeStyle = colors.accent
    ctx.globalAlpha = 1
    strokeLines(selected)
  }
  ctx.restore()
}
