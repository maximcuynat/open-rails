import { describe, expect, it } from 'vitest'
import {
  MAX_DESKS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  type RemoteMessage,
} from '../../src/application/remote/protocol'
import { RoomRelay, type RelayConnection } from './rooms'

class FakeConnection implements RelayConnection {
  sent: RemoteMessage[] = []
  closed = false
  send(data: string): void {
    this.sent.push(JSON.parse(data) as RemoteMessage)
  }
  close(): void {
    this.closed = true
  }
  /** Messages received since the last call */
  take(): RemoteMessage[] {
    const out = this.sent
    this.sent = []
    return out
  }
}

const STATE: RemoteMessage = { t: 'state', state: null, ack: 0 }
const COMMAND: RemoteMessage = {
  t: 'command',
  seq: 1,
  trainId: 't_1',
  command: { type: 'notchStep', step: 1 },
}

function setup(options: { timeoutMs?: number } = {}) {
  let now = 0
  const relay = new RoomRelay({ now: () => now, hosts: () => ['192.168.1.42'], ...options })
  const connect = () => {
    const conn = new FakeConnection()
    relay.connect(conn)
    return conn
  }
  const say = (conn: FakeConnection, message: unknown) => relay.receive(conn, JSON.stringify(message))
  const host = (room = 'ABC234', client = 'host-token') => {
    const conn = connect()
    say(conn, { t: 'host', v: PROTOCOL_VERSION, room, client })
    return conn
  }
  const desk = (room = 'ABC234', client = 'desk-token', name?: string) => {
    const conn = connect()
    say(conn, name === undefined ? { t: 'join', v: PROTOCOL_VERSION, room, client } : { t: 'join', v: PROTOCOL_VERSION, room, client, name })
    return conn
  }
  /** A host and `count` desks seated under the numbers 1 … count, everything they were told so far taken */
  const room = (count: number) => {
    const pc = host()
    const phones = Array.from({ length: count }, (_, i) => desk('ABC234', `desk-token-${i + 1}`))
    for (const conn of [pc, ...phones]) conn.take()
    return { pc, phones }
  }
  return { relay, connect, say, host, desk, room, advance: (ms: number) => (now += ms) }
}

describe('RoomRelay', () => {
  it('opens a room for a host and seats one desk', () => {
    const { relay, host, desk } = setup()
    const pc = host()
    expect(pc.take()).toEqual([{ t: 'opened', room: 'ABC234', hosts: ['192.168.1.42'] }])
    expect(relay.roomCount).toBe(1)
    const phone = desk()
    expect(phone.take()).toEqual([{ t: 'joined', room: 'ABC234', desk: 1 }])
    expect(pc.take()).toEqual([{ t: 'peer-joined', desk: 1 }])
  })

  it('forwards host messages to the desk and commands to the host, and nothing else', () => {
    const { say, host, desk } = setup()
    const pc = host()
    const phone = desk()
    pc.take()
    phone.take()
    say(pc, STATE)
    say(pc, { t: 'fleet', fleet: [] })
    expect(phone.take()).toEqual([STATE, { t: 'fleet', fleet: [] }])
    say(phone, COMMAND)
    // The relay says which desk speaks
    expect(pc.take()).toEqual([{ ...COMMAND, from: 1 }])
    expect(phone.take()).toEqual([])
  })

  it('keeps rooms apart', () => {
    const { say, host, desk } = setup()
    const pcA = host('AAAAAA', 'host-token-a')
    const pcB = host('BBBBBB', 'host-token-b')
    const phoneA = desk('AAAAAA', 'desk-token-a')
    const phoneB = desk('BBBBBB', 'desk-token-b')
    for (const conn of [pcA, pcB, phoneA, phoneB]) conn.take()
    say(pcA, STATE)
    say(phoneB, COMMAND)
    expect(phoneA.take()).toEqual([STATE])
    expect(phoneB.take()).toEqual([])
    // Each room numbers its own desks
    expect(pcB.take()).toEqual([{ ...COMMAND, from: 1 }])
    expect(pcA.take()).toEqual([])
  })

  it('refuses an unknown room', () => {
    const { desk, relay } = setup()
    const phone = desk('ZZZZZZ')
    expect(phone.take()).toEqual([{ t: 'error', code: 'unknown-room' }])
    expect(phone.closed).toBe(true)
    expect(relay.connectionCount).toBe(0)
  })

  it('seats a second desk beside the first one, each under its own number', () => {
    const { say, host, desk } = setup()
    const pc = host()
    const phone = desk()
    pc.take()
    phone.take()
    const second = desk('ABC234', 'other-desk-token', 'Léa')
    expect(second.take()).toEqual([{ t: 'joined', room: 'ABC234', desk: 2 }])
    expect(second.closed).toBe(false)
    // The host is told the number and the name; the first desk is told nothing
    expect(pc.take()).toEqual([{ t: 'peer-joined', desk: 2, name: 'Léa' }])
    expect(phone.take()).toEqual([])
    say(phone, COMMAND)
    say(second, COMMAND)
    expect(pc.take()).toEqual([{ ...COMMAND, from: 1 }, { ...COMMAND, from: 2 }])
  })

  it('seats eight desks under the numbers 1 to 8 and refuses the ninth', () => {
    const { relay, say, host, desk } = setup()
    const pc = host()
    pc.take()
    expect(MAX_DESKS).toBe(8)
    const phones = Array.from({ length: MAX_DESKS }, (_, i) => desk('ABC234', `desk-token-${i + 1}`))
    phones.forEach((phone, i) => expect(phone.take()).toEqual([{ t: 'joined', room: 'ABC234', desk: i + 1 }]))
    expect(pc.take()).toEqual(phones.map((_, i) => ({ t: 'peer-joined', desk: i + 1 })))
    expect(relay.connectionCount).toBe(1 + MAX_DESKS)

    const ninth = desk('ABC234', 'ninth-desk-token')
    expect(ninth.take()).toEqual([{ t: 'error', code: 'room-full' }])
    expect(ninth.closed).toBe(true)
    // Nobody else hears of it, and the eight stay seated
    expect(pc.take()).toEqual([])
    expect(relay.connectionCount).toBe(1 + MAX_DESKS)
    for (const phone of phones) expect(phone.closed).toBe(false)
    say(phones[7], COMMAND)
    expect(pc.take()).toEqual([{ ...COMMAND, from: 8 }])
  })

  it('gives a newcomer the lowest number that is free', () => {
    const { relay, room, desk } = setup()
    const { pc, phones } = room(4)
    relay.disconnect(phones[1])
    relay.disconnect(phones[2])
    expect(pc.take()).toEqual([{ t: 'peer-left', desk: 2 }, { t: 'peer-left', desk: 3 }])
    const first = desk('ABC234', 'newcomer-token-a')
    const second = desk('ABC234', 'newcomer-token-b')
    const third = desk('ABC234', 'newcomer-token-c')
    expect(first.take()).toEqual([{ t: 'joined', room: 'ABC234', desk: 2 }])
    expect(second.take()).toEqual([{ t: 'joined', room: 'ABC234', desk: 3 }])
    expect(third.take()).toEqual([{ t: 'joined', room: 'ABC234', desk: 5 }])
    expect(pc.take()).toEqual([
      { t: 'peer-joined', desk: 2 },
      { t: 'peer-joined', desk: 3 },
      { t: 'peer-joined', desk: 5 },
    ])
  })

  it('makes room for one more as soon as a desk of a full room leaves', () => {
    const { relay, room, desk } = setup()
    const { pc, phones } = room(MAX_DESKS)
    relay.disconnect(phones[4])
    pc.take()
    const newcomer = desk('ABC234', 'newcomer-token')
    expect(newcomer.take()).toEqual([{ t: 'joined', room: 'ABC234', desk: 5 }])
    expect(desk('ABC234', 'one-too-many-token').take()).toEqual([{ t: 'error', code: 'room-full' }])
  })

  it('sends a host message that names a desk to that desk only, and one that names none to all', () => {
    const { say, room } = setup()
    const { pc, phones } = room(3)
    const toTwo: RemoteMessage = { t: 'state', state: null, ack: 4, to: 2 }
    say(pc, toTwo)
    expect(phones[0].take()).toEqual([])
    expect(phones[1].take()).toEqual([toTwo])
    expect(phones[2].take()).toEqual([])

    const fleet: RemoteMessage = { t: 'fleet', fleet: [] }
    say(pc, fleet)
    for (const phone of phones) expect(phone.take()).toEqual([fleet])

    const fleetToThree: RemoteMessage = { t: 'fleet', fleet: [], to: 3 }
    say(pc, fleetToThree)
    say(pc, STATE)
    say(pc, { t: 'bye' })
    expect(phones[0].take()).toEqual([STATE, { t: 'bye' }])
    expect(phones[1].take()).toEqual([STATE, { t: 'bye' }])
    expect(phones[2].take()).toEqual([fleetToThree, STATE, { t: 'bye' }])

    // A number nobody sits under: the frame is dropped, the host stays
    say(pc, { t: 'state', state: null, ack: 0, to: 7 })
    for (const phone of phones) expect(phone.take()).toEqual([])
    expect(pc.take()).toEqual([])
    expect(pc.closed).toBe(false)
  })

  it('stamps a command with the number of the desk it came from, whatever the desk wrote', () => {
    const { say, room } = setup()
    const { pc, phones } = room(3)
    say(phones[1], COMMAND)
    // A desk that claims to be another one is not believed
    say(phones[2], { ...COMMAND, from: 1 })
    say(phones[0], { ...COMMAND, seq: 2, from: 8 })
    expect(pc.take()).toEqual([
      { ...COMMAND, from: 2 },
      { ...COMMAND, from: 3 },
      { ...COMMAND, seq: 2, from: 1 },
    ])
    // No desk hears the command of another
    for (const phone of phones) expect(phone.take()).toEqual([])
    // A number that cannot be a desk is an invalid message like any other
    say(phones[2], { ...COMMAND, from: 9 })
    expect(phones[2].take()).toEqual([{ t: 'error', code: 'bad-message' }])
    expect(phones[2].closed).toBe(true)
    expect(pc.take()).toEqual([{ t: 'peer-left', desk: 3 }])
  })

  it('refuses a second host on a code that is taken', () => {
    const { host, relay } = setup()
    host()
    const squatter = host('ABC234', 'other-host-token')
    expect(squatter.take()).toEqual([{ t: 'error', code: 'room-taken' }])
    expect(squatter.closed).toBe(true)
    expect(relay.roomCount).toBe(1)
  })

  it('refuses another protocol version', () => {
    const { connect, say, relay } = setup()
    const old = connect()
    say(old, { t: 'host', v: PROTOCOL_VERSION + 1, room: 'ABC234', client: 'host-token' })
    expect(old.take()).toEqual([{ t: 'error', code: 'version' }])
    expect(old.closed).toBe(true)
    expect(relay.roomCount).toBe(0)
  })

  it('closes the room when the host leaves', () => {
    const { relay, host, desk } = setup()
    const pc = host()
    const phone = desk()
    phone.take()
    relay.disconnect(pc)
    // Without a number: to a desk, it is the room that is gone
    expect(phone.take()).toEqual([{ t: 'peer-left' }])
    expect(phone.closed).toBe(true)
    expect(relay.roomCount).toBe(0)
    expect(relay.connectionCount).toBe(0)
    // The code is free again, and nothing of the old room is left
    const again = desk()
    expect(again.take()).toEqual([{ t: 'error', code: 'unknown-room' }])
  })

  it('closes every desk when the host leaves', () => {
    const { relay, room } = setup()
    const { pc, phones } = room(MAX_DESKS)
    relay.disconnect(pc)
    for (const phone of phones) {
      expect(phone.take()).toEqual([{ t: 'peer-left' }])
      expect(phone.closed).toBe(true)
    }
    expect(relay.roomCount).toBe(0)
    expect(relay.connectionCount).toBe(0)
    // The late close events of the desks find nothing to do
    for (const phone of phones) relay.disconnect(phone)
    expect(pc.take()).toEqual([])
  })

  it('tells the host when the desk leaves, and seats another one afterwards', () => {
    const { relay, host, desk } = setup()
    const pc = host()
    const phone = desk()
    pc.take()
    relay.disconnect(phone)
    expect(pc.take()).toEqual([{ t: 'peer-left', desk: 1 }])
    expect(relay.roomCount).toBe(1)
    const other = desk('ABC234', 'other-desk-token')
    expect(other.take()).toEqual([{ t: 'joined', room: 'ABC234', desk: 1 }])
    expect(pc.take()).toEqual([{ t: 'peer-joined', desk: 1 }])
  })

  it('lets the same desk take its seat back from its own dead connection', () => {
    const { host, desk } = setup()
    const pc = host()
    const ghost = desk()
    pc.take()
    const back = desk()
    expect(ghost.closed).toBe(true)
    expect(back.take()).toEqual([{ t: 'joined', room: 'ABC234', desk: 1 }])
    // The host sees a departure then the same desk back: a new sequence, the train it held kept
    expect(pc.take()).toEqual([{ t: 'peer-left', desk: 1 }, { t: 'peer-joined', desk: 1, back: true }])
  })

  it('gives a desk that comes back the number it had, not the lowest one free', () => {
    const { relay, say, room, desk } = setup()
    const { pc, phones } = room(3)
    // Desk 1 is gone for good: its number is free, and lower than the one coming back
    relay.disconnect(phones[0])
    pc.take()
    const back = desk('ABC234', 'desk-token-3', 'Zoé')
    expect(phones[2].closed).toBe(true)
    expect(back.take()).toEqual([{ t: 'joined', room: 'ABC234', desk: 3 }])
    expect(pc.take()).toEqual([{ t: 'peer-left', desk: 3 }, { t: 'peer-joined', desk: 3, name: 'Zoé', back: true }])
    // The late close event of the dead connection must not unseat the one that took over
    relay.disconnect(phones[2])
    expect(pc.take()).toEqual([])
    say(pc, { t: 'state', state: null, ack: 0, to: 3 })
    expect(back.take()).toEqual([{ t: 'state', state: null, ack: 0, to: 3 }])
    expect(phones[2].take()).toEqual([])
    say(back, COMMAND)
    expect(pc.take()).toEqual([{ ...COMMAND, from: 3 }])
    expect(phones[1].closed).toBe(false)
  })

  it('lets the same host take its room back, desk included', () => {
    const { relay, say, host, desk } = setup()
    const ghost = host()
    const phone = desk()
    phone.take()
    const back = host()
    expect(ghost.closed).toBe(true)
    expect(back.take()).toEqual([
      { t: 'opened', room: 'ABC234', hosts: ['192.168.1.42'] },
      { t: 'peer-joined', desk: 1, back: true },
    ])
    expect(phone.closed).toBe(false)
    say(back, STATE)
    expect(phone.take()).toEqual([STATE])
    // The late close event of the dead connection must not take the room down
    relay.disconnect(ghost)
    expect(relay.roomCount).toBe(1)
  })

  it('tells a host that comes back of every desk seated, with its number and its name', () => {
    const { relay, say, host, desk } = setup()
    const ghost = host()
    const anna = desk('ABC234', 'desk-token-1', 'Anna')
    const gone = desk('ABC234', 'desk-token-2', 'Parti')
    const nameless = desk('ABC234', 'desk-token-3')
    const zoe = desk('ABC234', 'desk-token-4', 'Zoé')
    relay.disconnect(gone)
    const back = host()
    expect(ghost.closed).toBe(true)
    expect(back.take()).toEqual([
      { t: 'opened', room: 'ABC234', hosts: ['192.168.1.42'] },
      { t: 'peer-joined', desk: 1, name: 'Anna', back: true },
      { t: 'peer-joined', desk: 3, back: true },
      { t: 'peer-joined', desk: 4, name: 'Zoé', back: true },
    ])
    for (const phone of [anna, nameless, zoe]) {
      expect(phone.closed).toBe(false)
      phone.take()
    }
    // The desks talk to the new connection, under the numbers they had
    say(zoe, COMMAND)
    expect(back.take()).toEqual([{ ...COMMAND, from: 4 }])
    say(back, { t: 'state', state: null, ack: 1, to: 3 })
    expect(nameless.take()).toEqual([{ t: 'state', state: null, ack: 1, to: 3 }])
    expect(anna.take()).toEqual([])
  })

  it('answers pings and closes connections that stay mute', () => {
    const { relay, connect, say, host, desk, advance } = setup({ timeoutMs: 15000 })
    const pc = host()
    const phone = desk()
    const idle = connect()
    pc.take()
    phone.take()
    advance(10000)
    say(pc, { t: 'ping' })
    expect(pc.take()).toEqual([{ t: 'pong' }])
    relay.sweep()
    expect(idle.closed).toBe(false)
    advance(5000)
    relay.sweep()
    // The phone and the idle connection said nothing for 15 s; the host pinged 5 s ago
    expect(idle.closed).toBe(true)
    expect(phone.closed).toBe(true)
    expect(pc.closed).toBe(false)
    expect(pc.take()).toEqual([{ t: 'peer-left', desk: 1 }])
    advance(15000)
    relay.sweep()
    expect(pc.closed).toBe(true)
    expect(relay.roomCount).toBe(0)
    expect(relay.connectionCount).toBe(0)
  })

  it('closes a connection that sends something invalid or out of role', () => {
    const { relay, connect, say, host, desk } = setup()
    const garbage = connect()
    relay.receive(garbage, '{nope')
    expect(garbage.take()).toEqual([{ t: 'error', code: 'bad-message' }])
    expect(garbage.closed).toBe(true)

    const binary = connect()
    relay.receive(binary, null)
    expect(binary.closed).toBe(true)

    const big = connect()
    relay.receive(big, JSON.stringify({ t: 'ping', pad: 'x'.repeat(MAX_MESSAGE_BYTES) }))
    expect(big.closed).toBe(true)

    // A desk may not speak as the host, nor a host as the desk, nor anyone as the relay
    const pc = host()
    const phone = desk()
    pc.take()
    say(phone, STATE)
    expect(phone.closed).toBe(true)
    expect(pc.take()).toEqual([{ t: 'peer-left', desk: 1 }])
    say(pc, COMMAND)
    expect(pc.closed).toBe(true)
    const liar = connect()
    say(liar, { t: 'peer-joined', desk: 1 })
    expect(liar.closed).toBe(true)
    const stranger = connect()
    say(stranger, COMMAND)
    expect(stranger.closed).toBe(true)
    expect(relay.roomCount).toBe(0)
  })

  it('refuses a second room request on one connection', () => {
    const { say, host } = setup()
    const pc = host()
    pc.take()
    say(pc, { t: 'host', v: PROTOCOL_VERSION, room: 'BBBBBB', client: 'host-token' })
    expect(pc.take()).toEqual([{ t: 'error', code: 'bad-message' }])
    expect(pc.closed).toBe(true)
  })

  it('drops host messages while no desk is seated', () => {
    const { say, host } = setup()
    const pc = host()
    pc.take()
    say(pc, STATE)
    expect(pc.take()).toEqual([])
    expect(pc.closed).toBe(false)
  })
})
