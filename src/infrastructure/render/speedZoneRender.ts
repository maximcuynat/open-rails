import type { Camera } from '@infrastructure/render/camera'
import { segmentEnds, shapePieces } from '@domain/geometry/segmentGeometry'
import type { Network, Point, SegmentId, SpeedZone, TrackSpan } from '@domain/models/types'
import { bezierDerivative1, bezierPoint } from '@domain/geometry/curve'
import { positionOnSegment, segmentPartialLength, tangentOnSegment } from '@domain/models/locomotive'
import { speedZonesOnRail, speedZonesRevision } from '@domain/models/speedZones'
import { speedZoneOverlaps } from '@domain/models/speedLimits'
import { trackSpansLength } from '@domain/services/trackPath'
import { drawDiagnosticMarker } from './diagnosticMarker'
import type { TrackPiece } from './levelPieces'
import { trackLod, type TrackLod } from './lod'
import { placeBadges, speedZoneBandShown, speedZoneBoardsShown, type BadgeBox } from './lodOverlays'
import { textWidth } from './textWidth'

// ─────────────────── Speed zones on the canvas ───────────────────
//
// A zone shows as a soft band under the rails of the stretch it limits, and as two small boards at
// its ends: black with white figures, like the real ones, « Z » where it starts and « R » where it
// ends. The band is drawn with the rails, level by level, so it follows bridges and tunnels; the
// boards and the overlap warnings come with the overlays.

/** Colour of the band of a zone, and of the preview of the speed limit tool */
export const SPEED_ZONE_COLOR = '#f59e0b'
const SPEED_ZONE_DANGER_COLOR = '#ef4444'
/** Opacity of the band: plain, then picked or about to be removed */
export const SPEED_ZONE_ALPHA = 0.3
export const SPEED_ZONE_ACTIVE_ALPHA = 0.55
/** Width of the band, in track gauges: it shows on both sides of the rails */
export const SPEED_ZONE_BAND_GAUGES = 2.6
/** The band is never thinner than this on screen (px) */
const SPEED_ZONE_MIN_WIDTH = 5
/** Distance (px) between the axis of the track and the middle of a board */
const BOARD_OFFSET = 20
const BOARD_HEIGHT = 14
const BOARD_BG = '#111827'
const BOARD_INK = '#ffffff'

/** Which zones stand out; absent: none */
export interface SpeedZoneHighlight {
  /** The picked zone */
  selectedId?: string | null
  /** The zone the next click would remove */
  dangerId?: string | null
}

/** Geometry of the stretch `t0` → `t1` of a rail, walked in that order (`t0` may be the larger one) */
function spanGeometry(net: Network, segId: SegmentId, t0: number, t1: number): { a: Point; b: Point; via?: Point } | null {
  const seg = net.segments.get(segId)
  const from = seg && net.nodes.get(seg.from)
  const to = seg && net.nodes.get(seg.to)
  if (!seg || !from || !to) return null
  if (seg.kind === 'curve' && seg.via) {
    // Exact sub-curve of a quadratic Bézier (the reparameterization of `subdivideCurve`)
    const a = bezierPoint(t0, from.pos, seg.via, to.pos)
    const b = bezierPoint(t1, from.pos, seg.via, to.pos)
    const d = bezierDerivative1(t0, from.pos, seg.via, to.pos)
    const k = (t1 - t0) / 2
    return { a, b, via: { x: a.x + k * d.x, y: a.y + k * d.y } }
  }
  const at = (t: number): Point => ({ x: from.pos.x + (to.pos.x - from.pos.x) * t, y: from.pos.y + (to.pos.y - from.pos.y) * t })
  return { a: at(t0), b: at(t1) }
}

/**
 * Add stretches of track to the current path, each as its own sub-path along the axis of the rail.
 * The caller begins the path and strokes it.
 */
export function traceTrackSpans(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  spans: readonly TrackSpan[],
): void {
  const sx = (x: number): number => (x - cam.x) * cam.scale + vw / 2
  const sy = (y: number): number => (y - cam.y) * cam.scale + vh / 2
  for (const span of spans) {
    const seg = net.segments.get(span.segId)
    // A long rail is traced piece by piece; the two other shapes are one piece
    const shape = seg?.kind === 'path' ? segmentEnds(net, seg) : null
    const lines = shape ? shapePieces(shape, span.t0, span.t1) : [spanGeometry(net, span.segId, span.t0, span.t1)]
    let started = false
    for (const line of lines) {
      if (!line) continue
      if (!started) ctx.moveTo(sx(line.a.x), sy(line.a.y))
      started = true
      if (line.via) ctx.quadraticCurveTo(sx(line.via.x), sy(line.via.y), sx(line.b.x), sy(line.b.y))
      else ctx.lineTo(sx(line.b.x), sy(line.b.y))
    }
  }
}

/**
 * Bands of the zones over the pieces of rail of one level. Called from the rail pass, before the
 * rails themselves: one stroke for the plain zones, one for the picked zone, one for the zone about
 * to be removed. Nothing at all is drawn for a network without zone.
 */
export function renderSpeedZoneBands(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  pieces: readonly TrackPiece[],
  gauge: number,
  levelAlpha: number,
  highlight?: SpeedZoneHighlight,
  lod: TrackLod = 'detail',
): void {
  if (net.speedZones.size === 0) return
  // In the schematic only the zone being worked on keeps its band (see `speedZoneBandShown`)
  if (!speedZoneBandShown(lod, { highlighted: highlight?.dangerId != null || highlight?.selectedId != null })) return
  const plainShown = speedZoneBandShown(lod, { highlighted: false })
  const plain: TrackSpan[] = []
  const selected: TrackSpan[] = []
  const danger: TrackSpan[] = []
  for (const piece of pieces) {
    for (const stretch of speedZonesOnRail(net, piece.seg.id)) {
      const t0 = Math.max(stretch.lo, piece.t0)
      const t1 = Math.min(stretch.hi, piece.t1)
      if (t1 - t0 <= 1e-9) continue
      const id = stretch.zone.id
      const group = id === highlight?.dangerId ? danger : id === highlight?.selectedId ? selected : plain
      if (group === plain && !plainShown) continue
      group.push({ segId: piece.seg.id, t0, t1 })
    }
  }
  if (plain.length + selected.length + danger.length === 0) return

  ctx.save()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(SPEED_ZONE_MIN_WIDTH, SPEED_ZONE_BAND_GAUGES * gauge * cam.scale)
  const stroke = (spans: TrackSpan[], color: string, alpha: number): void => {
    if (spans.length === 0) return
    ctx.strokeStyle = color
    ctx.globalAlpha = alpha * levelAlpha
    ctx.beginPath()
    traceTrackSpans(ctx, cam, vw, vh, net, spans)
    ctx.stroke()
  }
  stroke(plain, SPEED_ZONE_COLOR, SPEED_ZONE_ALPHA)
  stroke(selected, SPEED_ZONE_COLOR, SPEED_ZONE_ACTIVE_ALPHA)
  stroke(danger, SPEED_ZONE_DANGER_COLOR, SPEED_ZONE_ACTIVE_ALPHA)
  ctx.restore()
}

// ─────────────────── Boards and overlap warnings ───────────────────

/** One end of a zone: where its board stands, and the direction of the track there */
interface ZoneEnd {
  pos: Point
  tangent: Point
}

interface ZoneBoards {
  zone: SpeedZone
  /** Length of the zone along the track, m */
  length: number
  a: ZoneEnd
  b: ZoneEnd
}

interface OverlapMark {
  pos: Point
  /** The lower of the two speeds: the one that applies there, km/h */
  speed: number
}

interface ZoneLayout {
  revision: number
  boards: ZoneBoards[]
  overlaps: OverlapMark[]
}

const layouts = new WeakMap<object, ZoneLayout>()

function zoneEnd(net: Network, segId: SegmentId, t: number): ZoneEnd | null {
  const pos = positionOnSegment(net, segId, t)
  const tangent = tangentOnSegment(net, segId, t)
  return pos && tangent ? { pos, tangent } : null
}

/** Place of the track halfway along a list of stretches */
function spansMidpoint(net: Network, spans: readonly TrackSpan[]): Point | null {
  let remaining = trackSpansLength(net, spans) / 2
  for (const span of spans) {
    const length = segmentPartialLength(net, span.segId, span.t0, span.t1)
    if (remaining <= length && length > 0) {
      return positionOnSegment(net, span.segId, span.t0 + ((span.t1 - span.t0) * remaining) / length)
    }
    remaining -= length
  }
  const last = spans[spans.length - 1]
  return last ? positionOnSegment(net, last.segId, last.t1) : null
}

/**
 * Where the boards and the overlap warnings stand. Kept as long as the zones (`speedZonesRevision`)
 * and the track (`trackKey`, an object that is replaced whenever the network changes) stay the same.
 */
function zoneLayout(net: Network, trackKey: object): ZoneLayout {
  const revision = speedZonesRevision(net)
  const kept = layouts.get(trackKey)
  if (kept && kept.revision === revision) return kept

  const boards: ZoneBoards[] = []
  for (const zone of net.speedZones.values()) {
    const first = zone.spans[0]
    const last = zone.spans[zone.spans.length - 1]
    const a = first && zoneEnd(net, first.segId, first.t0)
    const b = last && zoneEnd(net, last.segId, last.t1)
    if (a && b) boards.push({ zone, length: trackSpansLength(net, zone.spans), a, b })
  }
  const overlaps: OverlapMark[] = []
  for (const overlap of speedZoneOverlaps(net)) {
    const pos = spansMidpoint(net, overlap.spans)
    if (pos) overlaps.push({ pos, speed: Math.min(overlap.a.speed, overlap.b.speed) })
  }
  const layout = { revision, boards, overlaps }
  layouts.set(trackKey, layout)
  return layout
}

/** Text of the warning on the stretch two zones share */
export function overlapLabel(speed: number): string {
  return `Chevauchement · ${speed} km/h`
}

export interface SpeedZoneMarkerOptions {
  highlight?: SpeedZoneHighlight
  /** Gauge the rails are drawn with, m: the boards follow the tier of the drawing */
  gauge: number
  /** Construction view: the stretches shared by two zones get the diagnostic marker */
  showOverlaps: boolean
}

/**
 * Boards at the two ends of every zone (« Z 90 » where it starts, « R 90 » where it ends) and the
 * warnings on overlapping zones. Drawn with the overlays of the network. `trackKey`: see `zoneLayout`.
 */
export function renderSpeedZoneMarkers(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  trackKey: object,
  options: SpeedZoneMarkerOptions,
): void {
  if (net.speedZones.size === 0) return
  const layout = zoneLayout(net, trackKey)
  const margin = 60
  const toScreen = (p: Point): Point | null => {
    const x = (p.x - cam.x) * cam.scale + vw / 2
    const y = (p.y - cam.y) * cam.scale + vh / 2
    return x < -margin || x > vw + margin || y < -margin || y > vh + margin ? null : { x, y }
  }

  interface Board extends BadgeBox {
    at: Point
    cx: number
    cy: number
    text: string
    outline: string | null
  }

  ctx.save()
  ctx.font = '700 9px Archivo, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const lod = trackLod(cam.scale, options.gauge)
  const boards: Board[] = []
  const board = (end: ZoneEnd, text: string, outline: string | null, length: number): void => {
    const at = toScreen(end.pos)
    if (!at) return
    // Beside the track, on the side that is up on screen, so it never covers the rails
    let nx = -end.tangent.y
    let ny = end.tangent.x
    if (ny > 0 || (ny === 0 && nx < 0)) {
      nx = -nx
      ny = -ny
    }
    const cx = at.x + nx * BOARD_OFFSET
    const cy = at.y + ny * BOARD_OFFSET
    const width = textWidth(ctx, text) + 10
    boards.push({
      x: cx - width / 2, y: cy - BOARD_HEIGHT / 2, w: width, h: BOARD_HEIGHT,
      selected: outline !== null, renamed: false, length,
      at, cx, cy, text, outline,
    })
  }
  for (const { zone, length, a, b } of layout.boards) {
    const danger = zone.id === options.highlight?.dangerId
    const selected = zone.id === options.highlight?.selectedId
    if (!speedZoneBoardsShown(lod, { highlighted: danger || selected, lengthPx: length * cam.scale })) continue
    const outline = danger ? SPEED_ZONE_DANGER_COLOR : selected ? SPEED_ZONE_COLOR : null
    board(a, `Z ${zone.speed}`, outline, length)
    board(b, `R ${zone.speed}`, outline, length)
  }

  // A board never covers another one: the zone being worked on first, then the longest zones
  for (const { at, cx, cy, x, y, w, h, text, outline } of placeBadges(boards)) {
    // Post from the track to the board
    ctx.strokeStyle = outline ?? BOARD_BG
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(at.x, at.y)
    ctx.lineTo(cx, cy)
    ctx.stroke()

    ctx.fillStyle = BOARD_BG
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 2)
    ctx.fill()
    ctx.strokeStyle = outline ?? BOARD_INK
    ctx.lineWidth = outline ? 2 : 1
    ctx.stroke()

    ctx.fillStyle = BOARD_INK
    ctx.fillText(text, cx, cy + 0.5)
  }
  ctx.restore()

  if (options.showOverlaps) {
    for (const overlap of layout.overlaps) {
      const at = toScreen(overlap.pos)
      if (at) drawDiagnosticMarker(ctx, at.x, at.y, cam.scale, 'warning', overlapLabel(overlap.speed))
    }
  }
}
