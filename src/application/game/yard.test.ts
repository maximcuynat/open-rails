import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { fakeDataset } from '@application/dataset/dataset.testkit'
import { resetDatasetIndexCache } from '@application/dataset/datasetClient'
import { resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { prepareSandbox } from './sandbox'

function serving(bodies: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = bodies[url.slice(url.lastIndexOf('/') + 1)]
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
}

/** A game on a real network, started at « Gare Un » with two coupled trainsets driven from this screen */
async function game() {
  const { index, files } = fakeDataset()
  const store = new EditorStore()
  await prepareSandbox(store, index, 's1', { model: 'regiolis', units: 2 }, { fetch: serving(files), baseUrl: '/' })
  store.togglePlayMode()
  return store
}

/** The place of the coupling between the two trainsets of a rake */
const coupling = (store: EditorStore, coupled: true) => store.liveCouplerPoints().find((point) => point.coupled === coupled)!.pos

describe('the rakes of a game on a real network', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  it('has no mode to build in: what leaves the game elsewhere stops and starts the time here', async () => {
    const store = await game()
    expect(store.hasBuildMode).toBe(false)
    store.togglePlayMode()
    expect([store.isPlayMode, store.isPaused]).toEqual([true, true])
    store.togglePlayMode()
    expect([store.isPlayMode, store.isPaused]).toEqual([true, false])
    // Nor is the coupling tool of the editor taken there
    store.toggleCouplingMode()
    expect([store.isPlayMode, store.tool === 'coupling']).toEqual([true, false])
  })

  it('parts a rake at rest and couples it again, the head keeping its pilot, its journey and this screen', async () => {
    const store = await game()
    const whole = store.trains[0]
    const vehicles = whole.vehicles.length
    store.setAutopilot(whole.id, true)
    expect(whole.itinerary).toBeDefined()

    // Not armed: a click does nothing
    expect(store.handleCouplingClick(coupling(store, true))).toBe('nothing')
    store.armCoupling(true)

    whole.currentSpeed = 5
    expect(store.handleCouplingClick(coupling(store, true))).toBe('moving')
    expect(store.trains).toEqual([whole])
    whole.currentSpeed = 0

    const joint = coupling(store, true)
    expect(store.handleCouplingClick(joint)).toBe('done')
    expect(store.trains).toHaveLength(2)
    const [head, tail] = store.trains
    expect(head.vehicles[0].id).toBe(whole.vehicles[0].id)
    expect(head.vehicles.length + tail.vehicles.length).toBe(vehicles)
    expect(store.selectedTrain).toBe(head)
    expect([...store.autopilots.keys()]).toEqual([head.id])
    expect(head.itinerary).toEqual(whole.itinerary)
    expect(tail.itinerary).toBeUndefined()
    expect(store.isPlayMode).toBe(true)

    expect(store.handleCouplingClick(joint)).toBe('done')
    expect(store.trains).toHaveLength(1)
    const again = store.trains[0]
    expect(again.vehicles).toHaveLength(vehicles)
    expect(store.selectedTrain).toBe(again)
    expect([...store.autopilots.keys()]).toEqual([again.id])
    expect(again.itinerary).toEqual(whole.itinerary)
  })

  it('takes a train out of the game: never the last one, never one that moves', async () => {
    const store = await game()
    expect(store.removeTrainInGame(store.trains[0].id)).toBe('last')
    store.armCoupling(true)
    store.handleCouplingClick(coupling(store, true))
    const [head, tail] = store.trains
    store.setAutopilot(tail.id, true)

    tail.currentSpeed = 3
    expect(store.removeTrainInGame(tail.id)).toBe('moving')
    tail.currentSpeed = 0
    expect(store.removeTrainInGame(tail.id)).toBe('done')
    expect(store.trains).toEqual([head])
    expect(store.autopilots.has(tail.id)).toBe(false)
    expect(store.selectedTrain).toBe(head)
  })

  it('leaves this screen on no train when its own train is taken out', async () => {
    const store = await game()
    store.armCoupling(true)
    store.handleCouplingClick(coupling(store, true))
    const [head, tail] = store.trains
    expect(store.removeTrainInGame(head.id)).toBe('done')
    expect(store.trains).toEqual([tail])
    expect(store.isFreeView).toBe(true)
  })

  it('comes back with the time stopped when a game is found again', async () => {
    const store = await game()
    // As after a page loaded again: the trains are there, nothing runs
    store.isPlayMode = false
    store.enterGamePaused()
    expect([store.isPlayMode, store.isPaused]).toEqual([true, true])
  })
})
