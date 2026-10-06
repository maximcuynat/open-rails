import type { Camera } from '@infrastructure/render/camera'
import { pointOnShape, segmentEnds, shapePieces, tangentOnShape } from '@domain/geometry/segmentGeometry'
import type { Network, Point, SegmentId, SpeedZone, TrackSpan } from '@domain/models/types'
import { bezierDerivative1, bezierPoint } from '@domain/geometry/curve'
import { positionOnSegment, segmentPartialLength, tangentOnSegment } from '@domain/models/locomotive'
import { speedZonesOnRail, speedZonesRevision } from '@domain/models/speedZones'
import { speedZoneOverlaps } from '@domain/models/speedLimits'
import { trackSpansLength } from '@domain/services/trackPath'
import { drawDiagnosticMarker } from './diagnosticMarker'
import type { TrackPiece } from './levelPieces'
import { trackLod, type TrackLod } from './lod'
import type { LabelSpace } from './labelSpace'
import { placeBadges, speedZoneBandShown, speedZoneBoardsShown, speedZoneCrowdBandShown, type BadgeBox } from './lodOverlays'
import { textWidth } from './textWidth'
import { themeInk } from './themeInk'

// ─────────────────── Speed zones on the canvas ───────────────────
//
// A zone shows as a soft band under the rails of the stretch it limits, and as two small boards at
// its ends: black with white figures, like the real ones, « Z » where it starts and « R » where it
// ends. The band is drawn with the rails, level by level, so it follows bridges and tunnels; the
// boards and the overlap warnings come with the overlays.
//
// On a yard every track has its zone, and the bands of parallel tracks merge into a slab that hides
// the rails. Two rules keep the tracks readable there (`zoneLayout`):
// - where a zone is in a crowd — two other limited tracks or more run alongside it
//   (`crowdedStretches`) — it is drawn for the signalling tool only, the one that works on zones:
//   a band that stays between its own rails, and its boards. With any other tool, and while
//   driving, a zone shows nothing there unless it is the one picked;
// - an end of a zone where another zone of the same speed carries on gets no board: the limit does
//   not change there.
// A zone on its own, or on one of the two tracks of a line, is drawn as it always was.

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
/** Width of the band of a zone where it is in a crowd, in track gauges: it stays between its rails */
export const SPEED_ZONE_CROWD_BAND_GAUGES = 1
/**
 * A limited track runs alongside another when their axes are closer than this, in widths of the
 * band: the track next to it, and the one after that
 */
export const SPEED_ZONE_CROWD_REACH = 2.5
/** A zone is in a crowd where this many other limited tracks run alongside: a yard, not the two tracks of a line */
export const SPEED_ZONE_CROWD_TRACKS = 2
/** Step (m) of the walk along the zones that looks for the ones alongside */
const CROWD_STEP = 20
/** Two ends of zones closer than this (m) are the same place of the track */
const SAME_PLACE = 1
/** Distance (px) between the axis of the track and the middle of a board */
const BOARD_OFFSET = 20
const BOARD_HEIGHT = 14
const BOARD_BG = '#111827'
const BOARD_INK = '#ffffff'

/** Gauge the tracks of the network are drawn with (m): the reach of a band is read against it */
const REFERENCE_GAUGE = 1.435

/**
 * Which zones stand out. Given by the signalling tool, the one that works on zones: with it every
 * zone is drawn, the ones in a crowd too. Absent: no zone stands out, and the ones in a crowd are
 * not drawn.
 */
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
  trackKey?: object,
): void {
  if (net.speedZones.size === 0) return
  // In the schematic only the zone being worked on keeps its band (see `speedZoneBandShown`)
  if (!speedZoneBandShown(lod, { highlighted: highlight?.dangerId != null || highlight?.selectedId != null })) return
  const plainShown = speedZoneBandShown(lod, { highlighted: false })
  // Where a zone is in a crowd (absent `trackKey`: not looked for): a band between its own rails,
  // for the signalling tool only — the one that gives a `highlight`
  const crowded = trackKey ? zoneLayout(net, trackKey).crowded : null
  const crowdShown = speedZoneCrowdBandShown(lod, highlight !== undefined)
  const plain: TrackSpan[] = []
  const narrow: TrackSpan[] = []
  const selected: TrackSpan[] = []
  const danger: TrackSpan[] = []
  for (const piece of pieces) {
    for (const stretch of speedZonesOnRail(net, piece.seg.id)) {
      const t0 = Math.max(stretch.lo, piece.t0)
      const t1 = Math.min(stretch.hi, piece.t1)
      if (t1 - t0 <= 1e-9) continue
      const id = stretch.zone.id
      if (id === highlight?.dangerId) danger.push({ segId: piece.seg.id, t0, t1 })
      else if (id === highlight?.selectedId) selected.push({ segId: piece.seg.id, t0, t1 })
      else if (!plainShown) continue
      else if (!crowded?.get(id)?.has(piece.seg.id)) plain.push({ segId: piece.seg.id, t0, t1 })
      else if (crowdShown) narrow.push({ segId: piece.seg.id, t0, t1 })
    }
  }
  if (plain.length + narrow.length + selected.length + danger.length === 0) return

  ctx.save()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  const wide = Math.max(SPEED_ZONE_MIN_WIDTH, SPEED_ZONE_BAND_GAUGES * gauge * cam.scale)
  const stroke = (spans: TrackSpan[], color: string, alpha: number, width: number): void => {
    if (spans.length === 0) return
    ctx.strokeStyle = color
    ctx.globalAlpha = alpha * levelAlpha
    ctx.lineWidth = width
    ctx.beginPath()
    traceTrackSpans(ctx, cam, vw, vh, net, spans)
    ctx.stroke()
  }
  stroke(plain, SPEED_ZONE_COLOR, SPEED_ZONE_ALPHA, wide)
  stroke(narrow, SPEED_ZONE_COLOR, SPEED_ZONE_ALPHA, SPEED_ZONE_CROWD_BAND_GAUGES * gauge * cam.scale)
  stroke(selected, SPEED_ZONE_COLOR, SPEED_ZONE_ACTIVE_ALPHA, wide)
  stroke(danger, SPEED_ZONE_DANGER_COLOR, SPEED_ZONE_ACTIVE_ALPHA, wide)
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
  /** A zone of the same speed carries on from that end: the limit does not change there, no board */
  aCarriesOn: boolean
  bCarriesOn: boolean
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
  /** Where the zones are in a crowd (see `crowdedStretches`) */
  crowded: CrowdedStretches
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
 * Marks the ends of zones where a zone of the same speed starts or ends too: a limit cut in several
 * zones end to end (an imported line is, at every change of way) is announced once, where it
 * really changes. The ends are looked up in buckets of a grid.
 */
function markCarriedOn(boards: ZoneBoards[]): void {
  interface End { owner: ZoneBoards; pos: Point; first: boolean }
  const buckets = new Map<string, End[]>()
  const keyOf = (cx: number, cy: number): string => `${cx},${cy}`
  const ends: End[] = []
  for (const owner of boards) {
    ends.push({ owner, pos: owner.a.pos, first: true }, { owner, pos: owner.b.pos, first: false })
  }
  for (const end of ends) {
    const key = keyOf(Math.floor(end.pos.x / SAME_PLACE), Math.floor(end.pos.y / SAME_PLACE))
    const list = buckets.get(key)
    if (list) list.push(end)
    else buckets.set(key, [end])
  }
  for (const end of ends) {
    const cx = Math.floor(end.pos.x / SAME_PLACE)
    const cy = Math.floor(end.pos.y / SAME_PLACE)
    let carriesOn = false
    for (let dy = -1; dy <= 1 && !carriesOn; dy++) {
      for (let dx = -1; dx <= 1 && !carriesOn; dx++) {
        for (const other of buckets.get(keyOf(cx + dx, cy + dy)) ?? []) {
          if (other.owner === end.owner || other.owner.zone.speed !== end.owner.zone.speed) continue
          if (Math.hypot(other.pos.x - end.pos.x, other.pos.y - end.pos.y) <= SAME_PLACE) {
            carriesOn = true
            break
          }
        }
      }
    }
    if (end.first) end.owner.aCarriesOn = carriesOn
    else end.owner.bCarriesOn = carriesOn
  }
}

/** For each zone, the rails over which it is in a crowd */
export type CrowdedStretches = ReadonlyMap<string, ReadonlySet<SegmentId>>

/**
 * Where the zones are in a crowd, rail by rail: over half of the stretch a zone covers on a rail, at
 * least `SPEED_ZONE_CROWD_TRACKS` other limited tracks run parallel to it within `reach` metres —
 * or one that is itself in that case: the outer track of a yard has a single neighbour, and belongs
 * to the yard all the same. The two tracks of a line never are; a line that runs past a yard is in
 * a crowd along the yard only.
 *
 * The zones are walked every few metres and the places kept in buckets of a grid: one pass over
 * the zones. Tracks are told apart by how far across they lie, so that two zones end to end on the
 * track next door count as one track.
 */
export function crowdedStretches(net: Network, reach: number): CrowdedStretches {
  // The stretches (one zone on one rail) and the places along them, as flat arrays: this runs over
  // every few metres of every zone
  const stretchZone: string[] = []
  const stretchRail: SegmentId[] = []
  const placesOfStretch: number[] = []
  const zones: number[] = []
  const stretches: number[] = []
  const places: number[] = []
  let zoneIndex = 0
  for (const zone of net.speedZones.values()) {
    for (const span of zone.spans) {
      const seg = net.segments.get(span.segId)
      const ends = seg && segmentEnds(net, seg)
      if (!seg || !ends) continue
      // The chord is close enough to the length to count the steps (a rail turns little)
      const from = pointOnShape(ends, span.t0)
      const to = pointOnShape(ends, span.t1)
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / CROWD_STEP))
      // The middle of each step: `steps` places per stretch
      for (let i = 0; i < steps; i++) {
        const t = span.t0 + ((span.t1 - span.t0) * (i + 0.5)) / steps
        const pos = pointOnShape(ends, t)
        const tangent = tangentOnShape(ends, t)
        zones.push(zoneIndex)
        stretches.push(stretchZone.length)
        places.push(pos.x, pos.y, tangent.x, tangent.y)
      }
      stretchZone.push(zone.id)
      stretchRail.push(span.segId)
      placesOfStretch.push(steps)
    }
    zoneIndex++
  }
  const n = zones.length
  const zoneOf = Int32Array.from(zones)
  const stretchOf = Int32Array.from(stretches)
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const txs = new Float64Array(n)
  const tys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = places[4 * i]
    ys[i] = places[4 * i + 1]
    txs[i] = places[4 * i + 2]
    tys[i] = places[4 * i + 3]
  }
  // A place of the next track is found within half a step ahead or behind, whatever its own steps
  const ahead = CROWD_STEP * 0.6
  // What is looked for lies within `reach` across and `ahead` along: in the cell or one of the eight around
  const cell = Math.max(reach, ahead)
  // Small integers (the engine keeps them as such): 16 384 cells each way, more than any network spans
  const keyOf = (cx: number, cy: number): number => ((cy + 0x4000) & 0x7fff) * 0x8000 + ((cx + 0x4000) & 0x7fff)
  const buckets = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const key = keyOf(Math.floor(xs[i] / cell), Math.floor(ys[i] / cell))
    const list = buckets.get(key)
    if (list) list.push(i)
    else buckets.set(key, [i])
  }
  // Two places further apart across than this are on two tracks (m): under the closest tracks are laid
  const trackWidth = reach / 4
  /** For each place, how many tracks run alongside, and the stretches they are (a few at most) */
  const tracksBeside = new Uint8Array(n)
  const stretchesBeside: number[][] = new Array(n)
  const across: number[] = []
  for (let i = 0; i < n; i++) {
    const x = xs[i]
    const y = ys[i]
    const tx = txs[i]
    const ty = tys[i]
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    across.length = 0
    let found: number[] | undefined
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = buckets.get(keyOf(cx + dx, cy + dy))
        if (!list) continue
        for (let k = 0; k < list.length; k++) {
          const o = list[k]
          if (zoneOf[o] === zoneOf[i]) continue
          const ox = xs[o] - x
          const oy = ys[o] - y
          const side = ox * ty - oy * tx
          const wide = side < 0 ? -side : side
          // Beside, not ahead on the same track, and going the same way (not a track crossing over)
          if (wide > reach || wide < trackWidth) continue
          const along = ox * tx + oy * ty
          if (along > ahead || along < -ahead) continue
          const same = txs[o] * tx + tys[o] * ty
          if (same < 0.9 && same > -0.9) continue
          let known = false
          for (let a = 0; a < across.length; a++) {
            const gap = across[a] - side
            if (gap < trackWidth && gap > -trackWidth) {
              known = true
              break
            }
          }
          if (!known) across.push(side)
          if (!found) found = [stretchOf[o]]
          else if (!found.includes(stretchOf[o])) found.push(stretchOf[o])
        }
      }
    }
    tracksBeside[i] = across.length
    if (found) stretchesBeside[i] = found
  }

  const count = stretchZone.length
  const counts = new Int32Array(count)
  for (let i = 0; i < n; i++) if (tracksBeside[i] >= SPEED_ZONE_CROWD_TRACKS) counts[stretchOf[i]]++
  const inside = new Uint8Array(count)
  let any = false
  for (let k = 0; k < count; k++) {
    if (counts[k] > 0 && counts[k] * 2 >= placesOfStretch[k]) {
      inside[k] = 1
      any = true
    }
  }
  const crowded = new Map<string, Set<SegmentId>>()
  if (!any) return crowded
  // The tracks along the edge of the yard: beside one of the stretches found above
  counts.fill(0)
  for (let i = 0; i < n; i++) {
    const beside = stretchesBeside[i]
    if (beside && beside.some((stretch) => inside[stretch] === 1)) counts[stretchOf[i]]++
  }
  const flagged = new Uint8Array(count)
  for (let k = 0; k < count; k++) {
    if (inside[k] === 1 || (counts[k] > 0 && counts[k] * 2 >= placesOfStretch[k])) flagged[k] = 1
  }
  for (let k = 0; k < count; k++) {
    // A short rail (one place) next to a stretch of its zone that is in a crowd goes with it: no stub of band left
    const joins = flagged[k] !== 1 && placesOfStretch[k] === 1 && (
      (k > 0 && stretchZone[k - 1] === stretchZone[k] && flagged[k - 1] === 1) ||
      (k + 1 < count && stretchZone[k + 1] === stretchZone[k] && flagged[k + 1] === 1))
    if (flagged[k] !== 1 && !joins) continue
    const rails = crowded.get(stretchZone[k])
    if (rails) rails.add(stretchRail[k])
    else crowded.set(stretchZone[k], new Set([stretchRail[k]]))
  }
  return crowded
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
    if (a && b) boards.push({ zone, length: trackSpansLength(net, zone.spans), a, b, aCarriesOn: false, bCarriesOn: false })
  }
  markCarriedOn(boards)
  const overlaps: OverlapMark[] = []
  for (const overlap of speedZoneOverlaps(net)) {
    const pos = spansMidpoint(net, overlap.spans)
    if (pos) overlaps.push({ pos, speed: Math.min(overlap.a.speed, overlap.b.speed) })
  }
  const crowded = crowdedStretches(net, SPEED_ZONE_CROWD_REACH * SPEED_ZONE_BAND_GAUGES * REFERENCE_GAUGE)
  const layout = { revision, boards, overlaps, crowded }
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
  /**
   * What is already written on this frame: a board that would cover something there is left out
   * (the zone being worked on keeps its two boards), and the boards drawn take their room
   */
  space?: LabelSpace
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
  const ink = themeInk(ctx)
  // The signalling tool is the one that gives a `highlight`: the zones are what it works on
  const working = options.highlight !== undefined
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
  for (const { zone, length, a, b, aCarriesOn, bCarriesOn } of layout.boards) {
    const danger = zone.id === options.highlight?.dangerId
    const selected = zone.id === options.highlight?.selectedId
    const highlighted = danger || selected
    if (!speedZoneBoardsShown(lod, { highlighted, lengthPx: length * cam.scale })) continue
    const outline = danger ? SPEED_ZONE_DANGER_COLOR : selected ? SPEED_ZONE_COLOR : null
    // In a crowd the boards are for the signalling tool, like the band: an end that stands in one has none
    const crowd = working || highlighted ? undefined : layout.crowded.get(zone.id)
    const aCrowded = crowd?.has(zone.spans[0].segId) ?? false
    const bCrowded = crowd?.has(zone.spans[zone.spans.length - 1].segId) ?? false
    // No board where a zone of the same speed carries on: the limit does not change there
    if (highlighted || (!aCarriesOn && !aCrowded)) board(a, `Z ${zone.speed}`, outline, length)
    if (highlighted || (!bCarriesOn && !bCrowded)) board(b, `R ${zone.speed}`, outline, length)
  }

  // A board never covers another one: the zone being worked on first, then the longest zones.
  // Nor what is already written on the frame, when a `space` is given.
  let placed = placeBadges(boards)
  const space = options.space
  if (space) {
    for (const b of placed) if (b.selected) space.reserve(b)
    const free = new Set(
      placed.filter((b) => !b.selected).sort((p, q) => q.length - p.length).filter((b) => space.claim(b)),
    )
    placed = placed.filter((b) => b.selected || free.has(b))
  }
  for (const { at, cx, cy, x, y, w, h, text, outline } of placed) {
    // Post from the track to the board
    ctx.strokeStyle = outline ?? ink
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
