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
import { diagnosticMarkerRadius, drawDiagnosticMarker, type DiagnosticLabelBox } from './diagnosticMarker'
import { trackPositionBand, type TrackPiece } from './levelPieces'
import { trackLod } from './lod'
import { themeInk } from './themeInk'

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
//   take at 30 or 60 km/h are two yellow lamps, as on the real target: side by side for the
//   announcement, one beyond the other for the reminder; they flash for 60, and the speed is on a
//   small tag once the zoom is close.
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
/** A flashing lamp between two flashes: still there, dimmed */
const LAMP_DIM_ALPHA = 0.28
const SIGNAL_BODY = '#111827'
const SIGNAL_EDGE = '#f8fafc'
const SIGNAL_SELECTED = '#2563eb'
const SIGNAL_DANGER = '#ef4444'
const MARKER_BLUE = '#1d4ed8'
const MARKER_YELLOW = '#facc15'
const SPEED_SIGN_BG = '#ffffff'
const SPEED_SIGN_INK = '#111827'

/**
 * Colours of the blocks, taken in turn in the order of the signals. Cool hues only: green, yellow
 * and red belong to the lamps, amber to the speed zones and the warnings.
 */
export const BLOCK_COLORS = ['#0ea5e9', '#8b5cf6', '#14b8a6', '#6366f1', '#38bdf8', '#a78bfa'] as const
/** Colours of the track held for each train, taken in turn in the order the trains appear: cool hues too */
export const RESERVATION_COLORS = ['#22d3ee', '#c084fc', '#60a5fa', '#2dd4bf', '#818cf8'] as const
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
    lamp: Math.max(3.5, Math.min(6, 0.45 * g)),
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
  /** Only there when true: the two lamps stand one beyond the other, away from the track (the reminder) */
  stacked?: true
  /** Only there when true: the two yellow lamps flash (points to take at 60 km/h) */
  flashing?: true
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
    // Two yellow lamps, whatever the target: side by side for the announcement, one beyond the
    // other for the reminder, as they are on the real target
    glyph.lamps = ['yellow', 'yellow']
    glyph.speed = speed
    if (aspect.reminder) glyph.stacked = true
    if (speed === 60) glyph.flashing = true
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
  /** Colour of the mast: the ink of the theme. Absent: dark, as on a light sheet */
  ink?: string
  /** False between two flashes of a flashing glyph: its lamps are dimmed. Absent: lit */
  flashOn?: boolean
}

/** Flashing lamps are lit this long, then out as long (ms): about 1 Hz, cadence not sourced */
export const SIGNAL_FLASH_HALF_PERIOD = 500

/** Whether a flashing lamp is lit at a time (ms) */
export function signalFlashOn(now: number): boolean {
  return Math.floor(now / SIGNAL_FLASH_HALF_PERIOD) % 2 === 0
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
  const two = glyph.shape !== 'marker' && glyph.lamps.length > 1
  // Two lamps stand across the mast, or one beyond the other away from the track (`stacked`)
  const axis = glyph.stacked ? left : heading
  const spread = two ? r + 0.5 : 0
  // The stacked pair starts where a single lamp would be and grows outwards
  const shift = glyph.stacked ? spread : 0
  const hx = cx + left.x * shift
  const hy = cy + left.y * shift
  /** How far the head reaches beyond its middle, away from the track */
  const reach = r + 2 + (glyph.stacked ? 2 * spread : 0)
  const dimmed = glyph.flashing === true && style.flashOn === false
  const lamp = (x: number, y: number, color: SignalColor | null): void => {
    const alpha = ctx.globalAlpha
    if (color && dimmed) ctx.globalAlpha = alpha * LAMP_DIM_ALPHA
    ctx.fillStyle = color ? SIGNAL_LAMP_COLORS[color] : LAMP_OFF
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = alpha
  }
  /** A small tag beyond the head, away from the track: the plate, the speed */
  const tag = (distance: number, text: string, background: string): void => {
    const px = cx + left.x * distance
    const py = cy + left.y * distance
    ctx.font = '700 9px Archivo, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const width = ctx.measureText(text).width + 6
    ctx.fillStyle = background
    ctx.strokeStyle = SIGNAL_BODY
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.rect(px - width / 2, py - 6, width, 12)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = SIGNAL_BODY
    ctx.fillText(text, px, py + 0.5)
  }

  ctx.save()
  if (style.alpha !== undefined) ctx.globalAlpha = style.alpha

  if (glyph.oneWay) {
    // One-way: a short bar across the track at the foot of the signal
    const half = Math.max(6, sizes.offset * 0.5)
    ctx.strokeStyle = SIGNAL_DANGER
    ctx.lineWidth = 2.5
    ctx.lineCap = 'butt'
    ctx.beginPath()
    ctx.moveTo(at.x - left.x * half, at.y - left.y * half)
    ctx.lineTo(at.x + left.x * half, at.y + left.y * half)
    ctx.stroke()
  }

  // Mast, from the track to the head
  ctx.strokeStyle = style.ink ?? SIGNAL_BODY
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

  if (two) {
    // Target of a French signal seen from above, as long as its two lamps: a thick line with round
    // ends, its light edge first
    ctx.lineCap = 'round'
    for (const [color, width] of [[SIGNAL_EDGE, 2 * (r + 2) + 2], [SIGNAL_BODY, 2 * (r + 2)]] as const) {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(hx - axis.x * spread, hy - axis.y * spread)
      ctx.lineTo(hx + axis.x * spread, hy + axis.y * spread)
      ctx.stroke()
    }
  } else {
    ctx.fillStyle = glyph.shape === 'marker' ? MARKER_BLUE : SIGNAL_BODY
    ctx.strokeStyle = SIGNAL_EDGE
    ctx.lineWidth = 1
    ctx.beginPath()
    if (glyph.shape === 'path') {
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
      // One lamp: a round head, at the standard level as for a sémaphore
      ctx.arc(cx, cy, r + 2, 0, Math.PI * 2)
    }
    ctx.fill()
    ctx.stroke()
  }

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
  } else if (two) {
    lamp(hx - axis.x * spread, hy - axis.y * spread, glyph.lamps[0])
    lamp(hx + axis.x * spread, hy + axis.y * spread, glyph.lamps[1])
  } else {
    lamp(cx, cy, glyph.lamps[0] ?? null)
  }

  // Plate beyond the head, away from the track, then the speed its two yellow lamps ask for
  if (glyph.plate && sizes.plate) tag(reach + 9, glyph.plate, SIGNAL_EDGE)
  if (glyph.speed && sizes.plate) tag(reach + (glyph.plate ? 23 : 9), String(glyph.speed), SIGNAL_LAMP_COLORS.yellow)

  if (style.ring) {
    ctx.strokeStyle = style.ring
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(hx, hy, 2 * r + 6 + (glyph.stacked ? spread : 0), 0, Math.PI * 2)
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

/**
 * What the marker of a report entry says on the canvas: the name of the defect, without its
 * figures — « Canton trop court ». The whole message is in the panel of the signal.
 */
export function reportLabel(entry: Pick<SignalReportEntry, 'message'>): string {
  return entry.message.split(' : ')[0]
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
export function drawSpeedSign(ctx: CanvasRenderingContext2D, at: Point, heading: Point, sign: Pick<SpeedSign, 'speed' | 'diamond'>, sizes: SignalSizes, ink: string = SPEED_SIGN_INK): void {
  const left = leftOf(heading)
  const cx = at.x + left.x * (sizes.offset + 4)
  const cy = at.y + left.y * (sizes.offset + 4)
  const half = 9
  ctx.save()
  ctx.strokeStyle = ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(at.x, at.y)
  ctx.lineTo(cx, cy)
  ctx.stroke()

  ctx.fillStyle = SPEED_SIGN_BG
  ctx.strokeStyle = SPEED_SIGN_INK
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
  ctx.font = '700 9px Archivo, system-ui, sans-serif'
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
  /** Driving: false between two flashes of the flashing lamps (`signalFlashOn`). Absent: lit */
  flashOn?: boolean
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
  const gauge = options.gauge ?? REFERENCE_GAUGE
  // In the schematic the boards of the zones are gone: the signs that announce them go with them
  const signs = options.level === 'pro' && trackLod(cam.scale, gauge) !== 'schematic' ? speedSigns(net, options.line) : []
  if (net.signals.size === 0 && signs.length === 0) return
  const sizes = signalSizes(cam.scale, gauge)
  const ink = themeInk(ctx)
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
        ink,
        flashOn: options.flashOn,
      })
    }
  }

  for (const sign of signs) {
    const pos = positionOnSegment(net, sign.segId, sign.t)
    const tangent = tangentOnSegment(net, sign.segId, sign.t)
    const at = pos && toScreen(pos)
    if (!at || !tangent) continue
    drawSpeedSign(ctx, at, sign.forward ? tangent : { x: -tangent.x, y: -tangent.y }, sign, sizes, ink)
  }

  if (options.report && net.signals.size > 0 && options.line) {
    const layout = signalLayout(net, trackKey)
    const headings = new Map<SignalId, Point>()
    for (const placed of layout.signals) headings.set(placed.signal.id, placed.heading)
    // A label never covers the head of its signal nor another label: it goes on the other side of
    // the track, and the ones that would overlap wait for a closer zoom
    const taken: DiagnosticLabelBox[] = []
    const marks: { at: Point; entry: SignalReportEntry }[] = []
    const radius = diagnosticMarkerRadius(cam.scale)
    for (const { pos, entry } of reportOf(net, layout, options.level, options.line)) {
      const at = toScreen(pos)
      if (!at) continue
      marks.push({ at, entry })
      // Nor the diamond of another marker
      taken.push({ x: at.x - radius, y: at.y - radius, w: 2 * radius, h: 2 * radius })
    }
    for (const { at, entry } of marks) {
      const heading = headings.get(entry.signalId)
      const head = heading ? leftOf(heading) : null
      drawDiagnosticMarker(ctx, at.x, at.y, cam.scale, 'warning', reportLabel(entry), {
        away: head ? { x: -head.x, y: -head.y } : undefined,
        taken,
      })
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
