import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { buildContextBar } from '@presentation/components/contextbar/contextBarModel'
import { clickPlatformTemplate, platformTemplateDrawing, resolvePlatformTemplate } from './platformTemplateTool'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

/** A store with a straight track along y = 0 from x = 0 to 800, and optionally another along y = `other` */
function storeWithTrack(other: number | null = null): EditorStore {
  const store = new EditorStore()
  const net = store.network
  addSegment(net, addNode(net, { x: 0, y: 0 }).id, addNode(net, { x: 800, y: 0 }).id)
  if (other !== null) addSegment(net, addNode(net, { x: 0, y: other }).id, addNode(net, { x: 800, y: other }).id)
  store.markDirty()
  store.camera = { x: 400, y: 0, scale: 2 }
  store.setTool('platform')
  return store
}

const texts = (store: EditorStore) =>
  (buildContextBar(store) ?? []).flatMap((item) => (item.kind === 'value' || item.kind === 'label' ? [item.text] : []))
const action = (store: EditorStore, id: string) => {
  const item = (buildContextBar(store) ?? []).find((it) => it.kind === 'action' && it.id === id)
  return item?.kind === 'action' ? item : null
}

describe('the station templates of the platform tool', () => {
  it('are offered in the bar of the platform tool, and taken from there', () => {
    const store = storeWithTrack()
    const toggle = action(store, 'platform-template-islandLoop')!
    expect(toggle.label).toBe('Évitement à quai central')
    expect(action(store, 'platform-template-sidePlatforms')!.label).toBe('Gare à deux quais latéraux')
    toggle.run()
    expect(store.platformTemplate).toBe('islandLoop')
    expect(action(store, 'platform-template-islandLoop')!.active).toBe(true)
    expect(texts(store)).toContain('Gabarit de gare')
  })

  it('lay an island loop in one click, as one undo step that redo lays again', () => {
    const store = storeWithTrack()
    store.setPlatformTemplate('islandLoop')
    store.cursorWorld = { x: 400, y: -5 }
    expect(resolvePlatformTemplate(store)?.preview.valid).toBe(true)
    expect(texts(store)).toContain('220,00 m')
    expect(texts(store)).toContain('9,40 m')
    const drawing = platformTemplateDrawing(store)!
    expect(drawing.rails).toHaveLength(5)
    expect(drawing.outlines).toHaveLength(1)
    expect(drawing.refused).toBe(false)

    const click = clickPlatformTemplate(store, { x: 400, y: -5 })
    expect(click.result).toBe('placed')
    expect(store.network.segments.size).toBe(8)
    expect(store.network.platforms.size).toBe(1)
    expect(store.network.stations.size).toBe(1)
    const [island] = store.network.platforms.values()
    expect(island.edges).toHaveLength(2)
    // `notify` settled the stops from the markers and proposed the two sets of points
    expect(store.network.stations.get(island.stationId)!.stops).toHaveLength(4)
    expect(store.network.junctions.size).toBe(2)

    store.undo()
    expect(store.network.segments.size).toBe(1)
    expect(store.network.platforms.size).toBe(0)
    expect(store.network.stations.size).toBe(0)
    store.redo()
    expect(store.network.segments.size).toBe(8)
    expect(store.network.platforms.size).toBe(1)
    expect(store.network.stations.size).toBe(1)
  })

  it('lay two side platforms on a double track, and say why not on a single track', () => {
    const single = storeWithTrack()
    single.setPlatformTemplate('sidePlatforms')
    single.cursorWorld = { x: 400, y: 2 }
    expect(texts(single)).toContain('Pas de seconde voie à côté (double voie ou évitement)')
    expect(clickPlatformTemplate(single, { x: 400, y: 2 }).result).toBe('invalid')
    expect(single.network.platforms.size).toBe(0)

    const store = storeWithTrack(4)
    store.setPlatformTemplate('sidePlatforms')
    expect(clickPlatformTemplate(store, { x: 400, y: 2 }).result).toBe('placed')
    expect(store.network.platforms.size).toBe(2)
    expect(store.network.stations.size).toBe(1)
    store.undo()
    expect(store.network.platforms.size).toBe(0)
    store.redo()
    expect(store.network.platforms.size).toBe(2)
  })

  it('says what an island loop needs on a straight too short', () => {
    const store = new EditorStore()
    addSegment(store.network, addNode(store.network, { x: 0, y: 0 }).id, addNode(store.network, { x: 200, y: 0 }).id)
    store.markDirty()
    store.setPlatformTemplate('islandLoop')
    store.cursorWorld = { x: 100, y: -3 }
    expect(texts(store).some((text) => text.startsWith('Voie droite trop courte'))).toBe(true)
    expect(clickPlatformTemplate(store, { x: 100, y: -3 }).result).toBe('invalid')
    expect(store.network.segments.size).toBe(1)
  })

  it('Escape puts the template down first, then leaves the tool; another tool drops it', () => {
    const store = storeWithTrack()
    store.setPlatformTemplate('sidePlatforms')
    store.cancelInteraction()
    expect(store.platformTemplate).toBeNull()
    expect(store.tool).toBe('platform')
    store.cancelInteraction()
    expect(store.tool).toBe('select')

    store.setPlatformTemplate('islandLoop')
    expect(store.tool).toBe('platform')
    store.setTool('select')
    expect(store.platformTemplate).toBeNull()
  })
})
