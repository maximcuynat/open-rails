import type { Camera } from '@infrastructure/render/camera'
import type { Network, Point, Signal, SignalId, TrackSpan } from '@domain/models/types'
import { positionOnSegment, tangentOnSegment } from '@domain/models/locomotive'
import { signalsRevision, type SignallingLevel } from '@domain/models/signals'
import { signalBlocks, signalTopology } from '@domain/models/signalBlocks'
import {
  signalAspect,
  signalStatus,
  defaultSignalStatus,
  type SignalColor,
  type SignalExtras,
  type SignallingState,
  type SignalState,
  type SlowdownSpeed,
} from '@domain/models/signalling'
import { signalReport, type SignalReportEntry } from '@domain/models/signalReport'
import { speedSigns, type SpeedSign } from '@domain/models/speedSigns'
import type { LineSettings } from '@domain/models/speedLimits'
import { speedZonesRevision } from '@domain/models/speedZones'
import { signalHeading, signalWorldPosition } from '@domain/services/signalLayout'
import { drawDiagnosticMarker } from './diagnosticMarker'
import { trackPositionBand, type TrackPiece } from './levelPieces'

// ─────────────────── Signals on the canvas ───────────────────
//
// A signal is drawn beside the track, on the left of the direction of travel it speaks to: two
// signals laid back to back therefore show on either side of the rails. Kept very plain: a short
// mast from the track and a head.
//
// - Standard level: a round head for a block signal, a diamond head for a path signal, one lamp.
// - Pro level, seen from above: a dark target with one lamp (sémaphore) or two (carré), and its
//   plate « F » / « Nf » once the zoom is close; a marker board of a cab-signalled line is a small
//   blue square with a yellow triangle and no lamp. The announcement and the reminder of points to
//   take at 30 or 60 km/h are two yellow lamps, with the speed on a small tag once the zoom is close.
// - Both levels: a one-way path signal has a short red bar across the track at its foot.
//
// The entries of the signalling report and the distant speed signs of the pro level come with
// them, with the overlays of the network: above the rails. Blocks and reservations are stripes
// beside the rails, drawn with the rails level by level (`renderSignalStripes`), like the bands of
// the speed zones: under the deck of a bridge above, faded in a tunnel.

/** Standard gauge (m): the sizes below are given for it */
const REFERENCE_GAUGE = 1.435

export const SIGNAL_LAMP_COLORS: Record<SignalColor, string> = { green: '#22c55e', yellow: '#facc15', red: '#ef4444' }
const LAMP_OFF = '#475569'
const SIGNAL_BODY = '#111827'
const SIGNAL_EDGE = '#f8fafc'
const SIGNAL_SELECTED = '#2563eb'
const SIGNAL_DANGER = '#ef4444'
const MARKER_BLUE = '#1d4ed8'
const MARKER_YELLOW = '#facc15'
const SPEED_SIGN_BG = '#ffffff'
const SPEED_SIGN_INK = '#111827'

/** Colours of the blocks, taken in turn in the order of the signals */
export const BLOCK_COLORS = ['#0ea5e9', '#f97316', '#a855f7', '#14b8a6', '#ec4899', '#84cc16', '#6366f1', '#eab308'] as const
/** Colours of the track held for each train, taken in turn in the order the trains appear */
export const RESERVATION_COLORS = ['#22d3ee', '#fb7185', '#a3e635', '#c084fc', '#fdba74'] as const
export const BLOCK_ALPHA = 0.55
export const RESERVATION_ALPHA = 0.8

/** Sizes of a signal on screen (px) at a zoom and a gauge */
export interface SignalSizes {
  /** Distance from the axis of the track to the middle of the head */
  offset: number
  /** Radius of a lamp */
  lamp: number
  /** The plate of a pro signal is written */
  plate: boolean
}

export function signalSizes(scale: number, gauge: number = REFERENCE_GAUGE): SignalSizes {
  const g = (gauge > 0 ? gauge : REFERENCE_GAUGE) * scale
  return {
    offset: Math.max(13, Math.min(26, 2.4 * g)),
    lamp: Math.max(3, Math.min(6, 0.45 * g)),
    plate: g >= 9,
  }
}

/** Unit vector to the left of a direction of travel, on screen (y grows downwards) */
export function leftOf(heading: Point): Point {
  return { x: heading.y, y: -heading.x }
}

/**
 * Where the head of a signal is drawn, in world coordinates, at a zoom: what a click aims at.
 * Null when the rail of the signal is gone.
 */
export function signalHeadWorld(net: Network, signal: Signal, scale: number, gauge?: number): Point | null {
  const pos = signalWorldPosition(net, signal)
  const heading = signalHeading(net, signal)
  if (!pos || !heading || !(scale > 0)) return null
  const left = leftOf(heading)
  const offset = signalSizes(scale, gauge).offset / scale
  return { x: pos.x + left.x * offset, y: pos.y + left.y * offset }
}

/** Shape of the head of a signal */
export type SignalShape = 'block' | 'path' | 'semaphore' | 'carre' | 'marker'

/** What to draw for a signal: its shape, the colour of each lamp (null: unlit) and its plate */
export interface SignalGlyph {
  shape: SignalShape
  lamps: (SignalColor | null)[]
  plate: 'F' | 'Nf' | null
  /** Only there when true: a one-way path signal, marked by a bar across the track */
  oneWay?: true
  /** Only there when lit (pro level): the speed of the announcement or of the reminder its two yellow lamps show */
  speed?: SlowdownSpeed
}

/**
 * The glyph of a signal in a given state, as one level shows it (see `signalAspect`). `extras`:
 * what it shows besides its state while driving (`SignalStatus`).
 */
export function signalGlyph(signal: Signal, state: SignalState, level: SignallingLevel, extras?: SignalExtras): SignalGlyph {
  const aspect = signalAspect(signal, state, level, extras)
  const glyph = baseGlyph(signal, state, level, aspect)
  if (signal.oneWay && signal.role === 'protection') glyph.oneWay = true
  const speed = aspect.reminder ?? aspect.slowdown
  if (speed) {
    // Two yellow lamps, whatever the target: seen from above the announcement and the reminder look alike
    glyph.lamps = ['yellow', 'yellow']
    glyph.speed = speed
  }
  return glyph
}

function baseGlyph(signal: Signal, state: SignalState, level: SignallingLevel, aspect: ReturnType<typeof signalAspect>): SignalGlyph {
  if (level !== 'pro') {
    return { shape: signal.role === 'protection' ? 'path' : 'block', lamps: [aspect.color], plate: null }
  }
  if (!aspect.lit) return { shape: 'marker', lamps: [], plate: aspect.plate }
  if (signal.role === 'protection') {
    // A closed carré shows two reds; open, its second lamp is out
    return { shape: 'carre', lamps: [aspect.color, state === 'stop' ? 'red' : null], plate: aspect.plate }
  }
  return { shape: 'semaphore', lamps: [aspect.color], plate: aspect.plate }
}

export interface SignalDrawStyle {
  alpha?: number
  /** Ring round the head: the picked signal, or the one the next click would remove */
  ring?: string | null
  /** Arrow of the direction of travel the signal speaks to, on the track */
  arrow?: boolean
  /** Struck through: the signal cannot stand there */
  crossed?: boolean
}

/**
 * One signal. `at` is its place on the axis of the track and `heading` the direction of travel it
 * speaks to, both on screen: the head goes to the left of `heading`.
 */
export function drawSignal(
  ctx: CanvasRenderingContext2D,
  at: Point,
  heading: Point,
  glyph: SignalGlyph,
  sizes: SignalSizes,
  style: SignalDrawStyle = {},
): void {
  const left = leftOf(heading)
  const cx = at.x + left.x * sizes.offset
  const cy = at.y + left.y * sizes.offset
  const r = sizes.lamp
  const lamp = (x: number, y: number, color: SignalColor | null): void => {
    ctx.fillStyle = color ? SIGNAL_LAMP_COLORS[color] : LAMP_OFF
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.save()
  if (style.alpha !== undefined) ctx.globalAlpha = style.alpha

  if (glyph.oneWay) {
    // One-way: a short bar across the track at the foot of the signal
    const half = Math.max(5, sizes.offset * 0.42)
    ctx.strokeStyle = SIGNAL_DANGER
    ctx.lineWidth = 2.5
    ctx.lineCap = 'butt'
    ctx.beginPath()
    ctx.moveTo(at.x - left.x * half, at.y - left.y * half)
    ctx.lineTo(at.x + left.x * half, at.y + left.y * half)
    ctx.stroke()
  }

  // Mast, from the track to the head
  ctx.strokeStyle = SIGNAL_BODY
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(at.x, at.y)
  ctx.lineTo(cx, cy)
  ctx.stroke()

  if (style.arrow) {
    // The direction of travel, on the axis of the track
    const len = Math.max(12, sizes.offset)
    const tipX = at.x + heading.x * len
    const tipY = at.y + heading.y * len
    ctx.strokeStyle = SIGNAL_SELECTED
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(at.x, at.y)
    ctx.lineTo(tipX, tipY)
    ctx.moveTo(tipX - heading.x * 5 + left.x * 4, tipY - heading.y * 5 + left.y * 4)
    ctx.lineTo(tipX, tipY)
    ctx.lineTo(tipX - heading.x * 5 - left.x * 4, tipY - heading.y * 5 - left.y * 4)
    ctx.stroke()
  }

  ctx.fillStyle = glyph.shape === 'marker' ? MARKER_BLUE : SIGNAL_BODY
  ctx.strokeStyle = SIGNAL_EDGE
  ctx.lineWidth = 1
  ctx.beginPath()
  if (glyph.shape === 'block') {
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2)
  } else if (glyph.shape === 'path') {
    const d = r + 4
    ctx.moveTo(cx, cy - d)
    ctx.lineTo(cx + d, cy)
    ctx.lineTo(cx, cy + d)
    ctx.lineTo(cx - d, cy)
    ctx.closePath()
  } else if (glyph.shape === 'marker') {
    const h = r + 2
    ctx.rect(cx - h, cy - h, h * 2, h * 2)
  } else {
    // Target of a French signal seen from above: as long as its lamps, across the mast
    const half = glyph.lamps.length > 1 ? 2 * r + 2.5 : r + 2
    ctx.roundRect(cx - half, cy - (r + 2), half * 2, (r + 2) * 2, r + 2)
  }
  ctx.fill()
  ctx.stroke()

  if (glyph.shape === 'marker') {
    // Yellow triangle, its point towards the track
    const h = r + 0.5
    ctx.fillStyle = MARKER_YELLOW
    ctx.beginPath()
    ctx.moveTo(cx - left.x * h, cy - left.y * h)
    ctx.lineTo(cx + left.x * h * 0.6 + heading.x * h * 0.8, cy + left.y * h * 0.6 + heading.y * h * 0.8)
    ctx.lineTo(cx + left.x * h * 0.6 - heading.x * h * 0.8, cy + left.y * h * 0.6 - heading.y * h * 0.8)
    ctx.closePath()
    ctx.fill()
  } else if (glyph.lamps.length > 1) {
    lamp(cx - r - 0.5, cy, glyph.lamps[0])
    lamp(cx + r + 0.5, cy, glyph.lamps[1])
  } else {
    lamp(cx, cy, glyph.lamps[0] ?? null)
  }

  if (glyph.plate && sizes.plate) {
    // Plate beyond the head, away from the track
    const px = cx + left.x * (r + 11)
    const py = cy + left.y * (r + 11)
    ctx.font = '700 8px Archivo, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const width = ctx.measureText(glyph.plate).width + 6
    ctx.fillStyle = SIGNAL_EDGE
    ctx.strokeStyle = SIGNAL_BODY
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.rect(px - width / 2, py - 5.5, width, 11)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = SIGNAL_BODY
    ctx.fillText(glyph.plate, px, py + 0.5)
  }

  if (glyph.speed && sizes.plate) {
    // The speed its two yellow lamps ask for, beyond the plate
    const reach = r + (glyph.plate ? 24 : 11)
    const px = cx + left.x * reach
    const py = cy + left.y * reach
    const text = String(glyph.speed)
    ctx.font = '700 8px Archivo, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const width = ctx.measureText(text).width + 6
    ctx.fillStyle = SIGNAL_LAMP_COLORS.yellow
    ctx.strokeStyle = SIGNAL_BODY
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.rect(px - width / 2, py - 5.5, width, 11)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = SIGNAL_BODY
    ctx.fillText(text, px, py + 0.5)
  }

  if (style.ring) {
    ctx.strokeStyle = style.ring
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, 2 * r + 6, 0, Math.PI * 2)
    ctx.stroke()
  }

  if (style.crossed) {
    const d = 2 * r + 5
    ctx.strokeStyle = SIGNAL_DANGER
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(cx - d, cy - d)
    ctx.lineTo(cx + d, cy + d)
    ctx.moveTo(cx + d, cy - d)
    ctx.lineTo(cx - d, cy + d)
    ctx.stroke()
  }
  ctx.restore()
}

// ─────────────────── Layout, kept between frames ───────────────────

interface PlacedSignal {
  signal: Signal
  pos: Point
  heading: Point
  /** Below ground: drawn faded, like the rails of a tunnel */
  tunnel: boolean
}

interface SignalLayout {
  revision: number
  signals: PlacedSignal[]
  /** The block of each signal, with the colour it is given */
  blocks: { signalId: SignalId; color: string; spans: readonly TrackSpan[] }[]
  /** Reports, by the settings they were worked out for */
  reportKey: string
  report: { pos: Point; entry: SignalReportEntry }[]
}

const layouts = new WeakMap<object, SignalLayout>()

/** Colour of the block of the `index`-th signal of the network */
export function blockColor(index: number): string {
  return BLOCK_COLORS[((index % BLOCK_COLORS.length) + BLOCK_COLORS.length) % BLOCK_COLORS.length]
}

/**
 * Where the signals stand and the track of their blocks. Kept as long as the signals
 * (`signalsRevision`) and the track (`trackKey`, an object replaced whenever the network changes)
 * stay the same.
 */
function signalLayout(net: Network, trackKey: object): SignalLayout {
  const revision = signalsRevision(net)
  const kept = layouts.get(trackKey)
  if (kept && kept.revision === revision) return kept
  const signals: PlacedSignal[] = []
  for (const signal of net.signals.values()) {
    const pos = signalWorldPosition(net, signal)
    const heading = signalHeading(net, signal)
    if (pos && heading) signals.push({ signal, pos, heading, tunnel: trackPositionBand(net, signal) < 0 })
  }
  const blocks: SignalLayout['blocks'] = []
  const all = signalBlocks(net)
  let index = 0
  for (const signal of net.signals.values()) {
    const block = all.get(signal.id)
    if (block) blocks.push({ signalId: signal.id, color: blockColor(index), spans: block.spans })
    index++
  }
  const layout: SignalLayout = { revision, signals, blocks, reportKey: '', report: [] }
  layouts.set(trackKey, layout)
  return layout
}

function reportOf(net: Network, layout: SignalLayout, level: SignallingLevel, line: LineSettings): SignalLayout['report'] {
  const key = `${level}|${line.lineSpeed}|${line.lineType}|${speedZonesRevision(net)}`
  if (layout.reportKey !== key) {
    layout.reportKey = key
    layout.report = []
    for (const entry of signalReport(net, { level, line })) {
      const pos = positionOnSegment(net, entry.segId, entry.t)
      if (pos) layout.report.push({ pos, entry })
    }
  }
  return layout.report
}

// ─────────────────── Stretches of track beside the axis ───────────────────

/**
 * Add stretches of track to the current path, each shifted by `offset` px to the left of the
 * direction it is walked in (`t0` → `t1`): two stretches over the same rail, one for each direction
 * of travel, show side by side. A curve is drawn as a short run of chords.
 */
export function traceOffsetSpans(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  spans: readonly TrackSpan[],
  offset: number,
): void {
  for (const span of spans) {
    const seg = net.segments.get(span.segId)
    if (!seg) continue
    // A long rail may wind: enough chords for the stripe to follow it
    const steps = seg.kind === 'path' ? 8 * (seg.path?.length ?? 1) : seg.kind === 'curve' && seg.via ? 8 : 1
    const ascending = span.t1 >= span.t0
    for (let i = 0; i <= steps; i++) {
      const t = span.t0 + ((span.t1 - span.t0) * i) / steps
      const pos = positionOnSegment(net, span.segId, t)
      const tangent = tangentOnSegment(net, span.segId, t)
      if (!pos || !tangent) break
      const left = leftOf(ascending ? tangent : { x: -tangent.x, y: -tangent.y })
      const x = (pos.x - cam.x) * cam.scale + vw / 2 + left.x * offset
      const y = (pos.y - cam.y) * cam.scale + vh / 2 + left.y * offset
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
  }
}

/** Distance (px) from the axis of the track to the stripe of a block, and its width */
function blockStripe(scale: number, gauge: number): { offset: number; width: number } {
  const g = (gauge > 0 ? gauge : REFERENCE_GAUGE) * scale
  return { offset: Math.max(4, 1.15 * g), width: Math.max(2.5, Math.min(6, 0.5 * g)) }
}

/** Stroke one block (or any stretch read in a direction of travel) as a stripe beside the rails. */
export function drawBlockStripe(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  spans: readonly TrackSpan[],
  color: string,
  gauge: number,
  alpha: number = BLOCK_ALPHA,
): void {
  if (spans.length === 0) return
  const stripe = blockStripe(cam.scale, gauge)
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = alpha
  ctx.lineWidth = stripe.width
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  traceOffsetSpans(ctx, cam, vw, vh, net, spans, stripe.offset)
  ctx.stroke()
  ctx.restore()
}

// ─────────────────── Speed signs (pro level) ───────────────────

/** One distant speed sign: white with black figures, a square, or a diamond for a large drop. */
export function drawSpeedSign(ctx: CanvasRenderingContext2D, at: Point, heading: Point, sign: Pick<SpeedSign, 'speed' | 'diamond'>, sizes: SignalSizes): void {
  const left = leftOf(heading)
  const cx = at.x + left.x * (sizes.offset + 4)
  const cy = at.y + left.y * (sizes.offset + 4)
  const half = 8
  ctx.save()
  ctx.strokeStyle = SPEED_SIGN_INK
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(at.x, at.y)
  ctx.lineTo(cx, cy)
  ctx.stroke()

  ctx.fillStyle = SPEED_SIGN_BG
  ctx.lineWidth = 1
  ctx.beginPath()
  if (sign.diamond) {
    const d = half * 1.35
    ctx.moveTo(cx, cy - d)
    ctx.lineTo(cx + d, cy)
    ctx.lineTo(cx, cy + d)
    ctx.lineTo(cx - d, cy)
    ctx.closePath()
  } else {
    ctx.rect(cx - half, cy - half, half * 2, half * 2)
  }
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = SPEED_SIGN_INK
  ctx.font = '700 8px Archivo, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(Math.round(sign.speed)), cx, cy + 0.5)
  ctx.restore()
}

// ─────────────────── The whole signalling layer ───────────────────

export interface SignalRenderOptions {
  level: SignallingLevel
  /** Rail gauge of the project, m */
  gauge?: number
  /** Driving: what the signals show and the track held. Absent: every signal in its default state */
  state?: SignallingState | null
  selectedId?: SignalId | null
  /** The signal the next click would remove */
  dangerId?: SignalId | null
  /** Each block as a coloured stripe beside the rails (drawn with the rails: `renderSignalStripes`) */
  showBlocks?: boolean
  /** Driving: the track held for each train (drawn with the rails too) */
  showReservations?: boolean
  /** Construction view: the entries of the signalling report get the diagnostic marker */
  report?: boolean
  /** Line settings: the report and the distant speed signs depend on them */
  line?: LineSettings
}

/** The stretches of `spans` that lie on the pieces of rail `ranges` holds, each kept in the direction it is walked */
function clipSpans(spans: readonly TrackSpan[], ranges: ReadonlyMap<string, { t0: number; t1: number }[]>): TrackSpan[] {
  const out: TrackSpan[] = []
  for (const span of spans) {
    const pieces = ranges.get(span.segId)
    if (!pieces) continue
    const lo = Math.min(span.t0, span.t1)
    const hi = Math.max(span.t0, span.t1)
    for (const piece of pieces) {
      const from = Math.max(lo, piece.t0)
      const to = Math.min(hi, piece.t1)
      if (to - from <= 1e-9) continue
      out.push(span.t1 >= span.t0 ? { segId: span.segId, t0: from, t1: to } : { segId: span.segId, t0: to, t1: from })
    }
  }
  return out
}

/**
 * Stripes of the blocks (`showBlocks`) and of the track held for each train (`showReservations`,
 * while driving) over the pieces of rail of one level. Called from the rail pass, before the rails
 * themselves, like the bands of the speed zones: what lies under the deck of a bridge above is
 * covered by it, and `levelAlpha` fades what is in a tunnel. One stroke per block and per stretch
 * held. Nothing at all is drawn for a network without signal. `trackKey`: see `signalLayout`.
 */
export function renderSignalStripes(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  trackKey: object,
  pieces: readonly TrackPiece[],
  levelAlpha: number,
  options: SignalRenderOptions | undefined,
): void {
  if (!options || net.signals.size === 0) return
  const held = options.showReservations && options.state ? options.state : null
  if (!options.showBlocks && !held) return
  const gauge = options.gauge ?? REFERENCE_GAUGE
  const ranges = new Map<string, { t0: number; t1: number }[]>()
  for (const piece of pieces) {
    const list = ranges.get(piece.seg.id)
    if (list) list.push(piece)
    else ranges.set(piece.seg.id, [piece])
  }

  if (options.showBlocks) {
    for (const block of signalLayout(net, trackKey).blocks) {
      const spans = clipSpans(block.spans, ranges)
      if (spans.length > 0) drawBlockStripe(ctx, cam, vw, vh, net, spans, block.color, gauge, BLOCK_ALPHA * levelAlpha)
    }
  }

  if (held) {
    const colors = new Map<string, string>()
    const colorOf = (trainId: string): string => {
      let color = colors.get(trainId)
      if (!color) {
        color = RESERVATION_COLORS[colors.size % RESERVATION_COLORS.length]
        colors.set(trainId, color)
      }
      return color
    }
    // Trains in the order the engine knows them, so a train keeps its colour from frame to frame
    for (const trainId of held.trains.keys()) colorOf(trainId)
    for (const reservations of held.railReservations.values()) {
      for (const reservation of reservations) {
        const spans = clipSpans([reservation], ranges)
        if (spans.length > 0) drawBlockStripe(ctx, cam, vw, vh, net, spans, colorOf(reservation.trainId), gauge, RESERVATION_ALPHA * levelAlpha)
      }
    }
  }
}

/**
 * Signals, distant speed signs (pro level) and report markers, in that order. Drawn with the
 * overlays of the network (the blocks and the reservations go with the rails, see
 * `renderSignalStripes`). `trackKey`: see `signalLayout`. Nothing at all is drawn for a network
 * without signal and without sign.
 */
export function renderSignalling(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  trackKey: object,
  options: SignalRenderOptions,
): void {
  const signs = options.level === 'pro' ? speedSigns(net, options.line) : []
  if (net.signals.size === 0 && signs.length === 0) return
  const gauge = options.gauge ?? REFERENCE_GAUGE
  const sizes = signalSizes(cam.scale, gauge)
  const margin = 60
  const toScreen = (p: Point): Point | null => {
    const x = (p.x - cam.x) * cam.scale + vw / 2
    const y = (p.y - cam.y) * cam.scale + vh / 2
    return x < -margin || x > vw + margin || y < -margin || y > vh + margin ? null : { x, y }
  }

  if (net.signals.size > 0) {
    const layout = signalLayout(net, trackKey)

    for (const placed of layout.signals) {
      const at = toScreen(placed.pos)
      if (!at) continue
      const status = options.state ? signalStatus(options.state, placed.signal) : defaultSignalStatus(placed.signal)
      const id = placed.signal.id
      const selected = id === options.selectedId
      drawSignal(ctx, at, placed.heading, signalGlyph(placed.signal, status.state, options.level, status), sizes, {
        alpha: placed.tunnel ? 0.4 : undefined,
        ring: id === options.dangerId ? SIGNAL_DANGER : selected ? SIGNAL_SELECTED : null,
        arrow: selected,
      })
    }
  }

  for (const sign of signs) {
    const pos = positionOnSegment(net, sign.segId, sign.t)
    const tangent = tangentOnSegment(net, sign.segId, sign.t)
    const at = pos && toScreen(pos)
    if (!at || !tangent) continue
    drawSpeedSign(ctx, at, sign.forward ? tangent : { x: -tangent.x, y: -tangent.y }, sign, sizes)
  }

  if (options.report && net.signals.size > 0 && options.line) {
    for (const { pos, entry } of reportOf(net, signalLayout(net, trackKey), options.level, options.line)) {
      const at = toScreen(pos)
      if (at) drawDiagnosticMarker(ctx, at.x, at.y, cam.scale, 'warning', entry.message)
    }
  }
}

// ─────────────────── Preview of the placement tool ───────────────────

/**
 * The two blocks a signal laid at `place` for the direction `forward` would make: the one it would
 * open (`ahead`) and the ones it would close (`behind`: the track from the signals before it up to
 * it). Worked out on a throwaway copy of the signals: the network itself is not touched.
 */
export function previewSignalBlocks(
  net: Network,
  place: { segId: string; t: number },
  forward: boolean,
): { ahead: readonly TrackSpan[]; behind: { signalId: SignalId; spans: readonly TrackSpan[] }[] } {
  const PREVIEW_ID = '__preview__'
  const signals = new Map(net.signals)
  signals.set(PREVIEW_ID, { id: PREVIEW_ID, segId: place.segId, t: place.t, forward, role: 'spacing' })
  const copy: Network = { ...net, signals }
  const topology = signalTopology(copy)
  const behind: { signalId: SignalId; spans: readonly TrackSpan[] }[] = []
  for (const block of topology.blocks.values()) {
    if (block.signalId !== PREVIEW_ID && block.boundingSignals.includes(PREVIEW_ID)) {
      behind.push({ signalId: block.signalId, spans: block.spans })
    }
  }
  return { ahead: topology.blocks.get(PREVIEW_ID)?.spans ?? [], behind }
}

/** Colour of the block of a signal of the network (the order of the signals gives it) */
export function blockColorOf(net: Network, signalId: SignalId): string {
  let index = 0
  for (const id of net.signals.keys()) {
    if (id === signalId) return blockColor(index)
    index++
  }
  return blockColor(index)
}
