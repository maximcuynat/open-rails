import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { fakeDataset } from '@application/dataset/dataset.testkit'
import { resetDatasetIndexCache } from '@application/dataset/datasetClient'
import { resetIdCounter } from '@domain/models/network'
import { ROLLING_STOCK } from '@domain/models/rollingStock'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { addSandboxTrain, canAddSandboxTrain, checkStationFit, prepareSandbox, SANDBOX_TRAINS, SandboxError, sandboxErrorMessage, stationFitMessage } from './sandbox'

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
    // The camera on the lead bogie of the rake, its nose on the stop at x = 250, close enough for the bogies
    expect(store.camera.x).toBeCloseTo(250 - ROLLING_STOCK.duplex.powerCar.noseOverhang, 3)
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

  it('offers the TGV rakes and the TER, each a rake of the table', () => {
    expect(SANDBOX_TRAINS.map((t) => t.model)).toEqual(['duplex', 'tgvm', 'regiolis'])
    for (const train of SANDBOX_TRAINS) expect(ROLLING_STOCK[train.model!].label).toContain(train.name.replace('TER ', '').replace('TGV ', ''))
  })

  it('starts a game with a TER: four cars on five bogies at the platform', async () => {
    const { index, files } = fakeDataset()
    const store = new EditorStore()
    await prepareSandbox(store, index, 's1', 'regiolis', { fetch: serving(files), baseUrl: '/' })
    const train = store.trains[0]
    expect(train.vehicles.map((v) => v.kind)).toEqual(['loco', 'wagon', 'wagon', 'loco'])
    expect(train.vehicles.every((v) => v.model === 'regiolis')).toBe(true)
    expect(train.maxSpeed).toBeCloseTo(160 / 3.6, 6)
    store.togglePlayMode()
    store.togglePlayMode()
  })

  it('adds a train at another station to the game under way, the first going on under its pilot', async () => {
    const { index, files } = fakeDataset()
    const options = { fetch: serving(files), baseUrl: '/' }
    const store = new EditorStore()
    expect(canAddSandboxTrain(store)).toBe(false)
    await prepareSandbox(store, index, 's1', 'duplex', options)
    expect(canAddSandboxTrain(store)).toBe(true)
    const first = store.trains[0]
    store.togglePlayMode()
    store.setAutopilot(first.id, true)
    for (let i = 0; i < 200; i++) store.tickAllTrains(0.05)
    expect(first.currentSpeed).toBeGreaterThan(0)

    // « Gare Deux » is on line b, not loaded: its line is added, nothing is replaced
    const added = await addSandboxTrain(store, index, 's2', 'regiolis', options)
    expect(added.stationName).toBe('Gare Deux')
    expect(store.isPlayMode).toBe(true)
    expect(store.dataset!.lines).toEqual(['a', 'b'])
    expect(store.trains).toHaveLength(2)
    const second = store.trains[1]
    expect(second.vehicles[0].model).toBe('regiolis')
    expect(second.itinerary).toEqual({ stations: ['s2'], next: 1 })
    // This screen is on the new train, at rest with its brakes on; the first keeps its pilot and runs on
    expect(store.selectedTrain).toBe(second)
    expect(second.currentSpeed).toBe(0)
    expect(second.brakeCylinder).toBeGreaterThan(0.5)
    expect(store.autopilots.has(first.id)).toBe(true)
    const before = first.vehicles[0].front
    const at = `${before.segId} ${before.t}`
    for (let i = 0; i < 100; i++) store.tickAllTrains(0.05)
    expect(`${first.vehicles[0].front.segId} ${first.vehicles[0].front.t}`).not.toBe(at)
    expect(second.currentSpeed).toBe(0)
    store.togglePlayMode()
  })

  it('refuses a train where no platform is free, and a station the game does not know', async () => {
    const { index, files } = fakeDataset()
    const options = { fetch: serving(files), baseUrl: '/' }
    const store = new EditorStore()
    await prepareSandbox(store, index, 's1', 'duplex', options)
    // « Gare Un » has one platform track, and a rake stands on it
    await expect(addSandboxTrain(store, index, 's1', 'duplex', options)).rejects.toThrow(/quai libre/)
    await expect(addSandboxTrain(store, index, 'nope', 'duplex', options)).rejects.toBeInstanceOf(SandboxError)
    expect(store.trains).toHaveLength(1)
  })

  it('starts a game with the composition asked for', async () => {
    const { index, files } = fakeDataset()
    const store = new EditorStore()
    await prepareSandbox(store, index, 's1', { model: 'duplex', trailers: 5 }, { fetch: serving(files), baseUrl: '/' })
    expect(store.trains[0].vehicles.map((v) => v.kind)).toEqual(['loco', 'wagon', 'wagon', 'wagon', 'wagon', 'wagon', 'loco'])
  })

  it('says before the launch whether the rake holds at the platforms, without touching the project', async () => {
    const { index, files } = fakeDataset()
    const options = { fetch: serving(files), baseUrl: '/' }
    const store = new EditorStore()
    // « Gare Un » is on a 500 m rail between two plain joints of a 1 500 m line
    const fit = (await checkStationFit(store, index, 's1', 'duplex', options))!
    expect(fit).toMatchObject({ tracks: 1, fitting: 1, placeable: true })
    expect(stationFitMessage(fit)).toMatchObject({ ok: true })
    expect(stationFitMessage(fit).text).toMatch(/tient sur 1 voie de la gare sur 1/)
    expect(store.network.segments.size).toBe(0)
    expect(store.dataset).toBeNull()
    expect(await checkStationFit(store, index, 'nope', 'duplex', options)).toBeNull()

    // In a game under way the trains standing there count, and the ids to come stay clear of theirs
    await prepareSandbox(store, index, 's1', 'duplex', options)
    expect((await checkStationFit(store, index, 's1', 'regiolis', options))!.placeable).toBe(false)
    await checkStationFit(store, index, 's2', 'regiolis', options)
    await addSandboxTrain(store, index, 's2', 'regiolis', options)
    const ids = store.trains.flatMap((t) => [t.id, ...t.vehicles.map((v) => v.id)])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has words for a rake too long for the platforms, and for one that fits nowhere', () => {
    expect(stationFitMessage({ rakeLength: 401, tracks: 3, fitting: 0, longest: 320, placeable: true })).toMatchObject({ ok: false })
    expect(stationFitMessage({ rakeLength: 401, tracks: 3, fitting: 0, longest: 320, placeable: true }).text).toMatch(/dépasse.*320 m/)
    expect(stationFitMessage({ rakeLength: 401, tracks: 0, fitting: 0, longest: 0, placeable: false }).text).toMatch(/aucune voie/)
  })
})
