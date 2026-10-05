import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { snapToNearestTrack } from '@domain/models/locomotive'
import { performTrackCut } from '@domain/geometry/constructionTemplates'
import { speedZonesAt } from '@domain/models/speedZones'
import { addSpeedZoneBetween, speedZoneEnds, speedZoneLength } from '@domain/services/speedZoneLayout'
import type { Network, Point, SpeedZone } from '@domain/models/types'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

function at(net: Network, x: number, y = 0) {
  const hit = snapToNearestTrack(net, { x, y }, 0.5)!
  return { segId: hit.segId, t: hit.t }
}

/** The zones of the network as places of the world: speed, ends (rounded to the centimetre) and length */
function world(net: Network) {
  const cm = (p: Point) => ({ x: Math.round(p.x * 100) / 100 + 0, y: Math.round(p.y * 100) / 100 + 0 })
  return [...net.speedZones.values()].map((zone: SpeedZone) => {
    const ends = speedZoneEnds(net, zone)!
    return { id: zone.id, speed: zone.speed, a: cm(ends.a), b: cm(ends.b), length: Math.round(speedZoneLength(net, zone) * 1e6) / 1e6 }
  })
}

/** A store with a committed track along y = 0 through the given abscissas and a 90 km/h zone from x = 250 to x = 750 */
function storeWithZone(xs = [0, 1000]) {
  const store = new EditorStore()
  const net = store.network
  const nodes = xs.map((x) => addNode(net, { x, y: 0 }))
  for (let i = 1; i < nodes.length; i++) addSegment(net, nodes[i - 1].id, nodes[i].id)
  const zone = addSpeedZoneBetween(net, at(net, 250), at(net, 750), 90)!
  store.markDirty()
  return { store, zone, nodes }
}

const ZONE = { speed: 90, a: { x: 250, y: 0 }, b: { x: 750, y: 0 }, length: 500 }

describe('speed zones in the store', () => {
  it('come back at the same place after a reload', () => {
    const { store, zone } = storeWithZone()
    performTrackCut(store.network, { x: 500, y: 0 })
    store.markDirty()

    const reloaded = new EditorStore()
    expect(reloaded.loadPersistedState()).toBe(true)
    expect(reloaded.network).not.toBe(store.network)
    expect(world(reloaded.network)).toEqual([{ id: zone.id, ...ZONE }])
    expect(world(reloaded.network)).toEqual(world(store.network))
  })

  it('travel with the exported project and its import', () => {
    const { store, zone } = storeWithZone()
    const file = JSON.parse(JSON.stringify(store.exportProject()))
    expect(file.speedZones).toHaveLength(1)

    const other = new EditorStore()
    other.loadFromData(file)
    expect(world(other.network)).toEqual([{ id: zone.id, ...ZONE }])
    // Importing a file without zone leaves none behind
    other.loadFromData({ version: 2, nodes: [], segments: [] })
    expect(other.network.speedZones.size).toBe(0)
  })

  it('a project without zone exports the same file after a round trip', () => {
    const store = new EditorStore()
    const a = addNode(store.network, { x: 0, y: 0 })
    const b = addNode(store.network, { x: 100, y: 0 })
    addSegment(store.network, a.id, b.id)
    store.markDirty()
    const file = JSON.stringify(store.exportProject())
    expect(file).not.toContain('speedZones')

    const other = new EditorStore()
    other.loadFromData(JSON.parse(file))
    other.camera = store.camera
    expect(JSON.stringify(other.exportProject())).toBe(file)
  })

  it('are gone with a new project', () => {
    const { store } = storeWithZone()
    store.newProject()
    expect(store.network.speedZones.size).toBe(0)
    expect(new EditorStore().loadPersistedState()).toBe(false)
  })

  it('undo and redo bring back the zone, and the track under it, as they were', () => {
    const { store, zone } = storeWithZone()
    const laid = world(store.network)
    expect(laid).toEqual([{ id: zone.id, ...ZONE }])

    // Step 2: the rail is cut in the middle of the zone
    performTrackCut(store.network, { x: 500, y: 0 })
    store.markDirty()
    expect(store.network.segments.size).toBe(2)
    expect(world(store.network)).toEqual(laid)

    // Step 3: a second zone
    addSpeedZoneBetween(store.network, at(store.network, 100), at(store.network, 300), 30)
    store.markDirty()
    const two = world(store.network)
    expect(two).toHaveLength(2)

    store.undo()
    expect(store.network.segments.size).toBe(2)
    expect(world(store.network)).toEqual(laid)
    expect(store.network.speedZones.get(zone.id)!.spans).toHaveLength(2)

    store.undo()
    expect(store.network.segments.size).toBe(1)
    expect(world(store.network)).toEqual(laid)
    expect(store.network.speedZones.get(zone.id)!.spans).toHaveLength(1)

    store.redo()
    store.redo()
    expect(store.network.segments.size).toBe(2)
    expect(world(store.network)).toEqual(two)
    // The index of the restored network answers for the restored zones
    const place = at(store.network, 270)
    expect(speedZonesAt(store.network, place.segId, place.t).map((z) => z.speed)).toEqual([90, 30])
  })

  it('undo brings back a zone that was removed with its track', () => {
    const { store, zone } = storeWithZone()
    store.setSelection({ nodes: new Set(), segments: new Set(store.network.segments.keys()) })
    store.deleteSelection()
    expect(store.network.speedZones.size).toBe(0)

    store.undo()
    expect(world(store.network)).toEqual([{ id: zone.id, ...ZONE }])
  })

  it('deleting a rail in the middle of a zone leaves a zone on each side', () => {
    const { store, zone } = storeWithZone([0, 400, 600, 1000])
    const middle = at(store.network, 500).segId
    store.setSelection({ nodes: new Set(), segments: new Set([middle]) })
    store.deleteSelection()

    const zones = world(store.network)
    expect(zones).toHaveLength(2)
    expect(zones[0]).toEqual({ id: zone.id, speed: 90, a: { x: 250, y: 0 }, b: { x: 400, y: 0 }, length: 150 })
    expect(zones[1]).toMatchObject({ speed: 90, a: { x: 600, y: 0 }, b: { x: 750, y: 0 }, length: 150 })

    store.undo()
    expect(world(store.network)).toEqual([{ id: zone.id, ...ZONE }])
  })

  it('deleting a rail at the end of a zone shortens it', () => {
    const { store, zone } = storeWithZone([0, 400, 600, 1000])
    store.setSelection({ nodes: new Set(), segments: new Set([at(store.network, 700).segId]) })
    store.deleteSelection()
    expect(world(store.network)).toEqual([{ id: zone.id, speed: 90, a: { x: 250, y: 0 }, b: { x: 600, y: 0 }, length: 350 }])
  })

  it('deleting a node of the track (dissolved) leaves the zone in place', () => {
    const { store, zone, nodes } = storeWithZone([0, 400, 600, 1000])
    store.setSelection({ nodes: new Set([nodes[1].id]), segments: new Set() })
    store.deleteSelection()
    expect(store.network.segments.size).toBe(2)
    expect(world(store.network)).toEqual([{ id: zone.id, ...ZONE }])
    expect(store.network.speedZones.get(zone.id)!.spans).toHaveLength(2)
  })

  it('stay in place when a track laid across is reconciled into a crossing, then raised into a bridge', () => {
    const { store, zone } = storeWithZone()
    const net = store.network
    const s = addNode(net, { x: 500, y: -100 })
    const n = addNode(net, { x: 500, y: 100 })
    addSegment(net, s.id, n.id)
    store.reconcileNetwork()
    store.markDirty()
    expect(net.segments.size).toBe(4)
    expect(world(net)).toEqual([{ id: zone.id, ...ZONE }])

    // The zone's own track goes up one level: the crossing becomes a bridge
    const mainRails = [...net.segments.values()].filter((seg) => net.nodes.get(seg.from)!.pos.y === 0 && net.nodes.get(seg.to)!.pos.y === 0)
    store.setSelection({ nodes: new Set(), segments: new Set(mainRails.map((seg) => seg.id)) })
    expect(store.shiftSelectionLevel(1)).toBe(true)
    expect(world(store.network)).toEqual([{ id: zone.id, ...ZONE }])

    store.undo()
    expect(world(store.network)).toEqual([{ id: zone.id, ...ZONE }])
  })

  it('follow their track when it is moved', () => {
    const { store, zone, nodes } = storeWithZone()
    for (const node of nodes) node.pos = { x: node.pos.x, y: node.pos.y + 40 }
    store.markDirty()
    expect(world(store.network)).toEqual([{ id: zone.id, speed: 90, a: { x: 250, y: 40 }, b: { x: 750, y: 40 }, length: 500 }])
  })

  it('notify drops what is left of a zone on a rail taken out of the graph by hand', () => {
    const { store } = storeWithZone([0, 400, 600, 1000])
    const net = store.network
    const middle = net.segments.get(at(net, 500).segId)!
    net.segments.delete(middle.id)
    for (const nid of [middle.from, middle.to]) net.adjacency.set(nid, net.adjacency.get(nid)!.filter((sid) => sid !== middle.id))
    store.notify()
    expect(world(net).map((z) => z.length)).toEqual([150, 150])
  })
})
