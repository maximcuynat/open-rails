import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { positionOnSegment } from '@domain/models/locomotive'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { applyConsoleCommand } from '../console/consoleCommands'
import type { ConsoleCommand } from '../console/consoleContract'
import { arrangeConsole } from '@presentation/components/console/consoleLayout'
import { FakeLink } from './fakeLink'
import { DESK_RETURN_GRACE_MS, createRemoteSession } from './remoteSession'

const stores: EditorStore[] = []

/**
 * A PC with two trains on a straight line and a phone desk session ready to be paired. The PC has
 * the second train selected, as after laying it.
 */
function setup() {
  const store = new EditorStore()
  stores.push(store)
  const n1 = addNode(store.network, { x: 0, y: 0 })
  const n2 = addNode(store.network, { x: 4000, y: 0 })
  addSegment(store.network, n1.id, n2.id)
  expect(store.placeTrainLoco({ x: 1000, y: 0 })).toBe(true)
  expect(store.placeTrainLoco({ x: 3000, y: 0 })).toBe(true)
  const links: FakeLink[] = []
  const session = createRemoteSession({
    store,
    createLink: () => {
      const link = new FakeLink()
      links.push(link)
      return link
    },
    generateRoom: () => 'ROOM22',
  })
  let seq = 0
  /** A command of desk 1 as the relay hands it over, aimed at the train that desk holds */
  const fromPhone = (c: ConsoleCommand, trainId: string | null = store.deskTrain(1)?.id ?? null) =>
    links[links.length - 1].receive({ t: 'command', seq: ++seq, trainId, command: c, from: 1 })
  const pair = () => {
    const link = links[links.length - 1]
    link.receive({ t: 'opened', room: session.getSnapshot()!.room, hosts: ['192.168.1.42'] })
    link.receive({ t: 'peer-joined', desk: 1 })
  }
  const leadX = (index: number) => {
    const lead = store.trains[index].vehicles[0]
    return positionOnSegment(store.network, lead.front.segId, lead.front.t)!.x
  }
  return { store, session, links, fromPhone, pair, leadX }
}

describe('who drives what: the PC, the desks, and the PC as a spectator of a train a desk holds', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    vi.useFakeTimers()
  })
  afterEach(() => {
    for (const store of stores.splice(0)) store.stopSimulationLoop()
    vi.useRealTimers()
  })

  it('a desk in the room is not a spectator PC: the PC watches only when a desk holds the train it looks at', () => {
    const { store, session, pair, fromPhone } = setup()
    const [first, second] = store.trains
    session.open()
    expect(store.deskNames.size).toBe(0)
    pair()
    expect([...store.deskNames.keys()]).toEqual([1])
    // Nobody drives yet: there is nothing to watch, the editor is as usual
    expect(store.isSpectating).toBe(false)
    expect(store.isPlayMode).toBe(false)
    expect(store.driverOf(second.id)).toBeNull()

    // The desk takes the other train: driving starts, and the PC drives its own
    fromPhone({ type: 'selectTrain', trainId: first.id }, null)
    expect(store.isPlayMode).toBe(true)
    expect(store.isSpectating).toBe(false)
    expect(store.driverOf(first.id)).toBe(1)
    expect(store.driverOf(second.id)).toBe('host')

    // The desk takes the train of the PC: now the PC watches
    fromPhone({ type: 'selectTrain', trainId: second.id }, null)
    expect(store.isSpectating).toBe(true)
    expect(store.driverOf(second.id)).toBe(1)
    expect(store.driverOf(first.id)).toBeNull()

    session.close()
    expect(store.deskNames.size).toBe(0)
    expect(store.isSpectating).toBe(false)
    expect(store.isPlayMode).toBe(true)
    expect(store.driverOf(second.id)).toBe('host')
  })

  it('a PC that had no train selected looks at the one the first desk takes', () => {
    const { store, session, pair, fromPhone } = setup()
    store.selectTrainById(null)
    session.open()
    pair()
    fromPhone({ type: 'selectTrain', trainId: store.trains[0].id }, null)
    expect(store.isPlayMode).toBe(true)
    expect(store.selectedTrainId).toBe(store.trains[0].id)
    expect(store.isSpectating).toBe(true)
    // …and drives the other one as soon as it picks it
    applyConsoleCommand(store, { type: 'selectTrainByOffset', offset: 1 })
    expect(store.selectedTrainId).toBe(store.trains[1].id)
    expect(store.isSpectating).toBe(false)
  })

  it('shows no console on the PC while spectating, and shows it again afterwards', () => {
    const { store, session, pair, fromPhone } = setup()
    const layoutNow = () => arrangeConsole(1440, 900, store.consolePreference, store.isPlayMode && !store.isSpectating, false).layout
    session.open()
    pair()
    // A desk at another train: the PC keeps its console
    fromPhone({ type: 'selectTrain', trainId: store.trains[0].id }, null)
    expect(layoutNow()).not.toBeNull()
    fromPhone({ type: 'selectTrain', trainId: store.trains[1].id }, null)
    expect(layoutNow()).toBeNull()
    // Looking at a train no desk holds brings it back, and so does the end of the session
    store.spectateTrain(store.trains[0].id)
    expect(layoutNow()).not.toBeNull()
    store.spectateTrain(store.trains[1].id)
    expect(layoutNow()).toBeNull()
    session.close()
    expect(layoutNow()).not.toBeNull()
  })

  it('the keyboard and the buttons of the PC no longer drive the train a desk holds: only that desk does', () => {
    const { store, session, pair, fromPhone } = setup()
    session.open()
    pair()
    const [other, driven] = store.trains
    fromPhone({ type: 'selectTrain', trainId: driven.id }, null)
    expect(store.selectedTrainId).toBe(driven.id)

    applyConsoleCommand(store, { type: 'reverser', reverser: 'forward' })
    applyConsoleCommand(store, { type: 'notchStep', step: 1 })
    applyConsoleCommand(store, { type: 'emergencyBrake' })
    expect(driven.reverser).toBe('neutral')
    expect(driven.notch).toBe(0)
    expect(driven.emergencyBrake).toBe(false)

    fromPhone({ type: 'reverser', reverser: 'forward' })
    fromPhone({ type: 'notchStep', step: 1 })
    expect(driven.reverser).toBe('forward')
    expect(driven.notch).toBe(1)

    // Picking another train from the PC takes the PC to it: it drives that one, the desk keeps its own
    applyConsoleCommand(store, { type: 'selectTrain', trainId: other.id })
    expect(store.selectedTrainId).toBe(other.id)
    expect(store.cameraTrain?.id).toBe(other.id)
    expect(store.isSpectating).toBe(false)
    applyConsoleCommand(store, { type: 'reverser', reverser: 'reverse' })
    applyConsoleCommand(store, { type: 'notchStep', step: 1 })
    expect(other).toMatchObject({ reverser: 'reverse', notch: 1 })
    expect(driven).toMatchObject({ reverser: 'forward', notch: 1 })
    expect(store.deskTrain(1)).toBe(driven)
    // …and the handles it pulled there are not let go by a step of the simulation
    store.tickAllTrains(1 / 60)
    expect(other.notch).toBe(1)
    expect(driven.notch).toBe(1)
  })

  it('the PC can still leave the drive, which takes every train out of the hands of the desks', () => {
    const { store, session, pair, fromPhone } = setup()
    session.open()
    pair()
    fromPhone({ type: 'selectTrain', trainId: store.trains[1].id }, null)
    expect(store.isSpectating).toBe(true)
    applyConsoleCommand(store, { type: 'releaseControls' })
    expect(store.isPlayMode).toBe(false)
    expect(store.isSpectating).toBe(false)
    expect(store.trainDrivers.size).toBe(0)
    expect(store.deskTrain(1)).toBeNull()
    // The desk is still in the room
    expect(session.getSnapshot()!.desks).toEqual([{ desk: 1 }])
  })

  it('follows the train the PC looks at, another one when it is picked, none in free view', () => {
    const { store, session, pair, fromPhone, leadX } = setup()
    session.open()
    pair()
    fromPhone({ type: 'selectTrain', trainId: store.trains[1].id }, null)
    expect(store.cameraTrain?.id).toBe(store.trains[1].id)

    store.spectateTrain(store.trains[0].id)
    // Watching another train is selecting it; the desk keeps the one it drives
    expect(store.selectedTrainId).toBe(store.trains[0].id)
    expect(store.deskTrain(1)).toBe(store.trains[1])
    expect(store.cameraTrain?.id).toBe(store.trains[0].id)
    expect(store.camera.x).toBeCloseTo(leadX(0), 6)

    store.camera.x = 0
    store.tickAllTrains(1 / 60)
    expect(store.camera.x).toBeCloseTo(leadX(0), 6)

    store.setSpectatorFreeView()
    store.camera.x = 123
    store.tickAllTrains(1 / 60)
    expect(store.camera.x).toBe(123)

    // Out of the free view: back on the train it was looking at
    store.spectateTrain(null)
    expect(store.followLocomotiveCamera).toBe(true)
    expect(store.cameraTrain?.id).toBe(store.trains[0].id)
    expect(store.camera.x).toBeCloseTo(leadX(0), 6)

    store.spectateTrain(store.trains[1].id)
    expect(store.isSpectating).toBe(true)
    expect(store.camera.x).toBeCloseTo(leadX(1), 6)
  })

  it('ignores a train that does not exist, and gives the PC its train back when the phone leaves', () => {
    const { store, session, pair, fromPhone, links } = setup()
    session.open()
    pair()
    const watched = store.trains[1]
    fromPhone({ type: 'selectTrain', trainId: watched.id }, null)
    store.spectateTrain('nope')
    expect(store.selectedTrainId).toBe(watched.id)
    expect(store.isSpectating).toBe(true)
    links[0].receive({ t: 'peer-left', desk: 1 })
    // The phone may be back: its train is kept for it a while
    expect(store.isSpectating).toBe(true)
    vi.advanceTimersByTime(DESK_RETURN_GRACE_MS)
    expect(store.deskNames.size).toBe(0)
    expect(store.trainDrivers.size).toBe(0)
    expect(store.isSpectating).toBe(false)
    // Back at the desk: the camera is on the train this PC now drives
    expect(store.cameraTrain?.id).toBe(watched.id)
    expect(store.driverOf(watched.id)).toBe('host')
    applyConsoleCommand(store, { type: 'notchStep', step: -1 })
    expect(watched.notch).toBe(-1)
  })
})
