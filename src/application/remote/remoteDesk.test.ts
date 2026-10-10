import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleCommand, ConsoleState, FleetEntry } from '../console/consoleContract'
import { FakeLink } from './fakeLink'
import { MAX_DRIVER_NAME_LENGTH, PROTOCOL_VERSION } from './protocol'
import { createRemoteDesk } from './remoteDesk'

const STATE: ConsoleState = {
  trainId: 't_1',
  speed: 3,
  maxSpeed: 80,
  stopped: false,
  notch: 1,
  minNotch: -5,
  maxNotch: 5,
  handleEffort: 0.2,
  reverser: 'forward',
  reverserLocked: true,
  emergencyBrake: false,
  emergencyReleasable: false,
  brake: null,
  acceleration: 0.1,
  gradientPermille: 0,
  stoppingDistance: 12,
  locoCount: 1,
  wagonCount: 0,
  upcomingTurnout: null,
  canSwitchCab: false,
}

const FLEET: FleetEntry[] = [
  { id: 't_1', rank: 1, model: 'TGV Duplex', locoCount: 1, wagonCount: 0, speed: 3, driven: true },
]

const JOIN = { t: 'join', v: PROTOCOL_VERSION, room: 'ABC234', client: 'desk-token' }
const APPLY: ConsoleCommand = { type: 'brake', command: 'apply' }
const HOLD: ConsoleCommand = { type: 'brake', command: 'hold' }

function setup(linkStatus: 'open' | 'connecting' = 'open') {
  const link = new FakeLink(linkStatus)
  const desk = createRemoteDesk({ link, room: 'ABC234', clientId: 'desk-token', rejoinGraceMs: 20000 })
  const seat = () => {
    link.receive({ t: 'joined', room: 'ABC234', desk: 1 })
    link.receive({ t: 'fleet', fleet: FLEET })
    link.receive({ t: 'state', state: STATE, ack: 0 })
    link.take()
  }
  return { link, desk, seat }
}

describe('remoteDesk', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('joins its room when the link opens, and again after a reconnection', () => {
    const { link, desk } = setup('connecting')
    expect(desk.getSnapshot()).toMatchObject({ link: 'connecting', joined: false, desk: null })
    link.setStatus('open')
    expect(link.take()).toEqual([JOIN])
    link.receive({ t: 'joined', room: 'ABC234', desk: 1 })
    expect(desk.getSnapshot()).toMatchObject({ link: 'open', joined: true, desk: 1, ended: null })
    link.setStatus('connecting')
    expect(desk.getSnapshot()).toMatchObject({ link: 'connecting', joined: false, state: null })
    link.setStatus('open')
    expect(link.take()).toEqual([JOIN])
  })

  it('knows the number it sits under, and takes the one it is given when it comes back', () => {
    const { link, desk } = setup()
    expect(desk.getSnapshot().desk).toBeNull()
    link.receive({ t: 'joined', room: 'ABC234', desk: 3 })
    expect(desk.getSnapshot()).toMatchObject({ joined: true, desk: 3 })
    // What the PC sends it is its own, whatever `to` says: the relay did the sorting
    link.receive({ t: 'fleet', fleet: FLEET })
    link.receive({ t: 'state', state: STATE, ack: 2, to: 3 })
    expect(desk.getSnapshot()).toMatchObject({ desk: 3, fleet: FLEET, state: STATE, ack: 2 })
    // The room reopened and another desk got there first
    link.setStatus('connecting')
    link.setStatus('open')
    link.receive({ t: 'joined', room: 'ABC234', desk: 5 })
    expect(desk.getSnapshot()).toMatchObject({ joined: true, desk: 5 })
  })

  it('gives the name of its driver when it joins, trimmed and cut to what the protocol takes', () => {
    const joinOf = (name: string | undefined) => {
      const link = new FakeLink('connecting')
      createRemoteDesk({ link, room: 'ABC234', clientId: 'desk-token', name })
      link.setStatus('open')
      const first = link.take()
      // The same again after a reconnection
      link.setStatus('connecting')
      link.setStatus('open')
      expect(link.take()).toEqual(first)
      return first
    }
    expect(joinOf('Léa')).toEqual([{ ...JOIN, name: 'Léa' }])
    expect(joinOf('  Léa  ')).toEqual([{ ...JOIN, name: 'Léa' }])
    expect(joinOf('x'.repeat(50))).toEqual([{ ...JOIN, name: 'x'.repeat(MAX_DRIVER_NAME_LENGTH) }])
    // No name, or nothing but spaces: no `name` at all, the PC then says « Pupitre N »
    expect(joinOf(undefined)).toEqual([JOIN])
    expect(joinOf('')).toEqual([JOIN])
    expect(joinOf('   ')).toEqual([JOIN])
    // A link already open joins at once, name included
    const link = new FakeLink()
    createRemoteDesk({ link, room: 'ABC234', clientId: 'desk-token', name: 'Léa' })
    expect(link.take()).toEqual([{ ...JOIN, name: 'Léa' }])
  })

  it('never says which desk it is: the relay does', () => {
    const { link, desk, seat } = setup()
    seat()
    desk.send({ type: 'notchStep', step: 1 })
    desk.send(APPLY)
    vi.advanceTimersByTime(400)
    const sent = link.take()
    expect(sent).toHaveLength(4)
    for (const message of sent) expect(message).not.toHaveProperty('from')
  })

  it('exposes the fleet and the state to its subscribers', () => {
    const { link, desk } = setup()
    const listener = vi.fn()
    const unsubscribe = desk.subscribe(listener)
    link.receive({ t: 'joined', room: 'ABC234', desk: 1 })
    link.receive({ t: 'fleet', fleet: FLEET })
    link.receive({ t: 'state', state: STATE, ack: 4 })
    expect(listener).toHaveBeenCalledTimes(3)
    expect(desk.getSnapshot()).toMatchObject({ joined: true, fleet: FLEET, state: STATE, ack: 4 })
    const before = desk.getSnapshot()
    expect(desk.getSnapshot()).toBe(before)
    unsubscribe()
    link.receive({ t: 'state', state: null, ack: 4 })
    expect(listener).toHaveBeenCalledTimes(3)
    expect(desk.getSnapshot().state).toBeNull()
  })

  it('numbers its commands and aims them at the train it shows', () => {
    const { link, desk, seat } = setup()
    seat()
    expect(desk.send({ type: 'notchStep', step: 1 })).toBe(1)
    expect(desk.send({ type: 'selectTrain', trainId: 't_2' })).toBe(2)
    expect(link.take()).toEqual([
      { t: 'command', seq: 1, trainId: 't_1', command: { type: 'notchStep', step: 1 } },
      { t: 'command', seq: 2, trainId: 't_2', command: { type: 'selectTrain', trainId: 't_2' } },
    ])
    link.receive({ t: 'state', state: null, ack: 2 })
    desk.send({ type: 'selectTrain', trainId: 't_1' })
    expect(link.take()).toEqual([
      { t: 'command', seq: 3, trainId: 't_1', command: { type: 'selectTrain', trainId: 't_1' } },
    ])
  })

  it('sends nothing before it is seated', () => {
    const { link, desk } = setup()
    link.take()
    expect(desk.send({ type: 'emergencyBrake' })).toBe(0)
    expect(link.take()).toEqual([])
  })

  it('repeats a held brake command every 200 ms until hold', () => {
    const { link, desk, seat } = setup()
    seat()
    desk.send(APPLY)
    vi.advanceTimersByTime(650)
    const sent = link.take()
    expect(sent).toHaveLength(4)
    expect(sent.map((m) => (m.t === 'command' ? m.seq : 0))).toEqual([1, 2, 3, 4])
    expect(sent.every((m) => m.t === 'command' && m.command === APPLY)).toBe(true)

    desk.send(HOLD)
    vi.advanceTimersByTime(1000)
    expect(link.take()).toEqual([{ t: 'command', seq: 5, trainId: 't_1', command: HOLD }])

    // Switching from apply to release keeps one repetition going, not two
    desk.send(APPLY)
    desk.send({ type: 'brake', command: 'release' })
    link.take()
    vi.advanceTimersByTime(400)
    expect(link.take().map((m) => (m.t === 'command' ? m.command : null))).toEqual([
      { type: 'brake', command: 'release' },
      { type: 'brake', command: 'release' },
    ])
  })

  it('stops repeating when the link drops, and does not resume by itself', () => {
    const { link, desk, seat } = setup()
    seat()
    desk.send(APPLY)
    link.take()
    link.setStatus('connecting')
    vi.advanceTimersByTime(1000)
    link.setStatus('open')
    link.receive({ t: 'joined', room: 'ABC234', desk: 1 })
    link.take()
    vi.advanceTimersByTime(1000)
    expect(link.take()).toEqual([])
  })

  it('ends when the PC cuts the link', () => {
    const { link, desk, seat } = setup()
    seat()
    link.receive({ t: 'bye' })
    expect(desk.getSnapshot()).toMatchObject({ ended: 'host-closed', joined: false, link: 'closed' })
    expect(link.status).toBe('closed')
    expect(desk.send({ type: 'emergencyBrake' })).toBe(0)
  })

  it('ends on a refusal of the relay', () => {
    for (const code of ['unknown-room', 'room-full', 'version'] as const) {
      const { link, desk } = setup()
      link.receive({ t: 'error', code })
      expect(desk.getSnapshot().ended).toBe(code)
      expect(link.status).toBe('closed')
    }
  })

  it('keeps trying for a while when the room it sat in disappears', () => {
    const { link, desk, seat } = setup()
    seat()
    // The PC's connection dropped: the relay closed the room and our socket. No number: it is the
    // room that is gone, not a desk
    link.receive({ t: 'peer-left' })
    expect(desk.getSnapshot()).toMatchObject({ joined: false, state: null, ended: null })
    link.setStatus('connecting')
    vi.advanceTimersByTime(2000)
    link.setStatus('open')
    expect(link.take()).toEqual([JOIN])
    link.receive({ t: 'error', code: 'unknown-room' })
    expect(desk.getSnapshot().ended).toBeNull()
    // The PC is back under the same code
    link.setStatus('connecting')
    vi.advanceTimersByTime(2000)
    link.setStatus('open')
    link.receive({ t: 'joined', room: 'ABC234', desk: 1 })
    expect(desk.getSnapshot()).toMatchObject({ joined: true, ended: null })
  })

  it('gives up when the room does not come back', () => {
    const { link, desk, seat } = setup()
    seat()
    link.receive({ t: 'peer-left' })
    link.setStatus('connecting')
    vi.advanceTimersByTime(20000)
    link.setStatus('open')
    link.receive({ t: 'error', code: 'unknown-room' })
    expect(desk.getSnapshot().ended).toBe('unknown-room')
    expect(link.status).toBe('closed')
  })

  it('releases a held brake and closes the link when stopped', () => {
    const { link, desk, seat } = setup()
    seat()
    desk.send(APPLY)
    link.take()
    desk.stop()
    expect(link.sent).toEqual([{ t: 'command', seq: 2, trainId: 't_1', command: HOLD }])
    expect(link.status).toBe('closed')
    expect(desk.getSnapshot()).toMatchObject({ link: 'closed', joined: false, ended: null })
    vi.advanceTimersByTime(1000)
    expect(link.sent).toHaveLength(1)
  })
})
