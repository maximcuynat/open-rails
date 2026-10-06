import type { Camera } from '@infrastructure/render/camera'
import { segmentEnds, shapePolyline } from '@domain/geometry/segmentGeometry'
import type { Network, SegmentId } from '@domain/models/types'
import { bezierDerivative1, bezierPoint } from '@domain/geometry/curve'
import { CANT_RANGE } from '@domain/models/cant'
import { trackCantOn, type TrackProfile } from '@domain/models/trackSpeed'
import type { TrackPiece } from './levelPieces'

// ─────────────────── Cant on the canvas ───────────────────
//
// A plan shows nothing of a canted track by itself (the gauge shrinks by half a percent), so the
// cant is marked by a convention: the outer rail of the curve — the high one — is highlighted, by a
// stroke that widens and deepens with the cant. Along the cant ramps at the two ends of a curve the
// mark fades in by steps. It is drawn under the rails of its level, like the bands of the speed
// zones, so it follows bridges and tunnels. Full size only: off the real scale the profile of the
// track is empty and nothing is drawn.

/** A stretch of a rail carrying one cant, for the drawing */
export interface CantStretch {
  t0: number
  t1: number
  /** Cant in the middle of the stretch, mm */
  cant: number
  /** Strength the stretch is drawn in (`cantMarkLevel`) */
  level: number
  /** Side of the high rail when the rail is run from `from` to `to`: 1 = its left ((−y, x) of its tangent), -1 = its right */
  outside: 1 | -1
}

/** A cant ramp is looked at in this many steps; the steps drawn in the same strength are then joined */
const RAMP_STEPS = 12
/** Number of strengths the mark is drawn in, from the least cant to `CANT_RANGE.max` */
export const CANT_MARK_LEVELS = 6
/** Width of the mark, in world metres (at standard gauge): from the least cant to the largest */
const MARK_WIDTH = { min: 0.2, max: 0.85 }
/** The mark is never thinner than this on screen (px), at the least cant and at the largest */
const MARK_MIN_PX = { min: 2, max: 3.5 }
/** Opacity of the mark, at the least cant and at the largest */
const MARK_ALPHA = { min: 0.3, max: 0.85 }

const stretchesByProfile = new WeakMap<TrackProfile, Map<SegmentId, CantStretch[]>>()

/** Number of times the stretches were built, for the tests that check they are kept */
export const cantRenderStats = { builds: 0 }

function buildStretches(profile: TrackProfile): Map<SegmentId, CantStretch[]> {
  const all = new Map<SegmentId, CantStretch[]>()
  const ids = new Set<SegmentId>([...profile.rails.keys(), ...profile.ramps.keys()])
  for (const segId of ids) {
    const ramps = profile.ramps.get(segId) ?? []
    const cuts = new Set<number>([0, 1])
    for (const ramp of ramps) {
      cuts.add(Math.max(0, Math.min(1, ramp.lo)))
      cuts.add(Math.max(0, Math.min(1, ramp.hi)))
    }
    const stops = [...cuts].sort((x, y) => x - y)
    const stretches: CantStretch[] = []
    for (let i = 0; i < stops.length - 1; i++) {
      const lo = stops[i]
      const hi = stops[i + 1]
      if (hi - lo < 1e-9) continue
      const mid = (lo + hi) / 2
      // Even cant between two ramps; a ramp is cut into steps
      const steps = ramps.some((ramp) => mid >= ramp.lo && mid <= ramp.hi) ? RAMP_STEPS : 1
      for (let k = 0; k < steps; k++) {
        const t0 = lo + ((hi - lo) * k) / steps
        const t1 = lo + ((hi - lo) * (k + 1)) / steps
        const place = trackCantOn(profile, segId, (t0 + t1) / 2)
        if (!(place.cant > 0) || place.inside === 0) continue
        const outside = place.inside === 1 ? -1 : 1
        const level = cantMarkLevel(place.cant)
        // Steps drawn alike are one stretch: a ramp is as many strokes as it crosses strengths
        const last = stretches[stretches.length - 1]
        if (last && last.level === level && last.outside === outside && Math.abs(last.t1 - t0) < 1e-9) {
          last.t1 = t1
          last.cant = trackCantOn(profile, segId, (last.t0 + t1) / 2).cant
        } else {
          stretches.push({ t0, t1, cant: place.cant, level, outside })
        }
      }
    }
    if (stretches.length > 0) all.set(segId, stretches)
  }
  return all
}

/**
 * The canted stretches of every rail of a profile. Built once per profile: `trackProfile` hands
 * out the same object until the track, the zones or the line settings change, and a new one then.
 */
export function cantStretches(profile: TrackProfile): ReadonlyMap<SegmentId, readonly CantStretch[]> {
  let kept = stretchesByProfile.get(profile)
  if (!kept) {
    kept = buildStretches(profile)
    cantRenderStats.builds++
    stretchesByProfile.set(profile, kept)
  }
  return kept
}

/** Strength a cant is drawn in: 1 for the least, `CANT_MARK_LEVELS` from `CANT_RANGE.max` on */
export function cantMarkLevel(cant: number): number {
  return Math.max(1, Math.min(CANT_MARK_LEVELS, Math.ceil((cant / CANT_RANGE.max) * CANT_MARK_LEVELS - 1e-9)))
}

/** Width (px) and opacity of the mark of a strength */
export function cantMarkStyle(level: number, scale: number, gauge: number, standardGauge: number): { width: number; alpha: number } {
  const k = CANT_MARK_LEVELS > 1 ? (level - 1) / (CANT_MARK_LEVELS - 1) : 1
  const mix = (range: { min: number; max: number }): number => range.min + (range.max - range.min) * k
  return { width: Math.max(mix(MARK_MIN_PX), mix(MARK_WIDTH) * (gauge / standardGauge) * scale), alpha: mix(MARK_ALPHA) }
}

interface OuterRailSpan {
  segId: SegmentId
  t0: number
  t1: number
  outside: 1 | -1
}

/** Add the outer rail of each span to the current path, each as its own sub-path */
function traceOuterRails(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  spans: readonly OuterRailSpan[],
  halfGauge: number,
): void {
  const scale = cam.scale
  const ox = vw / 2 - cam.x * scale
  const oy = vh / 2 - cam.y * scale
  for (const span of spans) {
    const seg = net.segments.get(span.segId)
    const from = seg && net.nodes.get(seg.from)
    const to = seg && net.nodes.get(seg.to)
    if (!seg || !from || !to) continue
    const d = halfGauge * span.outside
    if (seg.kind === 'path') {
      // A long rail: its path as chords, each point moved along the normal of the track there
      const ends = segmentEnds(net, seg)
      if (!ends) continue
      const pts = shapePolyline(ends, 16, span.t0, span.t1)
      pts.forEach((p, i) => {
        const before = pts[Math.max(0, i - 1)]
        const after = pts[Math.min(pts.length - 1, i + 1)]
        const len = Math.hypot(after.x - before.x, after.y - before.y)
        if (len < 1e-12) return
        const x = (p.x - ((after.y - before.y) / len) * d) * scale + ox
        const y = (p.y + ((after.x - before.x) / len) * d) * scale + oy
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
    } else if (seg.kind === 'curve' && seg.via) {
      // Sub-curve of the quadratic Bézier, then its parallel: ends moved along their normals
      // ((−y, x) of the direction of the track), control point moved to where the moved tangents meet
      const a = bezierPoint(span.t0, from.pos, seg.via, to.pos)
      const b = bezierPoint(span.t1, from.pos, seg.via, to.pos)
      const da = bezierDerivative1(span.t0, from.pos, seg.via, to.pos)
      const db = bezierDerivative1(span.t1, from.pos, seg.via, to.pos)
      const la = Math.hypot(da.x, da.y)
      const lb = Math.hypot(db.x, db.y)
      if (la < 1e-12 || lb < 1e-12) continue
      const nax = -da.y / la
      const nay = da.x / la
      const nbx = -db.y / lb
      const nby = db.x / lb
      const k = (span.t1 - span.t0) / 2
      const mx = nax + nbx
      const my = nay + nby
      const ml = Math.hypot(mx, my)
      const along = ml > 1e-9 ? (mx * nax + my * nay) / ml : 0
      ctx.moveTo((a.x + nax * d) * scale + ox, (a.y + nay * d) * scale + oy)
      const ex = (b.x + nbx * d) * scale + ox
      const ey = (b.y + nby * d) * scale + oy
      if (along > 1e-3) {
        const reach = d / along / ml
        ctx.quadraticCurveTo((a.x + k * da.x + mx * reach) * scale + ox, (a.y + k * da.y + my * reach) * scale + oy, ex, ey)
      } else {
        ctx.lineTo(ex, ey)
      }
    } else {
      const dx = to.pos.x - from.pos.x
      const dy = to.pos.y - from.pos.y
      const len = Math.hypot(dx, dy)
      if (len < 1e-12) continue
      const sx = (-dy / len) * d
      const sy = (dx / len) * d
      ctx.moveTo((from.pos.x + dx * span.t0 + sx) * scale + ox, (from.pos.y + dy * span.t0 + sy) * scale + oy)
      ctx.lineTo((from.pos.x + dx * span.t1 + sx) * scale + ox, (from.pos.y + dy * span.t1 + sy) * scale + oy)
    }
  }
}

/**
 * Cant marks over the pieces of rail of one level: the outer rail of every canted stretch,
 * highlighted in `color`. Called from the rail pass of the detailed drawing, before the rails
 * themselves; at most one stroke per strength. `gauge` is the gauge the rails are drawn with.
 */
export function renderCantMarks(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  pieces: readonly TrackPiece[],
  profile: TrackProfile,
  gauge: number,
  standardGauge: number,
  levelAlpha: number,
  color: string,
): void {
  if (profile.rails.size === 0) return
  const stretches = cantStretches(profile)
  if (stretches.size === 0) return
  const byLevel: OuterRailSpan[][] = []
  for (const piece of pieces) {
    const list = stretches.get(piece.seg.id)
    if (!list) continue
    for (const stretch of list) {
      const t0 = Math.max(stretch.t0, piece.t0)
      const t1 = Math.min(stretch.t1, piece.t1)
      if (t1 - t0 <= 1e-9) continue
      ;(byLevel[stretch.level] ??= []).push({ segId: piece.seg.id, t0, t1, outside: stretch.outside })
    }
  }
  if (byLevel.length === 0) return

  ctx.save()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  for (let level = 1; level < byLevel.length; level++) {
    const spans = byLevel[level]
    if (!spans) continue
    const style = cantMarkStyle(level, cam.scale, gauge, standardGauge)
    ctx.lineWidth = style.width
    ctx.globalAlpha = style.alpha * levelAlpha
    ctx.beginPath()
    traceOuterRails(ctx, cam, vw, vh, net, spans, gauge / 2)
    ctx.stroke()
  }
  ctx.restore()
}
