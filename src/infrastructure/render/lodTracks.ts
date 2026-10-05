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
 * Line tier: the pieces of rail of one level, each as ONE stroke along its centre line. The lines
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

  // Closed branches first: an open rail ending at the same points stays whole
  ctx.globalAlpha = alpha * CLOSED_BRANCH_ALPHA
  ctx.strokeStyle = colors.rail
  strokeBatch(ctx, closed)
  ctx.strokeStyle = colors.accent
  strokeBatch(ctx, selectedClosed)
  ctx.globalAlpha = alpha
  ctx.strokeStyle = colors.rail
  strokeBatch(ctx, normal)
  ctx.strokeStyle = colors.accent
  strokeBatch(ctx, selected)
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
