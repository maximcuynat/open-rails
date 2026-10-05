import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import type { ConsoleCommand } from '../console/consoleContract'
import { FakeLink } from './fakeLink'
import { BRAKE_HOLD_TIMEOUT_MS, type RemoteMessage } from './protocol'
import { createRemoteSession } from './remoteSession'

function setup() {
  const store = new EditorStore()
  const n1 = addNode(store.network, { x: 0, y: 0 })
  const n2 = addNode(store.network, { x: 4000, y: 0 })
  addSegment(store.network, n1.id, n2.id)
  expect(store.placeTrainLoco({ x: 1000, y: 0 })).toBe(true)
  expect(store.placeTrainLoco({ x: 3000, y: 0 })).toBe(true)

  const links: FakeLink[] = []
  const rooms = ['ROOM22', 'ROOM33']
  const session = createRemoteSession({
    store,
    createLink: () => {
      const link = new FakeLink()
      links.push(link)
      return link
    },
    generateRoom: () => rooms.shift() ?? 'ROOM99',
  })
  let seq = 0
  const command = (c: ConsoleCommand, trainId: string | null = store.selectedTrainId) =>
    links[links.length - 1].receive({ t: 'command', seq: ++seq, trainId, command: c })
  const pair = () => {
    const link = links[links.length - 1]
    link.receive({ t: 'opened', room: session.getSnapshot()!.room, hosts: ['192.168.1.42'] })
    link.receive({ t: 'peer-joined' })
  }
  const last = <T extends RemoteMessage['t']>(link: FakeLink, t: T) =>
    link.sent.filter((m): m is Extract<RemoteMessage, { t: T }> => m.t === t).pop()
  return { store, session, links, command, pair, last }
}

describe('remoteSession', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('has no session until it is opened, then opens a room under a fresh code each time', () => {
    const { session, links } = setup()
    const changes = vi.fn()
    session.subscribe(changes)
    expect(session.getSnapshot()).toBeNull()
    session.close()
    expect(changes).not.toHaveBeenCalled()

    session.open()
    expect(links).toHaveLength(1)
    expect(links[0].sent[0]).toMatchObject({ t: 'host', room: 'ROOM22' })
    expect(session.getSnapshot()).toMatchObject({ room: 'ROOM22', ready: false, deskConnected: false })
    expect(changes).toHaveBeenCalledTimes(1)
    // Already open: same session, same link
    session.open()
    expect(links).toHaveLength(1)

    links[0].receive({ t: 'opened', room: 'ROOM22', hosts: ['192.168.1.42'] })
    expect(session.getSnapshot()).toMatchObject({ ready: true, hosts: ['192.168.1.42'] })
    expect(changes).toHaveBeenCalledTimes(2)

    session.close()
    expect(session.getSnapshot()).toBeNull()
    expect(links[0].status).toBe('closed')
    expect(changes).toHaveBeenCalledTimes(3)

    session.open()
    expect(links).toHaveLength(2)
    expect(session.getSnapshot()).toMatchObject({ room: 'ROOM33' })
  })

  it('sends the fleet and the state of the store to the phone', () => {
    const { store, session, links, pair, last } = setup()
    session.open()
    pair()
    expect(session.getSnapshot()!.deskConnected).toBe(true)
    expect(last(links[0], 'fleet')!.fleet.map((f) => f.id)).toEqual(store.trains.map((t) => t.id))
    // The PC drives nothing yet
    expect(last(links[0], 'state')!.state).toBeNull()
  })

  it('applies the commands of the phone to the store, which notifies its own screen', () => {
    const { store, session, links, command, pair, last } = setup()
    session.open()
    pair()
    const notified = vi.fn()
    store.subscribe(notified)
    const second = store.trains[1].id

    command({ type: 'selectTrain', trainId: second }, null)
    expect(store.isPlayMode).toBe(true)
    expect(store.selectedTrainId).toBe(second)
    expect(notified).toHaveBeenCalled()
    expect(last(links[0], 'state')!.state).toMatchObject({ trainId: second, notch: 0 })

    notified.mockClear()
    command({ type: 'reverser', reverser: 'forward' })
    command({ type: 'notchStep', step: 1 })
    expect(store.selectedTrain).toMatchObject({ reverser: 'forward', notch: 1 })
    expect(notified).toHaveBeenCalledTimes(2)
    expect(last(links[0], 'state')!.state).toMatchObject({ reverser: 'forward', notch: 1 })

    command({ type: 'releaseControls' })
    expect(store.isPlayMode).toBe(false)
    expect(last(links[0], 'state')!.state).toBeNull()
    store.stopSimulationLoop()
  })

  it('puts the brake back to hold when the phone falls silent, is cut off, or the session closes', () => {
    const { store, session, links, command, pair } = setup()
    session.open()
    pair()
    command({ type: 'selectTrain', trainId: store.trains[0].id }, null)
    const train = store.selectedTrain!

    command({ type: 'brake', command: 'release' })
    expect(train.brakeCommand).toBe('release')
    vi.advanceTimersByTime(BRAKE_HOLD_TIMEOUT_MS)
    expect(train.brakeCommand).toBe('hold')

    command({ type: 'brake', command: 'apply' })
    links[0].receive({ t: 'peer-left' })
    expect(train.brakeCommand).toBe('hold')
    expect(session.getSnapshot()!.deskConnected).toBe(false)

    links[0].receive({ t: 'peer-joined' })
    links[0].receive({ t: 'command', seq: 1, trainId: train.id, command: { type: 'brake', command: 'apply' } })
    expect(train.brakeCommand).toBe('apply')
    session.close()
    expect(train.brakeCommand).toBe('hold')
    expect(links[0].sent.at(-1)).toEqual({ t: 'bye' })
    store.togglePlayMode()
  })

  it('never takes the brake handle out of the hand that holds it on the PC', () => {
    const { store, session, links, command, pair } = setup()
    session.open()
    pair()
    command({ type: 'selectTrain', trainId: store.trains[0].id }, null)
    const train = store.selectedTrain!

    // Both hold « apply »; the phone falls silent
    store.setSelectedTrainBrakeCommand('apply')
    command({ type: 'brake', command: 'apply' })
    vi.advanceTimersByTime(BRAKE_HOLD_TIMEOUT_MS * 2)
    expect(train.brakeCommand).toBe('apply')
    // …then the PC lets go: nobody holds the handle any more
    store.setSelectedTrainBrakeCommand('hold')
    expect(train.brakeCommand).toBe('hold')

    // The phone lets go by itself while the PC still holds
    store.setSelectedTrainBrakeCommand('apply')
    command({ type: 'brake', command: 'apply' })
    command({ type: 'brake', command: 'hold' })
    expect(train.brakeCommand).toBe('apply')

    // The phone is cut off in the middle of its own « release » while the PC holds « apply »:
    // the handle goes back to what the PC holds
    command({ type: 'brake', command: 'release' })
    expect(train.brakeCommand).toBe('release')
    links[0].receive({ t: 'peer-left' })
    expect(train.brakeCommand).toBe('apply')

    // And the other way round: the PC lets go while the phone still holds
    links[0].receive({ t: 'peer-joined' })
    links[0].receive({ t: 'command', seq: 1, trainId: train.id, command: { type: 'brake', command: 'release' } })
    store.setSelectedTrainBrakeCommand('hold')
    expect(train.brakeCommand).toBe('release')
    vi.advanceTimersByTime(BRAKE_HOLD_TIMEOUT_MS)
    expect(train.brakeCommand).toBe('hold')
    session.close()
    store.togglePlayMode()
  })
})
