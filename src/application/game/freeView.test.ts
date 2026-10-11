import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { fakeDataset } from '@application/dataset/dataset.testkit'
import { resetDatasetIndexCache } from '@application/dataset/datasetClient'
import { addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import { createRakeAtTrack, rakeLength } from '@domain/models/rakePlacement'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { prepareSandbox } from './sandbox'

function serving(bodies: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = bodies[url.slice(url.lastIndexOf('/') + 1)]
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
}

/** A game started at « Gare Un », its train being driven from this screen */
async function driving() {
  const { index, files } = fakeDataset()
  const store = new EditorStore()
  await prepareSandbox(store, index, 's1', 'regiolis', { fetch: serving(files), baseUrl: '/' })
  store.togglePlayMode()
  return { store, train: store.trains[0] }
}

describe('leaving a train to its pilot and looking elsewhere', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  it('is refused for a train nobody would drive, allowed once the pilot holds it', async () => {
    const { store, train } = await driving()
    expect(store.leaveTrain()).toBe(false)
    expect(store.selectedTrain).toBe(train)
    expect(store.isFreeView).toBe(false)
    store.setAutopilot(train.id, true)
    expect(store.leaveTrain()).toBe(true)
    expect(store.selectedTrain).toBeNull()
    expect(store.isFreeView).toBe(true)
    expect(store.isPlayMode).toBe(true)
    expect(store.followLocomotiveCamera).toBe(false)
    // The pilot still holds it, and the simulation goes on without a train on this screen
    expect(store.autopilots.has(train.id)).toBe(true)
    for (let i = 0; i < 200; i++) store.tickAllTrains(0.05)
    expect(train.currentSpeed).toBeGreaterThan(0)
    // A real network has no other mode: what would leave the game stops the time, the view stays free
    store.togglePlayMode()
    expect([store.isFreeView, store.isPaused]).toEqual([true, true])
  })

  it('takes a train back with the view on it', async () => {
    const { store, train } = await driving()
    store.setAutopilot(train.id, true)
    store.leaveTrain()
    store.spectateTrain(train.id)
    expect(store.selectedTrain).toBe(train)
    expect(store.isFreeView).toBe(false)
    expect(store.followLocomotiveCamera).toBe(true)
    expect(store.autopilots.has(train.id)).toBe(true)
    store.togglePlayMode()
  })

  it('sets another train down on the track with a click, the first going on', async () => {
    const { store, train } = await driving()
    store.setAutopilot(train.id, true)
    store.leaveTrain()
    store.armRakePlacement({ model: 'duplex' })
    // Off the track: nothing
    expect(store.placeRakeAt({ x: 700, y: 4000 }, 'duplex')).toBe(false)
    expect(store.rakePlacement).toEqual({ model: 'duplex' })
    // On the branch of line a, clear of the first train
    expect(store.placeRakeAt({ x: 1250, y: 30 }, 'duplex')).toBe(true)
    expect(store.rakePlacement).toBeNull()
    expect(store.trains).toHaveLength(2)
    const second = store.trains[1]
    expect(new Set(store.trains.map((t) => t.id)).size).toBe(2)
    expect(store.selectedTrain).toBe(second)
    expect(store.isFreeView).toBe(false)
    expect(second.currentSpeed).toBe(0)
    expect(second.itinerary).toBeUndefined()
    expect(store.autopilots.has(train.id)).toBe(true)
    store.togglePlayMode()
  })

  it('never lets a rail be laid while trains run', async () => {
    const { store } = await driving()
    for (const tool of ['place', 'curve', 'turnout'] as const) {
      store.setTool(tool)
      expect(store.tool).not.toBe(tool)
    }
    store.setTool('pan')
    expect(store.tool).toBe('pan')
    store.togglePlayMode()
  })

  it('refuses the tools that lay track while trains run on a project that is not locked either', () => {
    const store = new EditorStore()
    const a = addNode(store.network, { x: 0, y: 0 })
    const b = addNode(store.network, { x: 2000, y: 0 })
    addSegment(store.network, a.id, b.id)
    store.notify()
    expect(store.placeRakeAt({ x: 1000, y: 0 }, 'regiolis')).toBe(true)
    store.setTool('place')
    expect(store.tool).toBe('place')
    store.setTool('select')
    store.togglePlayMode()
    store.setTool('place')
    expect(store.tool).toBe('select')
    store.togglePlayMode()
  })
})

describe('a rake set down anywhere on the track', () => {
  it('faces the way with most track ahead, and is refused where it does not fit or where a train stands', () => {
    resetIdCounter()
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 3000, y: 0 })
    const rail = addSegment(net, a.id, b.id)!
    const first = createRakeAtTrack(net, rail.id, 0.2, 'duplex')!
    // 600 m from one end, 2 400 m from the other: its head towards the long side
    expect(first.vehicles[0].front.t).toBeGreaterThan(first.vehicles[first.vehicles.length - 1].rear.t)
    expect(createRakeAtTrack(net, rail.id, 0.6, 'duplex', [first])).toBeNull()
    expect(createRakeAtTrack(net, 's_nope', 0.5, 'duplex')).toBeNull()
    const short = createNetwork()
    const c = addNode(short, { x: 0, y: 0 })
    const d = addNode(short, { x: rakeLength('duplex') - 20, y: 0 })
    expect(createRakeAtTrack(short, addSegment(short, c.id, d.id)!.id, 0.5, 'duplex')).toBeNull()
  })
})
