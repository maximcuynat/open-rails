import type { Camera } from './camera'
import type { Network, Point, Station } from '@domain/models/types'
import { crowdedPoints, type LabelSpace, type ScreenBox } from './labelSpace'
import { textWidth } from './textWidth'

// The stations: a mark where each one stands and its name on a light pill, at every zoom — a line
// of three hundred kilometres seen whole is read by its stations. They take their room on the
// screen before the signals and the badges of the sections; a name that would cover something is
// left for a closer look, its mark stays. In a crowd of stations (a region seen whole) only the
// marks are drawn, the names come back as the view closes in.

export interface StationRenderOptions {
  selectedId?: string | null
  hoveredId?: string | null
  /** The room of the screen shared with the other labels of the frame */
  space?: LabelSpace
}

/** Side of the mark, px */
const MARK = 7
/** Pixels from the mark to the pill */
const GAP = 6
const PILL_HEIGHT = 18
const PILL_PADDING = 7
const FONT = '600 11px Archivo, system-ui, sans-serif'
/** A station with more than this many others within reach on screen is in a crowd: mark only */
const CROWD_LIMIT = 2
const CROWD_RX = 90
const CROWD_RY = 24
/** Stations this far off screen (px) are still drawn, for the pill that reaches in */
const MARGIN = 80

const SELECTED = '#06b6d4'
const HOVERED = '#64748b'
const INK = '#0f172a'

interface Placed {
  station: Station
  x: number
  y: number
}

export function renderStations(ctx: CanvasRenderingContext2D, cam: Camera, vw: number, vh: number, net: Network, options: StationRenderOptions = {}): void {
  if (net.stations.size === 0) return
  const placed: Placed[] = []
  for (const station of net.stations.values()) {
    const at = toScreen(station.pos, cam, vw, vh)
    if (at) placed.push({ station, x: at.x, y: at.y })
  }
  if (placed.length === 0) return
  // The picked station and the one under the cursor take their room first
  const rank = (p: Placed): number => (p.station.id === options.selectedId ? 0 : p.station.id === options.hoveredId ? 1 : 2)
  placed.sort((a, b) => rank(a) - rank(b))
  const crowded = crowdedPoints(placed, CROWD_RX, CROWD_RY, CROWD_LIMIT)

  ctx.save()
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  placed.forEach((p, i) => {
    const selected = p.station.id === options.selectedId
    const hovered = p.station.id === options.hoveredId
    const accent = selected ? SELECTED : hovered ? HOVERED : null
    // The mark: always
    const mark: ScreenBox = { x: p.x - MARK / 2, y: p.y - MARK / 2, w: MARK, h: MARK }
    options.space?.reserve(mark)
    ctx.fillStyle = accent ?? '#ffffff'
    ctx.strokeStyle = accent ?? INK
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.rect(mark.x, mark.y, mark.w, mark.h)
    ctx.fill()
    ctx.stroke()
    // The name: unless the station stands in a crowd, or something already stands there
    if (crowded[i] && !accent) return
    const tw = textWidth(ctx, p.station.name)
    const pill: ScreenBox = { x: p.x - tw / 2 - PILL_PADDING, y: p.y - MARK / 2 - GAP - PILL_HEIGHT, w: tw + 2 * PILL_PADDING, h: PILL_HEIGHT }
    if (accent) options.space?.reserve(pill)
    else if (options.space && !options.space.claim(pill)) return
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.beginPath()
    ctx.roundRect(pill.x, pill.y, pill.w, pill.h, 4)
    ctx.fill()
    ctx.strokeStyle = accent ?? INK
    ctx.lineWidth = accent ? 2 : 1
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.fillText(p.station.name, p.x, pill.y + pill.h / 2)
  })
  ctx.restore()
}

function toScreen(p: Point, cam: Camera, vw: number, vh: number): Point | null {
  const x = (p.x - cam.x) * cam.scale + vw / 2
  const y = (p.y - cam.y) * cam.scale + vh / 2
  return x < -MARGIN || x > vw + MARGIN || y < -MARGIN || y > vh + MARGIN ? null : { x, y }
}
