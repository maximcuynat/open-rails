import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
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
