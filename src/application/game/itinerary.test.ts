import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { buildTrainConsoleState } from '@application/console/consoleState'
import { fakeDataset } from '@application/dataset/dataset.testkit'
import { fetchLineFiles, resetDatasetIndexCache } from '@application/dataset/datasetClient'
import { resetIdCounter } from '@domain/models/network'
import { setRailway } from '@domain/models/railway'
import { travelWeight, travelWeightFor } from '@domain/dataset/lineRoute'
import { openPassage } from '@domain/models/junction'
import { findJunctionAtNode, isPassageOpen } from '@domain/models/routing'
import { advanceTrainSet } from '@domain/models/train'
import { guideAhead } from '@domain/services/routeGuide'
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
    // The time left follows: those 900 m at the limit of the track, or of the rake
    const view = buildItineraryView(store, train)!
    const fastest = Math.min(store.lineSettings.lineSpeed / 3.6, train.maxSpeed)
    expect(view.duration).not.toBeNull()
    expect(view.duration!).toBeGreaterThanOrEqual(900 / fastest - 1e-6)
    expect(view.totalDuration).toBeCloseTo(view.duration!, 6)

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

describe('a train sent the way it does not face', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  /** A game at « Gare Deux » (x = 1750 on line b), the rake turned to face east; « Gare Un » is west, on line a */
  async function facingAway(aid: 'full' | 'guide') {
    const { index, files } = fakeDataset()
    const options = { fetch: serving(files), baseUrl: '/' }
    const store = new EditorStore()
    store.setDrivingAid(aid)
    await prepareSandbox(store, index, 's2', 'duplex', options)
    store.addDatasetLines(await fetchLineFiles(index, ['a'], undefined, options))
    const headX = () => store.trains[0].vehicles[0].front.t
    // Set down facing the longer way out, west: driven from the other cab, it faces east
    const west = headX()
    expect(store.switchTrainCab(store.trains[0])).toBe(true)
    expect(headX()).not.toBe(west)
    return { store, headX, east: headX() }
  }

  it('is driven from its other cab under the full aid, and its way is then ahead', async () => {
    const { store, headX, east } = await facingAway('full')
    expect(addItineraryStop(store, store.trains[0], 's1')).toBeNull()
    expect(headX()).not.toBe(east)
    expect(buildItineraryView(store, store.trains[0])!.status).toBe('ok')
    expect(store.trains[0].itinerary).toEqual({ stations: ['s2', 's1'], next: 1 })
    expect(store.trains).toHaveLength(1)
  })

  it('takes the next stops on the train turned round, not on the one held before', async () => {
    const { store } = await facingAway('full')
    // Changing ends replaces the train in the store: whoever held it keeps the one before
    const held = store.trains[0]
    expect(addItineraryStop(store, held, 's1')).toBeNull()
    expect(store.trains[0]).not.toBe(held)
    removeItineraryStop(store, held, 1)
    expect(store.trains[0].itinerary).toEqual({ stations: ['s2'], next: 1 })
    expect(addItineraryStop(store, held, 's1')).toBeNull()
    expect(store.trains[0].itinerary).toEqual({ stations: ['s2', 's1'], next: 1 })
  })

  it('is left as it is under guidance: the driver is told to change ends', async () => {
    const { store, headX, east } = await facingAway('guide')
    addItineraryStop(store, store.trains[0], 's1')
    expect(headX()).toBe(east)
    expect(buildItineraryView(store, store.trains[0])!.status).toBe('behind')
  })
})

describe('the journeys a train can make', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  /** The small dataset with line b — where « Gare Deux » is — made a high-speed line */
  async function withHighSpeedLine(model: 'duplex' | 'regiolis') {
    const { index, files } = fakeDataset()
    const fast = { ...index, lines: index.lines.map((line) => ({ ...line, highSpeed: line.id === 'b', category: line.id === 'b' ? ('highSpeed' as const) : ('main' as const) })) }
    const options = { fetch: serving(files), baseUrl: '/' }
    const store = new EditorStore()
    await prepareSandbox(store, fast, 's1', model, options)
    return { store, index: fast, options, train: store.trains[0] }
  }

  it('lets a TGV go to a station of a high-speed line, not a TER', async () => {
    const tgv = await withHighSpeedLine('duplex')
    expect(addItineraryStop(tgv.store, tgv.train, 's2')).toBeNull()
    const ter = await withHighSpeedLine('regiolis')
    expect(addItineraryStop(ter.store, ter.train, 's2')).toMatch(/que ce train peut emprunter.*Gare Deux/)
    expect(ter.train.itinerary!.stations).toEqual(['s1'])
  })

  it('keeps the way of a TER off the rails of a high-speed line even when they are loaded', async () => {
    const { store, index, options, train } = await withHighSpeedLine('regiolis')
    store.addDatasetLines(await fetchLineFiles(index, ['b'], undefined, options))
    const blocked = store.railsBlockedFor(train)!
    const onB = [...store.network.segments.values()].filter((seg) => store.network.nodes.get(seg.from)!.pos.x >= 1000 && store.network.nodes.get(seg.to)!.pos.y === 0 && store.network.nodes.get(seg.to)!.pos.x > 1000)
    expect(onB.length).toBeGreaterThan(0)
    for (const seg of onB) expect(blocked(seg.id)).toBe(true)
    expect(blocked(train.vehicles[0].front.segId)).toBe(false)
    // A TGV may go anywhere
    const tgv = await withHighSpeedLine('duplex')
    expect(tgv.store.railsBlockedFor(tgv.train)).toBeUndefined()
  })

  it('keeps the way of every train off a metro track: none of the table is a metro', async () => {
    const tgv = await withHighSpeedLine('duplex')
    const net = tgv.store.network
    const metro = [...net.segments.values()].find((seg) => seg.id !== tgv.train.vehicles[0].front.segId)!
    setRailway(net, metro, 'subway')
    const blocked = tgv.store.railsBlockedFor(tgv.train)!
    expect(blocked(metro.id)).toBe(true)
    expect(blocked(tgv.train.vehicles[0].front.segId)).toBe(false)
    // Nor may a journey enter a metro line, whatever the train
    const line = { ...tgv.index.lines[0], category: 'subway' as const }
    expect(travelWeightFor({ maxKmh: 320, cabSignalling: true })(line)).toBe(Infinity)
    expect(travelWeight(line)).toBe(Infinity)
  })
})

describe('the driving aid along an itinerary', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetDatasetIndexCache()
    resetIdCounter()
  })

  /** On the way to « Gare Deux » with line b loaded, the points at x = 1000 set towards the branch of line a */
  async function towardsTheBranch(aid: 'full' | 'guide' | 'none') {
    const { store, index, train, options } = await started()
    store.setDrivingAid(aid)
    addItineraryStop(store, train, 's2')
    store.addDatasetLines(await fetchLineFiles(index, ['b'], undefined, options))
    store.notify()
    const node = [...store.network.nodes.values()].find((n) => n.pos.x === 1000 && n.pos.y === 0)!
    const junction = findJunctionAtNode(store.network, node.id)!
    const rails = (store.network.adjacency.get(node.id) ?? []).map((id) => store.network.segments.get(id)!)
    const other = (seg: (typeof rails)[number]) => store.network.nodes.get(seg.from === node.id ? seg.to : seg.from)!.pos
    const arriving = rails.find((seg) => other(seg).x === 500)!
    const branch = rails.find((seg) => other(seg).y === 60)!
    const onward = rails.find((seg) => other(seg).x === 1500 && other(seg).y === 0)!
    expect(openPassage(junction, arriving.id, branch.id)).toBe(true)
    const setForTheWay = () => isPassageOpen(store.network, node.id, arriving.id, onward.id)
    return { store, train, setForTheWay }
  }

  it('sets the points ahead for the way under the full aid', async () => {
    const { store, train, setForTheWay } = await towardsTheBranch('full')
    expect(setForTheWay()).toBe(false)
    refreshRouteGuide(store, train)
    expect(setForTheWay()).toBe(true)
    expect(buildItineraryView(store, train)!.pointsAgainst).toBeNull()
  })

  it('leaves them to the driver under guidance, and says how far they are', async () => {
    const { store, train, setForTheWay } = await towardsTheBranch('guide')
    refreshRouteGuide(store, train)
    expect(setForTheWay()).toBe(false)
    expect(buildItineraryView(store, train)!.pointsAgainst).toBeCloseTo(750, 3)
    // Asking for the full aid sets them at once
    store.setDrivingAid('full')
    expect(setForTheWay()).toBe(true)
  })

  it('does nothing without aid', async () => {
    const { store, train, setForTheWay } = await towardsTheBranch('none')
    refreshRouteGuide(store, train)
    expect(setForTheWay()).toBe(false)
    expect(buildItineraryView(store, train)!.pointsAgainst).toBeNull()
  })

  it('leaves alone the points a train stands on', async () => {
    const { store, train, setForTheWay } = await towardsTheBranch('full')
    // The rake astride the points: its lead 100 m past them, on the branch they are set to
    expect(advanceTrainSet(store.network, train, 850)).toBe(true)
    refreshRouteGuide(store, train)
    expect(setForTheWay()).toBe(false)
  })

  it('remembers the aid asked for', async () => {
    const { store } = await started()
    expect(store.drivingAid).toBe('full')
    store.setDrivingAid('guide')
    expect(new EditorStore().drivingAid).toBe('guide')
  })

  it('gives the stretch of the way to draw ahead of the train', async () => {
    const { store, train } = await towardsTheBranch('guide')
    refreshRouteGuide(store, train)
    const guide = store.routeGuides.get(train.id)!.guide!
    const lead = train.vehicles[0].front
    const near = guideAhead(store.network, guide, lead, 400)
    expect(near[0]).toMatchObject({ segId: lead.segId, t0: lead.t })
    expect(near.length).toBeLessThan(guide.path.spans.length)
    expect(guideAhead(store.network, guide, lead, 10_000)).toHaveLength(guide.path.spans.length)
    expect(guideAhead(store.network, guide, { segId: 's_nope', t: 0 }, 400)).toEqual([])
  })
})
