import type { EditorStore } from '@application/state/editorStore'
import { loadDatasetIndex } from '@application/dataset/datasetClient'
import { loadAllLines } from '@application/dataset/journeyLoader'
import { stationGrid } from '@infrastructure/render/stationGrid'
import { serializeNetwork } from '@infrastructure/persistence/persistence'
import { EXAMPLES, loadExample } from '../../examples'
import { nextPaint } from './frameTiming'
import { levelScales, summarise, zoomSweep, type FrameSummary } from './frameStats'

/**
 * The frame bench of the renderer (`tasks/plan-rendu-webgl.md`, lot W0). Under `npm run dev`, in
 * the browser console:
 *
 *   await __frameBench()                        // 9 stations, 81 stations, the whole dataset
 *   await __frameBench({ scenarios: ['gares-9'] })
 *
 * Each project is loaded in place of the current one (save it first), then the view is moved
 * without a pause: pans at three fixed zooms (whole network, `line` level, `detail` level), then a
 * zoom from the whole network down to the detail. For each it gives the time of one paint and the
 * time between two paints (p50 / p95, ms). Run it in an ordinary browser window: a headless one
 * rasterises in software (`tools/perf/measure-frame.cjs` runs it there all the same).
 */

export type BenchScenario = 'gares-9' | 'gares-81' | 'reseau-reel'

export interface BenchOptions {
  scenarios?: BenchScenario[]
  /** Paints measured per view */
  frames?: number
}

export interface BenchRow extends FrameSummary {
  scenario: BenchScenario
  rails: number
  view: 'entier' | 'line' | 'detail' | 'balayage'
}

/** Distance between two copies of Marseille Saint-Charles, m (as in `benchNetworks.ts`) */
const STATION_PITCH = 1400
/** Screen pixels the view moves at each paint */
const PAN_PX = 8
/** Paints left out before measuring: the first ones work out what is kept between frames */
const WARM_UP = 10

export async function runFrameBench(store: EditorStore, options: BenchOptions = {}): Promise<BenchRow[]> {
  const scenarios = options.scenarios ?? ['gares-9', 'gares-81', 'reseau-reel']
  const frames = options.frames ?? 120
  const rows: BenchRow[] = []
  for (const scenario of scenarios) {
    await loadScenario(store, scenario)
    rows.push(...(await measureViews(store, scenario, frames)))
  }
  console.table(rows)
  return rows
}

async function loadScenario(store: EditorStore, scenario: BenchScenario): Promise<void> {
  if (scenario === 'reseau-reel') {
    await loadAllLines(store, await loadDatasetIndex())
    return
  }
  const example = EXAMPLES.find((e) => e.id === 'marseille-saint-charles')!
  const station = await loadExample(example)
  const copies = scenario === 'gares-9' ? 3 : 9
  store.loadFromData(serializeNetwork(stationGrid(station, copies, STATION_PITCH), scenario))
}

async function measureViews(store: EditorStore, scenario: BenchScenario, frames: number): Promise<BenchRow[]> {
  const rails = store.network.segments.size
  const box = networkBox(store)
  store.frameBox(box)
  const whole = store.camera.scale
  const centre = busiestPoint(store, box)
  const { line, detail } = levelScales(store.gauge)
  const rows: BenchRow[] = []
  for (const [view, scale] of [['entier', whole], ['line', line], ['detail', detail]] as const) {
    store.camera.x = view === 'entier' ? (box.minX + box.maxX) / 2 : centre.x
    store.camera.y = view === 'entier' ? (box.minY + box.maxY) / 2 : centre.y
    store.camera.scale = scale
    const step = PAN_PX / scale
    const summary = await measure(store, frames, (i) => {
      // Back and forth, so that the view stays on what it measures
      store.camera.x += Math.floor(i / 30) % 2 === 0 ? step : -step
    })
    rows.push({ scenario, rails, view, ...summary })
  }
  store.camera.x = centre.x
  store.camera.y = centre.y
  const sweep = zoomSweep(whole, detail, frames)
  const summary = await measure(store, frames, (i) => {
    store.camera.scale = sweep[i]
  })
  rows.push({ scenario, rails, view: 'balayage', ...summary })
  return rows
}

/** `frames` paints in a row, `move` changing the view before each; the warm-up is not counted */
async function measure(store: EditorStore, frames: number, move: (i: number) => void): Promise<FrameSummary> {
  for (let i = 0; i < WARM_UP; i++) {
    store.notifyView()
    await nextPaint()
  }
  const draws: number[] = []
  const paints: number[] = []
  for (let i = 0; i < frames; i++) {
    move(i)
    store.notifyView()
    const { ms, endedAt } = await nextPaint()
    draws.push(ms)
    paints.push(endedAt)
  }
  return summarise(draws, paints)
}

function networkBox(store: EditorStore): { minX: number; minY: number; maxX: number; maxY: number } {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const node of store.network.nodes.values()) {
    box.minX = Math.min(box.minX, node.pos.x)
    box.minY = Math.min(box.minY, node.pos.y)
    box.maxX = Math.max(box.maxX, node.pos.x)
    box.maxY = Math.max(box.maxY, node.pos.y)
  }
  return box
}

/** Where to look closely: Marseille Saint-Charles when the network has it, else its first station, else its middle */
function busiestPoint(store: EditorStore, box: { minX: number; minY: number; maxX: number; maxY: number }): { x: number; y: number } {
  const stations = [...store.network.stations.values()]
  const station = stations.find((s) => s.name.includes('Saint-Charles')) ?? stations[0]
  if (station) return { x: station.pos.x, y: station.pos.y }
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
}
