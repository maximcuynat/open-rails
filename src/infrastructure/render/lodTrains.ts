/**
 * Level of detail of the trains: what is skipped because it is out of view, and the marker that
 * stands for a whole train in the schematic drawing. The tier itself comes from `lod.ts`; the
 * close-up drawing stays in `renderer.ts`.
 */
import type { Network, Point } from '@domain/models/types'
import { positionOnSegment, type TrackPosition } from '@domain/models/locomotive'
import type { ViewportBounds } from './renderer'

/** Width of the stroke that stands for a train in the schematic drawing, in screen pixels */
export const TRAIN_MARKER_WIDTH_PX = 5
/** Radius of the dot that stands for a train too short on screen to be a stroke */
export const TRAIN_MARKER_DOT_RADIUS_PX = 4
/** Below this length on screen the stroke would be shorter than it is wide: the train is a dot */
export const TRAIN_MARKER_MIN_LENGTH_PX = 8
/** Halo around the marker, so that it stands out from the track it lies on */
const TRAIN_MARKER_HALO_PX = 1.5

/**
 * Whether the bounding box of `points` touches the bounds. A box and not a point test: a shape
 * that straddles the edge of the view, or that is larger than the view, is still in.
 */
export function pointsInBounds(points: readonly Point[], b: ViewportBounds): boolean {
  if (points.length === 0) return false
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return maxX >= b.minX && minX <= b.maxX && maxY >= b.minY && minY <= b.maxY
}

/**
 * Cheap test done before any geometry of the train is computed: whether one of its vehicles may
 * be in view, from the two pivots of each. The body reaches a few metres beyond its pivots, far
 * less than the margin `getViewportBounds` adds around the screen (60 m at least), so a vehicle
 * rejected here has nothing on screen. A vehicle that cannot be located counts as in view.
 */
export function vehiclesInBounds(
  net: Network,
  vehicles: readonly { front: TrackPosition; rear: TrackPosition }[],
  b: ViewportBounds,
): boolean {
  for (const veh of vehicles) {
    const front = positionOnSegment(net, veh.front.segId, veh.front.t)
    const rear = positionOnSegment(net, veh.rear.segId, veh.rear.t)
    if (!front || !rear) return true
    if (pointsInBounds([front, rear], b)) return true
  }
  return false
}

/** A point of the line a train is drawn along in the schematic drawing, with its track level */
export interface TrainMarkerStop {
  pos: Point
  level: number
}

export interface TrainMarkerStyle {
  /** Colour of the marker itself */
  color: string
  /** Colour of the halo around it (the background of the drawing) */
  halo: string
}

/**
 * A train in the schematic drawing: a marker of constant size on screen. A thick rounded stroke
 * along `stops` (lead first) when that is long enough to read as a stroke, a dot at the lead
 * otherwise. `atLevel` is the caller's way of drawing something that stands on a track level
 * (skipped outside the level band of the pass, dimmed in a tunnel): a stretch between two stops
 * follows the higher one, like a gangway.
 */
export function drawTrainMarker(
  ctx: CanvasRenderingContext2D,
  toSx: (p: Point) => number,
  toSy: (p: Point) => number,
  stops: readonly TrainMarkerStop[],
  style: TrainMarkerStyle,
  atLevel: (level: number, draw: () => void) => void,
): void {
  if (stops.length === 0) return
  const xs = stops.map(s => toSx(s.pos))
  const ys = stops.map(s => toSy(s.pos))

  let length = 0
  for (let i = 1; i < stops.length; i++) length += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])

  if (length < TRAIN_MARKER_MIN_LENGTH_PX) {
    atLevel(stops[0].level, () => {
      ctx.beginPath()
      ctx.arc(xs[0], ys[0], TRAIN_MARKER_DOT_RADIUS_PX, 0, Math.PI * 2)
      ctx.fillStyle = style.color
      ctx.fill()
      ctx.strokeStyle = style.halo
      ctx.lineWidth = TRAIN_MARKER_HALO_PX
      ctx.stroke()
    })
    return
  }

  const stretchLevel = (i: number): number => Math.max(stops[i].level, stops[i + 1].level)
  // One path per run of stretches on the same level: a train on a single level is one stroke
  let from = 0
  while (from < stops.length - 1) {
    const level = stretchLevel(from)
    let to = from + 1
    while (to < stops.length - 1 && stretchLevel(to) === level) to++
    const first = from
    atLevel(level, () => {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(xs[first], ys[first])
      for (let i = first + 1; i <= to; i++) ctx.lineTo(xs[i], ys[i])
      ctx.strokeStyle = style.halo
      ctx.lineWidth = TRAIN_MARKER_WIDTH_PX + 2 * TRAIN_MARKER_HALO_PX
      ctx.stroke()
      ctx.strokeStyle = style.color
      ctx.lineWidth = TRAIN_MARKER_WIDTH_PX
      ctx.stroke()
    })
    from = to
  }
}
