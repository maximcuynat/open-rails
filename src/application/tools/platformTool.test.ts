import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { buildContextBar } from '@presentation/components/contextbar/contextBarModel'
import { clickPlatformTool, islandRefusalText, platformPreviewDrawing, rakeFitText, resolvePlatformTool } from './platformTool'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

/** A store with a straight track along y = 0 from x = 0 to 300, and optionally another along y = `other` */
function storeWithTrack(other: number | null = null): EditorStore {
  const store = new EditorStore()
  const net = store.network
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 300, y: 0 })
  addSegment(net, a.id, b.id)
  if (other !== null) addSegment(net, addNode(net, { x: 0, y: other }).id, addNode(net, { x: 300, y: other }).id)
  store.markDirty()
  store.camera = { x: 150, y: 0, scale: 4 }
  store.setTool('platform')
  return store
}

const values = (store: EditorStore) =>
  (buildContextBar(store) ?? []).flatMap((item) => (item.kind === 'value' || item.kind === 'label' ? [item.text] : []))

describe('the platform tool', () => {
  it('lays a platform and its station in two clicks, as one undo step', () => {
    const store = storeWithTrack()
    expect(clickPlatformTool(store, { x: 20, y: -4 }).result).toBe('started')
    expect(store.platformStart).not.toBeNull()
    expect(store.network.platforms.size).toBe(0)

    store.cursorWorld = { x: 220, y: -4 }
    expect(values(store)).toContain('200.00 m')
    expect(platformPreviewDrawing(store)?.platforms).toHaveLength(1)

    const click = clickPlatformTool(store, { x: 220, y: -4 })
    expect(click.result).toBe('placed')
    expect(store.platformStart).toBeNull()
    expect(store.network.platforms.size).toBe(1)
    const [platform] = store.network.platforms.values()
    expect(platform.edges[0].side).toBe('left')
    const station = store.network.stations.get(platform.stationId)!
    expect(station.name).toBe('Gare 1')
    expect(store.canUndo).toBe(true)

    store.undo()
    expect(store.network.stations.size).toBe(0)
  })

  it.skip('undo takes the platform back (waits for the platforms in the saved project, lot Q0)', () => {
    const store = storeWithTrack()
    clickPlatformTool(store, { x: 20, y: -4 })
    clickPlatformTool(store, { x: 220, y: -4 })
    store.undo()
    expect(store.network.platforms.size).toBe(0)
    store.redo()
    expect(store.network.platforms.size).toBe(1)
  })

  it('lays one platform on each side while Shift is held, or with the toggle', () => {
    const store = storeWithTrack()
    store.setPlatformShiftHeld(true)
    clickPlatformTool(store, { x: 20, y: -4 })
    clickPlatformTool(store, { x: 220, y: -4 })
    expect([...store.network.platforms.values()].map((p) => p.edges[0].side).sort()).toEqual(['left', 'right'])
    expect(store.network.stations.size).toBe(1)

    // The toggle on, Shift turns it back off
    store.setPlatformBothSides(true)
    expect(store.platformBothSidesActive).toBe(false)
    store.setPlatformShiftHeld(false)
    expect(store.platformBothSidesActive).toBe(true)
  })

  it('lays an island between two tracks far enough apart, and says why not when they are too close', () => {
    const wide = storeWithTrack(10)
    clickPlatformTool(wide, { x: 20, y: 5 })
    clickPlatformTool(wide, { x: 220, y: 5 })
    const [island] = wide.network.platforms.values()
    expect(island.edges).toHaveLength(2)

    resetMemoryStorage()
    const narrow = storeWithTrack(3.8)
    clickPlatformTool(narrow, { x: 20, y: 2 })
    narrow.cursorWorld = { x: 220, y: 2 }
    const preview = resolvePlatformTool(narrow)
    expect(preview?.phase === 'end' && preview.plan?.island).toMatchObject({ ok: false })
    expect(values(narrow).some((text) => text.startsWith('Voies trop proches pour un quai central (3.80 m, il faut 6.40 m)'))).toBe(true)
    expect(islandRefusalText({ spacing: 3.8, minSpacing: 6.4, ok: false }, 'm')).toBe('Voies trop proches pour un quai central (3.80 m, il faut 6.40 m)')
  })

  it('shows the rakes the platform would hold', () => {
    expect(rakeFitText(100)).toBe('TGV Duplex ✗ UM ✗ · TGV M ✗ UM ✗ · TER Régiolis ✓ UM ✗')
  })

  it('needs the track for its first click; Escape drops the start, then leaves the tool', () => {
    const store = storeWithTrack()
    expect(clickPlatformTool(store, { x: 20, y: -60 }).result).toBe('off-track')
    clickPlatformTool(store, { x: 20, y: -4 })
    store.cancelInteraction()
    expect(store.platformStart).toBeNull()
    expect(store.tool).toBe('platform')
    store.cancelInteraction()
    expect(store.tool).toBe('select')
  })

  it('is refused while driving', () => {
    const store = storeWithTrack()
    // Driving, as `togglePlayMode` leaves it once a train is laid
    store.isPlayMode = true
    expect(clickPlatformTool(store, { x: 20, y: -4 }).result).toBe('refused')
    expect(store.network.platforms.size).toBe(0)
  })
})
