import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { fakeDataset } from '@application/dataset/dataset.testkit'
import { fetchLineFiles, resetDatasetIndexCache } from '@application/dataset/datasetClient'
import { reloadDataset } from '@application/dataset/journeyLoader'
import { recipeLines } from '@domain/dataset/datasetRecipe'
import { boxesMeet, distanceToBox, gatesToward, linesToDrop, piecesOverCap, routeThroughStations, travelWeight, travelWeightFor } from '@domain/dataset/lineRoute'
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

/** A game started at « Gare Un » on line a; line b touches it, line d is 50 km away */
async function started() {
  const { index, files } = fakeDataset()
  const options = { fetch: serving({ ...files, 'index.json': index }), baseUrl: '/' }
  const store = new EditorStore()
  await prepareSandbox(store, index, 's1', 'duplex', options)
  return { store, index, options, train: store.trains[0] }
}

describe('lines of the dataset coming and going as the trains run', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  it('measures from a point to a box, and names the loaded lines far from every train', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 50 }
    expect(distanceToBox(50, 25, box)).toBe(0)
    expect(distanceToBox(130, 90, box)).toBe(50)
    const { index } = fakeDataset()
    const loaded = new Set(['a', 'b', 'd'])
    const at = [{ x: 250, y: 0 }]
    expect(linesToDrop(index, loaded, at, 20_000, new Set())).toEqual(['d'])
    expect(linesToDrop(index, loaded, at, 20_000, new Set(['d']))).toEqual([])
    // A second train near it keeps it; no train at all drops nothing
    expect(linesToDrop(index, loaded, [...at, { x: 0, y: 45_000 }], 20_000, new Set())).toEqual([])
    expect(linesToDrop(index, loaded, [], 20_000, new Set())).toEqual([])
    // A point that reaches further (the view, as far as it shows) keeps what it reaches
    expect(linesToDrop(index, loaded, [{ x: 250, y: 0, keep: 60_000 }], 20_000, new Set())).toEqual([])
  })

  it('tells boxes that meet, and which pieces go past the cap: the ones seen longest ago', () => {
    expect(boxesMeet({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: 10, minY: 5, maxX: 20, maxY: 6 })).toBe(true)
    expect(boxesMeet({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: 11, minY: 5, maxX: 20, maxY: 6 })).toBe(false)
    const seen = new Map([['a', 3], ['b', 1], ['c', 2]])
    expect(piecesOverCap(['a', 'b', 'c'], seen, new Set(), 3)).toEqual([])
    expect(piecesOverCap(['a', 'b', 'c'], seen, new Set(), 2)).toEqual(['b'])
    // Room for one to come; never one held; one never seen is the oldest
    expect(piecesOverCap(['a', 'b', 'c'], seen, new Set(['b']), 2, 1)).toEqual(['c', 'a'])
    expect(piecesOverCap(['a', 'x'], seen, new Set(), 1)).toEqual(['x'])
  })

  it('drops a line in place: its rails go, the rest stays as it was, the recipe follows', async () => {
    const { store, index, options } = await started()
    const kept = [...store.network.segments.values()]
    const before = kept.length
    const added = store.addDatasetLines(await fetchLineFiles(index, ['b', 'd'], undefined, options))
    expect(added).toBeGreaterThan(0)
    expect(store.dataset!.lines).toEqual(['a', 'b', 'd'])
    expect(store.removeDatasetLines(['d'])).toBe(1)
    expect(store.dataset!.lines).toEqual(['a', 'b'])
    expect(store.datasetFiles.has('d')).toBe(false)
    expect(store.network.stations.has('s3')).toBe(false)
    store.removeDatasetLines(['b'])
    expect(store.network.segments.size).toBe(before)
    for (const rail of kept) expect(store.network.segments.get(rail.id)).toEqual(rail)
    expect(store.trains).toHaveLength(1)
  })

  it('never drops the line a train stands on; the last one goes when no train is on it', async () => {
    const { store, index, options } = await started()
    expect(store.removeDatasetLines(['a'])).toBe(0)
    store.addDatasetLines(await fetchLineFiles(index, ['b'], undefined, options))
    expect(store.removeDatasetLines(['a', 'b'])).toBeGreaterThan(0)
    expect(store.dataset!.lines).toEqual(['a'])
    expect(store.trains).toHaveLength(1)
    store.removeTrainSet(store.trains[0].id)
    expect(store.removeDatasetLines(['a'])).toBeGreaterThan(0)
    expect(store.dataset!.lines).toEqual([])
    expect(store.network.segments.size).toBe(0)
  })

  it('while driving, drops what every train is far from and keeps what is near', async () => {
    const { store, index, options } = await started()
    store.addDatasetLines(await fetchLineFiles(index, ['b', 'd'], undefined, options))
    store.togglePlayMode()
    store.tickAllTrains(1.1)
    // d is 50 km away; b touches the line of the train
    expect(store.dataset!.lines).toEqual(['a', 'b'])
    expect(store.network.stations.has('s2')).toBe(true)
    store.togglePlayMode()
  })

  // Regression: ISSUE-002 — in the free view the line on screen was dropped, the screen went blank
  // Found by /qa on 2026-10-16
  // Report: .gstack/qa-reports/qa-report-localhost-2026-10-16.md
  it('in the free view, keeps the line the screen looks at though no train is near it', async () => {
    const { store, index, options, train } = await started()
    store.addDatasetLines(await fetchLineFiles(index, ['b', 'd'], undefined, options))
    store.togglePlayMode()
    store.setAutopilot(train.id, true)
    expect(store.leaveTrain()).toBe(true)
    // The screen looks at Gare Isolée, on d, 50 km from the train
    store.camera.x = 250
    store.camera.y = 50_000
    store.tickAllTrains(1.1)
    expect(store.dataset!.lines).toEqual(['a', 'b', 'd'])
    // Driving a train again, the screen is the train's: d goes
    store.spectateTrain(train.id)
    store.tickAllTrains(1.1)
    expect(store.dataset!.lines).toEqual(['a', 'b'])
    store.togglePlayMode()
  })

  it('reads a recipe saved before the lines were cut: a whole line stands for its pieces', async () => {
    const { index } = fakeDataset()
    const cut = { ...index, lines: index.lines.map((line) => (line.id === 'a' ? line : { ...line, id: `x-${line.id}`, partOf: 'x' })) }
    expect(recipeLines(cut, ['a', 'x'])).toEqual(['a', 'x-b', 'x-d'])
    expect(recipeLines(cut, ['gone'])).toEqual(['gone'])
    expect(recipeLines(cut, ['x-b', 'x'])).toEqual(['x-b', 'x-d'])
  })

  it('fetches a saved game again with the lines it held', async () => {
    const { store, index, options } = await started()
    store.addDatasetLines(await fetchLineFiles(index, ['b'], undefined, options))
    store.flushPersistedState()
    const again = new EditorStore()
    expect(again.datasetReloadPending).toBe(true)
    await reloadDataset(again, options)
    expect(again.dataset!.lines).toEqual(['a', 'b'])
    expect(again.trains).toHaveLength(1)
  })

  it('leaves what is loaded from where the train is, by the way that takes least time', () => {
    const { index } = fakeDataset()
    const gate = index.connections[0].nodeId
    // On line a, bound for « Gare Deux » on line b: out by the node the two lines share
    expect(gatesToward(index, new Set(['a']), ['b'])).toEqual([gate])
    expect(gatesToward(index, new Set(['a', 'd']), ['b'], new Set(['a']))).toEqual([gate])
    // Loaded to the end, or no way there: no gate
    expect(gatesToward(index, new Set(['a', 'b']), ['b'], new Set(['a']))).toEqual([])
    expect(gatesToward(index, new Set(['a']), ['d'], new Set(['a']))).toEqual([])
    // A kilometre of high-speed line costs less time than one of classic line
    const [a] = index.lines
    expect(travelWeight({ ...a, category: 'highSpeed' })).toBeLessThan(travelWeight({ ...a, category: 'main' }))
    expect(travelWeight({ ...a, category: 'main' })).toBeLessThan(travelWeight({ ...a, category: 'regional' }))
  })

  it('costs a train its own time on a line, and keeps one without cab signalling off the high-speed lines', () => {
    const { index } = fakeDataset()
    const [a] = index.lines
    const tgv = travelWeightFor({ maxKmh: 320, cabSignalling: true })
    const ter = travelWeightFor({ maxKmh: 160, cabSignalling: false })
    // The same classic line at the same speed; a slow train takes longer on a fast line
    expect(ter({ ...a, category: 'main' })).toBe(tgv({ ...a, category: 'main' }))
    expect(travelWeightFor({ maxKmh: 100, cabSignalling: true })({ ...a, category: 'highSpeed' })).toBeGreaterThan(tgv({ ...a, category: 'highSpeed' }))
    expect(ter({ ...a, category: 'highSpeed' })).toBe(Infinity)
    // « Gare Deux » is on a high-speed line: a journey there for the one, none for the other
    const classicThenFast = { ...index, lines: index.lines.map((line) => ({ ...line, highSpeed: line.id === 'b', category: line.id === 'b' ? ('highSpeed' as const) : ('main' as const) })) }
    expect('error' in routeThroughStations(classicThenFast, ['s1', 's2'], tgv)).toBe(false)
    expect(routeThroughStations(classicThenFast, ['s1', 's2'], ter)).toMatchObject({ error: 'no-route' })
    expect(gatesToward(classicThenFast, new Set(['a']), ['b'], new Set(['a']), ter)).toEqual([])
  })
})
