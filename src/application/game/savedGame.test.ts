import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { fakeDataset } from '@application/dataset/dataset.testkit'
import { resetDatasetIndexCache } from '@application/dataset/datasetClient'
import { reloadDataset } from '@application/dataset/journeyLoader'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import type { TrainSet } from '@domain/models/train'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { prepareSandbox } from './sandbox'

function serving(bodies: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = bodies[url.slice(url.lastIndexOf('/') + 1)]
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
}

/** Put a train under way: reverser forward, handle at P3, brakes released, 12 m/s */
function underWay(train: TrainSet): void {
  Object.assign(train, { currentSpeed: 12, reverser: 'forward', notch: 3, brakeCommand: 'release', brakePipe: 5, brakeCylinder: 0 })
}

const controls = (t: TrainSet) => [t.currentSpeed, t.reverser, t.notch, t.brakeCommand, t.brakePipe, t.brakeCylinder]

describe('a game found again after the page was loaded again', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  it('comes back held on a layout of one’s own: speed, handles and pilot as they were', () => {
    const store = new EditorStore()
    const a = addNode(store.network, { x: 0, y: 0 })
    const b = addNode(store.network, { x: 3000, y: 0 })
    addSegment(store.network, a.id, b.id)
    store.placeTrainItem({ x: 500, y: 0 })
    store.togglePlayMode()
    const train = store.selectedTrain!
    underWay(train)
    store.setAutopilot(train.id, true)
    store.flushPersistedState()

    const again = new EditorStore()
    expect(again.isPlayMode).toBe(false)
    expect(controls(again.trains[0])).toEqual(controls(train))
    expect(again.autopilots.has(train.id)).toBe(true)
    expect(again.isSimulationHeld).toBe(true)
    // And an undo step, a saved file, hold nothing of it: only where the trains stand
    expect(JSON.stringify(again.exportProject())).not.toContain('"notch"')
  })

  it('comes back at rest once every train was put at rest', () => {
    const store = new EditorStore()
    const a = addNode(store.network, { x: 0, y: 0 })
    const b = addNode(store.network, { x: 3000, y: 0 })
    addSegment(store.network, a.id, b.id)
    store.placeTrainItem({ x: 500, y: 0 })
    store.togglePlayMode()
    underWay(store.selectedTrain!)
    store.setAutopilot(store.selectedTrain!.id, true)
    store.togglePlayMode()
    store.haltAllTrains()
    store.flushPersistedState()

    const again = new EditorStore()
    expect(again.trains[0].currentSpeed).toBe(0)
    expect(again.autopilots.size).toBe(0)
    expect(again.isSimulationHeld).toBe(false)
  })

  it('comes back in the game, the time stopped, on a real network — in the free view when it was left there', async () => {
    const { index, files } = fakeDataset()
    const options = { fetch: serving({ ...files, 'index.json': index }), baseUrl: '/' }
    const store = new EditorStore()
    await prepareSandbox(store, index, 's1', 'regiolis', options)
    store.togglePlayMode()
    const train = store.selectedTrain!
    underWay(train)
    store.setAutopilot(train.id, true)
    store.leaveTrain()
    store.flushPersistedState()

    const again = new EditorStore()
    expect(again.datasetReloadPending).toBe(true)
    // Twice, as the page does under React's strict mode: the second fetch must not bring the trains back at rest
    await Promise.all([reloadDataset(again, options), reloadDataset(again, options)])
    again.enterGamePaused()
    expect([again.isPlayMode, again.isPaused, again.isFreeView]).toEqual([true, true, true])
    expect(controls(again.trains[0])).toEqual(controls(train))
    expect(again.autopilots.has(train.id)).toBe(true)
    // Nothing moves until the time is let go
    const at = { ...again.trains[0].vehicles[0].front }
    again.simulateFrame(0.05)
    expect(again.trains[0].vehicles[0].front).toEqual(at)
    again.setPaused(false)
    again.simulateFrame(0.05)
    expect(again.trains[0].vehicles[0].front).not.toEqual(at)
  })
})
