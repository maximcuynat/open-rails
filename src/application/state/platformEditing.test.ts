import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import { addPlatform, edgeLength } from '@domain/models/platforms'
import { addStation } from '@domain/models/stations'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

/** A straight track of 300 m in three rails, a station, and a platform of 50 m along the middle rail */
function storeWithPlatform() {
  const store = new EditorStore()
  const net = createNetwork()
  const n = [0, 100, 200, 300].map((x) => addNode(net, { x, y: 0 }))
  const rails = [0, 1, 2].map((i) => addSegment(net, n[i].id, n[i + 1].id)!.id)
  const station = addStation(net, { name: 'Clelles-Mens', pos: { x: 150, y: 20 }, stops: [] })
  const platform = addPlatform(net, {
    stationId: station.id,
    edges: [{ track: [{ segId: rails[1], t0: 0.25, t1: 0.75 }], side: 'right' }],
    width: 6,
    markers: [{ edge: 0, at: 40, heading: 'forward' }],
  })
  store.network = net
  store.markDirty()
  store.setTool('select')
  store.camera.scale = 10
  return { store, station, platform, rails }
}

/** Undo steps recorded (the history is private: read as the tests of the store do) */
const historyLength = (store: EditorStore) => (store as unknown as { history: unknown[] }).history.length

const lengthOf = (store: EditorStore, id: string) => edgeLength(store.network, store.network.platforms.get(id)!.edges[0])

describe('editing a platform with the selection tool', () => {
  it('picks a platform from its body, dropping the track and station selections', () => {
    const { store, station, platform } = storeWithPlatform()
    store.selectStation(station.id)
    const hit = store.platformHitAt({ x: 150, y: 4 })
    expect(hit).toEqual({ kind: 'body', platformId: platform.id })
    expect(store.selectPlatform(platform.id)).toBe(true)
    expect(store.selectedPlatform).toBe(platform)
    expect(store.selectedStation).toBeNull()
    expect(store.updatePlatformHover({ x: 150, y: 4 })).toBe(true)
    expect(store.hoveredPlatformId).toBe(platform.id)
    // Picking a station drops it, another tool too
    store.selectStation(station.id)
    expect(store.selectedPlatform).toBeNull()
    store.selectPlatform(platform.id)
    store.setTool('place')
    expect(store.selectedPlatform).toBeNull()
    expect(store.selectPlatform(platform.id)).toBe(false)
  })

  it('finds the ends and the markers of the selected platform before its body', () => {
    const { store, platform } = storeWithPlatform()
    expect(store.platformHitAt({ x: 125, y: 4 })).toEqual({ kind: 'end', platformId: platform.id, edge: 0, end: 'start' })
    store.selectPlatform(platform.id)
    expect(store.platformHitAt({ x: 165, y: 1 })).toEqual({ kind: 'marker', platformId: platform.id, index: 0 })
  })

  it('drags an end along the track: the length changes, the drop is one undo step', () => {
    const { store, platform } = storeWithPlatform()
    store.selectPlatform(platform.id)
    const steps = historyLength(store)
    expect(store.beginPlatformDrag({ kind: 'end', platformId: platform.id, edge: 0, end: 'end' })).toBe(true)
    expect(store.dragPlatformTo({ x: 240, y: 3 })).toBe(true)
    expect(store.platformDragMeasure).toEqual({ kind: 'end', length: expect.closeTo(115, 6) })
    expect(historyLength(store)).toBe(steps)
    expect(store.endPlatformDrag()).toBe(true)
    expect(lengthOf(store, platform.id)).toBeCloseTo(115, 6)
    expect(historyLength(store)).toBe(steps + 1)
  })

  it('puts a dragged end back on Escape', () => {
    const { store, platform } = storeWithPlatform()
    store.beginPlatformDrag({ kind: 'end', platformId: platform.id, edge: 0, end: 'start' })
    store.dragPlatformTo({ x: 20, y: 3 })
    expect(lengthOf(store, platform.id)).toBeCloseTo(155, 6)
    store.cancelInteraction()
    expect(store.platformDrag).toBeNull()
    expect(lengthOf(store, platform.id)).toBeCloseTo(50, 6)
  })

  it('drags a stop marker along its edge', () => {
    const { store, platform } = storeWithPlatform()
    store.selectPlatform(platform.id)
    store.beginPlatformDrag({ kind: 'marker', platformId: platform.id, index: 0 })
    store.dragPlatformTo({ x: 140, y: 2 })
    // Forward marker: its distance to the end it faces
    expect(store.platformDragMeasure).toEqual({ kind: 'marker', length: expect.closeTo(35, 6) })
    expect(store.endPlatformDrag()).toBe(true)
    expect(platform.markers[0].at).toBeCloseTo(15, 6)
  })

  it('deletes the selected platform with Delete, and undo brings it back once platforms are saved', () => {
    const { store, platform, rails } = storeWithPlatform()
    store.selectPlatform(platform.id)
    store.deleteSelection()
    expect(store.network.platforms.has(platform.id)).toBe(false)
    expect(store.selectedPlatform).toBeNull()
    // The track stays
    expect(rails.every((id) => store.network.segments.has(id))).toBe(true)
    store.undo()
    expect(store.network.platforms.has(platform.id)).toBe(true)
  })

  it('changes the track number, the width, the markers and the station of a platform, one undo step each', () => {
    const { store, platform } = storeWithPlatform()
    const steps = historyLength(store)
    expect(store.setPlatformRef(platform.id, 0, 'A')).toBe(true)
    expect(store.setPlatformWidth(platform.id, 8)).toBe(true)
    expect(store.setPlatformWidth(platform.id, 8)).toBe(false)
    expect(store.addPlatformMarker(platform.id, 0, 'backward')).toBe(true)
    expect(platform.markers[1]).toEqual({ edge: 0, at: expect.closeTo(10, 6), heading: 'backward' })
    expect(store.setPlatformMarker(platform.id, 1, { maxLength: 120 })).toBe(true)
    expect(store.removePlatformMarker(platform.id, 0)).toBe(true)
    const created = store.createStationForPlatform(platform.id, 'Mens')!
    expect(platform.stationId).toBe(created)
    // In the middle of the platform, 8 m wide now: 1.7 + 4 m from the axis
    expect(store.network.stations.get(created)!.pos).toEqual({ x: expect.closeTo(150, 6), y: expect.closeTo(5.7, 6) })
    expect(platform).toMatchObject({ width: 8, edges: [{ ref: 'A' }], markers: [{ heading: 'backward', maxLength: 120 }] })
    expect(historyLength(store)).toBe(steps + 6)
  })

  it('refuses every change on a project that cannot be edited', () => {
    const { store, platform } = storeWithPlatform()
    store.isPlayMode = true
    expect(store.setPlatformWidth(platform.id, 8)).toBe(false)
    expect(store.deletePlatform(platform.id)).toBe(false)
    expect(store.beginPlatformDrag({ kind: 'end', platformId: platform.id, edge: 0, end: 'end' })).toBe(false)
    expect(store.createStation('Mens')).toBeNull()
    expect(store.network.platforms.has(platform.id)).toBe(true)
  })
})

describe('stations in the editor', () => {
  it('are created, renamed and their mark dragged; undo puts the name back', () => {
    const { store, station } = storeWithPlatform()
    const id = store.createStation('  Lus-la-Croix-Haute ', { x: 10, y: 10 })!
    expect(store.selectedStation?.name).toBe('Lus-la-Croix-Haute')
    expect(store.renameStation(station.id, { name: 'Clelles', code: 'clm' })).toBe(true)
    expect(store.network.stations.get(station.id)).toMatchObject({ name: 'Clelles', code: 'CLM' })
    expect(store.renameStation(station.id, { name: '  ' })).toBe(false)
    expect(store.renameStation(station.id, { name: 'Clelles' })).toBe(false)
    store.undo()
    expect(store.network.stations.get(station.id)!.name).toBe('Clelles-Mens')
    expect(store.network.stations.has(id)).toBe(true)

    expect(store.beginStationDrag(station.id)).toBe(true)
    expect(store.dragStationTo({ x: 160, y: 30 })).toBe(true)
    expect(store.endStationDrag()).toBe(true)
    expect(store.network.stations.get(station.id)!.pos).toEqual({ x: 160, y: 30 })
    // Escape during a drag puts the mark back
    store.beginStationDrag(station.id)
    store.dragStationTo({ x: 0, y: 0 })
    store.cancelInteraction()
    expect(store.network.stations.get(station.id)!.pos).toEqual({ x: 160, y: 30 })
  })
})
