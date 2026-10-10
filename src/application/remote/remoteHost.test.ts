import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleCommand, ConsoleState, FleetEntry } from '../console/consoleContract'
import { FakeLink } from './fakeLink'
import { PROTOCOL_VERSION, type RemoteMessage } from './protocol'
import { createRemoteHost } from './remoteHost'

const state = (trainId: string | null = 't_1', speed = 0): ConsoleState => ({
  trainId,
  speed,
  maxSpeed: 80,
  stopped: speed === 0,
  notch: 0,
  minNotch: -5,
  maxNotch: 5,
  handleEffort: 0,
  reverser: 'forward',
  reverserLocked: false,
  emergencyBrake: false,
  emergencyReleasable: false,
  brake: { command: 'hold', tone: 'released', pipeBar: 5, cylinderBar: 0 },
  acceleration: 0,
  gradientPermille: 0,
  stoppingDistance: 0,
  locoCount: 1,
  wagonCount: 0,
  upcomingTurnout: null,
  canSwitchCab: false,
})

const entry = (id: string, rank: number, speed = 0): FleetEntry => ({
  id,
  rank,
  model: 'TGV Duplex',
  locoCount: 1,
  wagonCount: 0,
  speed,
  driven: id === 't_1',
})

function setup(linkStatus: 'open' | 'connecting' = 'open') {
  const link = new FakeLink(linkStatus)
  const world = {
    /** What each desk holds; desk 1 holds t_1 to begin with, the others nothing */
    states: new Map<number, ConsoleState | null>([[1, state()]]),
    /** The state of desk 1, for the tests that seat no other */
    get state(): ConsoleState | null {
      return this.states.get(1) ?? null
    },
    set state(value: ConsoleState | null) {
      this.states.set(1, value)
    },
    fleet: [entry('t_1', 1), entry('t_2', 2)],
    log: [] as { desk: number; command: ConsoleCommand }[],
    /** Every command applied, whoever sent it */
    get applied(): ConsoleCommand[] {
      return this.log.map((line) => line.command)
    },
    appliedBy(desk: number): ConsoleCommand[] {
      return this.log.filter((line) => line.desk === desk).map((line) => line.command)
    },
    /** What the host was told of the seats, in order: `+2 Léa`, `-2` */
    seats: [] as string[],
  }
  const rooms = ['NEW222', 'NEW333']
  const host = createRemoteHost({
    link,
    getState: (desk) => world.states.get(desk) ?? null,
    getFleet: () => world.fleet,
    apply: (desk, command) => {
      world.log.push({ desk, command })
      if (command.type === 'selectTrain') world.states.set(desk, state(command.trainId))
      if (command.type === 'releaseControls') world.states.set(desk, null)
    },
    seat: (desk, name) => world.seats.push(name === undefined ? `+${desk}` : `+${desk} ${name}`),
    unseat: (desk) => world.seats.push(`-${desk}`),
    room: 'ABC234',
    clientId: 'host-token',
    generateRoom: () => rooms.shift() ?? 'NEW999',
  })
  /** The commands of one desk, numbered by that desk as the relay hands them over */
  const from = (desk: number) => {
    let seq = 0
    return (c: ConsoleCommand, trainId: string | null = `t_${desk}`, at = ++seq) => {
      seq = Math.max(seq, at)
      link.receive({ t: 'command', seq: at, trainId, command: c, from: desk })
    }
  }
  const command = from(1)
  const pair = () => {
    link.receive({ t: 'opened', room: 'ABC234', hosts: ['192.168.1.42'] })
    link.receive({ t: 'peer-joined', desk: 1 })
  }
  /** A second desk sits down, at the controls of t_2 */
  const pairSecond = (name?: string) => {
    world.states.set(2, state('t_2'))
    link.receive(name === undefined ? { t: 'peer-joined', desk: 2 } : { t: 'peer-joined', desk: 2, name })
  }
  const types = (messages: RemoteMessage[]) => messages.map((m) => m.t)
  const states = (messages: RemoteMessage[]) => messages.filter((m): m is Extract<RemoteMessage, { t: 'state' }> => m.t === 'state')
  return { link, world, host, command, from, pair, pairSecond, types, states }
}

const HOLD: ConsoleCommand = { type: 'brake', command: 'hold' }
const APPLY: ConsoleCommand = { type: 'brake', command: 'apply' }

describe('remoteHost', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens its room as soon as the link is open, and again after a reconnection', () => {
    const { link, host } = setup('connecting')
    expect(link.take()).toEqual([])
    link.setStatus('open')
    const request = { t: 'host', v: PROTOCOL_VERSION, room: 'ABC234', client: 'host-token' }
    expect(link.take()).toEqual([request])
    link.receive({ t: 'opened', room: 'ABC234', hosts: ['192.168.1.42'] })
    expect(host.getSnapshot()).toMatchObject({
      link: 'open',
      room: 'ABC234',
      ready: true,
      deskConnected: false,
      desks: [],
      hosts: ['192.168.1.42'],
    })
    link.setStatus('connecting')
    expect(host.getSnapshot()).toMatchObject({ link: 'connecting', ready: false })
    link.setStatus('open')
    expect(link.take()).toEqual([request])
  })

  it('sends the fleet then the state when the desk arrives', () => {
    const { link, world, host, pair } = setup()
    link.take()
    vi.advanceTimersByTime(1000)
    // Nobody to talk to yet
    expect(link.take()).toEqual([])
    pair()
    // The fleet is for everyone, the state for that desk
    expect(link.take()).toEqual([
      { t: 'fleet', fleet: world.fleet },
      { t: 'state', state: world.state, ack: 0, to: 1 },
    ])
    expect(host.getSnapshot()).toMatchObject({ deskConnected: true, desks: [{ desk: 1 }] })
    expect(world.seats).toEqual(['+1'])
  })

  it('seats each desk under its number and its name, and sends the newcomer what it needs', () => {
    const { link, world, host, pair } = setup()
    pair()
    link.take()
    world.states.set(3, state('t_2'))
    link.receive({ t: 'peer-joined', desk: 3, name: 'Léa' })
    // Everyone is sent the fleet again; the state goes to the newcomer alone
    expect(link.take()).toEqual([
      { t: 'fleet', fleet: world.fleet },
      { t: 'state', state: state('t_2'), ack: 0, to: 3 },
    ])
    link.receive({ t: 'peer-joined', desk: 2 })
    // By number, whatever the order of arrival; a desk without a name has no `name` at all
    expect(host.getSnapshot().desks).toEqual([{ desk: 1 }, { desk: 2 }, { desk: 3, name: 'Léa' }])
    expect(host.getSnapshot().deskConnected).toBe(true)
    expect(world.seats).toEqual(['+1', '+3 Léa', '+2'])
  })

  it('sends the state ten times a second', () => {
    const { link, world, pair, types } = setup()
    pair()
    link.take()
    vi.advanceTimersByTime(99)
    expect(link.take()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(link.take()).toEqual([{ t: 'state', state: world.state, ack: 0, to: 1 }])
    world.state = state('t_1', 14)
    vi.advanceTimersByTime(900)
    const second = link.take()
    expect(types(second)).toEqual(new Array(9).fill('state'))
    expect(second[8]).toEqual({ t: 'state', state: world.state, ack: 0, to: 1 })
    // null while the desk holds no train
    world.state = null
    vi.advanceTimersByTime(100)
    expect(link.take()).toEqual([{ t: 'state', state: null, ack: 0, to: 1 }])
  })

  it('sends each desk its own state, named by `to`, at every tick', () => {
    const { link, world, pair, pairSecond, states } = setup()
    pair()
    pairSecond()
    link.take()
    world.states.set(1, state('t_1', 10))
    world.states.set(2, state('t_2', 25))
    vi.advanceTimersByTime(100)
    expect(link.take()).toEqual([
      { t: 'state', state: state('t_1', 10), ack: 0, to: 1 },
      { t: 'state', state: state('t_2', 25), ack: 0, to: 2 },
    ])
    // One ticker for the room, not one per desk
    vi.advanceTimersByTime(1000)
    const sent = states(link.take())
    expect(sent.filter((m) => m.to === 1)).toHaveLength(10)
    expect(sent.filter((m) => m.to === 2)).toHaveLength(10)
    // Never a state for everyone: a desk would show the train of another
    expect(sent.every((m) => m.to === 1 || m.to === 2)).toBe(true)
    expect(sent.every((m) => m.state?.trainId === `t_${m.to}`)).toBe(true)
  })

  it('sends the fleet again when it changes, and its speeds once a second', () => {
    const { link, world, pair } = setup()
    pair()
    link.take()
    const fleets = () => link.take().filter((m) => m.t === 'fleet')

    world.fleet = [...world.fleet, entry('t_3', 3)]
    vi.advanceTimersByTime(100)
    expect(fleets()).toEqual([{ t: 'fleet', fleet: world.fleet }])
    vi.advanceTimersByTime(100)
    expect(fleets()).toEqual([])

    // Only a speed moved: not worth a message at every tick
    world.fleet = [entry('t_1', 1, 20), entry('t_2', 2), entry('t_3', 3)]
    vi.advanceTimersByTime(700)
    expect(fleets()).toEqual([])
    vi.advanceTimersByTime(100)
    expect(fleets()).toEqual([{ t: 'fleet', fleet: world.fleet }])
    vi.advanceTimersByTime(2000)
    expect(fleets()).toEqual([])

    // A train removed, another driven: sent at the next tick
    world.fleet = [entry('t_2', 2)]
    vi.advanceTimersByTime(100)
    expect(fleets()).toEqual([{ t: 'fleet', fleet: world.fleet }])
  })

  it('applies a command and answers with the state at once', () => {
    const { link, world, command, pair } = setup()
    pair()
    link.take()
    command({ type: 'notchStep', step: 1 })
    expect(world.log).toEqual([{ desk: 1, command: { type: 'notchStep', step: 1 } }])
    expect(link.take()).toEqual([{ t: 'state', state: world.state, ack: 1, to: 1 }])
  })

  it('ignores a command the relay did not stamp with a seated desk', () => {
    const { link, world, pair } = setup()
    pair()
    link.take()
    const notch: ConsoleCommand = { type: 'notchStep', step: 1 }
    // No number, or the number of a desk that is not there: nothing applied, nothing answered
    link.receive({ t: 'command', seq: 1, trainId: 't_1', command: notch })
    link.receive({ t: 'command', seq: 2, trainId: 't_1', command: notch, from: 2 })
    link.receive({ t: 'command', seq: 3, trainId: null, command: { type: 'selectTrain', trainId: 't_2' }, from: 5 })
    expect(world.log).toEqual([])
    expect(link.take()).toEqual([])
    // And they did not use up the sequence of desk 1
    link.receive({ t: 'command', seq: 1, trainId: 't_1', command: notch, from: 1 })
    expect(world.log).toEqual([{ desk: 1, command: notch }])
  })

  it('ignores a command that is not newer than the last one', () => {
    const { world, command, pair } = setup()
    pair()
    command({ type: 'notchStep', step: 1 }, 't_1', 5)
    command({ type: 'notchStep', step: -1 }, 't_1', 5)
    command({ type: 'emergencyBrake' }, 't_1', 3)
    expect(world.applied).toEqual([{ type: 'notchStep', step: 1 }])
    command({ type: 'switchCab' }, 't_1', 6)
    expect(world.applied).toHaveLength(2)
  })

  it('ignores a command aimed at a train that is not the one the desk holds, except choosing a train', () => {
    const { link, world, command, pair } = setup()
    pair()
    link.take()
    command({ type: 'notchSet', notch: 5 }, 't_2')
    command({ type: 'emergencyBrake' }, null)
    expect(world.applied).toEqual([])
    // The desk still gets a state, so it sees where the PC stands
    expect(link.take()).toEqual([
      { t: 'state', state: world.state, ack: 1, to: 1 },
      { t: 'state', state: world.state, ack: 2, to: 1 },
    ])

    command({ type: 'selectTrain', trainId: 't_2' }, 't_9')
    expect(world.applied).toEqual([{ type: 'selectTrain', trainId: 't_2' }])
    expect(world.state?.trainId).toBe('t_2')
    // Commands for the train left behind are stale now
    command({ type: 'notchStep', step: 1 }, 't_1')
    expect(world.applied).toHaveLength(1)
    command({ type: 'notchStep', step: 1 }, 't_2')
    expect(world.applied).toHaveLength(2)
    // Moving on to the next train needs no matching train either
    command({ type: 'selectTrainByOffset', offset: 1 }, 't_9')
    command({ type: 'selectTrainByOffset', offset: -1 }, null)
    expect(world.applied.slice(2)).toEqual([
      { type: 'selectTrainByOffset', offset: 1 },
      { type: 'selectTrainByOffset', offset: -1 },
    ])
  })

  it('accepts only the choice of a train while the desk holds none', () => {
    const { link, world, command, pair } = setup()
    world.state = null
    pair()
    link.take()
    command({ type: 'notchStep', step: 1 }, null)
    command({ type: 'releaseControls' }, null)
    command({ type: 'emergencyBrake' }, 't_1')
    expect(world.applied).toEqual([])
    // Each one is still answered, so the desk sees it holds nothing
    expect(link.take()).toEqual([
      { t: 'state', state: null, ack: 1, to: 1 },
      { t: 'state', state: null, ack: 2, to: 1 },
      { t: 'state', state: null, ack: 3, to: 1 },
    ])
    command({ type: 'selectTrainByOffset', offset: 1 }, null)
    command({ type: 'selectTrain', trainId: 't_2' }, null)
    expect(world.log).toEqual([
      { desk: 1, command: { type: 'selectTrainByOffset', offset: 1 } },
      { desk: 1, command: { type: 'selectTrain', trainId: 't_2' } },
    ])
  })

  it('keeps two desks and their two trains apart, whatever the order of their commands', () => {
    const { link, world, from, pair, pairSecond } = setup()
    pair()
    pairSecond('Léa')
    link.take()
    const one = from(1)
    const two = from(2)
    const up: ConsoleCommand = { type: 'notchStep', step: 1 }
    const down: ConsoleCommand = { type: 'notchStep', step: -1 }

    one(up)
    two(down)
    two({ type: 'emergencyBrake' })
    one({ type: 'switchCab' })
    expect(world.log).toEqual([
      { desk: 1, command: up },
      { desk: 2, command: down },
      { desk: 2, command: { type: 'emergencyBrake' } },
      { desk: 1, command: { type: 'switchCab' } },
    ])
    // Each is answered alone, with its own train and its own sequence
    expect(link.take()).toEqual([
      { t: 'state', state: state('t_1'), ack: 1, to: 1 },
      { t: 'state', state: state('t_2'), ack: 1, to: 2 },
      { t: 'state', state: state('t_2'), ack: 2, to: 2 },
      { t: 'state', state: state('t_1'), ack: 2, to: 1 },
    ])

    // A desk that names the train of the other moves nothing: not its own train, not the other's
    one(up, 't_2')
    two(up, 't_1')
    expect(world.log).toHaveLength(4)
    expect(link.take()).toEqual([
      { t: 'state', state: state('t_1'), ack: 3, to: 1 },
      { t: 'state', state: state('t_2'), ack: 3, to: 2 },
    ])

    // The sequences are counted per desk: a high number from one does not make the other stale
    one(up, 't_1', 500)
    two(down, 't_2', 4)
    one(down, 't_1', 4)
    expect(world.appliedBy(1)).toEqual([up, { type: 'switchCab' }, up])
    expect(world.appliedBy(2)).toEqual([down, { type: 'emergencyBrake' }, down])
    // What is stale is not even answered
    expect(link.take()).toEqual([
      { t: 'state', state: state('t_1'), ack: 500, to: 1 },
      { t: 'state', state: state('t_2'), ack: 4, to: 2 },
    ])

    // They swap trains: each state follows its desk
    one({ type: 'releaseControls' })
    two({ type: 'selectTrain', trainId: 't_1' })
    one({ type: 'selectTrain', trainId: 't_2' })
    link.take()
    one(up, 't_2')
    two(down, 't_1')
    one(up, 't_1')
    expect(world.log.slice(-2)).toEqual([
      { desk: 1, command: up },
      { desk: 2, command: down },
    ])
    expect(link.take()).toEqual([
      { t: 'state', state: state('t_2'), ack: 503, to: 1 },
      { t: 'state', state: state('t_1'), ack: 6, to: 2 },
      // Dropped (desk 1 no longer holds t_1) but answered
      { t: 'state', state: state('t_2'), ack: 504, to: 1 },
    ])
  })

  it('drives the legacy locomotive, whose train id is null', () => {
    const { world, command, pair } = setup()
    world.state = state(null)
    pair()
    command({ type: 'notchStep', step: 1 }, null)
    expect(world.applied).toEqual([{ type: 'notchStep', step: 1 }])
  })

  it('goes back to hold when a held brake command stops being repeated', () => {
    const { world, command, pair } = setup()
    pair()
    command(APPLY)
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(200)
      command(APPLY)
    }
    expect(world.applied).toEqual(new Array(6).fill(APPLY))
    vi.advanceTimersByTime(599)
    expect(world.applied).toHaveLength(6)
    vi.advanceTimersByTime(1)
    expect(world.applied).toEqual([...new Array(6).fill(APPLY), HOLD])
    // Once, not at every timeout
    vi.advanceTimersByTime(5000)
    expect(world.applied).toHaveLength(7)
    expect(world.appliedBy(1)).toHaveLength(7)
  })

  it('puts back to hold the brake of the one desk that fell silent, and of no other', () => {
    const { link, world, host, from, pair, pairSecond, states } = setup()
    pair()
    pairSecond()
    const one = from(1)
    const two = from(2)
    const RELEASE: ConsoleCommand = { type: 'brake', command: 'release' }
    one(APPLY)
    two(RELEASE)
    // Desk 2 keeps repeating; desk 1 says nothing more
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(200)
      two(RELEASE)
    }
    vi.advanceTimersByTime(199)
    expect(world.appliedBy(1)).toEqual([APPLY])
    vi.advanceTimersByTime(1)
    // 600 ms after its last word: desk 1 alone, and in its own name
    expect(world.log.slice(-1)).toEqual([{ desk: 1, command: HOLD }])
    expect(world.appliedBy(1)).toEqual([APPLY, HOLD])
    expect(world.appliedBy(2)).toEqual([RELEASE, RELEASE, RELEASE])
    // The silent desk is still seated and still told its state
    expect(host.getSnapshot().desks).toEqual([{ desk: 1 }, { desk: 2 }])
    link.take()
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(200)
      two(RELEASE)
    }
    expect(world.appliedBy(1)).toEqual([APPLY, HOLD])
    expect(world.appliedBy(2)).toEqual(new Array(13).fill(RELEASE))
    expect(states(link.take()).some((m) => m.to === 1)).toBe(true)
    // Desk 2 in its turn, 600 ms after it stops; a hold it sends itself adds none
    one(APPLY)
    one(HOLD)
    vi.advanceTimersByTime(600)
    expect(world.appliedBy(1)).toEqual([APPLY, HOLD, APPLY, HOLD])
    expect(world.appliedBy(2)).toEqual([...new Array(13).fill(RELEASE), HOLD])
    vi.advanceTimersByTime(5000)
    expect(world.log).toHaveLength(18)
  })

  it('does not add a hold when the desk sent one itself', () => {
    const { world, command, pair } = setup()
    pair()
    command({ type: 'brake', command: 'release' })
    vi.advanceTimersByTime(200)
    command(HOLD)
    vi.advanceTimersByTime(5000)
    expect(world.applied).toEqual([{ type: 'brake', command: 'release' }, HOLD])
  })

  it('goes back to hold when the desk leaves or the link drops', () => {
    const left = setup()
    left.pair()
    left.command(APPLY)
    // Without a number it is a message for a desk (the room is gone): the host does nothing of it
    left.link.receive({ t: 'peer-left' })
    left.link.receive({ t: 'peer-left', desk: 2 })
    expect(left.world.applied).toEqual([APPLY])
    expect(left.host.getSnapshot().deskConnected).toBe(true)
    left.link.receive({ t: 'peer-left', desk: 1 })
    expect(left.world.log).toEqual([
      { desk: 1, command: APPLY },
      { desk: 1, command: HOLD },
    ])
    expect(left.host.getSnapshot()).toMatchObject({ deskConnected: false, desks: [] })
    // The brake is put back while the desk still holds its train, then the seat is given up
    expect(left.world.seats).toEqual(['+1', '-1'])
    vi.advanceTimersByTime(5000)
    expect(left.world.applied).toHaveLength(2)

    const cut = setup()
    cut.pair()
    cut.command(APPLY)
    cut.link.take()
    cut.link.setStatus('connecting')
    expect(cut.world.applied).toEqual([APPLY, HOLD])
    expect(cut.host.getSnapshot()).toMatchObject({ deskConnected: false, desks: [], ready: false })
    expect(cut.world.seats).toEqual(['+1', '-1'])
    // And nothing is sent into the void
    vi.advanceTimersByTime(1000)
    expect(cut.link.take()).toEqual([])

    // No brake held: nothing to undo
    const idle = setup()
    idle.pair()
    idle.command({ type: 'notchStep', step: 1 })
    idle.link.receive({ t: 'peer-left', desk: 1 })
    expect(idle.world.applied).toEqual([{ type: 'notchStep', step: 1 }])
  })

  it('lets one desk go and keeps serving the others', () => {
    const { link, world, host, from, pair, pairSecond, states } = setup()
    pair()
    pairSecond('Léa')
    const one = from(1)
    const two = from(2)
    one(APPLY)
    two(APPLY)
    link.take()
    link.receive({ t: 'peer-left', desk: 1 })
    // Its brake goes back to hold, its seat is given up; desk 2 keeps its brake and its seat
    expect(world.appliedBy(1)).toEqual([APPLY, HOLD])
    expect(world.appliedBy(2)).toEqual([APPLY])
    expect(world.seats).toEqual(['+1', '+2 Léa', '-1'])
    expect(host.getSnapshot()).toMatchObject({ deskConnected: true, desks: [{ desk: 2, name: 'Léa' }] })
    // Nothing more is sent to the desk that left, and its late commands are ignored
    vi.advanceTimersByTime(500)
    two(APPLY)
    one({ type: 'notchStep', step: 1 })
    const sent = states(link.take())
    expect(sent).toHaveLength(6)
    expect(sent.every((m) => m.to === 2 && m.state?.trainId === 't_2')).toBe(true)
    expect(world.appliedBy(1)).toHaveLength(2)
    expect(world.appliedBy(2)).toEqual([APPLY, APPLY])
    // The last one out stops the ticker
    link.receive({ t: 'peer-left', desk: 2 })
    expect(world.seats).toEqual(['+1', '+2 Léa', '-1', '-2'])
    expect(world.appliedBy(2)).toEqual([APPLY, APPLY, HOLD])
    expect(host.getSnapshot()).toMatchObject({ deskConnected: false, desks: [] })
    link.take()
    vi.advanceTimersByTime(5000)
    expect(link.take()).toEqual([])
    expect(world.log).toHaveLength(5)
  })

  it('unseats every desk when the link drops', () => {
    const { link, world, host, from, pair, pairSecond } = setup()
    pair()
    pairSecond()
    from(2)(APPLY)
    link.setStatus('connecting')
    expect(world.log).toEqual([
      { desk: 2, command: APPLY },
      { desk: 2, command: HOLD },
    ])
    expect(world.seats).toEqual(['+1', '+2', '-1', '-2'])
    expect(host.getSnapshot()).toMatchObject({ deskConnected: false, desks: [], ready: false })
  })

  it('puts the brake back to hold before leaving a train', () => {
    const { world, command, pair } = setup()
    pair()
    command(APPLY)
    command({ type: 'selectTrain', trainId: 't_2' })
    expect(world.applied).toEqual([APPLY, HOLD, { type: 'selectTrain', trainId: 't_2' }])
    vi.advanceTimersByTime(5000)
    expect(world.applied).toHaveLength(3)
  })

  it('starts afresh with a desk that comes back', () => {
    const { link, world, command, pair } = setup()
    pair()
    command({ type: 'notchStep', step: 1 }, 't_1', 40)
    link.receive({ t: 'peer-left', desk: 1 })
    link.take()
    link.receive({ t: 'peer-joined', desk: 1 })
    expect(link.take()).toEqual([
      { t: 'fleet', fleet: world.fleet },
      { t: 'state', state: world.state, ack: 0, to: 1 },
    ])
    // A new page counts from 1 again
    command({ type: 'notchStep', step: 1 }, 't_1', 1)
    expect(world.applied).toHaveLength(2)
    expect(world.seats).toEqual(['+1', '-1', '+1'])
  })

  it('takes an arrival under a number already seated for a desk that came back', () => {
    const { link, world, host, command, pair } = setup()
    pair()
    command(APPLY, 't_1', 40)
    link.take()
    // The departure was lost on the way: the arrival alone says the desk is a new one
    link.receive({ t: 'peer-joined', desk: 1, name: 'Léa' })
    expect(world.applied).toEqual([APPLY, HOLD])
    expect(world.seats).toEqual(['+1', '-1', '+1 Léa'])
    expect(host.getSnapshot().desks).toEqual([{ desk: 1, name: 'Léa' }])
    expect(link.take()).toEqual([
      { t: 'fleet', fleet: world.fleet },
      { t: 'state', state: world.state, ack: 0, to: 1 },
    ])
    command({ type: 'notchStep', step: 1 }, 't_1', 1)
    expect(world.applied).toHaveLength(3)
    // One ticker still, not two
    link.take()
    vi.advanceTimersByTime(1000)
    expect(link.take().filter((m) => m.t === 'state')).toHaveLength(10)
  })

  it('ignores commands while no desk is seated', () => {
    const { link, world, command } = setup()
    link.receive({ t: 'opened', room: 'ABC234', hosts: [] })
    command({ type: 'emergencyBrake' })
    expect(world.applied).toEqual([])
  })

  it('survives a command that throws', () => {
    const link = new FakeLink()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    createRemoteHost({
      link,
      getState: () => state(),
      getFleet: () => [],
      apply: () => {
        throw new Error('boom')
      },
      seat: () => {
        throw new Error('no chair')
      },
      unseat: () => {
        throw new Error('stuck')
      },
      room: 'ABC234',
    })
    link.receive({ t: 'peer-joined', desk: 1 })
    expect(error).toHaveBeenCalledTimes(1)
    link.take()
    link.receive({ t: 'command', seq: 1, trainId: 't_1', command: { type: 'switchCab' }, from: 1 })
    expect(link.take()).toEqual([{ t: 'state', state: state(), ack: 1, to: 1 }])
    expect(error).toHaveBeenCalledTimes(2)
    // A seat that cannot be given up does not keep the desk in the room
    link.receive({ t: 'peer-left', desk: 1 })
    expect(error).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(1000)
    expect(link.take()).toEqual([])
    error.mockRestore()
  })

  it('draws another code when the relay says the room is taken', () => {
    const { link, host } = setup()
    link.take()
    link.receive({ t: 'error', code: 'room-taken' })
    expect(host.getSnapshot()).toMatchObject({ room: 'NEW222', ready: false })
    // The relay closed the connection; the link comes back
    link.setStatus('connecting')
    link.setStatus('open')
    expect(link.take()).toEqual([
      { t: 'host', v: PROTOCOL_VERSION, room: 'NEW222', client: 'host-token' },
    ])
  })

  it('gives up on a version mismatch', () => {
    const { link, host } = setup()
    link.receive({ t: 'error', code: 'version' })
    expect(host.getSnapshot()).toMatchObject({ error: 'version', link: 'closed', ready: false })
    expect(link.status).toBe('closed')
  })

  it('says bye, releases the brake and closes the link when stopped', () => {
    const { link, world, host, command, pair } = setup()
    const listener = vi.fn()
    host.subscribe(listener)
    pair()
    command(APPLY)
    link.take()
    host.stop()
    expect(link.sent).toEqual([{ t: 'bye' }])
    expect(world.applied).toEqual([APPLY, HOLD])
    expect(link.status).toBe('closed')
    expect(host.getSnapshot()).toMatchObject({ link: 'closed', deskConnected: false, desks: [], ready: false })
    expect(world.seats).toEqual(['+1', '-1'])
    expect(listener).toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(link.sent).toHaveLength(1)
    expect(world.applied).toHaveLength(2)
  })

  it('says bye once for the whole room and lets every desk go when stopped', () => {
    const { link, world, host, from, pair, pairSecond } = setup()
    pair()
    pairSecond()
    from(1)(APPLY)
    from(2)({ type: 'brake', command: 'release' })
    link.take()
    host.stop()
    // One `bye` without a number: the relay hands it to every desk
    expect(link.sent).toEqual([{ t: 'bye' }])
    expect(world.appliedBy(1)).toEqual([APPLY, HOLD])
    expect(world.appliedBy(2)).toEqual([{ type: 'brake', command: 'release' }, HOLD])
    expect(world.seats).toEqual(['+1', '+2', '-1', '-2'])
    expect(host.getSnapshot()).toMatchObject({ link: 'closed', deskConnected: false, desks: [] })
  })

  it('keeps the same snapshot object while nothing changes', () => {
    const { host, pair } = setup()
    pair()
    const before = host.getSnapshot()
    vi.advanceTimersByTime(1000)
    expect(host.getSnapshot()).toBe(before)
  })
})
