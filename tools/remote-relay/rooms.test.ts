import { describe, expect, it } from 'vitest'
import {
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
  const desk = (room = 'ABC234', client = 'desk-token') => {
    const conn = connect()
    say(conn, { t: 'join', v: PROTOCOL_VERSION, room, client })
    return conn
  }
  return { relay, connect, say, host, desk, advance: (ms: number) => (now += ms) }
}

describe('RoomRelay', () => {
  it('opens a room for a host and seats one desk', () => {
    const { relay, host, desk } = setup()
    const pc = host()
    expect(pc.take()).toEqual([{ t: 'opened', room: 'ABC234', hosts: ['192.168.1.42'] }])
    expect(relay.roomCount).toBe(1)
    const phone = desk()
    expect(phone.take()).toEqual([{ t: 'joined', room: 'ABC234' }])
    expect(pc.take()).toEqual([{ t: 'peer-joined' }])
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
    expect(pc.take()).toEqual([COMMAND])
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
    expect(pcB.take()).toEqual([COMMAND])
    expect(pcA.take()).toEqual([])
  })

  it('refuses an unknown room', () => {
    const { desk, relay } = setup()
    const phone = desk('ZZZZZZ')
    expect(phone.take()).toEqual([{ t: 'error', code: 'unknown-room' }])
    expect(phone.closed).toBe(true)
    expect(relay.connectionCount).toBe(0)
  })

  it('refuses a second desk and leaves the first one alone', () => {
    const { say, host, desk } = setup()
    const pc = host()
    const phone = desk()
    pc.take()
    phone.take()
    const intruder = desk('ABC234', 'other-desk-token')
    expect(intruder.take()).toEqual([{ t: 'error', code: 'room-full' }])
    expect(intruder.closed).toBe(true)
    expect(pc.take()).toEqual([])
    say(phone, COMMAND)
    expect(pc.take()).toEqual([COMMAND])
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
    expect(phone.take()).toEqual([{ t: 'peer-left' }])
    expect(phone.closed).toBe(true)
    expect(relay.roomCount).toBe(0)
    expect(relay.connectionCount).toBe(0)
    // The code is free again, and nothing of the old room is left
    const again = desk()
    expect(again.take()).toEqual([{ t: 'error', code: 'unknown-room' }])
  })

  it('tells the host when the desk leaves, and seats another one afterwards', () => {
    const { relay, host, desk } = setup()
    const pc = host()
    const phone = desk()
    pc.take()
    relay.disconnect(phone)
    expect(pc.take()).toEqual([{ t: 'peer-left' }])
    expect(relay.roomCount).toBe(1)
    const other = desk('ABC234', 'other-desk-token')
    expect(other.take()).toEqual([{ t: 'joined', room: 'ABC234' }])
    expect(pc.take()).toEqual([{ t: 'peer-joined' }])
  })

  it('lets the same desk take its seat back from its own dead connection', () => {
    const { host, desk } = setup()
    const pc = host()
    const ghost = desk()
    pc.take()
    const back = desk()
    expect(ghost.closed).toBe(true)
    expect(back.take()).toEqual([{ t: 'joined', room: 'ABC234' }])
    // The host sees a departure then an arrival, so it starts the desk afresh
    expect(pc.take()).toEqual([{ t: 'peer-left' }, { t: 'peer-joined' }])
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
      { t: 'peer-joined' },
    ])
    expect(phone.closed).toBe(false)
    say(back, STATE)
    expect(phone.take()).toEqual([STATE])
    // The late close event of the dead connection must not take the room down
    relay.disconnect(ghost)
    expect(relay.roomCount).toBe(1)
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
    expect(pc.take()).toEqual([{ t: 'peer-left' }])
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
    expect(pc.take()).toEqual([{ t: 'peer-left' }])
    say(pc, COMMAND)
    expect(pc.closed).toBe(true)
    const liar = connect()
    say(liar, { t: 'peer-joined' })
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
