import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ZONE_TOOL_SPEED, EditorStore, MAX_ZONE_SPEED } from './editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import * as speedLimits from '@domain/models/speedLimits'
import { speedZoneEnds, speedZoneLength } from '@domain/services/speedZoneLayout'
import type { SpeedZone } from '@domain/models/types'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
  vi.restoreAllMocks()
})

/** A store with a committed straight track along y = 0 from x = 0 to x = 1000, and a second, separate one along y = 50 */
function storeWithTracks() {
  const store = new EditorStore()
  const net = store.network
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 1000, y: 0 })
  addSegment(net, a.id, b.id)
  const c = addNode(net, { x: 0, y: 50 })
  const d = addNode(net, { x: 1000, y: 50 })
  addSegment(net, c.id, d.id)
  store.camera.scale = 3
  store.markDirty()
  return store
}

/** Number of steps the undo history holds */
const undoSteps = (store: EditorStore) => (store as unknown as { history: unknown[] }).history.length

const zones = (store: EditorStore): SpeedZone[] => [...store.network.speedZones.values()]

/** Lay a zone with the tool, from x = `from` to x = `to` on the track along y = 0 */
function layZone(store: EditorStore, from: number, to: number, speed?: number): SpeedZone {
  store.setSignalToolSubMode('speedZone')
  if (speed !== undefined) store.setSpeedZoneToolSpeed(speed)
  expect(store.clickSpeedZoneTool(store.trackPointAt({ x: from, y: 0 }))).toBe('started')
  expect(store.clickSpeedZoneTool(store.trackPointAt({ x: to, y: 0 }))).toBe('placed')
  return store.selectedSpeedZone!
}

describe('signalling mode', () => {
  it('opens on its selection sub-mode and holds one sub-mode at a time', () => {
    const store = storeWithTracks()
    store.setTool('signal')
    expect(store.tool).toBe('signal')
    expect(store.signalToolSubMode).toBe('select')
    store.setSignalToolSubMode('speedZone')
    expect(store.isSpeedZoneTool).toBe(true)
    store.setSignalToolSubMode('delete')
    expect(store.signalToolSubMode).toBe('delete')
    expect(store.isSpeedZoneTool).toBe(false)
  })

  it('opens straight on a sub-mode from the track tools, and always comes back on the selection', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('speedZone')
    expect(store.tool).toBe('signal')
    expect(store.signalToolSubMode).toBe('speedZone')
    store.setTool('place')
    store.setTool('signal')
    expect(store.signalToolSubMode).toBe('select')
  })

  it('drops the track selection on the way in, so Delete never reaches a rail', () => {
    const store = storeWithTracks()
    const segId = [...store.network.segments.keys()][0]
    store.setSelection({ nodes: new Set(), segments: new Set([segId]) })
    store.setTool('signal')
    expect(store.selection.segments.size).toBe(0)
    store.deleteSelection()
    expect(store.network.segments.size).toBe(2)
  })

  it('exitSignalMode goes back to the track tools', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('delete')
    store.exitSignalMode()
    expect(store.tool).toBe('select')
  })
})

describe('speed limit tool', () => {
  it('lays a zone in two clicks, selects it and records one undo step', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('speedZone')
    const steps = undoSteps(store)

    expect(store.clickSpeedZoneTool(store.trackPointAt({ x: 250, y: 0 }))).toBe('started')
    expect(store.speedZoneStart).not.toBeNull()
    expect(zones(store)).toHaveLength(0)
    expect(undoSteps(store)).toBe(steps)

    expect(store.clickSpeedZoneTool(store.trackPointAt({ x: 750, y: 0 }))).toBe('placed')
    expect(zones(store)).toHaveLength(1)
    const zone = zones(store)[0]
    expect(zone.speed).toBe(DEFAULT_ZONE_TOOL_SPEED)
    expect(speedZoneLength(store.network, zone)).toBeCloseTo(500, 6)
    const ends = speedZoneEnds(store.network, zone)!
    expect(ends.a.x).toBeCloseTo(250, 6)
    expect(ends.b.x).toBeCloseTo(750, 6)
    expect(store.speedZoneStart).toBeNull()
    expect(store.selectedSpeedZone).toBe(zone)
    expect(undoSteps(store)).toBe(steps + 1)
    // The tool stays in hand for the next zone
    expect(store.isSpeedZoneTool).toBe(true)
  })

  it('lays the zone at the speed of the tool, stepped by 10 km/h between 10 and the highest line speed', () => {
    const store = storeWithTracks()
    store.setSpeedZoneToolSpeed(94)
    expect(store.speedZoneToolSpeed).toBe(90)
    store.setSpeedZoneToolSpeed(0)
    expect(store.speedZoneToolSpeed).toBe(10)
    store.setSpeedZoneToolSpeed(5000)
    expect(store.speedZoneToolSpeed).toBe(MAX_ZONE_SPEED)
    expect(layZone(store, 100, 300, 60).speed).toBe(60)
  })

  it('refuses a click off the track and keeps the start', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('speedZone')
    expect(store.trackPointAt({ x: 500, y: 25 })).toBeNull()
    expect(store.clickSpeedZoneTool(null)).toBe('off-track')
    expect(store.speedZoneStart).toBeNull()
    store.clickSpeedZoneTool(store.trackPointAt({ x: 250, y: 0 }))
    expect(store.clickSpeedZoneTool(null)).toBe('off-track')
    expect(store.speedZoneStart).not.toBeNull()
    expect(zones(store)).toHaveLength(0)
  })

  it('refuses two points that no track joins, without a zone nor an undo step', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('speedZone')
    const steps = undoSteps(store)
    store.clickSpeedZoneTool(store.trackPointAt({ x: 250, y: 0 }))
    expect(store.clickSpeedZoneTool(store.trackPointAt({ x: 750, y: 50 }))).toBe('no-path')
    expect(zones(store)).toHaveLength(0)
    expect(undoSteps(store)).toBe(steps)
    // The start is kept: the next click can still close the zone
    expect(store.clickSpeedZoneTool(store.trackPointAt({ x: 750, y: 0 }))).toBe('placed')
  })

  it('does nothing outside its sub-mode', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('select')
    expect(store.clickSpeedZoneTool(store.trackPointAt({ x: 250, y: 0 }))).toBe('refused')
    expect(store.speedZoneStart).toBeNull()
  })

  it('undo removes the zone, redo puts it back at the same place', () => {
    const store = storeWithTracks()
    layZone(store, 250, 750, 90)
    store.undo()
    expect(zones(store)).toHaveLength(0)
    expect(store.selectedSpeedZone).toBeNull()
    store.redo()
    expect(zones(store)).toHaveLength(1)
    expect(zones(store)[0].speed).toBe(90)
    expect(speedZoneLength(store.network, zones(store)[0])).toBeCloseTo(500, 6)
  })

  it('undo forgets a start that was waiting for its second click', () => {
    const store = storeWithTracks()
    layZone(store, 100, 200)
    store.clickSpeedZoneTool(store.trackPointAt({ x: 400, y: 0 }))
    store.undo()
    expect(store.speedZoneStart).toBeNull()
  })
})

describe('speed zone selection and edition', () => {
  it('picks the zone under a point, only inside the signalling mode', () => {
    const store = storeWithTracks()
    const zone = layZone(store, 250, 750)
    store.setSignalToolSubMode('select')
    expect(store.speedZoneAt({ x: 500, y: 0 })?.id).toBe(zone.id)
    expect(store.speedZoneAt({ x: 100, y: 0 })).toBeNull()
    expect(store.speedZoneAt({ x: 500, y: 50 })).toBeNull()

    expect(store.selectSpeedZone(null)).toBe(true)
    expect(store.selectedSpeedZone).toBeNull()
    expect(store.selectSpeedZone(zone.id)).toBe(true)
    expect(store.selectedSpeedZone?.id).toBe(zone.id)
    expect(store.selectSpeedZone('z_missing')).toBe(false)

    // Outside the mode: no zone can be picked, and none stays picked
    store.setTool('select')
    expect(store.selectedSpeedZone).toBeNull()
    expect(store.selectSpeedZone(zone.id)).toBe(false)
    expect(store.selectedSpeedZone).toBeNull()
    // The zone itself is still there
    expect(zones(store)).toHaveLength(1)
  })

  it('goes through overlapping zones click after click', () => {
    const store = storeWithTracks()
    const first = layZone(store, 100, 600, 90)
    const second = layZone(store, 400, 900, 60)
    store.setSignalToolSubMode('select')
    store.selectSpeedZone(null)
    const picked = store.speedZoneAt({ x: 500, y: 0 })!
    store.selectSpeedZone(picked.id)
    const next = store.speedZoneAt({ x: 500, y: 0 })!
    expect(new Set([picked.id, next.id])).toEqual(new Set([first.id, second.id]))
  })

  it('remembers the zone under the cursor in the select and delete sub-modes only', () => {
    const store = storeWithTracks()
    const zone = layZone(store, 250, 750)
    expect(store.updateSpeedZoneHover({ x: 500, y: 0 })).toBe(false)
    expect(store.hoveredSpeedZoneId).toBeNull()
    store.setSignalToolSubMode('delete')
    expect(store.updateSpeedZoneHover({ x: 500, y: 0 })).toBe(true)
    expect(store.hoveredSpeedZoneId).toBe(zone.id)
    expect(store.updateSpeedZoneHover({ x: 500, y: 0 })).toBe(false)
    expect(store.updateSpeedZoneHover({ x: 50, y: 0 })).toBe(true)
    expect(store.hoveredSpeedZoneId).toBeNull()
  })

  it('changes the speed of a zone in one undo step', () => {
    const store = storeWithTracks()
    const zone = layZone(store, 250, 750, 90)
    const steps = undoSteps(store)
    expect(store.setSpeedZoneSpeed(zone.id, 60)).toBe(true)
    expect(store.network.speedZones.get(zone.id)!.speed).toBe(60)
    expect(undoSteps(store)).toBe(steps + 1)
    // Same speed, unknown zone: nothing happens and nothing is recorded
    expect(store.setSpeedZoneSpeed(zone.id, 60)).toBe(false)
    expect(store.setSpeedZoneSpeed('z_missing', 60)).toBe(false)
    expect(undoSteps(store)).toBe(steps + 1)
    store.undo()
    expect(zones(store)[0].speed).toBe(90)
  })

  it('deletes a zone in one undo step and releases it from the selection', () => {
    const store = storeWithTracks()
    const zone = layZone(store, 250, 750)
    const steps = undoSteps(store)
    expect(store.deleteSpeedZone(zone.id)).toBe(true)
    expect(zones(store)).toHaveLength(0)
    expect(store.selectedSpeedZoneId).toBeNull()
    expect(undoSteps(store)).toBe(steps + 1)
    expect(store.deleteSpeedZone(zone.id)).toBe(false)
    store.undo()
    expect(zones(store)).toHaveLength(1)
  })

  it('Delete removes the selected zone and nothing else', () => {
    const store = storeWithTracks()
    layZone(store, 250, 750)
    store.deleteSelection()
    expect(zones(store)).toHaveLength(0)
    expect(store.network.segments.size).toBe(2)
    // Nothing selected: nothing happens
    const steps = undoSteps(store)
    store.deleteSelection()
    expect(undoSteps(store)).toBe(steps)
  })

  it('tells when a zone overlaps another one, from the domain', () => {
    const store = storeWithTracks()
    const zone = layZone(store, 100, 600)
    const other = layZone(store, 400, 900)
    const spy = vi.spyOn(speedLimits, 'overlapsOfZone')
    spy.mockReturnValue([])
    expect(store.speedZoneOverlapsAnother(zone.id)).toBe(false)
    spy.mockReturnValue([{ a: zone, b: other, spans: [], length: 200 }])
    expect(store.speedZoneOverlapsAnother(zone.id)).toBe(true)
    expect(spy).toHaveBeenLastCalledWith(store.network, zone.id)
  })
})

describe('signalling mode and driving', () => {
  /** A store with a zone and a train, in driving mode */
  function drivingStore() {
    const store = storeWithTracks()
    const zone = layZone(store, 250, 750, 90)
    store.setTrainPlacementKind('tgv_loco')
    store.placeTrainItem({ x: 100, y: 0 })
    store.togglePlayMode()
    expect(store.isPlayMode).toBe(true)
    return { store, zone }
  }

  it('refuses the mode, the tool and every edition of a zone while driving', () => {
    const { store, zone } = drivingStore()
    const steps = undoSteps(store)
    store.setSignalToolSubMode('speedZone')
    expect(store.isSpeedZoneTool).toBe(false)
    expect(store.clickSpeedZoneTool(store.trackPointAt({ x: 800, y: 0 }))).toBe('refused')
    expect(store.setSpeedZoneSpeed(zone.id, 60)).toBe(false)
    expect(store.deleteSpeedZone(zone.id)).toBe(false)
    expect(store.selectSpeedZone(zone.id)).toBe(false)
    expect(zones(store)).toEqual([expect.objectContaining({ id: zone.id, speed: 90 })])
    expect(undoSteps(store)).toBe(steps)
  })
})

describe('Escape in the signalling mode', () => {
  it('first cancels the zone in progress, then goes back to the selection, then to the track tools', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('speedZone')
    store.clickSpeedZoneTool(store.trackPointAt({ x: 250, y: 0 }))

    store.cancelInteraction()
    expect(store.speedZoneStart).toBeNull()
    expect(store.isSpeedZoneTool).toBe(true)

    store.cancelInteraction()
    expect(store.tool).toBe('signal')
    expect(store.signalToolSubMode).toBe('select')

    store.cancelInteraction()
    expect(store.tool).toBe('select')
  })

  it('releases the selected zone before leaving the mode', () => {
    const store = storeWithTracks()
    const zone = layZone(store, 250, 750)
    store.setSignalToolSubMode('select')
    store.selectSpeedZone(zone.id)

    store.cancelInteraction()
    expect(store.tool).toBe('signal')
    expect(store.selectedSpeedZone).toBeNull()

    store.cancelInteraction()
    expect(store.tool).toBe('select')
    expect(zones(store)).toHaveLength(1)
  })

  it('leaves the delete sub-mode for the selection first', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('delete')
    store.cancelInteraction()
    expect(store.tool).toBe('signal')
    expect(store.signalToolSubMode).toBe('select')
  })
})
