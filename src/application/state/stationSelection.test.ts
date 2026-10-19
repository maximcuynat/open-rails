import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
import { addPlatform } from '@domain/models/platforms'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

function storeWithStation() {
  const store = new EditorStore()
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 1000, y: 0 })
  const rail = addSegment(net, a.id, b.id)!
  const station = addStation(net, { name: 'Clelles-Mens', pos: { x: 500, y: 0 }, uic: '8774762', stops: [{ segId: rail.id, t: 0.5 }] })
  store.network = net
  store.markDirty()
  store.setTool('select')
  return { store, station, a }
}

describe('picking a station', () => {
  it('finds the station under the cursor within the tolerance, and selects it instead of the track', () => {
    const { store, station, a } = storeWithStation()
    store.selection = { nodes: new Set([a.id]), segments: new Set() }
    expect(store.stationAt({ x: 503, y: 2 }, 5)).toBe(station)
    expect(store.stationAt({ x: 520, y: 0 }, 5)).toBeNull()
    expect(store.selectStation(station.id)).toBe(true)
    expect(store.selectedStation).toBe(station)
    expect(store.selection.nodes.size).toBe(0)
    expect(store.selectStation('st_nowhere')).toBe(false)
    expect(store.selectStation(null)).toBe(true)
    expect(store.selectedStation).toBeNull()
  })

  it('is dropped by another tool, by clearing the selection, and by a new project', () => {
    const { store, station } = storeWithStation()
    store.selectStation(station.id)
    store.setTool('place')
    expect(store.selectedStation).toBeNull()
    store.setTool('select')
    store.selectStation(station.id)
    store.clearSelection()
    expect(store.selectedStation).toBeNull()
    store.selectStation(station.id)
    store.loadFromData(store.exportProject())
    expect(store.selectedStation).toBeNull()
    // A station that is gone is no longer selected
    store.selectStation([...store.network.stations.keys()][0])
    store.network.stations.clear()
    expect(store.selectedStation).toBeNull()
  })

  it('remembers the station under the cursor with the selection tool only', () => {
    const { store, station } = storeWithStation()
    expect(store.updateStationHover({ x: 501, y: 1 })).toBe(true)
    expect(store.hoveredStationId).toBe(station.id)
    expect(store.updateStationHover({ x: 501, y: 1 })).toBe(false)
    expect(store.updateStationHover({ x: 900, y: 0 })).toBe(true)
    expect(store.hoveredStationId).toBeNull()
    store.setTool('pan')
    expect(store.updateStationHover({ x: 501, y: 1 })).toBe(false)
    expect(store.hoveredStationId).toBeNull()
  })
})

describe('a station laid in the middle of its platform', () => {
  /** A platform beside the track from x = 400 to 600, on the left (y < 0), and its station at its middle, at 10 px/m */
  function storeWithPlatform() {
    const store = new EditorStore()
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 1000, y: 0 })
    const rail = addSegment(net, a.id, b.id)!
    const station = addStation(net, { name: 'Gare 1', pos: { x: 500, y: -4.7 }, stops: [] })
    const platform = addPlatform(net, { stationId: station.id, edges: [{ track: [{ segId: rail.id, t0: 0.4, t1: 0.6 }], side: 'left' }], width: 6, markers: [] })
    const lone = addStation(net, { name: 'Halte', pos: { x: 900, y: -20 }, stops: [] })
    store.network = net
    store.markDirty()
    store.setTool('select')
    store.camera.scale = 10
    return { store, station, platform, lone }
  }

  it('leaves a click on the platform beside its mark to the platform', () => {
    const { store, platform } = storeWithPlatform()
    // 8 px from the mark: within the reach of a station, but on the platform
    const beside = { x: 500.8, y: -4.7 }
    expect(store.stationPickAt(beside)).toBeNull()
    expect(store.platformHitAt(beside)).toEqual({ kind: 'body', platformId: platform.id })
    expect(store.updateStationHover(beside)).toBe(false)
    expect(store.hoveredStationId).toBeNull()
  })

  it('still gives the station to a click on its mark or on its name', () => {
    const { store, station } = storeWithPlatform()
    expect(store.stationPickAt({ x: 500.3, y: -4.6 })).toBe(station)
    // The name stands on a pill above the mark
    expect(store.stationPickAt({ x: 501.5, y: -6.5 })).toBe(station)
    expect(store.updateStationHover({ x: 501.5, y: -6.5 })).toBe(true)
    expect(store.hoveredStationId).toBe(station.id)
  })

  it('keeps the reach of a station that stands on no platform', () => {
    const { store, lone } = storeWithPlatform()
    expect(store.stationPickAt({ x: 900.9, y: -20.5 })).toBe(lone)
    expect(store.stationPickAt({ x: 903, y: -20 })).toBeNull()
  })
})
