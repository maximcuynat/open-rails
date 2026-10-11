import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { buildTrainConsoleState } from '@application/console/consoleState'
import { fakeDataset } from '@application/dataset/dataset.testkit'
import { fetchLineFiles, resetDatasetIndexCache } from '@application/dataset/datasetClient'
import { resetIdCounter } from '@domain/models/network'
import { advanceTrainSet } from '@domain/models/train'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { decodeMessage, encodeMessage } from '@application/remote/protocol'
import { addItineraryStop, buildItineraryView, refreshRouteGuide, removeItineraryStop } from './itinerary'
import { prepareSandbox } from './sandbox'

function serving(bodies: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = bodies[url.slice(url.lastIndexOf('/') + 1)]
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
}

/** A sandbox game started at « Gare Un » (x = 250 on line a; « Gare Deux » is at x = 1750 on line b, not loaded) */
async function started() {
  const { index, files } = fakeDataset()
  const options = { fetch: serving(files), baseUrl: '/' }
  const store = new EditorStore()
  await prepareSandbox(store, index, 's1', 'duplex', options)
  return { store, index, train: store.trains[0], options }
}

describe('the itinerary of a train in a game', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  it('starts at the station of the sandbox, with nothing ahead', async () => {
    const { store, train } = await started()
    expect(train.itinerary).toEqual({ stations: ['s1'], next: 1 })
    expect(buildItineraryView(store, train)).toMatchObject({ origin: 'Gare Un', stops: [], next: null, destination: null, status: 'ok' })
    expect(buildTrainConsoleState(store, train).route).toBeUndefined()
  })

  it('leads to the gate of a line not loaded, then to the platform once it is', async () => {
    const { store, index, train, options } = await started()
    expect(addItineraryStop(store, train, 's2')).toBeNull()
    let view = buildItineraryView(store, train)!
    expect(view).toMatchObject({ next: 'Gare Deux', destination: 'Gare Deux', exact: false, status: 'ok', platform: null })
    // 750 m of track to the gate at x = 1000, then 750 m as the crow flies
    expect(view.distance).toBeCloseTo(1500, 0)
    expect(store.routeGuides.get(train.id)?.guide?.target).toBe('gate')

    store.addDatasetLines(await fetchLineFiles(index, ['b'], undefined, options))
    refreshRouteGuide(store, train)
    view = buildItineraryView(store, train)!
    expect(view).toMatchObject({ exact: true, status: 'ok' })
    expect(view.distance).toBeCloseTo(1500, 3)
    expect(view.total).toBeCloseTo(1500, 3)

    // The console is told, and what it is told crosses to a phone
    const state = buildTrainConsoleState(store, train)
    expect(state.route).toMatchObject({ next: 'Gare Deux', destination: 'Gare Deux', exact: true, status: 'ok' })
    const read = decodeMessage(encodeMessage({ t: 'state', state, ack: 0 }))
    expect(read.ok && read.message.t === 'state' ? read.message.state?.route : null).toEqual(state.route)
  })

  it('follows the train along the way, and moves on once it has stopped at the platform', async () => {
    const { store, index, train, options } = await started()
    addItineraryStop(store, train, 's2')
    store.addDatasetLines(await fetchLineFiles(index, ['b'], undefined, options))
    expect(advanceTrainSet(store.network, train, 600)).toBe(true)
    expect(refreshRouteGuide(store, train)).toBe(false)
    expect(buildItineraryView(store, train)!.distance).toBeCloseTo(900, 3)

    // Running through at speed is not a call
    advanceTrainSet(store.network, train, 890)
    train.currentSpeed = 20
    expect(refreshRouteGuide(store, train)).toBe(false)
    train.currentSpeed = 0
    expect(refreshRouteGuide(store, train)).toBe(true)
    expect(train.itinerary).toEqual({ stations: ['s1', 's2'], next: 2 })
    expect(buildItineraryView(store, train)).toMatchObject({ origin: 'Gare Deux', next: null, status: 'arrived' })
    expect(buildTrainConsoleState(store, train).route).toMatchObject({ next: null, status: 'arrived' })
  })

  it('finds the way again when the train leaves it', async () => {
    const { store, index, train, options } = await started()
    addItineraryStop(store, train, 's2')
    store.addDatasetLines(await fetchLineFiles(index, ['b'], undefined, options))
    // Past the station: the way is now behind
    advanceTrainSet(store.network, train, 1700)
    refreshRouteGuide(store, train)
    expect(buildItineraryView(store, train)).toMatchObject({ status: 'behind', exact: true })
  })

  it('refuses a station no line leads to, and takes a station out', async () => {
    const { store, train } = await started()
    expect(addItineraryStop(store, train, 's3')).toMatch(/Gare Isolée/)
    expect(train.itinerary!.stations).toEqual(['s1'])
    expect(addItineraryStop(store, train, 'nope')).toBe('Gare inconnue.')
    addItineraryStop(store, train, 's2')
    removeItineraryStop(store, train, 1)
    expect(train.itinerary).toEqual({ stations: ['s1'], next: 1 })
    expect(store.routeGuides.has(train.id)).toBe(false)
  })

  it('is saved with the train', async () => {
    const { store, train } = await started()
    addItineraryStop(store, train, 's2')
    const saved = store.exportProject()
    expect(saved.trains?.[0].itinerary).toEqual({ stations: ['s1', 's2'], next: 1 })
  })
})
