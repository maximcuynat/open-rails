import { test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { convertOsm, surveyOsm } from '@domain/import/osmImport'
import type { OverpassResponse } from '@domain/import/osmTypes'
import { options, readFixture } from '@domain/import/osmImport.testkit'
import { createNetwork, addNode, addSegment, addCurveSegment, resetIdCounter, syncIdCounter } from '@domain/models/network'
import { syncJunctions } from '@domain/models/junction'
import { verifyNetworkRevisions } from '@domain/models/networkWatch'
import type { Network } from '@domain/models/types'
import { createTrainSet, setNotch, setReverser } from '@domain/models/train'
import { setBrakeCommand } from '@domain/models/trainDynamics'
import { trackProfile } from '@domain/models/trackSpeed'
import { DEFAULT_LINE_SETTINGS } from '@domain/models/speedLimits'
import { createCamera } from '@infrastructure/render/camera'
import { renderNetworkWithTrains } from '@infrastructure/render/renderer'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { deserializeNetwork, resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { EditorStore } from '@application/state/editorStore'

/**
 * Lot 0 of `tasks/plan-lignes-lgv-multijoueur.md`: what a high-speed line of several hundred km
 * costs, in conversion, drawing, derived data, saving and driving. Run by hand:
 *
 *   PROFILE=1 npx vitest run tools/perf/measure-lgv.test.ts --silent=false
 *   PROFILE=1 LGV_KM=300 LGV_TARGET_RAILS=15000 npx vitest run tools/perf/measure-lgv.test.ts --silent=false
 *
 * The LGV Sud-Est at Pasilly (`fixtures/lgv-pasilly.json`) is the only high-speed sample: the
 * Overpass answer is tiled side by side until it holds LGV_KM of track, converted once (the cost
 * of `convertOsm` at that size), and the result is copied until the network reaches
 * LGV_TARGET_RAILS (the size of the whole French high-speed network, estimated). The copies are
 * not joined: sections, blocks and trains stay within one copy.
 */

verifyNetworkRevisions(false)

const out = (line: string): void => { process.stderr.write(line + '\n') }
const ms = (v: number): string => `${v.toFixed(1)} ms`
function time<T>(label: string, fn: () => T): T {
  const t0 = performance.now()
  const r = fn()
  out(`${label}: ${ms(performance.now() - t0)}`)
  return r
}
/** Mean of `n` runs after one warm-up */
function mean(label: string, n: number, fn: () => void): number {
  fn()
  const t0 = performance.now()
  for (let i = 0; i < n; i++) fn()
  const per = (performance.now() - t0) / n
  out(`${label}: ${ms(per)} (mean of ${n})`)
  return per
}

/** The Overpass answer repeated `copies` times on a grid, ids and coordinates shifted */
function tileOverpass(data: OverpassResponse, copies: number): OverpassResponse {
  const nodes = data.elements.filter((e) => e.type === 'node' && e.lat !== undefined && e.lon !== undefined)
  const lats = nodes.map((n) => n.lat!)
  const lons = nodes.map((n) => n.lon!)
  const dLat = Math.max(...lats) - Math.min(...lats) + 0.01
  const dLon = Math.max(...lons) - Math.min(...lons) + 0.01
  const cols = Math.ceil(Math.sqrt(copies))
  const elements: OverpassResponse['elements'] = []
  for (let c = 0; c < copies; c++) {
    const row = Math.floor(c / cols)
    const col = c % cols
    const offset = (c + 1) * 1e10
    for (const e of data.elements) {
      const copy = { ...e, id: e.id + offset }
      if (e.lat !== undefined) copy.lat = e.lat + row * dLat
      if (e.lon !== undefined) copy.lon = e.lon + col * dLon
      if (e.nodes) copy.nodes = e.nodes.map((id) => id + offset)
      elements.push(copy)
    }
  }
  return { ...data, elements }
}

function bounds(net: Network): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of net.nodes.values()) {
    minX = Math.min(minX, n.pos.x); maxX = Math.max(maxX, n.pos.x)
    minY = Math.min(minY, n.pos.y); maxY = Math.max(maxY, n.pos.y)
  }
  return { minX, minY, maxX, maxY }
}

/** `net` copied `copies` times on a grid (as `buildStations` does), levels kept */
function tileNetwork(net: Network, copies: number): Network {
  const big = createNetwork()
  const b = bounds(net)
  const pitchX = b.maxX - b.minX + 500
  const pitchY = b.maxY - b.minY + 500
  const cols = Math.ceil(Math.sqrt(copies))
  let paths = 0
  for (let c = 0; c < copies; c++) {
    const dx = (c % cols) * pitchX
    const dy = Math.floor(c / cols) * pitchY
    const ids = new Map<string, string>()
    for (const node of net.nodes.values()) {
      const copy = addNode(big, { x: node.pos.x + dx, y: node.pos.y + dy })
      if (node.level) copy.level = node.level
      ids.set(node.id, copy.id)
    }
    for (const seg of net.segments.values()) {
      const from = ids.get(seg.from)!
      const to = ids.get(seg.to)!
      if (seg.kind === 'curve' && seg.via) addCurveSegment(big, from, to, { x: seg.via.x + dx, y: seg.via.y + dy })
      else if (seg.kind === 'path') paths++
      else addSegment(big, from, to)
    }
  }
  if (paths) out(`  (${paths} long rails not copied)`)
  syncJunctions(big)
  return big
}

function stubCtx(): CanvasRenderingContext2D {
  const noop = (): void => {}
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop === 'canvas') return undefined
      if (prop === 'measureText') return () => ({ width: 40 })
      return prop in target ? target[prop] : noop
    },
    set(target, prop, value) { target[prop] = value; return true },
  }) as unknown as CanvasRenderingContext2D
}

const MiB = 1024 * 1024

test.runIf(process.env.PROFILE)('lgv', { timeout: 1_800_000 }, () => {
  const wantKm = Number(process.env.LGV_KM ?? 300)
  const wantRails = Number(process.env.LGV_TARGET_RAILS ?? 15000)
  const opts = options()

  // ── 1. One sample ─────────────────────────────────────────────────────────
  out('\n== Pasilly, one copy')
  const one = readFixture('lgv-pasilly')
  const survey = surveyOsm(one, opts)
  out(`survey: ${survey.ways} ways, ${survey.lengthKm.toFixed(1)} km of track, ${survey.switches} switches`)
  resetIdCounter()
  const single = time('convertOsm', () => convertOsm(one, opts))
  const sb = bounds(single.network)
  out(`network: ${single.network.nodes.size} nodes, ${single.network.segments.size} rails, ${single.network.junctions.size} junctions, ${single.network.speedZones.size} zones, ${single.network.signals.size} signals, ${((sb.maxX - sb.minX) / 1000).toFixed(1)} × ${((sb.maxY - sb.minY) / 1000).toFixed(1)} km`)
  out(`density: ${(single.network.segments.size / survey.lengthKm).toFixed(1)} rails per km of track, ${(1000 * survey.lengthKm / single.network.segments.size).toFixed(0)} m per rail`)

  // ── 2. Conversion of LGV_KM of track in one go ────────────────────────────
  const copies = Math.max(1, Math.ceil(wantKm / survey.lengthKm))
  out(`\n== ${copies} copies of the answer side by side (~${(copies * survey.lengthKm).toFixed(0)} km of track)`)
  const tiled = tileOverpass(one, copies)
  out(`answer: ${tiled.elements.length} elements, ${(JSON.stringify(tiled).length / MiB).toFixed(1)} MiB of JSON`)
  time('surveyOsm', () => surveyOsm(tiled, opts))
  resetIdCounter()
  const line = time('convertOsm', () => convertOsm(tiled, opts))
  out(`network: ${line.network.nodes.size} nodes, ${line.network.segments.size} rails, ${line.network.junctions.size} junctions, ${line.network.signals.size} signals; ${line.report.issues.length} issues`)

  // ── 3. The whole high-speed network, by copying the line ──────────────────
  const netCopies = Math.max(1, Math.ceil(wantRails / line.network.segments.size))
  out(`\n== ${netCopies} copies of that line (target ${wantRails} rails)`)
  const net = time('tileNetwork + syncJunctions', () => tileNetwork(line.network, netCopies))
  syncIdCounter(net)
  const nb = bounds(net)
  out(`network: ${net.nodes.size} nodes, ${net.segments.size} rails, ${net.junctions.size} junctions, ${((nb.maxX - nb.minX) / 1000).toFixed(0)} × ${((nb.maxY - nb.minY) / 1000).toFixed(0)} km`)

  // ── 4. Derived data, cold ─────────────────────────────────────────────────
  out('\n== Derived data (cold)')
  const meta: Record<string, any> = {}
  time('sections', () => networkDerived(net, meta).sections)
  time('kinematicIssues', () => networkDerived(net, meta).kinematicIssues(1.435, { levelHeight: 6, maxGradient: 0.035 }))
  time('components + loops + deadEnds', () => { const d = networkDerived(net, meta); d.components(); d.loops(); d.deadEnds() })
  time('trackProfile', () => trackProfile(net))

  // ── 5. Drawing ────────────────────────────────────────────────────────────
  out('\n== One frame, 1920×1080, canvas stubbed (JS side only)')
  const ctx = stubCtx()
  const selection = { nodes: new Set<string>(), segments: new Set<string>() }
  const renderOptions = { gauge: 1.435, gradient: { levelHeight: 6, maxGradient: 0.035 }, inclination: { line: DEFAULT_LINE_SETTINGS } }
  const onTrack = [...net.nodes.values()][Math.floor(net.nodes.size / 2)].pos
  const fit = Math.min(1920 / (nb.maxX - nb.minX), 1080 / (nb.maxY - nb.minY))
  for (const scale of [fit, 0.1, 0.4, 1, 2.5, 8]) {
    const cam = createCamera(onTrack.x, onTrack.y, scale)
    mean(`frame at ${scale.toFixed(scale < 0.01 ? 4 : 2)} px/m`, 10, () => {
      renderNetworkWithTrains(ctx, cam, 1920, 1080, net, selection, undefined, renderOptions, () => {})
    })
  }

  // ── 6. The store: notify, save, undo snapshot, load ───────────────────────
  out('\n== Store')
  resetMemoryStorage()
  const store = new EditorStore()
  store.network = net
  time('markDirty (first notify + autosave in memory)', () => store.markDirty())
  mean('notify, nothing changed', 20, () => store.notify())
  const project = time('exportProject (serialize)', () => store.exportProject())
  const json = time('JSON.stringify', () => JSON.stringify(project))
  out(`project JSON: ${(json.length / MiB).toFixed(2)} MiB (localStorage usually holds 5 MiB per site)`)
  if (process.env.LGV_OUT) { writeFileSync(process.env.LGV_OUT, json); out(`written to ${process.env.LGV_OUT}`) }
  time('pushHistorySnapshot (one undo step)', () => store.pushHistorySnapshot())
  time('flushPersistedState (autosave, memory storage)', () => store.flushPersistedState())
  out(`autosaveFailed: ${store.autosaveFailed}`)
  const parsed = time('JSON.parse', () => JSON.parse(json))
  time('deserializeNetwork (load)', () => deserializeNetwork(parsed))

  // ── 7. Driving: one train at full power, 600 ticks of 1/60 s ─────────────
  out('\n== Driving')
  const train = createTrainSet(net, onTrack, 'loco')
  if (!train) throw new Error('no track for the train')
  store.trains = [train]
  store.selectTrainById(train.id)
  store.togglePlayMode()
  setReverser(train, 'forward')
  setNotch(train, 8)
  setBrakeCommand(train, 'release')
  time('first tick', () => store.tickAllTrains(1 / 60))
  const perTick = mean('tickAllTrains', 600, () => store.tickAllTrains(1 / 60))
  out(`train speed after ~10 s: ${(train.currentSpeed * 3.6).toFixed(0)} km/h; a 60 Hz frame leaves ${(16.7 - perTick).toFixed(1)} ms for the drawing`)
  const cam = createCamera(onTrack.x, onTrack.y, 2.5)
  mean('frame at 2.5 px/m while driving', 10, () => {
    renderNetworkWithTrains(ctx, cam, 1920, 1080, net, selection, undefined, renderOptions, () => {})
  })
})
