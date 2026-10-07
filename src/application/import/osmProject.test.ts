import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import type { OsmImportReport, OsmImportResult } from '@domain/import/osmTypes'
import { addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import { addSpeedZone } from '@domain/models/speedZones'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { buildOsmProject, loadOsmImport, osmLineSettings, osmProjectName, osmSourceOf, showOsmPlace } from './osmProject'

const REPORT: OsmImportReport = {
  nodes: 4,
  rails: 3,
  lengthKm: 0.6,
  turnouts: 0,
  doubleSlips: 0,
  fixedCrossings: 0,
  railsOnBridge: 1,
  railsInTunnel: 0,
  stackedCrossings: 1,
  undecidedCrossings: 0,
  speedZones: 1,
  lengthWithoutSpeedKm: 0,
  droppedComponents: 0,
  issues: [],
}

/** A line of three rails whose middle one is on a bridge, limited to 90 km/h: what a conversion hands over */
function importResult(overrides: Partial<OsmImportResult> = {}): OsmImportResult {
  const network = createNetwork()
  const a = addNode(network, { x: -300, y: 0 })
  const b = addNode(network, { x: -100, y: 0 })
  const c = addNode(network, { x: 100, y: 0 })
  const d = addNode(network, { x: 300, y: 0 })
  b.level = 1
  c.level = 1
  addSegment(network, a.id, b.id)
  const bridge = addSegment(network, b.id, c.id)
  addSegment(network, c.id, d.id)
  addSpeedZone(network, [{ segId: bridge!.id, t0: 0, t1: 1 }], 90)
  return {
    network,
    lineSpeed: 140,
    highSpeed: false,
    origin: { lat: 48.8443, lon: 2.3744 },
    frame: 'local',
    dataDate: '2026-10-06T07:12:00Z',
    report: REPORT,
    ...overrides,
  }
}

const NOW = new Date('2026-10-06T09:30:00Z')

beforeEach(() => {
  resetMemoryStorage()
  resetIdCounter()
})

describe('line settings of an import', () => {
  it('takes the speed read on the tracks, on a conventional line', () => {
    expect(osmLineSettings({ lineSpeed: 140, highSpeed: false })).toEqual({ lineSpeed: 140, lineType: 'classic' })
  })

  it('makes a high-speed line of tracks marked as such', () => {
    expect(osmLineSettings({ lineSpeed: 300, highSpeed: true })).toEqual({ lineSpeed: 300, lineType: 'highSpeed' })
  })

  it('falls back on the presets of the settings window when no speed was read', () => {
    expect(osmLineSettings({ highSpeed: false })).toEqual({ lineSpeed: 160, lineType: 'classic' })
    expect(osmLineSettings({ highSpeed: true })).toEqual({ lineSpeed: 300, lineType: 'highSpeed' })
  })

  it('keeps the speed a multiple of ten, inside what the settings accept', () => {
    expect(osmLineSettings({ lineSpeed: 125, highSpeed: false }).lineSpeed).toBe(130)
    expect(osmLineSettings({ lineSpeed: 574, highSpeed: true }).lineSpeed).toBe(360)
    expect(osmLineSettings({ lineSpeed: 3, highSpeed: false }).lineSpeed).toBe(10)
    expect(osmLineSettings({ lineSpeed: Number.NaN, highSpeed: false }).lineSpeed).toBe(160)
  })
})

describe('provenance of an import', () => {
  it('keeps the centre of the projection, the date of the data and the day of the import', () => {
    expect(osmSourceOf(importResult(), NOW)).toEqual({
      lat: 48.8443,
      lon: 2.3744,
      dataDate: '2026-10-06T07:12:00Z',
      importedAt: '2026-10-06T09:30:00.000Z',
    })
  })

  it('says the frame only when it is the national one', () => {
    expect('frame' in osmSourceOf(importResult(), NOW)).toBe(false)
    expect(osmSourceOf(importResult({ frame: 'lambert93' }), NOW).frame).toBe('lambert93')
  })

  it('dates the data from the day of the import when the answer carries no date', () => {
    expect(osmSourceOf(importResult({ dataDate: undefined }), NOW).dataDate).toBe('2026-10-06')
  })

  it('names the project after the place, as the example made from OpenStreetMap is', () => {
    expect(osmProjectName('Gare de Lyon')).toBe('Gare de Lyon (OSM)')
    expect(osmProjectName('  ')).toBe('Import OpenStreetMap')
    expect(osmProjectName()).toBe('Import OpenStreetMap')
  })
})

describe('the project of an import', () => {
  it('is a full-size project in metres, without baseboard, camera or train', () => {
    const project = buildOsmProject(importResult(), { levels: true, placeName: 'Gare de Lyon', now: NOW })
    expect(project.name).toBe('Gare de Lyon (OSM)')
    expect(project.unit).toBe('m')
    expect(project.scalePreset).toBe('1:1')
    expect(project.gauge).toBe(1.435)
    expect(project.trackSpacing).toBe(3.8)
    expect(project.boardEnabled).toBe(false)
    expect(project.showDimensions).toBe(false)
    expect(project.camera).toBeUndefined()
    expect(project.trains ?? []).toEqual([])
  })

  it('carries the track with its levels and its speed zones', () => {
    const project = buildOsmProject(importResult(), { levels: true, now: NOW })
    expect(project.nodes).toHaveLength(4)
    expect(project.segments).toHaveLength(3)
    expect(project.nodes.filter((n) => n.level === 1)).toHaveLength(2)
    expect(project.speedZones).toHaveLength(1)
    expect(project.speedZones?.[0].speed).toBe(90)
  })

  it('carries the line settings, the provenance and the levels without relief', () => {
    const project = buildOsmProject(importResult(), { levels: true, now: NOW })
    expect(project.lineSpeed).toBe(140)
    expect(project.flatLevels).toBe(true)
    expect(project.osmSource).toEqual({ lat: 48.8443, lon: 2.3744, dataDate: '2026-10-06T07:12:00Z', importedAt: '2026-10-06T09:30:00.000Z' })
  })

  it('leaves the levels alone when the import did not read them', () => {
    const project = buildOsmProject(importResult(), { levels: false, now: NOW })
    expect(project.flatLevels).toBeUndefined()
    expect(project.osmSource).toBeDefined()
  })

  it('writes a high-speed line as such', () => {
    const project = buildOsmProject(importResult({ lineSpeed: 300, highSpeed: true }), { levels: true, now: NOW })
    expect(project.lineSpeed).toBe(300)
    expect(project.lineType).toBe('highSpeed')
  })
})

describe('loading an import in the editor', () => {
  /** A store holding a small network of its own, as when the user imports over a project */
  function storeWithProject(): EditorStore {
    const store = new EditorStore()
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 50, y: 0 })
    addSegment(net, a.id, b.id)
    store.network = net
    store.projectName = 'Mon réseau'
    store.markDirty()
    return store
  }

  it('replaces the project and sets what an import sets', () => {
    const store = storeWithProject()
    const fitView = vi.fn()
    loadOsmImport(store, importResult(), { levels: true, placeName: 'Gare de Lyon', now: NOW }, fitView)

    expect(store.projectName).toBe('Gare de Lyon (OSM)')
    expect(store.network.segments.size).toBe(3)
    expect(store.network.speedZones.size).toBe(1)
    expect(store.scalePreset).toBe('1:1')
    expect(store.unit).toBe('m')
    expect(store.boardEnabled).toBe(false)
    expect(store.lineSettings.lineSpeed).toBe(140)
    expect(store.lineSettings.lineType).toBe('classic')
    expect(store.flatLevels).toBe(true)
    expect(store.osmSource).toEqual({ lat: 48.8443, lon: 2.3744, dataDate: '2026-10-06T07:12:00Z', importedAt: '2026-10-06T09:30:00.000Z' })
    expect(store.trains).toEqual([])
    expect(fitView).toHaveBeenCalledTimes(1)
  })

  it('frames the network after it is loaded, not before', () => {
    const store = storeWithProject()
    let railsWhenFramed = -1
    loadOsmImport(store, importResult(), { levels: true, now: NOW }, () => {
      railsWhenFramed = store.network.segments.size
    })
    expect(railsWhenFramed).toBe(3)
  })

  it('is one step of the history: undoing brings the previous project back, redoing the import', () => {
    const store = storeWithProject()
    loadOsmImport(store, importResult(), { levels: true, placeName: 'Gare de Lyon', now: NOW }, () => {})
    expect(store.canUndo).toBe(true)

    store.undo()
    expect(store.network.segments.size).toBe(1)
    expect(store.osmSource).toBeNull()
    expect(store.flatLevels).toBe(false)

    store.redo()
    expect(store.network.segments.size).toBe(3)
    expect(store.osmSource?.lat).toBe(48.8443)
    expect(store.flatLevels).toBe(true)
  })

  it('goes out again in the exported project', () => {
    const store = storeWithProject()
    loadOsmImport(store, importResult(), { levels: true, now: NOW }, () => {})
    const exported = store.exportProject()
    expect(exported.osmSource?.dataDate).toBe('2026-10-06T07:12:00Z')
    expect(exported.flatLevels).toBe(true)
  })

  it('does not need a window to run (the default framing is skipped outside a browser)', () => {
    const store = storeWithProject()
    expect(() => loadOsmImport(store, importResult(), { levels: true, now: NOW })).not.toThrow()
    expect(store.network.segments.size).toBe(3)
  })
})

describe('showing a place of the report', () => {
  it('centres the view on it, close enough to read the track', () => {
    const store = new EditorStore()
    store.camera.scale = 0.2
    const notified = vi.fn()
    store.subscribe(notified)
    showOsmPlace(store, { x: 1234, y: -567 })
    expect(store.camera.x).toBe(1234)
    expect(store.camera.y).toBe(-567)
    expect(store.camera.scale).toBe(5)
    expect(notified).toHaveBeenCalled()
  })

  it('keeps a closer zoom the user already has', () => {
    const store = new EditorStore()
    store.camera.scale = 12
    showOsmPlace(store, { x: 10, y: 20 })
    expect(store.camera.scale).toBe(12)
  })
})
