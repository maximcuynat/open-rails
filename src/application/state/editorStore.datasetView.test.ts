import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { fakeDataset } from '@application/dataset/dataset.testkit'
import { resetDatasetIndexCache } from '@application/dataset/datasetClient'
import { openWholeNetwork, reloadDataset } from '@application/dataset/journeyLoader'
import type { LineId } from '@domain/dataset/datasetIndex'
import { resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'

function serving(bodies: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = bodies[url.slice(url.lastIndexOf('/') + 1)]
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
}

/** « Réseau France » opened on the small dataset, with a loader that answers when told to */
async function france() {
  const dataset = fakeDataset()
  const { index, files } = dataset
  const store = new EditorStore()
  store.setViewport(1200, 800)
  await openWholeNetwork(store, { fetch: serving({ ...files, 'index.json': index }), baseUrl: '/' })
  const asked: LineId[][] = []
  const waiting: (() => void)[] = []
  store.datasetLoader = (lines) => {
    asked.push(lines)
    return new Promise((resolve) => {
      waiting.push(() => resolve(new Map(lines.map((id) => [id, files[`${id}.json`] as SerializedProject]))))
    })
  }
  /** Every fetch asked for so far arrives */
  const arrive = async (): Promise<void> => {
    for (const release of waiting.splice(0)) release()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  /** The camera put there, at that scale (px per metre) */
  const look = (x: number, y: number, scale: number): void => {
    store.camera.x = x
    store.camera.y = y
    store.camera.scale = scale
  }
  return { ...dataset, store, asked, arrive, look }
}

describe('« Réseau France »: the whole dataset, its lines loaded as the view comes near them', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  it('opens locked and empty, with the index and its overview, framed on the country', async () => {
    const { store, index } = await france()
    expect(store.isNetworkLocked).toBe(true)
    expect(store.canEditNetwork).toBe(false)
    expect(store.network.segments.size).toBe(0)
    expect(store.dataset).toEqual({ version: 1, dataDate: index.dataDate, lines: [], stations: [], whole: true })
    expect(store.projectName).toBe('Réseau France')
    expect(store.datasetIndex).toEqual(index)
    expect(store.osmSource?.frame).toBe('lambert93')
    // Framed on every line: from Gare Un to Gare Isolée, 50 km apart
    expect(store.camera.y).toBeCloseTo(25_000)
  })

  it('fetches nothing while the view is far out: the overview is enough there', async () => {
    const { store, asked, look } = await france()
    look(500, 0, 0.5)
    expect(store.isDatasetViewNear).toBe(false)
    store.refreshDatasetLines()
    expect(asked).toEqual([])
  })

  it('fetches the pieces the view meets once it is close enough, and adds them in place', async () => {
    const { store, asked, arrive, look, rails } = await france()
    look(500, 0, 3)
    expect(store.isDatasetViewNear).toBe(true)
    store.refreshDatasetLines()
    // a and b are in view and its margin; d, 50 km away, is not
    expect(asked).toEqual([['a', 'b']])
    expect(store.datasetPending.size).toBe(2)
    // Asked once: a second check while they are on their way asks nothing more
    store.refreshDatasetLines()
    expect(asked).toHaveLength(1)
    await arrive()
    expect(store.dataset!.lines).toEqual(['a', 'b'])
    expect(store.network.segments.size).toBe(rails)
    expect(store.datasetPending.size).toBe(0)
  })

  it('drops the pieces far from the view and from every train, the last one too', async () => {
    const { store, arrive, look } = await france()
    look(500, 0, 3)
    store.refreshDatasetLines()
    await arrive()
    look(250, 50_000, 3)
    store.refreshDatasetLines()
    expect(store.dataset!.lines).toEqual([])
    expect(store.network.segments.size).toBe(0)
    await arrive()
    expect(store.dataset!.lines).toEqual(['d'])
  })

  it('keeps the pieces a train stands on or is near, however far the view goes', async () => {
    const { store, arrive, look } = await france()
    look(500, 0, 3)
    store.refreshDatasetLines()
    await arrive()
    expect(store.placeTrainItem({ x: 300, y: 0 })).toBe(true)
    look(250, 50_000, 3)
    store.refreshDatasetLines()
    // a under the train, b within reach of it
    expect(store.dataset!.lines).toEqual(['a', 'b'])
    expect(store.trains).toHaveLength(1)
  })

  it('keeps no more pieces than the cap: the nearest is fetched, the one seen longest ago goes first', async () => {
    const { store, asked, arrive, look } = await france()
    store.datasetMaxPieces = 1
    look(200, 0, 3)
    store.refreshDatasetLines()
    // a is nearer the middle of the view than b
    expect(asked).toEqual([['a']])
    await arrive()
    look(1900, 0, 3)
    store.refreshDatasetLines()
    // b is wanted now: a, seen before, makes room for it
    expect(asked[1]).toEqual(['b'])
    expect(store.dataset!.lines).toEqual([])
    await arrive()
    expect(store.dataset!.lines).toEqual(['b'])
  })

  it('does not add to a new project what the previous one asked for', async () => {
    const { store, arrive, look } = await france()
    look(500, 0, 3)
    store.refreshDatasetLines()
    store.newProject()
    await arrive()
    expect(store.network.segments.size).toBe(0)
    expect(store.dataset).toBeNull()
    expect(store.datasetPending.size).toBe(0)
  })

  it('is saved as its recipe and opened again with what was loaded, without the settings of one line', async () => {
    const { store, arrive, look, index, files } = await france()
    look(500, 0, 3)
    store.refreshDatasetLines()
    await arrive()
    store.flushPersistedState()

    const again = new EditorStore()
    expect(again.datasetReloadPending).toBe(true)
    expect(again.dataset).toMatchObject({ whole: true, lines: ['a', 'b'] })
    await reloadDataset(again, { fetch: serving({ ...files, 'index.json': index }), baseUrl: '/' })
    expect(again.isNetworkLocked).toBe(true)
    expect(again.projectName).toBe('Réseau France')
    expect(again.dataset).toMatchObject({ whole: true, lines: ['a', 'b'] })
    expect(again.network.segments.size).toBe(store.network.segments.size)
    expect(again.camera.x).toBe(500)
  })

  it('is opened again empty when nothing was loaded', async () => {
    const { store, index, files } = await france()
    store.flushPersistedState()
    const again = new EditorStore()
    expect(again.datasetReloadPending).toBe(true)
    await reloadDataset(again, { fetch: serving({ ...files, 'index.json': index }), baseUrl: '/' })
    expect(again.isNetworkLocked).toBe(true)
    expect(again.network.segments.size).toBe(0)
    expect(again.datasetIndex).not.toBeNull()
  })
})
