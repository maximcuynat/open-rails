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
    state: state() as ConsoleState | null,
    fleet: [entry('t_1', 1), entry('t_2', 2)],
    applied: [] as ConsoleCommand[],
  }
  const rooms = ['NEW222', 'NEW333']
  const host = createRemoteHost({
    link,
    getState: () => world.state,
    getFleet: () => world.fleet,
    apply: (command) => {
      world.applied.push(command)
      if (command.type === 'selectTrain') world.state = state(command.trainId)
      if (command.type === 'releaseControls') world.state = null
    },
    room: 'ABC234',
    clientId: 'host-token',
    generateRoom: () => rooms.shift() ?? 'NEW999',
  })
  let seq = 0
  const command = (c: ConsoleCommand, trainId: string | null = 't_1', at = ++seq) => {
    seq = Math.max(seq, at)
    link.receive({ t: 'command', seq: at, trainId, command: c })
  }
  const pair = () => {
    link.receive({ t: 'opened', room: 'ABC234', hosts: ['192.168.1.42'] })
    link.receive({ t: 'peer-joined' })
  }
  const types = (messages: RemoteMessage[]) => messages.map((m) => m.t)
  return { link, world, host, command, pair, types }
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
    expect(link.take()).toEqual([
      { t: 'fleet', fleet: world.fleet },
      { t: 'state', state: world.state, ack: 0 },
    ])
    expect(host.getSnapshot().deskConnected).toBe(true)
  })

  it('sends the state ten times a second', () => {
    const { link, world, pair, types } = setup()
    pair()
    link.take()
    vi.advanceTimersByTime(99)
    expect(link.take()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(link.take()).toEqual([{ t: 'state', state: world.state, ack: 0 }])
    world.state = state('t_1', 14)
    vi.advanceTimersByTime(900)
    const second = link.take()
    expect(types(second)).toEqual(new Array(9).fill('state'))
    expect(second[8]).toEqual({ t: 'state', state: world.state, ack: 0 })
    // null while the PC drives nothing
    world.state = null
    vi.advanceTimersByTime(100)
    expect(link.take()).toEqual([{ t: 'state', state: null, ack: 0 }])
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
    expect(world.applied).toEqual([{ type: 'notchStep', step: 1 }])
    expect(link.take()).toEqual([{ t: 'state', state: world.state, ack: 1 }])
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

  it('ignores a command aimed at a train that is not the one driven, except choosing a train', () => {
    const { link, world, command, pair } = setup()
    pair()
    link.take()
    command({ type: 'notchSet', notch: 5 }, 't_2')
    command({ type: 'emergencyBrake' }, null)
    expect(world.applied).toEqual([])
    // The desk still gets a state, so it sees where the PC stands
    expect(link.take()).toEqual([
      { t: 'state', state: world.state, ack: 1 },
      { t: 'state', state: world.state, ack: 2 },
    ])

    command({ type: 'selectTrain', trainId: 't_2' }, 't_9')
    expect(world.applied).toEqual([{ type: 'selectTrain', trainId: 't_2' }])
    expect(world.state?.trainId).toBe('t_2')
    // Commands for the train left behind are stale now
    command({ type: 'notchStep', step: 1 }, 't_1')
    expect(world.applied).toHaveLength(1)
    command({ type: 'notchStep', step: 1 }, 't_2')
    expect(world.applied).toHaveLength(2)
  })

  it('accepts only the choice of a train while the PC drives nothing', () => {
    const { world, command, pair } = setup()
    world.state = null
    pair()
    command({ type: 'notchStep', step: 1 }, null)
    command({ type: 'releaseControls' }, null)
    expect(world.applied).toEqual([])
    command({ type: 'selectTrain', trainId: 't_2' }, null)
    expect(world.applied).toEqual([{ type: 'selectTrain', trainId: 't_2' }])
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
    left.link.receive({ t: 'peer-left' })
    expect(left.world.applied).toEqual([APPLY, HOLD])
    expect(left.host.getSnapshot().deskConnected).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(left.world.applied).toHaveLength(2)

    const cut = setup()
    cut.pair()
    cut.command(APPLY)
    cut.link.take()
    cut.link.setStatus('connecting')
    expect(cut.world.applied).toEqual([APPLY, HOLD])
    expect(cut.host.getSnapshot()).toMatchObject({ deskConnected: false, ready: false })
    // And nothing is sent into the void
    vi.advanceTimersByTime(1000)
    expect(cut.link.take()).toEqual([])

    // No brake held: nothing to undo
    const idle = setup()
    idle.pair()
    idle.command({ type: 'notchStep', step: 1 })
    idle.link.receive({ t: 'peer-left' })
    expect(idle.world.applied).toEqual([{ type: 'notchStep', step: 1 }])
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
    link.receive({ t: 'peer-left' })
    link.take()
    link.receive({ t: 'peer-joined' })
    expect(link.take()).toEqual([
      { t: 'fleet', fleet: world.fleet },
      { t: 'state', state: world.state, ack: 0 },
    ])
    // A new page counts from 1 again
    command({ type: 'notchStep', step: 1 }, 't_1', 1)
    expect(world.applied).toHaveLength(2)
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
      room: 'ABC234',
    })
    link.receive({ t: 'peer-joined' })
    link.take()
    link.receive({ t: 'command', seq: 1, trainId: 't_1', command: { type: 'switchCab' } })
    expect(link.take()).toEqual([{ t: 'state', state: state(), ack: 1 }])
    expect(error).toHaveBeenCalled()
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
    expect(host.getSnapshot()).toMatchObject({ link: 'closed', deskConnected: false, ready: false })
    expect(listener).toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(link.sent).toHaveLength(1)
    expect(world.applied).toHaveLength(2)
  })

  it('keeps the same snapshot object while nothing changes', () => {
    const { host, pair } = setup()
    pair()
    const before = host.getSnapshot()
    vi.advanceTimersByTime(1000)
    expect(host.getSnapshot()).toBe(before)
  })
})
