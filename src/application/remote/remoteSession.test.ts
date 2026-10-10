import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { setNotch } from '@domain/models/train'
import { setBrakeCommand } from '@domain/models/trainDynamics'
import { applyConsoleCommand } from '../console/consoleCommands'
import type { ConsoleCommand } from '../console/consoleContract'
import { buildFleet } from '../console/consoleState'
import { FakeLink } from './fakeLink'
import { BRAKE_HOLD_TIMEOUT_MS, type RemoteMessage } from './protocol'
import { DESK_RETURN_GRACE_MS, createRemoteSession } from './remoteSession'

const stores: EditorStore[] = []

/** A PC with trains 1 000 m apart on a straight line (the last one placed is the one it has selected) and a session to pair desks with */
function setup(trainCount = 2) {
  const store = new EditorStore()
  stores.push(store)
  const n1 = addNode(store.network, { x: 0, y: 0 })
  const n2 = addNode(store.network, { x: 1000 * (trainCount + 2), y: 0 })
  addSegment(store.network, n1.id, n2.id)
  for (let i = 0; i < trainCount; i++) expect(store.placeTrainLoco({ x: 1000 * (i + 1), y: 0 })).toBe(true)

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
  const seqs = new Map<number, number>()
  /** A command as the relay hands it over: stamped with its desk, aimed at the train that desk holds */
  const from = (desk: number) => (c: ConsoleCommand, trainId: string | null = store.deskTrain(desk)?.id ?? null) => {
    const seq = (seqs.get(desk) ?? 0) + 1
    seqs.set(desk, seq)
    links[links.length - 1].receive({ t: 'command', seq, trainId, command: c, from: desk })
  }
  const command = from(1)
  const pair = (desk = 1, name?: string) => {
    const link = links[links.length - 1]
    if (!session.getSnapshot()!.ready) link.receive({ t: 'opened', room: session.getSnapshot()!.room, hosts: ['192.168.1.42'] })
    // A desk that sits down is a new page: it counts its commands from 1
    seqs.delete(desk)
    link.receive(name === undefined ? { t: 'peer-joined', desk } : { t: 'peer-joined', desk, name })
  }
  const last = <T extends RemoteMessage['t']>(link: FakeLink, t: T, to?: number) =>
    link.sent.filter((m): m is Extract<RemoteMessage, { t: T }> => m.t === t && (to === undefined || ('to' in m && m.to === to))).pop()
  return { store, session, links, command, from, pair, last }
}

describe('remoteSession', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    vi.useFakeTimers()
  })
  afterEach(() => {
    for (const store of stores.splice(0)) store.stopSimulationLoop()
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
    expect(session.getSnapshot()).toMatchObject({ room: 'ROOM22', ready: false, deskConnected: false, desks: [] })
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
    expect(session.getSnapshot()).toMatchObject({ deskConnected: true, desks: [{ desk: 1 }] })
    expect(store.deskNames.has(1)).toBe(true)
    expect(last(links[0], 'fleet')!.fleet.map((f) => f.id)).toEqual(store.trains.map((t) => t.id))
    // The desk holds no train yet, and nobody drives
    expect(last(links[0], 'state')).toEqual({ t: 'state', state: null, ack: 0, to: 1 })
    expect(last(links[0], 'fleet')!.fleet.map((f) => f.driver)).toEqual([null, null])
    expect(store.isPlayMode).toBe(false)
  })

  it('applies the commands of the phone to the store, which notifies its own screen', () => {
    const { store, session, links, command, pair, last } = setup()
    session.open()
    pair()
    const notified = vi.fn()
    store.subscribe(notified)
    const first = store.trains[0]

    command({ type: 'selectTrain', trainId: first.id }, null)
    expect(store.isPlayMode).toBe(true)
    expect(store.deskTrain(1)).toBe(first)
    // The train this screen had selected stays its own
    expect(store.selectedTrainId).toBe(store.trains[1].id)
    expect(notified).toHaveBeenCalled()
    expect(last(links[0], 'state')).toMatchObject({ to: 1, state: { trainId: first.id, notch: 0 } })

    notified.mockClear()
    command({ type: 'reverser', reverser: 'forward' })
    command({ type: 'notchStep', step: 1 })
    expect(first).toMatchObject({ reverser: 'forward', notch: 1 })
    expect(store.trains[1]).toMatchObject({ reverser: 'neutral', notch: 0 })
    expect(notified).toHaveBeenCalledTimes(2)
    expect(last(links[0], 'state')!.state).toMatchObject({ trainId: first.id, reverser: 'forward', notch: 1 })

    // Letting go of its train is not the end of the drive: the simulation goes on for the others
    command({ type: 'releaseControls' })
    expect(store.isPlayMode).toBe(true)
    expect(store.deskTrain(1)).toBeNull()
    expect(store.trainDrivers.size).toBe(0)
    expect(first.notch).toBe(0)
    expect(last(links[0], 'state')).toEqual({ t: 'state', state: null, ack: 4, to: 1 })
    // A handle moved with no train in hand moves nothing
    command({ type: 'notchStep', step: 1 }, first.id)
    expect(first.notch).toBe(0)
    store.togglePlayMode()
  })

  it('puts the brake back to hold when the phone falls silent, is cut off, or the session closes', () => {
    const { store, session, links, command, pair } = setup()
    session.open()
    pair()
    command({ type: 'selectTrain', trainId: store.trains[0].id }, null)
    const train = store.deskTrain(1)!
    expect(train).toBe(store.trains[0])

    command({ type: 'brake', command: 'release' })
    expect(train.brakeCommand).toBe('release')
    vi.advanceTimersByTime(BRAKE_HOLD_TIMEOUT_MS)
    expect(train.brakeCommand).toBe('hold')
    // Silent is not gone: it still holds its train
    expect(store.deskTrain(1)).toBe(train)

    command({ type: 'brake', command: 'apply' })
    links[0].receive({ t: 'peer-left', desk: 1 })
    expect(train.brakeCommand).toBe('hold')
    expect(session.getSnapshot()).toMatchObject({ deskConnected: false, desks: [] })
    // Gone, maybe for a moment: its train is at rest and still its own, the drive goes on
    expect(store.deskTrain(1)).toBe(train)
    expect(store.isPlayMode).toBe(true)
    // Not back in time: the train is nobody's and the name is forgotten
    vi.advanceTimersByTime(DESK_RETURN_GRACE_MS)
    expect(store.trainDrivers.size).toBe(0)
    expect(store.deskNames.size).toBe(0)
    expect(store.isPlayMode).toBe(true)

    // A desk that comes back holds nothing: it takes a train again
    pair()
    command({ type: 'brake', command: 'apply' }, train.id)
    expect(train.brakeCommand).toBe('hold')
    command({ type: 'selectTrain', trainId: train.id }, null)
    command({ type: 'brake', command: 'apply' })
    expect(train.brakeCommand).toBe('apply')
    session.close()
    expect(train.brakeCommand).toBe('hold')
    expect(links[0].sent.at(-1)).toEqual({ t: 'bye' })
    expect(store.trainDrivers.size).toBe(0)
    expect(store.deskNames.size).toBe(0)
    store.togglePlayMode()
  })

  it('gives each train one brake handle: the hand of a desk and the hand of the PC never meet on it', () => {
    const { store, session, links, command, pair } = setup()
    session.open()
    pair()
    const [held, own] = store.trains
    command({ type: 'selectTrain', trainId: held.id }, null)
    expect(store.selectedTrain).toBe(own)

    // Each holds « apply » on its own train; the phone falls silent: its train alone goes back to hold
    store.setSelectedTrainBrakeCommand('apply')
    command({ type: 'brake', command: 'apply' })
    expect([held.brakeCommand, own.brakeCommand]).toEqual(['apply', 'apply'])
    vi.advanceTimersByTime(BRAKE_HOLD_TIMEOUT_MS * 2)
    expect([held.brakeCommand, own.brakeCommand]).toEqual(['hold', 'apply'])
    // …and the PC letting go does nothing to the train of the desk
    command({ type: 'brake', command: 'release' })
    store.setSelectedTrainBrakeCommand('hold')
    expect([held.brakeCommand, own.brakeCommand]).toEqual(['release', 'hold'])

    // The phone is cut off in the middle of its own « release » while the PC holds « apply »
    store.setSelectedTrainBrakeCommand('apply')
    links[0].receive({ t: 'peer-left', desk: 1 })
    expect([held.brakeCommand, own.brakeCommand]).toEqual(['hold', 'apply'])

    // The desk takes the very train the PC holds the brake of: the PC's hand comes off the handle,
    // and it cannot put it back while the desk is at the controls
    pair()
    command({ type: 'selectTrain', trainId: own.id }, null)
    expect(store.deskTrain(1)).toBe(own)
    expect(own.brakeCommand).toBe('hold')
    store.setSelectedTrainBrakeCommand('apply')
    applyConsoleCommand(store, { type: 'brake', command: 'apply' })
    expect(own.brakeCommand).toBe('hold')
    command({ type: 'brake', command: 'release' })
    expect(own.brakeCommand).toBe('release')
    store.setSelectedTrainBrakeCommand('hold')
    store.centreSelectedTrainBrake()
    expect(own.brakeCommand).toBe('release')
    vi.advanceTimersByTime(BRAKE_HOLD_TIMEOUT_MS)
    expect(own.brakeCommand).toBe('hold')
    session.close()
    store.togglePlayMode()
  })
})

describe('remoteSession: several desks', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    vi.useFakeTimers()
  })
  afterEach(() => {
    for (const store of stores.splice(0)) store.stopSimulationLoop()
    vi.useRealTimers()
  })

  const steps = (store: EditorStore, count: number) => {
    for (let i = 0; i < count; i++) store.tickAllTrains(1 / 60)
  }

  /** Four trains: desk 1 at the first, desk 2 (« Léa ») at the second, nobody at the third, the PC at the fourth */
  function twoDesks() {
    const world = setup(4)
    const { store, session, pair, from } = world
    session.open()
    pair(1)
    pair(2, 'Léa')
    const [a, b, c, d] = store.trains
    const one = from(1)
    const two = from(2)
    one({ type: 'selectTrain', trainId: a.id }, null)
    two({ type: 'selectTrain', trainId: b.id }, null)
    expect(store.selectedTrain).toBe(d)
    return { ...world, a, b, c, d, one, two }
  }

  it('lets two desks drive two trains, each keeping its own notch and brake step after step', () => {
    const { store, a, b, c, d, one, two } = twoDesks()
    expect(store.isPlayMode).toBe(true)
    expect([...store.trainDrivers]).toEqual([[a.id, 1], [b.id, 2]])
    expect(store.deskTrain(1)).toBe(a)
    expect(store.deskTrain(2)).toBe(b)
    expect(store.isSpectating).toBe(false)

    one({ type: 'reverser', reverser: 'forward' })
    one({ type: 'notchSet', notch: 3 })
    one({ type: 'brake', command: 'release' })
    two({ type: 'reverser', reverser: 'reverse' })
    two({ type: 'notchSet', notch: 1 })
    two({ type: 'brake', command: 'apply' })
    // Nobody is at the third train, whose handles were left pulled
    setNotch(c, 4)
    setBrakeCommand(c, 'release')

    steps(store, 1)
    expect(a).toMatchObject({ notch: 3, brakeCommand: 'release', reverser: 'forward' })
    expect(b).toMatchObject({ notch: 1, brakeCommand: 'apply', reverser: 'reverse' })
    // Neutralised at the first step: no traction, the brake handle at rest
    expect(c).toMatchObject({ notch: 0, brakeCommand: 'hold' })

    steps(store, 600)
    expect(a).toMatchObject({ notch: 3, brakeCommand: 'release', reverser: 'forward' })
    expect(b).toMatchObject({ notch: 1, brakeCommand: 'apply', reverser: 'reverse' })
    expect(c).toMatchObject({ notch: 0, brakeCommand: 'hold', currentSpeed: 0 })
    // The first runs, brake released under power; the second stands, brake applied
    expect(a.currentSpeed).toBeGreaterThan(1)
    expect(b.currentSpeed).toBe(0)
    expect(d).toMatchObject({ notch: 0, brakeCommand: 'hold', currentSpeed: 0 })

    // A handle moved on one desk moves on its train only
    two({ type: 'brake', command: 'hold' })
    two({ type: 'notchSet', notch: -2 })
    one({ type: 'notchStep', step: 1 })
    steps(store, 60)
    expect(a).toMatchObject({ notch: 4, brakeCommand: 'release' })
    expect(b).toMatchObject({ notch: -2, brakeCommand: 'hold' })
    store.togglePlayMode()
  })

  it('neutralises a train nobody drives, and no other: traction off and brake handle at rest, the electric brake left on', () => {
    const { store, a, b, c, d } = twoDesks()
    for (const train of [a, b, c, d]) {
      setNotch(train, 2)
      setBrakeCommand(train, 'apply')
    }
    steps(store, 3)
    // Held by a desk, held by a desk, nobody's, the PC's
    expect([a, b, c, d].map((t) => t.notch)).toEqual([2, 2, 0, 2])
    expect([a, b, c, d].map((t) => t.brakeCommand)).toEqual(['apply', 'apply', 'hold', 'apply'])
    // Only what pulls is cut: a handle left in the electric brake stays there
    setNotch(c, -3)
    steps(store, 3)
    expect(c.notch).toBe(-3)

    // The PC moves on to the train nobody had: that one is driven now, the one it leaves is not
    store.spectateTrain(c.id)
    setNotch(c, 2)
    steps(store, 3)
    expect([a, b, c, d].map((t) => t.notch)).toEqual([2, 2, 2, 0])
    expect(d.brakeCommand).toBe('hold')
    store.togglePlayMode()
  })

  it('refuses a train another desk holds, and leaves both desks where they were', () => {
    const { store, links, a, b, c, one, two, last } = twoDesks()
    expect(store.takeTrain(a.id, 2)).toBe(false)
    expect(store.takeTrain(b.id, 1)).toBe(false)
    expect([...store.trainDrivers]).toEqual([[a.id, 1], [b.id, 2]])
    // Asking again for the train it already holds is granted, and changes nothing
    expect(store.takeTrain(a.id, 1)).toBe(true)
    expect(store.takeTrain('nope', 1)).toBe(false)
    expect([...store.trainDrivers]).toEqual([[a.id, 1], [b.id, 2]])

    // The same through the wire: desk 2 asks for the train of desk 1 and keeps its own
    two({ type: 'notchSet', notch: 2 })
    two({ type: 'selectTrain', trainId: a.id }, null)
    expect(store.deskTrain(2)).toBe(b)
    expect(store.deskTrain(1)).toBe(a)
    expect(last(links[0], 'state', 2)!.state).toMatchObject({ trainId: b.id })
    // …and what it then does still goes to its own train, not to the one it asked for
    two({ type: 'notchStep', step: 1 }, a.id)
    expect(a.notch).toBe(0)
    two({ type: 'notchStep', step: 1 })
    expect(b.notch).toBe(3)

    // A free train is granted, and the one left behind is free for the other desk
    two({ type: 'selectTrain', trainId: c.id }, null)
    expect(store.deskTrain(2)).toBe(c)
    expect(b.notch).toBe(0)
    expect(store.takeTrain(b.id, 1)).toBe(true)
    expect([...store.trainDrivers].sort()).toEqual([[b.id, 1], [c.id, 2]].sort())
    one({ type: 'notchStep', step: 1 })
    expect([a.notch, b.notch, c.notch]).toEqual([0, 1, 0])
    store.togglePlayMode()
  })

  it('goes round the trains nobody else holds when a desk asks for the next one', () => {
    const { store, a, b, c, d, one, two } = twoDesks()
    // From the first: the second is desk 2's, so the third; then the fourth, which the PC drives
    // but no desk holds; then round to the first again
    one({ type: 'selectTrainByOffset', offset: 1 })
    expect(store.deskTrain(1)).toBe(c)
    one({ type: 'selectTrainByOffset', offset: 1 })
    expect(store.deskTrain(1)).toBe(d)
    one({ type: 'selectTrainByOffset', offset: 1 })
    expect(store.deskTrain(1)).toBe(a)
    one({ type: 'selectTrainByOffset', offset: -1 })
    expect(store.deskTrain(1)).toBe(d)
    // Desk 2 the other way: the first is free, the fourth is not
    two({ type: 'selectTrainByOffset', offset: -1 })
    expect(store.deskTrain(2)).toBe(a)
    two({ type: 'selectTrainByOffset', offset: -1 })
    expect(store.deskTrain(2)).toBe(c)
    expect([...store.trainDrivers.values()].sort()).toEqual([1, 2])
    expect(store.trainDrivers.has(b.id)).toBe(false)
    store.togglePlayMode()
  })

  it('a desk that lets go of its controls frees its train and leaves the drive running', () => {
    const { store, session, links, a, b, one, two, last } = twoDesks()
    one({ type: 'reverser', reverser: 'forward' })
    one({ type: 'notchSet', notch: 3 })
    one({ type: 'brake', command: 'release' })
    two({ type: 'reverser', reverser: 'forward' })
    two({ type: 'notchSet', notch: 2 })

    one({ type: 'releaseControls' })
    expect(store.isPlayMode).toBe(true)
    expect(store.deskTrain(1)).toBeNull()
    expect([...store.trainDrivers]).toEqual([[b.id, 2]])
    // Handles at rest on the train it leaves
    expect(a).toMatchObject({ notch: 0, brakeCommand: 'hold' })
    expect(last(links[0], 'state', 1)).toMatchObject({ state: null, to: 1 })
    // Still seated, and the other desk still at its controls
    expect(session.getSnapshot()!.desks).toEqual([{ desk: 1 }, { desk: 2, name: 'Léa' }])
    expect(last(links[0], 'state', 2)!.state).toMatchObject({ trainId: b.id, notch: 2 })
    steps(store, 10)
    expect(b.notch).toBe(2)
    two({ type: 'notchStep', step: 1 })
    expect(b.notch).toBe(3)
    // Nothing held: letting go again does nothing, and the train is free for anyone
    one({ type: 'releaseControls' }, null)
    expect(store.isPlayMode).toBe(true)
    expect(buildFleet(store)[0]).toMatchObject({ id: a.id, driven: false, driver: null })
    expect(store.takeTrain(a.id, 2)).toBe(true)
    expect(b.notch).toBe(0)
    store.togglePlayMode()
  })

  it('lets the PC drive a free train while two desks drive theirs', () => {
    const { store, a, b, c, d, one, two } = twoDesks()
    one({ type: 'reverser', reverser: 'forward' })
    one({ type: 'notchSet', notch: 3 })
    two({ type: 'reverser', reverser: 'forward' })
    two({ type: 'notchSet', notch: 1 })
    two({ type: 'brake', command: 'apply' })

    expect(store.isSpectating).toBe(false)
    applyConsoleCommand(store, { type: 'reverser', reverser: 'forward' })
    applyConsoleCommand(store, { type: 'notchSet', notch: 5 })
    applyConsoleCommand(store, { type: 'brake', command: 'release' })
    expect(d).toMatchObject({ reverser: 'forward', notch: 5, brakeCommand: 'release' })
    steps(store, 600)
    expect(d).toMatchObject({ notch: 5, brakeCommand: 'release' })
    expect(d.currentSpeed).toBeGreaterThan(1)
    expect(a).toMatchObject({ notch: 3, brakeCommand: 'hold' })
    expect(b).toMatchObject({ notch: 1, brakeCommand: 'apply' })
    expect(c).toMatchObject({ notch: 0, brakeCommand: 'hold', currentSpeed: 0 })

    // The PC moves on to the free train and drives it; the one it leaves is neutralised
    applyConsoleCommand(store, { type: 'selectTrain', trainId: c.id })
    expect(store.selectedTrain).toBe(c)
    expect(store.isSpectating).toBe(false)
    applyConsoleCommand(store, { type: 'notchStep', step: -1 })
    expect(c.notch).toBe(-1)
    steps(store, 1)
    expect(d).toMatchObject({ notch: 0, brakeCommand: 'hold' })
    expect(a.notch).toBe(3)
    expect(b).toMatchObject({ notch: 1, brakeCommand: 'apply' })
    expect([...store.trainDrivers]).toEqual([[a.id, 1], [b.id, 2]])
    store.togglePlayMode()
  })

  it('makes the PC a spectator of its own train when a desk takes it, until it picks another', () => {
    const { store, a, c, d, one } = twoDesks()
    applyConsoleCommand(store, { type: 'reverser', reverser: 'forward' })
    applyConsoleCommand(store, { type: 'notchStep', step: 1 })
    applyConsoleCommand(store, { type: 'brake', command: 'apply' })
    expect(d).toMatchObject({ notch: 1, brakeCommand: 'apply' })
    expect(store.isSpectating).toBe(false)

    one({ type: 'selectTrain', trainId: d.id }, null)
    expect(store.deskTrain(1)).toBe(d)
    expect(store.selectedTrain).toBe(d)
    expect(store.isSpectating).toBe(true)
    // The hand of the PC comes off the brake; the train left by the desk is nobody's
    expect(d.brakeCommand).toBe('hold')
    expect(store.driverOf(a.id)).toBeNull()

    // Keyboard and buttons of the PC no longer move it
    applyConsoleCommand(store, { type: 'notchStep', step: 1 })
    applyConsoleCommand(store, { type: 'notchSet', notch: 5 })
    applyConsoleCommand(store, { type: 'brake', command: 'release' })
    applyConsoleCommand(store, { type: 'reverser', reverser: 'neutral' })
    applyConsoleCommand(store, { type: 'emergencyBrake' })
    applyConsoleCommand(store, { type: 'rerail' })
    store.stepSelectedTrainNotch(1)
    store.setSelectedTrainNotch(4)
    store.toggleSelectedTrainEmergencyBrake()
    expect(d).toMatchObject({ notch: 1, brakeCommand: 'hold', reverser: 'forward', emergencyBrake: false })
    // The desk does
    one({ type: 'notchStep', step: 1 })
    expect(d.notch).toBe(2)
    steps(store, 5)
    expect(d.notch).toBe(2)

    // The PC picks a train no desk holds: it drives again, and the desk keeps the one it took
    applyConsoleCommand(store, { type: 'selectTrain', trainId: c.id })
    expect(store.isSpectating).toBe(false)
    expect(store.selectedTrain).toBe(c)
    applyConsoleCommand(store, { type: 'notchStep', step: 1 })
    expect(c.notch).toBe(1)
    expect(d.notch).toBe(2)
    expect(store.deskTrain(1)).toBe(d)

    // Back on the train of the desk, then the desk lets go: the PC has the controls again
    applyConsoleCommand(store, { type: 'selectTrain', trainId: d.id })
    expect(store.isSpectating).toBe(true)
    one({ type: 'releaseControls' })
    expect(store.isSpectating).toBe(false)
    expect(d.notch).toBe(0)
    applyConsoleCommand(store, { type: 'notchStep', step: 1 })
    expect(d.notch).toBe(1)
    store.togglePlayMode()
  })

  it('tells who drives each train: the PC, a desk by the name it gave, a desk by its number', () => {
    const { store, links, a, b, c, d, last } = twoDesks()
    const drivers = () => buildFleet(store).map((f) => [f.id, f.driven, f.driver, f.driverName])
    expect(drivers()).toEqual([
      [a.id, true, 1, 'Pupitre 1'],
      [b.id, true, 2, 'Léa'],
      [c.id, false, null, undefined],
      [d.id, true, 'host', 'PC'],
    ])
    // Nobody: no `driverName` key at all
    expect(buildFleet(store)[2]).not.toHaveProperty('driverName')
    expect(store.driverName('host')).toBe('PC')
    expect(store.driverName(2)).toBe('Léa')
    expect(store.driverName(7)).toBe('Pupitre 7')
    expect(store.driverName(null)).toBeNull()

    // The desks are sent the same at the next tick, for all of them at once
    vi.advanceTimersByTime(100)
    const fleet = last(links[0], 'fleet')!
    expect(fleet).not.toHaveProperty('to')
    expect(fleet.fleet).toEqual(buildFleet(store))

    // Desk 2 takes the train of the PC: it is Léa's, and the PC drives nothing
    expect(store.takeTrain(d.id, 2)).toBe(true)
    expect(drivers()).toEqual([
      [a.id, true, 1, 'Pupitre 1'],
      [b.id, false, null, undefined],
      [c.id, false, null, undefined],
      [d.id, true, 2, 'Léa'],
    ])
    // A name given again replaces the first; an empty one falls back to the number
    store.seatDesk(1, '  Zoé ')
    store.seatDesk(2, '')
    expect(drivers().map((row) => row[3])).toEqual(['Zoé', undefined, undefined, 'Pupitre 2'])

    // Outside the drive nobody drives anything
    store.togglePlayMode()
    expect(drivers().map((row) => [row[1], row[2], row[3]])).toEqual(new Array(4).fill([false, null, undefined]))
    expect(store.trainDrivers.size).toBe(0)
  })

  it('frees the train of a desk that leaves, and of every desk when the session closes', () => {
    const { store, session, links, a, b, one, two } = twoDesks()
    one({ type: 'notchSet', notch: 2 })
    one({ type: 'brake', command: 'release' })
    two({ type: 'notchSet', notch: 4 })
    links[0].receive({ t: 'peer-left', desk: 1 })
    // At rest at once, and kept for the phone that may only have lost its network
    expect(a).toMatchObject({ notch: 0, brakeCommand: 'hold' })
    expect(store.deskTrain(1)).toBe(a)
    // The same phone back in time finds its train
    links[0].receive({ t: 'peer-joined', desk: 1, back: true })
    vi.advanceTimersByTime(DESK_RETURN_GRACE_MS)
    expect(store.deskTrain(1)).toBe(a)
    // Another phone under that number does not inherit it
    links[0].receive({ t: 'peer-left', desk: 1 })
    links[0].receive({ t: 'peer-joined', desk: 1, name: 'Nouveau' })
    expect(store.deskTrain(1)).toBeNull()
    expect(store.driverName(1)).toBe('Nouveau')
    // Gone for good: given up on after the grace
    links[0].receive({ t: 'peer-left', desk: 1 })
    vi.advanceTimersByTime(DESK_RETURN_GRACE_MS)
    expect([...store.trainDrivers]).toEqual([[b.id, 2]])
    expect([...store.deskNames]).toEqual([[2, 'Léa']])
    expect(b.notch).toBe(4)
    expect(session.getSnapshot()).toMatchObject({ deskConnected: true, desks: [{ desk: 2, name: 'Léa' }] })
    expect(store.isPlayMode).toBe(true)

    session.close()
    expect(store.trainDrivers.size).toBe(0)
    expect(store.deskNames.size).toBe(0)
    expect(b.notch).toBe(0)
    // The PC goes on driving
    expect(store.isPlayMode).toBe(true)
    expect(store.isSpectating).toBe(false)
    store.togglePlayMode()
  })

  it('lets go of every train when the PC leaves the drive, the desks staying seated', () => {
    const { store, session, links, a, one, last } = twoDesks()
    one({ type: 'notchSet', notch: 2 })
    applyConsoleCommand(store, { type: 'releaseControls' })
    expect(store.isPlayMode).toBe(false)
    expect(store.trainDrivers.size).toBe(0)
    expect(a.notch).toBe(0)
    expect(session.getSnapshot()!.desks).toEqual([{ desk: 1 }, { desk: 2, name: 'Léa' }])
    vi.advanceTimersByTime(100)
    expect(last(links[0], 'state', 1)!.state).toBeNull()
    expect(last(links[0], 'state', 2)!.state).toBeNull()
    // A desk that takes a train starts the drive again
    one({ type: 'selectTrain', trainId: a.id }, null)
    expect(store.isPlayMode).toBe(true)
    expect(store.deskTrain(1)).toBe(a)
    store.togglePlayMode()
  })
})
