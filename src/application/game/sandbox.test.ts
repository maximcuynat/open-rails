import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { fakeDataset } from '@application/dataset/dataset.testkit'
import { resetDatasetIndexCache } from '@application/dataset/datasetClient'
import { resetIdCounter } from '@domain/models/network'
import { ROLLING_STOCK } from '@domain/models/rollingStock'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { prepareSandbox, SANDBOX_TRAINS, SandboxError, sandboxErrorMessage } from './sandbox'

function serving(bodies: Record<string, unknown>, fail = false): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (fail) throw new TypeError('Failed to fetch')
    const url = String(input)
    const body = bodies[url.slice(url.lastIndexOf('/') + 1)]
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
}

describe('starting a sandbox game', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  it('loads the lines of the station only, with a complete rake at its platform, selected and in view', async () => {
    const { index, files } = fakeDataset()
    const store = new EditorStore()
    const start = await prepareSandbox(store, index, 's1', 'duplex', { fetch: serving(files), baseUrl: '/' })
    expect(start.stationName).toBe('Gare Un')
    expect(store.dataset).toEqual({ version: 1, dataDate: index.dataDate, lines: ['a'], stations: ['s1'] })
    expect(store.projectName).toBe('Gare Un')
    expect(store.isNetworkLocked).toBe(true)
    expect(store.trains).toHaveLength(1)
    const train = store.trains[0]
    expect(train.vehicles).toHaveLength(ROLLING_STOCK.duplex.trailerCount + 2)
    expect(train.vehicles[0].front.segId).toBe(start.stop.segId)
    expect(store.selectedTrain).toBe(train)
    // The camera on the head of the rake (the stop, at x = 250), close enough for the bogies
    expect(store.camera.x).toBeCloseTo(250, 3)
    expect(store.camera.y).toBeCloseTo(0, 3)
    expect(store.camera.scale).toBeGreaterThanOrEqual(3.5)
    // Not driving yet: the player chooses a console first, then takes the controls
    expect(store.isPlayMode).toBe(false)
    store.togglePlayMode()
    expect(store.isPlayMode).toBe(true)
    store.togglePlayMode()
  })

  it('starts again from another station while a game is being driven', async () => {
    const { index, files } = fakeDataset()
    const store = new EditorStore()
    const options = { fetch: serving(files), baseUrl: '/' }
    await prepareSandbox(store, index, 's1', 'duplex', options)
    store.togglePlayMode()
    await prepareSandbox(store, index, 's2', 'tgvm', options)
    expect(store.isPlayMode).toBe(false)
    expect(store.dataset?.lines).toEqual(['b'])
    expect(store.trains).toHaveLength(1)
    expect(store.trains[0].vehicles[0].model).toBe('tgvm')
  })

  it('leaves the store as it was when the download fails', async () => {
    const { index } = fakeDataset()
    const store = new EditorStore()
    const failure = await prepareSandbox(store, index, 's1', 'duplex', { fetch: serving({}, true), baseUrl: '/' }).catch((e: unknown) => e)
    expect(sandboxErrorMessage(failure)).toMatch(/connexion/)
    expect(store.isNetworkLocked).toBe(false)
    expect(store.trains).toHaveLength(0)
  })

  it('says so when the station holds no rake, the station staying loaded', async () => {
    const { index, files } = fakeDataset()
    // The station as a file without its platform stops would give it
    const short = structuredClone(files)
    for (const station of short['a.json'].stations ?? []) station.stops = []
    const store = new EditorStore()
    const failure = await prepareSandbox(store, index, 's1', 'duplex', { fetch: serving(short), baseUrl: '/' }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(SandboxError)
    expect(sandboxErrorMessage(failure)).toMatch(/Gare Un/)
    expect(store.isNetworkLocked).toBe(true)
    expect(store.trains).toHaveLength(0)
  })

  it('offers the TGV rakes, and the TER as a train to come', () => {
    expect(SANDBOX_TRAINS.filter((t) => t.model).map((t) => t.model)).toEqual(['duplex', 'tgvm'])
    expect(SANDBOX_TRAINS[SANDBOX_TRAINS.length - 1]).toMatchObject({ id: 'ter', detail: 'Bientôt disponible' })
  })
})
