import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore, SPEED_ZONE_NO_PATH, SPEED_ZONE_OFF_TRACK, SPEED_ZONE_OVERLAP } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { showToast } from './Toast'
import { changeZoneSpeed, clickSpeedZoneTool } from './speedZoneActions'

vi.mock('./Toast', () => ({ showToast: vi.fn() }))

/** Two separate straight tracks, along y = 0 and y = 60, with the speed limit tool in hand */
function storeWithTool(): EditorStore {
  const store = new EditorStore()
  for (const y of [0, 60]) {
    const a = addNode(store.network, { x: 0, y })
    const b = addNode(store.network, { x: 1000, y })
    addSegment(store.network, a.id, b.id)
  }
  store.camera.scale = 3
  store.markDirty()
  store.setSignalToolSubMode('speedZone')
  return store
}

describe('speed zone actions: what the user is told', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    vi.mocked(showToast).mockClear()
  })

  it('says nothing for a zone laid without overlap', () => {
    const store = storeWithTool()
    clickSpeedZoneTool(store, store.trackPointAt({ x: 100, y: 0 }))
    clickSpeedZoneTool(store, store.trackPointAt({ x: 600, y: 0 }))
    expect(store.network.speedZones.size).toBe(1)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('reports a click off the track', () => {
    const store = storeWithTool()
    clickSpeedZoneTool(store, null)
    expect(showToast).toHaveBeenCalledWith(SPEED_ZONE_OFF_TRACK, 'warning')
  })

  it('reports two points that no track joins', () => {
    const store = storeWithTool()
    clickSpeedZoneTool(store, store.trackPointAt({ x: 100, y: 0 }))
    clickSpeedZoneTool(store, store.trackPointAt({ x: 600, y: 60 }))
    expect(store.network.speedZones.size).toBe(0)
    expect(showToast).toHaveBeenCalledWith(SPEED_ZONE_NO_PATH, 'warning')
  })

  it('warns once when the zone just laid overlaps another one', () => {
    const store = storeWithTool()
    const overlaps = vi.spyOn(store, 'speedZoneOverlapsAnother').mockReturnValue(true)
    clickSpeedZoneTool(store, store.trackPointAt({ x: 100, y: 0 }))
    expect(showToast).not.toHaveBeenCalled()
    clickSpeedZoneTool(store, store.trackPointAt({ x: 600, y: 0 }))
    expect(overlaps).toHaveBeenCalledWith(store.selectedSpeedZoneId)
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith(SPEED_ZONE_OVERLAP, 'warning', expect.any(Number))
  })

  it('warns when an overlapping zone is given another speed, and only when it really changes', () => {
    const store = storeWithTool()
    clickSpeedZoneTool(store, store.trackPointAt({ x: 100, y: 0 }))
    clickSpeedZoneTool(store, store.trackPointAt({ x: 600, y: 0 }))
    const zone = store.selectedSpeedZone!
    vi.spyOn(store, 'speedZoneOverlapsAnother').mockReturnValue(true)
    changeZoneSpeed(store, zone.id, zone.speed)
    expect(showToast).not.toHaveBeenCalled()
    changeZoneSpeed(store, zone.id, zone.speed - 10)
    expect(showToast).toHaveBeenCalledWith(SPEED_ZONE_OVERLAP, 'warning', expect.any(Number))
  })

  it('says it once per zone for as long as it overlaps: not at each step of the speed counter', () => {
    const store = storeWithTool()
    clickSpeedZoneTool(store, store.trackPointAt({ x: 100, y: 0 }))
    clickSpeedZoneTool(store, store.trackPointAt({ x: 600, y: 0 }))
    const zone = store.selectedSpeedZone!
    const overlaps = vi.spyOn(store, 'speedZoneOverlapsAnother').mockReturnValue(true)
    changeZoneSpeed(store, zone.id, zone.speed - 10)
    changeZoneSpeed(store, zone.id, zone.speed - 10)
    changeZoneSpeed(store, zone.id, zone.speed + 10)
    expect(showToast).toHaveBeenCalledTimes(1)
    // It stops overlapping, then overlaps again: the warning is owed anew
    overlaps.mockReturnValue(false)
    changeZoneSpeed(store, zone.id, zone.speed - 10)
    expect(showToast).toHaveBeenCalledTimes(1)
    overlaps.mockReturnValue(true)
    changeZoneSpeed(store, zone.id, zone.speed - 10)
    changeZoneSpeed(store, zone.id, zone.speed - 10)
    expect(showToast).toHaveBeenCalledTimes(2)
  })

  it('a zone laid over a zone already warned for is told too: the warning is per zone', () => {
    const store = storeWithTool()
    vi.spyOn(store, 'speedZoneOverlapsAnother').mockReturnValue(true)
    clickSpeedZoneTool(store, store.trackPointAt({ x: 100, y: 0 }))
    clickSpeedZoneTool(store, store.trackPointAt({ x: 600, y: 0 }))
    clickSpeedZoneTool(store, store.trackPointAt({ x: 200, y: 0 }))
    clickSpeedZoneTool(store, store.trackPointAt({ x: 500, y: 0 }))
    expect(store.network.speedZones.size).toBe(2)
    expect(showToast).toHaveBeenCalledTimes(2)
  })
})
