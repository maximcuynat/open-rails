import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { getStorage, resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { listProjects } from '@infrastructure/persistence/projectLibrary'
import { FIRST_PROJECT_ID, gameKeyOf, LEGACY_NETWORK_KEY, networkKeyOf } from '@infrastructure/persistence/storageKeys'
import { fakeDataset } from '@application/dataset/dataset.testkit'
import { resetDatasetIndexCache } from '@application/dataset/datasetClient'
import { loadJourney, reloadDataset } from '@application/dataset/journeyLoader'

/** A store whose project holds one rail of 50 m, written */
function drawnStore(name = 'Ma ligne'): EditorStore {
  const store = new EditorStore()
  const a = addNode(store.network, { x: 0, y: 0 })
  const b = addNode(store.network, { x: 50, y: 0 })
  addSegment(store.network, a.id, b.id)
  store.projectName = name
  store.markDirty()
  return store
}

describe('the projects of the library in the store', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
    resetDatasetIndexCache()
  })

  it('starts blank with no project, and gives the first one written the keys of v0.5', () => {
    const store = new EditorStore()
    expect(store.projectId).toBeNull()
    const drawn = drawnStore()
    expect(drawn.projectId).toBe(FIRST_PROJECT_ID)
    expect(getStorage()!.getItem(LEGACY_NETWORK_KEY)).toContain('Ma ligne')
  })

  it('opens again the project opened last', () => {
    const first = drawnStore('A')
    first.newProject()
    const b = addNode(first.network, { x: 0, y: 0 })
    const c = addNode(first.network, { x: 0, y: 80 })
    addSegment(first.network, b.id, c.id)
    first.projectName = 'B'
    first.markDirty()
    const again = new EditorStore()
    expect(again.projectId).toBe(first.projectId)
    expect(again.projectName).toBe('B')
  })

  it('never clears a stored project on « Nouveau »: the project left stays in the library', () => {
    const store = drawnStore('Ma ligne')
    const kept = getStorage()!.getItem(LEGACY_NETWORK_KEY)
    store.newProject()
    expect(store.projectId).not.toBe(FIRST_PROJECT_ID)
    expect(store.network.segments.size).toBe(0)
    expect(getStorage()!.getItem(LEGACY_NETWORK_KEY)).toBe(kept)
    expect(listProjects().map((p) => p.name)).toContain('Ma ligne')
  })

  it('writes the project left, even a change still waiting, and opens the other with its own track', () => {
    const store = drawnStore('A')
    const first = store.projectId!
    store.newProject()
    const second = store.projectId!
    const n = addNode(store.network, { x: 0, y: 0 })
    const m = addNode(store.network, { x: 0, y: 80 })
    addSegment(store.network, n.id, m.id)
    addSegment(store.network, m.id, addNode(store.network, { x: 0, y: 160 }).id)
    store.markDirty()
    expect(store.openProject(first)).toBe(true)
    expect(store.network.segments.size).toBe(1)
    expect(store.openProject(second)).toBe(true)
    expect(store.network.segments.size).toBe(2)
    expect(store.openProject('absent')).toBe(false)
    expect(store.projectId).toBe(second)
  })

  it('does not let undo cross from one project to another', () => {
    const store = drawnStore('A')
    const first = store.projectId!
    store.newProject()
    store.openProject(first)
    expect(store.canUndo).toBe(false)
    expect(store.network.segments.size).toBe(1)
  })

  it('keeps the game of each project under that project, never in another', () => {
    const store = drawnStore('A')
    const first = store.projectId!
    store.newProject()
    // What A's trains were doing, as A left it
    getStorage()!.setItem(gameKeyOf(first), 'game of A')
    store.flushPersistedState()
    expect(gameKeyOf(store.projectId!)).not.toBe(gameKeyOf(first))
    expect(getStorage()!.getItem(gameKeyOf(first))).toBe('game of A')
  })

  it('opens a file as a project of its own, and changes nothing when the file does not read', () => {
    const store = drawnStore('A')
    const first = store.projectId!
    expect(() => store.loadFromData({ version: 999 })).toThrow()
    expect(store.projectId).toBe(first)
    expect(store.network.segments.size).toBe(1)
    expect(listProjects()).toHaveLength(1)

    store.loadFromData(JSON.parse(JSON.stringify(store.exportProject())))
    expect(store.projectId).not.toBe(first)
    expect(listProjects()).toHaveLength(2)
    expect(getStorage()!.getItem(networkKeyOf(first))).not.toBeNull()
  })

  it('forgets a failed write when another project is opened (they share one storage)', () => {
    const store = drawnStore('A')
    const first = store.projectId!
    store.autosaveFailed = true
    store.newProject()
    expect(store.autosaveFailed).toBe(false)
    store.openProject(first)
    expect(store.autosaveFailed).toBe(false)
  })

  it('drops the lines of a recipe fetched again when another project was opened meanwhile', async () => {
    const { index, files } = fakeDataset()
    const serving = (async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = ({ ...files, 'index.json': index } as Record<string, unknown>)[url.slice(url.lastIndexOf('/') + 1)]
      return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch
    const store = new EditorStore()
    await loadJourney(store, index, ['s1', 's2'], { fetch: serving, baseUrl: '/' })
    store.flushPersistedState()
    const recipeProject = store.projectId!

    const again = new EditorStore()
    expect(again.projectId).toBe(recipeProject)
    expect(again.datasetReloadPending).toBe(true)
    const reload = reloadDataset(again, { fetch: serving, baseUrl: '/' })
    again.newProject()
    await reload
    expect(again.projectId).not.toBe(recipeProject)
    expect(again.dataset).toBeNull()
    expect(again.network.segments.size).toBe(0)
  })
})
