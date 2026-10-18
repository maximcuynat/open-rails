import type { Network, Platform, PlatformEdge, Point } from '@domain/models/types'
import { networkCheckToken } from '@domain/models/networkWatch'
import { edgeLength, edgeLine, platformDimensions, pointOnEdge, sideNormal, PLATFORM_EDGE_OFFSET, PLATFORM_WIDTH, ISLAND_MIN_WIDTH, type PlatformDimensions } from '@domain/models/platforms'
import { formatDistance, type Unit } from '@domain/models/units'
import type { Camera } from './camera'
import type { LabelSpace, ScreenBox } from './labelSpace'
import type { TrackLod } from './lod'
import { lineTrackWidth } from './lodTracks'
import { trackPositionBand } from './levelPieces'
import { textWidth } from './textWidth'

// ─────────────────── Platforms on the canvas ───────────────────
//
// A platform is drawn with the track it runs along, in the pass of its level: its body after the
// bridge deck and before everything else of the level (speed bands, block stripes, rails), so that
// it never covers a rail nor what is laid beside the rails. Its edge (« nez de quai ») is a line of
// its own, with the safety line a little inside it and a tick at each end (the « bornes ») once
// the view is close. Its stop markers are boards on the platform, written with the train length
// they stop, among the overlays (they take their room in the `LabelSpace`).
//
// From the line tier out the platform is a thick line beside the track; in the schematic it is not
// drawn. The geometry of every platform is kept from one frame to the next and only worked out
// again for a platform whose rails, nodes or fields changed.

/** What the platforms of a frame are drawn with */
export interface PlatformRenderOptions {
  /** The platform picked and the one under the cursor */
  selectedId?: string | null
  hoveredId?: string | null
  /** Display unit of the lengths written on the stop markers (metres when left out) */
  unit?: Unit
}

/** How the platforms are drawn at a tier: as a body, as a thick line beside the track, or not at all */
export type PlatformLook = 'body' | 'strip' | 'hidden'

export function platformLook(lod: TrackLod): PlatformLook {
  if (lod === 'detail' || lod === 'rails') return 'body'
  return lod === 'line' ? 'strip' : 'hidden'
}

// Thresholds of the details, in pixels of the width of the platform on screen (any model scale)
/** The ticks at the ends and the stop marker boards: from about 3 px/m at 1:1 */
export const PLATFORM_DETAIL_FROM_PX = 18
/** The safety line inside the edge: from about 6 px/m at 1:1 */
export const PLATFORM_SAFETY_LINE_FROM_PX = 36
/** The train length written by a stop marker: from about 8 px/m at 1:1 */
export const PLATFORM_LABEL_FROM_PX = 48

/** Distance from the edge to the safety line, metres at 1:1 */
const SAFETY_LINE_INSET = 0.5
/** The thick line of a zoomed-out platform is never thinner than this, px */
const STRIP_MIN_PX = 2
/** Length of the tick at an end of an edge, into the platform, px */
const TICK_PX = 10
/** Board of a stop marker: length along the edge, width across, distance from the edge, px */
const BOARD_ALONG = 10
const BOARD_ACROSS = 8
const BOARD_FROM_EDGE = 7
/** Pixels from the board to the middle of its label */
const LABEL_FROM_BOARD = 14
const LABEL_FONT = '600 10px Archivo, system-ui, sans-serif'
const BOARD_INK = '#0f172a'

// ─────────────────── Geometry kept between frames ───────────────────

/** One edge as drawn: its track as a line, with the unit normal towards the platform at each point */
interface EdgeShape {
  axis: Point[]
  normal: Point[]
}

/** A stop marker as drawn: where, the way it faces, and towards the platform */
interface MarkerShape {
  point: Point
  heading: Point
  normal: Point
  maxLength?: number
}

/** A platform as drawn, in world coordinates */
export interface PlatformShape {
  platform: Platform
  /** The closed outline of its body (first point not repeated) */
  outline: Point[]
  /** Box of the outline, for the culling */
  minX: number
  minY: number
  maxX: number
  maxY: number
  edges: EdgeShape[]
  markers: MarkerShape[]
  /** Drawing level of its track (bridge > 0, tunnel < 0) */
  level: number
  /** What the shape was worked out from: compared, value by value, when the network changes */
  inputs: unknown[]
}

interface Kept {
  token: number | undefined
  gauge: number | undefined
  shapes: PlatformShape[]
}

const kept = new WeakMap<Network, Kept>()

/**
 * The shapes of the platforms of a network, in the order they were laid; the platforms that have
 * no track left are not in it. Kept while the network does not change, and then worked out again
 * only for the platforms whose own inputs changed.
 */
export function platformShapes(net: Network, gauge?: number): PlatformShape[] {
  const token = networkCheckToken(net)
  const known = kept.get(net)
  if (known && token !== undefined && known.token === token && known.gauge === gauge) return known.shapes
  const previous = new Map<Platform, PlatformShape>()
  if (known && known.gauge === gauge) for (const shape of known.shapes) previous.set(shape.platform, shape)
  const dims = platformDimensions(gauge)
  const shapes: PlatformShape[] = []
  for (const platform of net.platforms.values()) {
    const inputs = platformInputs(net, platform)
    const before = previous.get(platform)
    const shape = before && sameInputs(before.inputs, inputs) ? before : platformShape(net, platform, dims, inputs)
    if (shape) shapes.push(shape)
  }
  kept.set(net, { token, gauge, shapes })
  return shapes
}

/** The values the shape of a platform is drawn from: its fields, its rails, their nodes */
function platformInputs(net: Network, platform: Platform): unknown[] {
  const inputs: unknown[] = [platform.width, platform.edges.length]
  for (const edge of platform.edges) {
    inputs.push(edge.side, edge.track.length)
    for (const span of edge.track) {
      const seg = net.segments.get(span.segId)
      const from = seg && net.nodes.get(seg.from)
      const to = seg && net.nodes.get(seg.to)
      inputs.push(span.segId, span.t0, span.t1, seg, seg?.kind, seg?.via?.x, seg?.via?.y, seg?.path)
      inputs.push(from?.pos.x, from?.pos.y, from?.level, to?.pos.x, to?.pos.y, to?.level)
    }
  }
  for (const marker of platform.markers) inputs.push(marker.edge, marker.at, marker.heading, marker.maxLength)
  return inputs
}

function sameInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
  return true
}

/** Scale factor of a layout, from its platform sizes */
const scaleOf = (dims: PlatformDimensions): number => dims.edgeOffset / PLATFORM_EDGE_OFFSET

function edgeShape(net: Network, edge: PlatformEdge, tolerance: number): EdgeShape | null {
  // The line of the track and the line one metre towards the platform, cut the same way: their
  // difference is the unit normal, and any offset is then a multiply-add
  const axis = edgeLine(net, edge, 0, tolerance)
  if (axis.length < 2) return null
  const shifted = edgeLine(net, edge, 1, tolerance)
  const normal = axis.map((p, i) => ({ x: shifted[i].x - p.x, y: shifted[i].y - p.y }))
  return { axis, normal }
}

const offsetLine = (edge: EdgeShape, offset: number): Point[] =>
  edge.axis.map((p, i) => ({ x: p.x + edge.normal[i].x * offset, y: p.y + edge.normal[i].y * offset }))

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

function platformShape(net: Network, platform: Platform, dims: PlatformDimensions, inputs: unknown[]): PlatformShape | null {
  // Curves cut finely enough at the scale of the layout (`edgeLine` would keep 5 cm at any scale)
  const tolerance = 0.05 * scaleOf(dims)
  const edges: EdgeShape[] = []
  for (const edge of platform.edges) {
    const shape = edgeShape(net, edge, tolerance)
    if (!shape) return null
    edges.push(shape)
  }
  // The outline of `platformOutline`, from the lines kept here
  const front = offsetLine(edges[0], dims.edgeOffset)
  let outline: Point[]
  if (edges.length === 1) {
    outline = [...front, ...offsetLine(edges[0], dims.edgeOffset + platform.width * scaleOf(dims)).reverse()]
  } else {
    const other = offsetLine(edges[1], dims.edgeOffset)
    const sameWay = distance(front[0], other[0]) <= distance(front[0], other[other.length - 1])
    outline = [...front, ...(sameWay ? other.reverse() : other)]
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  // The track is in the box too: the thick line of a zoomed-out platform may lie closer to it
  for (const line of [outline, edges[0].axis, ...(edges[1] ? [edges[1].axis] : [])]) {
    for (const p of line) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  const markers: MarkerShape[] = []
  for (const marker of platform.markers) {
    const edge = platform.edges[marker.edge]
    const at = edge && pointOnEdge(net, edge, marker.at)
    if (!at) continue
    const sign = marker.heading === 'forward' ? 1 : -1
    markers.push({
      point: at.point,
      heading: { x: at.heading.x * sign, y: at.heading.y * sign },
      normal: sideNormal(at.heading, edge.side),
      ...(marker.maxLength !== undefined ? { maxLength: marker.maxLength } : {}),
    })
  }
  const middle = pointOnEdge(net, platform.edges[0], edgeLength(net, platform.edges[0]) / 2)
  const level = middle ? trackPositionBand(net, middle) : 0
  return { platform, outline, minX, minY, maxX, maxY, edges, markers, level, inputs }
}

/** The platforms whose box meets a world box (the view and its margin) */
export function platformsInView(net: Network, bounds: { minX: number; minY: number; maxX: number; maxY: number }, gauge?: number): PlatformShape[] {
  if (net.platforms.size === 0) return []
  return platformShapes(net, gauge).filter((s) => s.maxX >= bounds.minX && s.minX <= bounds.maxX && s.maxY >= bounds.minY && s.minY <= bounds.maxY)
}

/**
 * The platforms drawn in the pass of `level`, among the levels drawn this frame (`levels`, lowest
 * first): each platform goes with the highest of them that is not above its own — the lowest when
 * all are —, so that it is drawn once, whatever is in view.
 */
export function platformsOfPass(shapes: readonly PlatformShape[], level: number, levels: readonly number[]): PlatformShape[] {
  if (levels.length <= 1) return shapes as PlatformShape[]
  return shapes.filter((shape) => {
    let pass = levels[0]
    for (const l of levels) if (l <= shape.level) pass = l
    return pass === level
  })
}

// ─────────────────── Colours ───────────────────

interface PlatformColors {
  body: string
  edge: string
  line: string
  accent: string
  ink: string
}

/** Light theme, where there is no stylesheet (tests) */
const DEFAULT_COLORS: PlatformColors = { body: '#d4d6d9', edge: '#8f96a0', line: '#eab308', accent: '#2563eb', ink: '#1a1a1a' }

function platformColors(ctx: CanvasRenderingContext2D): PlatformColors {
  try {
    if (typeof window !== 'undefined' && window.getComputedStyle && ctx.canvas) {
      const style = window.getComputedStyle(ctx.canvas)
      const read = (prop: string, fallback: string): string => style.getPropertyValue(prop).trim() || fallback
      return {
        body: read('--platform', DEFAULT_COLORS.body),
        edge: read('--platform-edge', DEFAULT_COLORS.edge),
        line: read('--platform-line', DEFAULT_COLORS.line),
        accent: read('--accent', DEFAULT_COLORS.accent),
        ink: read('--ink', DEFAULT_COLORS.ink),
      }
    }
  } catch {
    // No stylesheet: the light theme
  }
  return DEFAULT_COLORS
}

// ─────────────────── Drawing ───────────────────

export interface PlatformPassOptions extends Pick<PlatformRenderOptions, 'selectedId' | 'hoveredId'> {
  lod: TrackLod
  gauge?: number
  /** Opacity of the level (a tunnel is dimmed) */
  alpha?: number
}

/** The bodies of the platforms of one level pass, under everything else of the level */
export function renderPlatformBodies(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  shapes: readonly PlatformShape[],
  options: PlatformPassOptions,
): void {
  const look = platformLook(options.lod)
  if (shapes.length === 0 || look === 'hidden') return
  const s = cam.scale
  const ox = vw / 2 - cam.x * s
  const oy = vh / 2 - cam.y * s
  const dims = platformDimensions(options.gauge)
  const k = scaleOf(dims)
  const colors = platformColors(ctx)

  const trace = (line: readonly Point[], close: boolean): void => {
    ctx.moveTo(line[0].x * s + ox, line[0].y * s + oy)
    for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x * s + ox, line[i].y * s + oy)
    if (close) ctx.closePath()
  }
  const highlight = (shape: PlatformShape): 'selected' | 'hovered' | null =>
    shape.platform.id === options.selectedId ? 'selected' : shape.platform.id === options.hoveredId ? 'hovered' : null

  ctx.save()
  ctx.globalAlpha = options.alpha ?? 1
  ctx.lineJoin = 'round'

  if (look === 'strip') {
    // A thick line beside the track, clear of the line the track is drawn as
    const trackHalf = lineTrackWidth(s) / 2
    ctx.lineCap = 'butt'
    for (const shape of shapes) {
      const mark = highlight(shape)
      ctx.strokeStyle = mark ? colors.accent : colors.body
      ctx.fillStyle = ctx.strokeStyle
      ctx.beginPath()
      if (shape.edges.length === 2) {
        // An island: its body between the two tracks, edged so that it never vanishes
        ctx.lineWidth = 1
        trace(shape.outline, true)
        ctx.fill()
        ctx.stroke()
        continue
      }
      const widthPx = Math.max(STRIP_MIN_PX, shape.platform.width * k * s)
      const centrePx = Math.max((dims.edgeOffset + (shape.platform.width * k) / 2) * s, trackHalf + 1 + widthPx / 2)
      ctx.lineWidth = widthPx
      trace(offsetLine(shape.edges[0], centrePx / s), false)
      ctx.stroke()
    }
    ctx.restore()
    return
  }

  // The bodies, one fill each (two platforms that overlap never cut a hole in each other)
  for (const shape of shapes) {
    ctx.fillStyle = colors.body
    ctx.beginPath()
    trace(shape.outline, true)
    ctx.fill()
    const mark = highlight(shape)
    if (mark) {
      ctx.save()
      ctx.globalAlpha = (options.alpha ?? 1) * (mark === 'selected' ? 0.22 : 0.12)
      ctx.fillStyle = colors.accent
      ctx.fill()
      ctx.restore()
    }
  }

  // The edges along the track, in one stroke
  ctx.lineCap = 'butt'
  ctx.strokeStyle = colors.edge
  ctx.lineWidth = Math.max(1, Math.min(3, 0.25 * k * s))
  ctx.beginPath()
  for (const shape of shapes) for (const edge of shape.edges) trace(offsetLine(edge, dims.edgeOffset), false)
  ctx.stroke()

  const widthPx = PLATFORM_WIDTH * k * s
  if (widthPx >= PLATFORM_SAFETY_LINE_FROM_PX) {
    ctx.strokeStyle = colors.line
    ctx.lineWidth = Math.max(1, 0.12 * k * s)
    ctx.beginPath()
    for (const shape of shapes) for (const edge of shape.edges) trace(offsetLine(edge, dims.edgeOffset + SAFETY_LINE_INSET * k), false)
    ctx.stroke()
  }

  if (widthPx >= PLATFORM_DETAIL_FROM_PX) {
    // The ends of each edge: a tick across it, into the platform
    ctx.strokeStyle = colors.ink
    ctx.lineWidth = 2
    ctx.beginPath()
    for (const shape of shapes) {
      const room = (shape.edges.length === 2 ? ISLAND_MIN_WIDTH / 2 : shape.platform.width) * k
      const tick = Math.min(room, TICK_PX / s)
      for (const edge of shape.edges) {
        for (const i of [0, edge.axis.length - 1]) {
          const p = edge.axis[i]
          const n = edge.normal[i]
          const a = dims.edgeOffset
          const b = dims.edgeOffset + tick
          ctx.moveTo((p.x + n.x * a) * s + ox, (p.y + n.y * a) * s + oy)
          ctx.lineTo((p.x + n.x * b) * s + ox, (p.y + n.y * b) * s + oy)
        }
      }
    }
    ctx.stroke()
  }

  // The picked platform and the one under the cursor: their outline in the accent colour
  for (const shape of shapes) {
    const mark = highlight(shape)
    if (!mark) continue
    ctx.strokeStyle = colors.accent
    ctx.lineWidth = mark === 'selected' ? 2.5 : 1.5
    if (mark === 'hovered') ctx.setLineDash([5, 4])
    ctx.beginPath()
    trace(shape.outline, true)
    ctx.stroke()
    if (mark === 'hovered') ctx.setLineDash([])
  }
  ctx.restore()
}

export interface StopMarkerOptions extends Pick<PlatformRenderOptions, 'unit'> {
  lod: TrackLod
  gauge?: number
  /** The room of the screen shared with the other labels of the frame */
  space?: LabelSpace
}

/**
 * The stop markers of the platforms: a board on the platform beside the edge, pointing the way of
 * the trains it speaks to, with the longest train it stops written beside it when it has one.
 * Boards are always drawn once the view is close enough; a label gives way to what is already there.
 */
export function renderStopMarkers(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  shapes: readonly PlatformShape[],
  options: StopMarkerOptions,
): void {
  if (shapes.length === 0 || platformLook(options.lod) !== 'body') return
  const s = cam.scale
  const dims = platformDimensions(options.gauge)
  const widthPx = PLATFORM_WIDTH * scaleOf(dims) * s
  if (widthPx < PLATFORM_DETAIL_FROM_PX) return
  const labels = widthPx >= PLATFORM_LABEL_FROM_PX
  const unit = options.unit ?? 'm'
  const edgePx = dims.edgeOffset * s

  ctx.save()
  ctx.font = LABEL_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const shape of shapes) {
    for (const marker of shape.markers) {
      const { point, heading, normal } = marker
      const along = BOARD_FROM_EDGE + BOARD_ACROSS / 2
      const x = (point.x - cam.x) * s + vw / 2 + normal.x * (edgePx + along)
      const y = (point.y - cam.y) * s + vh / 2 + normal.y * (edgePx + along)
      if (x < -BOARD_ALONG || x > vw + BOARD_ALONG || y < -BOARD_ALONG || y > vh + BOARD_ALONG) continue
      options.space?.reserve({ x: x - BOARD_ALONG / 2, y: y - BOARD_ALONG / 2, w: BOARD_ALONG, h: BOARD_ALONG })

      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(Math.atan2(heading.y, heading.x))
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = BOARD_INK
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.rect(-BOARD_ALONG / 2, -BOARD_ACROSS / 2, BOARD_ALONG, BOARD_ACROSS)
      ctx.fill()
      ctx.stroke()
      // The way of the trains it speaks to
      ctx.fillStyle = BOARD_INK
      ctx.beginPath()
      ctx.moveTo(BOARD_ALONG / 2 - 2, 0)
      ctx.lineTo(-BOARD_ALONG / 2 + 3, -BOARD_ACROSS / 2 + 1.5)
      ctx.lineTo(-BOARD_ALONG / 2 + 3, BOARD_ACROSS / 2 - 1.5)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      if (!labels || marker.maxLength === undefined) continue
      const text = formatDistance(marker.maxLength, unit, unit === 'm' ? 0 : undefined)
      const lx = x + normal.x * LABEL_FROM_BOARD
      const ly = y + normal.y * LABEL_FROM_BOARD
      const tw = textWidth(ctx, text)
      const box: ScreenBox = { x: lx - tw / 2 - 3, y: ly - 7, w: tw + 6, h: 14 }
      if (options.space && !options.space.claim(box)) continue
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.beginPath()
      ctx.roundRect(box.x, box.y, box.w, box.h, 3)
      ctx.fill()
      ctx.fillStyle = BOARD_INK
      ctx.fillText(text, lx, ly)
    }
  }
  ctx.restore()
}
