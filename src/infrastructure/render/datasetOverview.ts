import { lineCategory, type DatasetIndex, type LineCategory, type LineId } from '@domain/dataset/datasetIndex'
import type { Station } from '@domain/models/types'
import type { Camera } from './camera'
import { LabelSpace } from './labelSpace'
import { renderStationMarks } from './stationRender'

// The lines of a dataset that are not loaded, drawn from the index alone: the course of each as
// the few strokes the generator worked out (`lineOutline`), in the colour of its kind, and their
// stations. The rest of the country is on the map before a train gets there.

/** One colour per kind of line, readable on the light and on the dark paper */
export const LINE_CATEGORY_COLORS: Record<LineCategory, string> = {
  highSpeed: '#2563eb',
  main: '#ea580c',
  regional: '#16a34a',
  service: '#64748b',
}

/**
 * The colour of each rail of the lines loaded from a dataset, by the kind of its line: what the
 * network is drawn with from the line tier out (`RenderNetworkOptions.railTint`). A rail two
 * files hold (a border) takes the kind of the first.
 */
export function railTintOf(index: DatasetIndex, files: ReadonlyMap<LineId, { segments: readonly { id: string }[] }>): (segId: string) => string | undefined {
  const colorOf = new Map<string, string>()
  for (const line of index.lines) {
    const file = files.get(line.id)
    if (!file) continue
    const color = LINE_CATEGORY_COLORS[lineCategory(line)]
    for (const seg of file.segments) if (!colorOf.has(seg.id)) colorOf.set(seg.id, color)
  }
  return (segId) => colorOf.get(segId)
}

const STROKE_WIDTH = 2
/** Points of a stroke closer than this on screen (px) to the last one drawn are passed over */
const MIN_STEP = 2
const MARGIN = 20

/**
 * Draw the outlines of the lines of `index` that are not in `loaded`, and the stations none of
 * whose lines is. Returns how many strokes were drawn (for the tests and the measures).
 */
export function renderDatasetOverview(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  index: DatasetIndex,
  loaded: ReadonlySet<LineId>,
  options: { space?: LabelSpace } = {},
): number {
  const halfW = vw / 2 / cam.scale + MARGIN / cam.scale
  const halfH = vh / 2 / cam.scale + MARGIN / cam.scale
  const sx = (x: number) => (x - cam.x) * cam.scale + vw / 2
  const sy = (y: number) => (y - cam.y) * cam.scale + vh / 2
  let drawn = 0

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = STROKE_WIDTH
  // One path per colour: a handful of strokes in all
  const byColor = new Map<string, number[][]>()
  for (const line of index.lines) {
    if (loaded.has(line.id) || !line.outline) continue
    const { bbox } = line
    if (bbox.maxX < cam.x - halfW || bbox.minX > cam.x + halfW || bbox.maxY < cam.y - halfH || bbox.minY > cam.y + halfH) continue
    const color = LINE_CATEGORY_COLORS[lineCategory(line)]
    const strokes = byColor.get(color)
    if (strokes) strokes.push(...line.outline)
    else byColor.set(color, [...line.outline])
  }
  for (const [color, strokes] of byColor) {
    ctx.beginPath()
    for (const stroke of strokes) {
      let lastX = sx(stroke[0])
      let lastY = sy(stroke[1])
      ctx.moveTo(lastX, lastY)
      const end = stroke.length - 2
      for (let i = 2; i <= end; i += 2) {
        const x = sx(stroke[i])
        const y = sy(stroke[i + 1])
        if (i < end && Math.abs(x - lastX) < MIN_STEP && Math.abs(y - lastY) < MIN_STEP) continue
        ctx.lineTo(x, y)
        lastX = x
        lastY = y
      }
      drawn++
    }
    ctx.strokeStyle = color
    ctx.stroke()
  }
  ctx.restore()

  const stations: Station[] = []
  for (const station of index.stations) {
    if (station.lines.some((id) => loaded.has(id))) continue
    stations.push({ id: station.id, name: station.name, pos: { x: station.x, y: station.y }, stops: [] })
  }
  // Their names keep clear of one another, as those of the network do
  if (stations.length > 0) renderStationMarks(ctx, cam, vw, vh, stations, { space: options.space ?? new LabelSpace() })
  return drawn
}
