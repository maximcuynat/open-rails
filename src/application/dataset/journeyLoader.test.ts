import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { fakeDataset } from './dataset.testkit'
import { resetDatasetIndexCache } from './datasetClient'
import { loadJourney, reloadDataset } from './journeyLoader'

function serving(bodies: Record<string, unknown>, fail = false): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (fail) throw new TypeError('Failed to fetch')
    const url = String(input)
    const body = bodies[url.slice(url.lastIndexOf('/') + 1)]
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
}

describe('loading a journey of the dataset', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  it('fetches the lines of the route and hands the store a locked, named, framed project', async () => {
    const { index, files, rails } = fakeDataset()
    const store = new EditorStore()
    const progress = vi.fn()
    const route = await loadJourney(store, index, ['s1', 's2'], { fetch: serving(files), baseUrl: '/', onProgress: progress })
    expect(route.lines).toEqual(['a', 'b'])
    expect(store.isNetworkLocked).toBe(true)
    expect(store.dataset).toEqual({ version: 1, dataDate: index.dataDate, lines: ['a', 'b'], stations: ['s1', 's2'] })
    expect(store.network.segments.size).toBe(rails)
    expect(store.projectName).toBe('Gare Un → Gare Deux')
    expect(store.osmSource?.frame).toBe('lambert93')
    expect(store.selectedStationId).toBe('s1')
    expect(store.camera.x).toBe(1000)
    expect(store.camera.y).toBe(30)
    expect(store.datasetLoader).not.toBeNull()
    expect(store.datasetIndex).toBe(index)
    expect(progress.mock.calls.map((c) => c[0])).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })

  it('refuses a journey without a route and leaves the store as it was', async () => {
    const { index, files } = fakeDataset()
    const store = new EditorStore()
    await expect(loadJourney(store, index, ['s1', 's3'], { fetch: serving(files), baseUrl: '/' })).rejects.toMatchObject({ kind: 'no-route', message: /Gare Un et Gare Isolée/ })
    expect(store.isNetworkLocked).toBe(false)
    expect(store.network.segments.size).toBe(0)
  })

  it('fetches the lines of a saved recipe again, with its trains and camera', async () => {
    const { index, files, rails } = fakeDataset()
    const store = new EditorStore()
    await loadJourney(store, index, ['s1', 's2'], { fetch: serving(files), baseUrl: '/' })
    expect(store.placeTrainItem({ x: 300, y: 0 })).toBe(true)
    store.camera.x = 777
    store.flushPersistedState()

    const again = new EditorStore()
    expect(again.datasetReloadPending).toBe(true)
    await reloadDataset(again, { fetch: serving({ ...files, 'index.json': index }), baseUrl: '/' })
    expect(again.datasetReloadPending).toBe(false)
    expect(again.isNetworkLocked).toBe(true)
    expect(again.network.segments.size).toBe(rails)
    expect(again.trains.length).toBe(1)
    expect(again.network.segments.has(again.trains[0].vehicles[0].front.segId)).toBe(true)
    expect(again.camera.x).toBe(777)
    expect(again.projectName).toBe('Gare Un → Gare Deux')
    expect(again.datasetLoader).not.toBeNull()
  })

  it('says it is offline and keeps the recipe for a later try', async () => {
    const { index, files } = fakeDataset()
    const store = new EditorStore()
    await loadJourney(store, index, ['s1', 's2'], { fetch: serving(files), baseUrl: '/' })
    store.flushPersistedState()

    const again = new EditorStore()
    await expect(reloadDataset(again, { fetch: serving({}, true), baseUrl: '/' })).rejects.toMatchObject({ kind: 'offline', message: /connexion/ })
    expect(again.isNetworkLocked).toBe(true)
    expect(again.dataset?.lines).toEqual(['a', 'b'])
    expect(again.network.segments.size).toBe(0)
    expect(again.datasetReloadPending).toBe(true)
  })
})
