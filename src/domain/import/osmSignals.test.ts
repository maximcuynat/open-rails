import { describe, it, expect, beforeEach } from 'vitest'
import { convertOsm, surveyOsm } from './osmImport'
import { DEFAULT_OSM_IMPORT_OPTIONS, type OsmImportResult, type OsmSignalMode, type OverpassElement } from './osmTypes'
import { along, answer, contentsOf, openInEditor, options, osmNode, osmWay, placeIn } from './osmImport.testkit'
import { isUsableSignal, readOsmSignal, readSignalDirection } from './osmSignals'
import { CAB_SIGNAL_KEY, MAIN_SIGNAL_KEY, MAIN_SIGNAL_VALUES, OLD_CAB_MARKER_VALUES } from './osmSignalTable'
import { resetIdCounter } from '../models/network'
import { SIGNAL_SWITCH_CLEARANCE, checkSignalPlacement } from '../models/signals'
import type { Signal } from '../models/types'
import { signalHeading, signalWorldPosition } from '../services/signalLayout'

type Tags = Record<string, string>

const main = (value: string, more: Tags = {}): Tags => ({ railway: 'signal', 'railway:signal:direction': 'forward', [MAIN_SIGNAL_KEY]: value, ...more })
const cab = (value: string, more: Tags = {}): Tags => ({ railway: 'signal', 'railway:signal:direction': 'forward', [CAB_SIGNAL_KEY]: value, ...more })

describe('what a signal node is', () => {
  it('reads a carré as a path signal, under its old and its new value', () => {
    for (const value of ['FR:C', 'FR:CARRE']) {
      expect(readOsmSignal(main(value)), value).toEqual({ use: true, role: 'protection', cabMarker: false, assumed: false })
    }
    // The plate of a carré (BM, PR) does not make it a block signal
    expect(readOsmSignal(main('FR:C', { 'railway:signal:main:plate': 'FR:BM' }))).toMatchObject({ use: true, role: 'protection' })
  })

  it('reads a guidon d’arrêt as a path signal', () => {
    expect(readOsmSignal(main('FR:GA'))).toMatchObject({ use: true, role: 'protection', cabMarker: false })
  })

  it('reads a sémaphore as a block signal, with the F, PR or BM plate or without any', () => {
    expect(readOsmSignal(main('FR:S'))).toEqual({ use: true, role: 'spacing', cabMarker: false, assumed: false })
    for (const plate of ['FR:F', 'FR:PR', 'FR:BM']) {
      expect(readOsmSignal(main('FR:S', { 'railway:signal:main:plate': plate })), plate).toMatchObject({ use: true, role: 'spacing' })
      expect(readOsmSignal(main('FR:S', { 'railway:signal:main:type': plate })), plate).toMatchObject({ use: true, role: 'spacing' })
    }
  })

  it('reads as a path signal a sémaphore that can show the carré or carries the Nf plate', () => {
    expect(readOsmSignal(main('FR:S', { 'railway:signal:main:states': 'FR:A;FR:C;FR:S;FR:VL' }))).toMatchObject({ use: true, role: 'protection' })
    expect(readOsmSignal(main('FR:S', { 'railway:signal:main:states': 'FR:A; FR:CARRE' }))).toMatchObject({ use: true, role: 'protection' })
    expect(readOsmSignal(main('FR:S', { 'railway:signal:main:plate': 'FR:NF' }))).toMatchObject({ use: true, role: 'protection' })
    expect(readOsmSignal(main('FR:S', { 'railway:signal:main:type': 'FR:NF' }))).toMatchObject({ use: true, role: 'protection' })
    // The carré violet among the states is not the carré
    expect(readOsmSignal(main('FR:S', { 'railway:signal:main:states': 'FR:A;FR:CV;FR:S' }))).toMatchObject({ use: true, role: 'spacing' })
  })

  it('leaves the carré violet aside, whatever its plate', () => {
    for (const value of ['FR:Cv', 'FR:CV']) {
      expect(readOsmSignal(main(value, { 'railway:signal:main:plate': 'FR:NF', 'railway:signal:main:states': 'FR:CV;FR:M' })), value).toEqual({ use: false, why: 'shunting' })
    }
  })

  it('accepts a main value it does not know: by its plate or its states when they tell, left aside otherwise', () => {
    expect(readOsmSignal(main('FR:GABARIT'))).toEqual({ use: false, why: 'unknown' })
    expect(readOsmSignal(main('DE-ESO:hp'))).toEqual({ use: false, why: 'unknown' })
    expect(readOsmSignal(main('constructor'))).toEqual({ use: false, why: 'unknown' })
    expect(readOsmSignal(main('FR:NOUVEAU', { 'railway:signal:main:type': 'FR:F' }))).toMatchObject({ use: true, role: 'spacing' })
    expect(readOsmSignal(main('FR:NOUVEAU', { 'railway:signal:main:type': 'FR:NF' }))).toMatchObject({ use: true, role: 'protection' })
    expect(readOsmSignal(main('FR:NOUVEAU', { 'railway:signal:main:states': 'FR:C;FR:VL' }))).toMatchObject({ use: true, role: 'protection' })
    expect(readOsmSignal(main('FR:NOUVEAU', { 'railway:signal:main:type': 'FR:ZZ' }))).toEqual({ use: false, why: 'unknown' })
  })

  it('reads the marker boards of a high-speed line: Nf guards, F spaces', () => {
    const marker = (type?: string): Tags =>
      cab('FR:marker', { 'railway:signal:train_protection:main': 'stop_marker', 'railway:signal:train_protection:main:form': 'sign', ...(type ? { 'railway:signal:train_protection:main:type': type } : {}) })
    expect(readOsmSignal(marker('FR:NF'))).toEqual({ use: true, role: 'protection', cabMarker: true, assumed: false })
    expect(readOsmSignal(marker('FR:F'))).toEqual({ use: true, role: 'spacing', cabMarker: true, assumed: false })
    expect(readOsmSignal(marker())).toEqual({ use: true, role: 'spacing', cabMarker: true, assumed: true })
    // `FR:marker` that is not a stop marker: the board of a change of system
    expect(readOsmSignal(cab('FR:marker', { 'railway:signal:train_protection:system_change': 'FR:type_transition' }))).toEqual({ use: false, why: 'other' })
  })

  it('reads the old values of the marker boards, which do not say Nf or F', () => {
    for (const value of OLD_CAB_MARKER_VALUES) {
      expect(readOsmSignal(cab(value)), value).toEqual({ use: true, role: 'spacing', cabMarker: true, assumed: true })
    }
    expect(readOsmSignal(cab('FR:repère_arrêt_ETCS;FR:repère_arrêt_TVM'))).toMatchObject({ use: true, cabMarker: true })
    // The boards of the start and the end of the cab signalling are no marker
    expect(readOsmSignal(cab('FR:CAB'))).toEqual({ use: false, why: 'other' })
    expect(readOsmSignal(cab('FR:pancarte_CAB_entrée'))).toEqual({ use: false, why: 'other' })
  })

  it('leaves aside, each under its count, the signals that stop no train', () => {
    const node = (tags: Tags): Tags => ({ railway: 'signal', 'railway:signal:direction': 'forward', ...tags })
    expect(readOsmSignal(node({ 'railway:signal:distant': 'FR:A' }))).toEqual({ use: false, why: 'distant' })
    expect(readOsmSignal(node({ 'railway:signal:speed_limit': 'FR:Z' }))).toEqual({ use: false, why: 'speed' })
    expect(readOsmSignal(node({ 'railway:signal:speed_limit_distant': 'FR:TIV-D', 'railway:signal:speed_limit_distant:speed': '30' }))).toEqual({ use: false, why: 'speed' })
    expect(readOsmSignal(node({ 'railway:signal:shunting': 'FR:G' }))).toEqual({ use: false, why: 'shunting' })
    expect(readOsmSignal(node({ 'railway:signal:departure': 'FR:SLD' }))).toEqual({ use: false, why: 'other' })
    expect(readOsmSignal(node({ 'railway:signal:quelque_chose': 'FR:X' }))).toEqual({ use: false, why: 'other' })
    expect(readOsmSignal(node({}))).toEqual({ use: false, why: 'untyped' })
    expect(readOsmSignal(undefined)).toEqual({ use: false, why: 'untyped' })
    expect(readOsmSignal(main('FR:C', { 'railway:signal:main:deactivated': 'yes' }))).toEqual({ use: false, why: 'deactivated' })
    // A main signal on the same mast as a speed board is still a main signal
    expect(readOsmSignal(main('FR:CARRE', { 'railway:signal:speed_limit_distant': 'FR:TIV-D' }))).toMatchObject({ use: true, role: 'protection' })
  })

  it('reads the direction, and nothing from `both` or from its absence', () => {
    expect(readSignalDirection({ 'railway:signal:direction': 'forward' })).toBe('forward')
    expect(readSignalDirection({ 'railway:signal:direction': 'backward' })).toBe('backward')
    expect(readSignalDirection({ 'railway:signal:direction': 'both' })).toBeNull()
    expect(readSignalDirection({})).toBeNull()
    expect(isUsableSignal(main('FR:S'))).toBe(true)
    expect(isUsableSignal({ ...main('FR:S'), 'railway:signal:direction': 'both' })).toBe(false)
    expect(isUsableSignal(main('FR:CV'))).toBe(false)
  })

  it('keeps every value of the table under one meaning', () => {
    expect(Object.keys(MAIN_SIGNAL_VALUES).sort()).toEqual(['FR:C', 'FR:CARRE', 'FR:CV', 'FR:Cv', 'FR:GA', 'FR:S'])
  })
})

// ─────────────────── On the track ───────────────────

/** A track along the x axis from 0 to `length`, a node every 50 m from id 1; `tagged` gives tags to the node at x */
function track(length: number, tagged: Record<number, Tags>, drawn: 'east' | 'west' = 'east', wayTags: Tags = {}): OverpassElement[] {
  const places = along([0, 0], [length, 0], 50)
  const nodes = places.map(([x, y], i) => osmNode(1 + i, x, y, tagged[x]))
  const ids = places.map((_, i) => 1 + i)
  return [...nodes, osmWay(100, drawn === 'east' ? ids : [...ids].reverse(), wayTags)]
}

function convert(elements: OverpassElement[], signals: OsmSignalMode = 'real', over: Parameters<typeof options>[0] = {}): OsmImportResult {
  return convertOsm(answer(elements), options({ signals, ...over }))
}

/** Which way the trains a signal speaks to run, in the terms of the kit, and where it stands along the x axis */
function reading(result: OsmImportResult, signal: Signal): { towards: 'east' | 'west'; x: number; offTrack: number } {
  const heading = signalHeading(result.network, signal)!
  const origin = placeIn(result, 0, 0)
  const east = placeIn(result, 100, 0)
  // A hundred metres of the kit are not quite a hundred metres of the projection
  const scale = Math.hypot(east.x - origin.x, east.y - origin.y)
  const ux = (east.x - origin.x) / scale
  const uy = (east.y - origin.y) / scale
  const pos = signalWorldPosition(result.network, signal)!
  const dx = pos.x - origin.x
  const dy = pos.y - origin.y
  return { towards: heading.x * ux + heading.y * uy > 0 ? 'east' : 'west', x: ((dx * ux + dy * uy) * 100) / scale, offTrack: Math.abs(dx * -uy + dy * ux) }
}

const signalsOf = (result: OsmImportResult): Signal[] => [...result.network.signals.values()]

describe('real signals on the track', () => {
  beforeEach(() => resetIdCounter())

  it('lays a signal where its node stands, for the trains that run the way the track is drawn', () => {
    const result = convert(track(600, { 200: main('FR:CARRE') }))
    const [signal] = signalsOf(result)
    expect(signalsOf(result)).toHaveLength(1)
    expect(signal.role).toBe('protection')
    expect(signal.cabMarker).toBeUndefined()
    const where = reading(result, signal)
    expect(where.towards).toBe('east')
    expect(where.x).toBeCloseTo(200, 0)
    expect(where.offTrack).toBeLessThan(0.05)
    expect(result.report.signals).toMatchObject({ mode: 'real', found: 1, real: { protection: 1, spacing: 0, cabMarkers: 0 }, realMoved: 0, skipped: {}, ignored: {} })
  })

  it('turns the signal round with `backward`, and with the direction the way is drawn in', () => {
    const towards = (direction: string, drawn: 'east' | 'west'): string => {
      resetIdCounter()
      const result = convert(track(600, { 200: { ...main('FR:S'), 'railway:signal:direction': direction } }, drawn))
      expect(signalsOf(result)).toHaveLength(1)
      expect(signalsOf(result)[0].role).toBe('spacing')
      return reading(result, signalsOf(result)[0]).towards
    }
    expect(towards('forward', 'east')).toBe('east')
    expect(towards('backward', 'east')).toBe('west')
    expect(towards('forward', 'west')).toBe('west')
    expect(towards('backward', 'west')).toBe('east')
  })

  it('reads the direction from the way the signal is on when the chain runs through ways drawn both ways', () => {
    // Three ways in a row: the middle one, the shortest, is drawn against the two others
    const places = along([0, 0], [900, 0], 50)
    const nodes = places.map(([x, y], i) => osmNode(1 + i, x, y, x === 450 || x === 100 ? main('FR:S') : undefined))
    const ids = places.map((_, i) => 1 + i)
    const result = convert([...nodes, osmWay(100, ids.slice(0, 8)), osmWay(101, ids.slice(7, 12).reverse()), osmWay(102, ids.slice(11))])
    const byX = signalsOf(result).map((signal) => reading(result, signal)).sort((a, b) => a.x - b.x)
    expect(byX.map((where) => Math.round(where.x))).toEqual([100, 450])
    expect(byX.map((where) => where.towards)).toEqual(['east', 'west'])
  })

  it('does not lay a signal without direction, nor one for both: counted and listed', () => {
    const result = convert(track(600, { 200: { railway: 'signal', [MAIN_SIGNAL_KEY]: 'FR:C' }, 400: { ...main('FR:S'), 'railway:signal:direction': 'both' } }))
    expect(signalsOf(result)).toHaveLength(0)
    expect(result.report.signals).toMatchObject({ found: 2, real: { protection: 0, spacing: 0 }, skipped: { 'no-direction': 2 } })
    const issues = result.report.issues.filter((issue) => issue.kind === 'signal-not-placed')
    expect(issues.map((issue) => issue.osmIds)).toEqual([[5], [9]])
    const place = placeIn(result, 200, 0)
    expect(Math.hypot(issues[0].x - place.x, issues[0].y - place.y)).toBeLessThan(0.01)
    expect(issues[0].detail).toContain('sens')
  })

  it('does not lay a signal on the node where two ways drawn in opposite directions meet', () => {
    const places = along([0, 0], [600, 0], 50)
    const nodes = places.map(([x, y], i) => osmNode(1 + i, x, y, x === 300 ? main('FR:C') : undefined))
    const ids = places.map((_, i) => 1 + i)
    const opposed = convert([...nodes, osmWay(100, ids.slice(0, 7)), osmWay(101, ids.slice(6).reverse())])
    expect(signalsOf(opposed)).toHaveLength(0)
    expect(opposed.report.signals!.skipped).toEqual({ 'ambiguous-direction': 1 })

    // Drawn the same way, the node between two ways is a place like another
    resetIdCounter()
    const inLine = convert([...nodes, osmWay(100, ids.slice(0, 7)), osmWay(101, ids.slice(6))])
    expect(signalsOf(inLine)).toHaveLength(1)
    expect(reading(inLine, signalsOf(inLine)[0])).toMatchObject({ towards: 'east' })
  })

  /** The track of `track(600)` with a branch leaving it at x = 300 towards the north-east */
  const withBranch = (tagged: Record<number, Tags>): OverpassElement[] => {
    const branch = along([300, 0], [600, -60], 50).slice(1)
    return [
      ...track(600, { 300: { railway: 'switch' }, ...tagged }),
      ...branch.map(([x, y], i) => osmNode(50 + i, x, y)),
      osmWay(110, [7, ...branch.map((_, i) => 50 + i)]),
    ]
  }

  it('does not lay a signal that stands on the points themselves', () => {
    const result = convert(withBranch({ 300: main('FR:C') }))
    expect(signalsOf(result)).toHaveLength(0)
    expect(result.report.signals!.skipped).toEqual({ 'on-switch': 1 })
    expect(result.report.issues.filter((issue) => issue.kind === 'signal-not-placed')).toHaveLength(1)
  })

  it('moves a signal that stands within two metres of the points just clear of them', () => {
    // The way of `track` is replaced by one that passes the signal node, a metre before the points
    const elements = withBranch({}).filter((el) => !(el.type === 'way' && el.id === 100))
    const moved = convert([...elements, osmNode(90, 299, 0, main('FR:C')), osmWay(100, [1, 2, 3, 4, 5, 6, 90, 7, 8, 9, 10, 11, 12, 13])])
    expect(signalsOf(moved)).toHaveLength(1)
    const [signal] = signalsOf(moved)
    expect(moved.report.signals).toMatchObject({ real: { protection: 1 }, realMoved: 1, skipped: {} })
    const where = reading(moved, signal)
    expect(where.towards).toBe('east')
    expect(300 - where.x).toBeGreaterThanOrEqual(SIGNAL_SWITCH_CLEARANCE)
    expect(300 - where.x).toBeLessThan(SIGNAL_SWITCH_CLEARANCE * 2)
    expect(checkSignalPlacement(moved.network, signal, signal.forward, { ignoreId: signal.id })).toBeNull()
  })

  it('lays one signal of two that stand at the same place for the same direction', () => {
    const elements = track(600, { 200: main('FR:C') }).filter((el) => el.type !== 'way')
    const result = convert([...elements, osmNode(90, 200.3, 0, main('FR:S')), osmWay(100, [1, 2, 3, 4, 5, 90, 6, 7, 8, 9, 10, 11, 12, 13])])
    expect(signalsOf(result)).toHaveLength(1)
    expect(result.report.signals).toMatchObject({ found: 2, skipped: { duplicate: 1 } })
  })

  it('counts without listing it a signal on a track the options leave out', () => {
    const yard = along([0, 40], [600, 40], 50).map(([x, y], i) => osmNode(60 + i, x, y, x === 200 ? main('FR:C') : undefined))
    const elements = [...track(600, { 400: main('FR:S') }), ...yard, osmWay(120, yard.map((el) => el.id), { service: 'yard' })]
    const result = convert(elements, 'real', { serviceTracks: false })
    expect(signalsOf(result)).toHaveLength(1)
    expect(result.report.signals).toMatchObject({ found: 2, real: { spacing: 1 }, skipped: { 'track-not-imported': 1 } })
    expect(result.report.issues.filter((issue) => issue.kind === 'signal-not-placed')).toHaveLength(0)
  })

  it('counts by kind the signals it leaves aside', () => {
    const node = (tags: Tags): Tags => ({ railway: 'signal', 'railway:signal:direction': 'forward', ...tags })
    const result = convert(
      track(600, {
        100: main('FR:CV'),
        150: node({ 'railway:signal:distant': 'FR:A' }),
        200: node({ 'railway:signal:speed_limit': 'FR:Z' }),
        250: node({ 'railway:signal:speed_limit_distant': 'FR:TIV-D' }),
        300: node({}),
        350: main('FR:GABARIT'),
        400: node({ 'railway:signal:departure': 'FR:SLD' }),
      }),
    )
    expect(signalsOf(result)).toHaveLength(0)
    expect(result.report.signals).toMatchObject({ found: 7, ignored: { shunting: 1, distant: 1, speed: 2, untyped: 1, unknown: 1, other: 1 }, skipped: {} })
    expect(result.report.issues.filter((issue) => issue.kind === 'signal-not-placed')).toHaveLength(0)
  })

  it('lays the marker boards of a high-speed line, and makes a path signal of an untyped one that points follow', () => {
    const marker = (type: string): Tags => cab('FR:marker', { 'railway:signal:train_protection:main': 'stop_marker', 'railway:signal:train_protection:main:type': type })
    const result = convert(withBranch({ 100: marker('FR:F'), 200: cab('FR:REP_TVM'), 450: cab('FR:REP_TVM'), 550: marker('FR:NF') }))
    const byX = signalsOf(result).sort((a, b) => reading(result, a).x - reading(result, b).x)
    expect(byX.map((signal) => Math.round(reading(result, signal).x))).toEqual([100, 200, 450, 550])
    expect(byX.every((signal) => signal.cabMarker === true)).toBe(true)
    // 200: the points at 300 are in its block. 450: plain track as far as the marker at 550
    expect(byX.map((signal) => signal.role)).toEqual(['spacing', 'protection', 'spacing', 'protection'])
    expect(result.report.signals!.real).toEqual({ protection: 2, spacing: 2, cabMarkers: 4 })
  })
})

describe('signals of an import', () => {
  beforeEach(() => resetIdCounter())

  /** 6 km of plain track, a carré for eastbound trains at 1 000 m */
  const longTrack = (): OverpassElement[] => {
    const places = along([0, 0], [6000, 0], 100)
    return [...places.map(([x, y], i) => osmNode(1 + i, x, y, x === 1000 ? main('FR:C') : undefined)), osmWay(100, places.map((_, i) => 1 + i))]
  }

  it('lays the automatic signalling when the options say nothing', () => {
    expect(DEFAULT_OSM_IMPORT_OPTIONS.signals).toBe('generated')
    const { signals: _left, ...silent } = options()
    const result = convertOsm(answer(longTrack()), silent)
    expect(result.report.signals).toMatchObject({ mode: 'generated', found: 1, real: { protection: 0, spacing: 0 } })
    expect(result.network.signals.size).toBeGreaterThan(0)
  })

  it('lays nothing with `none`, and still counts the nodes', () => {
    const result = convert(longTrack(), 'none')
    expect(result.network.signals.size).toBe(0)
    expect(result.report.signals).toMatchObject({ mode: 'none', found: 1, generated: { protection: 0, spacing: 0 } })
  })

  it('`generated`: block signals in pairs on plain track, none of the real ones', () => {
    const result = convert(longTrack(), 'generated')
    // 6 000 m at 160 km/h, 1 411 m to stop: four blocks of 1 500 m, so three pairs
    expect(result.report.signals).toMatchObject({ real: { protection: 0, spacing: 0 }, generated: { protection: 0, spacing: 6, cabMarkers: 0 } })
    const where = signalsOf(result).map((signal) => reading(result, signal))
    expect(where.map((w) => Math.round(w.x / 10) * 10).sort((a, b) => a - b)).toEqual([1500, 1500, 3000, 3000, 4500, 4500])
    expect(where.filter((w) => w.towards === 'east')).toHaveLength(3)
  })

  it('`real`: the real ones alone', () => {
    const result = convert(longTrack(), 'real')
    expect(signalsOf(result)).toHaveLength(1)
    expect(result.report.signals).toMatchObject({ real: { protection: 1 }, generated: { protection: 0, spacing: 0 } })
  })

  it('`mixed`: plain track that carries a real signal gets no generated one, the rest is signalled', () => {
    // A second track, with no real signal, 40 m to the south
    const second = along([0, 40], [6000, 40], 100).map(([x, y], i) => osmNode(200 + i, x, y))
    const result = convert([...longTrack(), ...second, osmWay(101, second.map((el) => el.id))], 'mixed')
    expect(result.report.signals).toMatchObject({ real: { protection: 1, spacing: 0 }, generated: { protection: 0, spacing: 6 }, stretchesLeftToReal: 1 })
    const offTrack = signalsOf(result).map((signal) => reading(result, signal).offTrack)
    // The real one on the first track, the six generated on the second
    expect(offTrack.filter((d) => d < 10)).toHaveLength(1)
    expect(offTrack.filter((d) => d > 30 && d < 50)).toHaveLength(6)
  })

  it('makes marker boards of the signals generated on a high-speed track', () => {
    const places = along([0, 0], [6000, 0], 100)
    const elements = [...places.map(([x, y], i) => osmNode(1 + i, x, y)), osmWay(100, places.map((_, i) => 1 + i), { highspeed: 'yes', maxspeed: '300' })]
    const result = convert(elements, 'generated')
    // Marker boards every 1 500 m: the cab stops a train over several blocks
    expect(result.report.signals!.generated).toEqual({ protection: 0, spacing: 6, cabMarkers: 6 })
    expect(signalsOf(result).every((signal) => signal.cabMarker === true)).toBe(true)
  })

  it('changes neither the rails nor what the editor does when it opens the network', () => {
    const elements = (): OverpassElement[] => {
      const branch = along([3000, 0], [6000, -400], 100).slice(1)
      return [...longTrack().map((el) => (el.id === 31 && el.type === 'node' ? { ...el, tags: { railway: 'switch' } } : el)), ...branch.map(([x, y], i) => osmNode(300 + i, x, y)), osmWay(110, [31, ...branch.map((_, i) => 300 + i)])]
    }
    const without = convert(elements(), 'none')
    resetIdCounter()
    const withSignals = convert(elements(), 'mixed')
    expect(withSignals.network.signals.size).toBeGreaterThan(1)
    expect(contentsOf(withSignals.network)).toEqual(contentsOf(without.network))
    const count = withSignals.network.signals.size
    expect(openInEditor(withSignals.network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
    expect(withSignals.network.signals.size).toBe(count)
  })

  it('counts beforehand the signals it can lay', () => {
    const data = answer(track(600, { 100: main('FR:CARRE'), 200: main('FR:CV'), 300: { ...main('FR:S'), 'railway:signal:direction': 'both' }, 400: cab('FR:REP_TVM'), 500: { railway: 'signal' } }))
    expect(surveyOsm(data, options())).toMatchObject({ signals: 5, typedMainSignals: 2, usableSignals: 2 })
  })
})
