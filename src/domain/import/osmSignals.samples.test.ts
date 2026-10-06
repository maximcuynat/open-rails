import { describe, it, expect, vi } from 'vitest'
import { convertOsm, surveyOsm } from './osmImport'
import type { OsmImportIssue, OsmImportResult, OsmSignalMode } from './osmTypes'
import { contentsOf, openInEditor, options, readFixture } from './osmImport.testkit'
import { createProjection } from './osmProjection'
import { importLine, isUsableSignal } from './osmSignals'
import { walkForward } from '../models/locomotive'
import { resetIdCounter } from '../models/network'
import { signalRoute, signalTopology } from '../models/signalBlocks'
import { signalReport } from '../models/signalReport'
import { createSignallingState, type SignalPassing } from '../models/signalling'
import { drive, run } from '../models/signalling.testkit'
import { checkSignalPlacement, type SignallingLevel } from '../models/signals'
import { createVehicle, makeTrainSet } from '../models/train'
import type { Network } from '../models/types'
import { signalWorldPosition } from '../services/signalLayout'

// The signals of the four areas of `fixtures/`: the real ones where OpenStreetMap holds some
// (Paris), the automatic signalling everywhere, and what the signalling engine makes of them.

vi.setConfig({ testTimeout: 180_000 })

const converted = new Map<string, OsmImportResult>()

/** An area converted once for all the tests that look at it under the same signal mode */
function sample(name: string, signals: OsmSignalMode): OsmImportResult {
  const key = `${name} ${signals}`
  let found = converted.get(key)
  if (!found) {
    resetIdCounter()
    found = convertOsm(readFixture(name), options({ signals }))
    converted.set(key, found)
  }
  return found
}

/** What the signalling report of the editor says of a converted network, by kind of entry */
function control(result: OsmImportResult, level: SignallingLevel): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of signalReport(result.network, { level, line: importLine(result.lineSpeed, result.highSpeed) })) counts[entry.type] = (counts[entry.type] ?? 0) + 1
  return counts
}

const notPlaced = (result: OsmImportResult): OsmImportIssue[] => result.report.issues.filter((issue) => issue.kind === 'signal-not-placed')

/** Every signal stands where the engine would let one be laid */
function expectAllWellPlaced(net: Network): void {
  for (const signal of net.signals.values()) {
    expect(checkSignalPlacement(net, signal, signal.forward, { ignoreId: signal.id }), signal.id).toBeNull()
  }
}

/**
 * A train put 300 m inside the area on the track that enters it at `edge`, run `metres` further in
 * with the signalling: the signals it passed.
 */
function runIn(result: OsmImportResult, edge: OsmImportIssue, metres: number, level: SignallingLevel): { passings: SignalPassing[]; braked: boolean } | null {
  const net = result.network
  const node = [...net.nodes.values()].find((n) => Math.hypot(n.pos.x - edge.x, n.pos.y - edge.y) < 1e-6)!
  const seg = net.segments.get(net.adjacency.get(node.id)![0])!
  const start = seg.from === node.id ? { t: 0, forward: true } : { t: 1, forward: false }
  const place = walkForward(net, seg.id, start.t, start.forward, 300)
  const vehicle = place && createVehicle(net, place.segId, place.t, 'loco', place.forward ? 1 : -1)
  if (!vehicle) return null
  const train = drive(makeTrainSet(`train_${edge.osmIds.join('_')}_${level}`, [vehicle]), 20)
  const passings = run(net, [train], createSignallingState(), train, metres, { level, stopEnforced: true }, 10, { line: importLine(result.lineSpeed, result.highSpeed) })
  return { passings, braked: train.emergencyBrake === true }
}

describe('signals of the sample areas', () => {
  it('Paris, real signals: 125 of the 126 the import reads are laid, where their nodes stand', () => {
    const data = readFixture('paris-gare-de-lyon')
    // The fixture kept the tags the reading needs
    const nodes = data.elements.filter((el) => el.type === 'node' && el.tags?.railway === 'signal')
    expect(nodes).toHaveLength(252)
    expect(nodes.filter((el) => el.tags!['railway:signal:main:plate'] !== undefined).length).toBeGreaterThan(140)
    expect(nodes.filter((el) => isUsableSignal(el.tags)).length).toBe(126)
    expect(surveyOsm(data, options())).toMatchObject({ signals: 251, typedMainSignals: 160, usableSignals: 125 })

    const result = sample('paris-gare-de-lyon', 'real')
    const signals = result.report.signals!
    // 104 carrés (`FR:CARRE` 73, `FR:C` 31) and 3 sémaphores that show the carré or carry the Nf
    // plate, less one on a track that joins nothing; 19 plain sémaphores
    expect(signals).toMatchObject({
      mode: 'real',
      found: 252,
      real: { protection: 106, spacing: 19, cabMarkers: 0 },
      skipped: { 'track-not-imported': 1 },
      ignored: { shunting: 42, speed: 61, untyped: 12, other: 10, unknown: 1 },
      generated: { protection: 0, spacing: 0, cabMarkers: 0 },
    })
    expect(signals.realMoved).toBeLessThanOrEqual(12)
    expect(result.network.signals.size).toBe(125)
    expect(notPlaced(result)).toEqual([])
    expectAllWellPlaced(result.network)

    // Each one within 3 m of a signal node of the data: 35 cm of fitting, 2 m when moved clear of points
    const project = createProjection(result.origin.lat, result.origin.lon)
    const places = nodes.filter((el) => isUsableSignal(el.tags)).map((el) => project(el.lat!, el.lon!))
    const gaps = [...result.network.signals.values()].map((signal) => {
      const pos = signalWorldPosition(result.network, signal)!
      return Math.min(...places.map((p) => Math.hypot(p.x - pos.x, p.y - pos.y)))
    })
    expect(Math.max(...gaps)).toBeLessThan(3)
    expect(gaps.filter((gap) => gap < 0.5).length).toBeGreaterThan(110)
  })

  it('Paris, real signals: the blocks are worked out, and the control report says what is missing', () => {
    const result = sample('paris-gare-de-lyon', 'real')
    const topology = signalTopology(result.network)
    expect(topology.blocks.size).toBe(125)
    expect([...topology.blocks.values()].filter((block) => block.truncated)).toEqual([])
    // Real signals are too few to cut the area into blocks: the report says so, and nothing else
    const pro = control(result, 'pro')
    expect(Object.keys(pro).sort()).toEqual(['block-too-long', 'block-too-short'])
    expect(pro['block-too-long']).toBeGreaterThan(20)
    expect(control(result, 'standard')['block-too-long']).toBeUndefined()
  })

  it('Paris, mixed: the real ones, and the automatic signalling on the plain track that carries none', () => {
    const real = sample('paris-gare-de-lyon', 'real')
    const mixed = sample('paris-gare-de-lyon', 'mixed')
    const generated = sample('paris-gare-de-lyon', 'generated')
    const signals = mixed.report.signals!
    expect(signals.real).toEqual(real.report.signals!.real)
    expect(signals.stretchesLeftToReal).toBeGreaterThan(60)
    expect(signals.stretchesLeftToReal).toBeLessThanOrEqual(125)
    const count = signals.generated.protection + signals.generated.spacing
    const all = generated.report.signals!.generated.protection + generated.report.signals!.generated.spacing
    expect(count).toBeGreaterThan(400)
    expect(count).toBeLessThan(all)
    expect(mixed.network.signals.size).toBe(125 + count)
    expectAllWellPlaced(mixed.network)
    expect(Object.keys(control(mixed, 'pro')).filter((type) => !type.startsWith('block-too-'))).toEqual(expect.not.arrayContaining(['signal-on-switch']))
  })

  for (const mode of ['real', 'mixed', 'generated'] as const) {
    it(`Paris, ${mode}: the signals change neither the rails nor what the editor does at the opening`, () => {
      const result = sample('paris-gare-de-lyon', mode)
      resetIdCounter()
      const bare = convertOsm(readFixture('paris-gare-de-lyon'), options({ signals: 'none' }))
      expect(contentsOf(result.network)).toEqual(contentsOf(bare.network))
      const count = result.network.signals.size
      expect(count).toBeGreaterThan(0)
      // Looked at last: it runs the check of the editor on the network itself
      expect(openInEditor(result.network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
      expect(result.network.signals.size).toBe(count)
    })
  }

  for (const name of ['dijon-ville', 'lgv-pasilly', 'clelles-mens'] as const) {
    it(`${name}, automatic signalling: every set of points guarded, block signals in pairs, nothing for the editor to redo`, () => {
      const result = sample(name, 'generated')
      const signals = result.report.signals!
      expect(signals.real).toEqual({ protection: 0, spacing: 0, cabMarkers: 0 })
      expect(signals.generated.protection + signals.generated.spacing).toBe(result.network.signals.size)
      expect(result.network.signals.size).toBeGreaterThan(10)
      expect(notPlaced(result)).toEqual([])
      expectAllWellPlaced(result.network)

      const topology = signalTopology(result.network)
      expect(topology.blocks.size).toBe(result.network.signals.size)
      expect([...topology.blocks.values()].filter((block) => block.truncated)).toEqual([])
      // No points in the block of a block signal, no block signal alone, no signal on points, no
      // block too long; what is left is blocks shorter than the distance needed to stop
      for (const level of ['standard', 'pro'] as const) {
        expect(Object.keys(control(result, level)).filter((type) => type !== 'block-too-short'), level).toEqual([])
      }
      const count = result.network.signals.size
      expect(openInEditor(result.network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
      expect(result.network.signals.size).toBe(count)
    })
  }

  it('LGV at Pasilly: the generated signals of the high-speed tracks are marker boards', () => {
    const { generated } = sample('lgv-pasilly', 'generated').report.signals!
    expect(generated.cabMarkers).toBeGreaterThan(20)
    expect(generated.cabMarkers).toBeLessThanOrEqual(generated.protection + generated.spacing)
    expect(generated.spacing).toBeGreaterThan(10)
  })

  it('Dijon and the areas without real signal: `real` lays nothing and says why', () => {
    const dijon = sample('dijon-ville', 'real')
    expect(dijon.network.signals.size).toBe(0)
    expect(dijon.report.signals).toMatchObject({ found: 9, real: { protection: 0, spacing: 0 }, ignored: { untyped: 9 }, skipped: {} })
    const clelles = sample('clelles-mens', 'real')
    expect(clelles.report.signals).toMatchObject({ found: 6, ignored: { speed: 3, distant: 2, untyped: 1 }, skipped: {} })
    expect(sample('lgv-pasilly', 'real').report.signals).toMatchObject({ found: 0, ignored: {}, skipped: {} })
  })

  for (const level of ['standard', 'pro'] as const) {
    it(`a train entering each area runs past its first signals (${level}): none closed but before points set against it`, () => {
      for (const name of ['clelles-mens', 'lgv-pasilly', 'dijon-ville'] as const) {
        const result = sample(name, 'generated')
        const edges = result.report.issues.filter((issue) => issue.kind === 'cut-by-area')
        let ran = 0
        let passed = 0
        for (const edge of edges) {
          const outcome = runIn(result, edge, 4000, level)
          if (!outcome) continue
          ran++
          for (const passing of outcome.passings) {
            if (!passing.fault) {
              passed++
              continue
            }
            // Stopped by the signalling: only where the route of that signal runs into points set
            // for another track, which the driver has to throw
            const route = signalRoute(result.network, passing.signalId)
            expect(route?.blockedAt, `${name} ${passing.signalId}`).not.toBeNull()
          }
        }
        expect(ran, name).toBeGreaterThanOrEqual(2)
        expect(passed, name).toBeGreaterThan(0)
      }
    })
  }
})
