import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleCommand, ConsoleState } from '@application/console/consoleContract'
import { createRemoteDesk } from '@application/remote/remoteDesk'
import { createRemoteHost } from '@application/remote/remoteHost'
import { fakeBroker, FakeRtcWorld } from './rtc.testkit'
import { RtcDeskLink } from './rtcDeskLink'
import { RtcHostLink } from './rtcHostLink'

const BROKER = 'wss://broker.example/peerjs'

const state = (trainId: string): ConsoleState =>
  ({ trainId, speed: 0, maxSpeed: 80, stopped: true, notch: 0, minNotch: -5, maxNotch: 5, handleEffort: 0, reverser: 'neutral', reverserLocked: false, emergencyBrake: false, emergencyReleasable: false, brake: null, acceleration: 0, gradientPermille: 0, stoppingDistance: 0, locoCount: 1, wagonCount: 0, upcomingTurnout: null, canSwitchCab: false }) as ConsoleState

/** A PC with its host on a WebRTC link, a broker and a world of peers in memory */
function setup(room = 'ABC234') {
  const broker = fakeBroker()
  const world = new FakeRtcWorld()
  const applied: [number, ConsoleCommand][] = []
  const held = new Map<number, string>()
  const hostLink = new RtcHostLink({ brokerUrl: BROKER, createSocket: broker.createSocket, createPeer: world.createPeer })
  const rooms = [room, 'XYZ789']
  const host = createRemoteHost({
    link: hostLink,
    getState: (desk) => (held.has(desk) ? state(held.get(desk)!) : null),
    getFleet: () => [],
    apply: (desk, command) => {
      applied.push([desk, command])
      if (command.type === 'selectTrain') held.set(desk, command.trainId)
    },
    generateRoom: () => rooms.shift() ?? 'QQQ222',
  })
  const desk = (name?: string, code = room) => {
    const link = new RtcDeskLink({ brokerUrl: BROKER, room: code, createSocket: broker.createSocket, createPeer: world.createPeer, minRetryMs: 1000, maxRetryMs: 4000, attemptMs: 8000 })
    return { link, desk: createRemoteDesk({ link, room: code, name }) }
  }
  return { broker, world, host, hostLink, applied, held, desk }
}

describe('desks reaching the PC directly (WebRTC)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the room once the broker has given its id, and seats two desks under their numbers', async () => {
    const { host, broker, desk } = setup()
    expect(host.getSnapshot()).toMatchObject({ link: 'open', ready: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getSnapshot()).toMatchObject({ ready: true, room: 'ABC234', hosts: [] })
    expect(broker.state.opened[0]).toContain('id=openrails-ABC234')

    const lea = desk('Léa')
    const tom = desk('Tom')
    await vi.advanceTimersByTimeAsync(0)
    expect(lea.desk.getSnapshot()).toMatchObject({ link: 'open', joined: true, desk: 1 })
    expect(tom.desk.getSnapshot()).toMatchObject({ link: 'open', joined: true, desk: 2 })
    expect(host.getSnapshot().desks).toEqual([{ desk: 1, name: 'Léa' }, { desk: 2, name: 'Tom' }])
    // The drive goes directly: each desk has let go of the broker, the PC still holds its place
    expect(broker.hub.clientCount).toBe(1)
  })

  it('carries the drive both ways: each desk its own state, each command its desk', async () => {
    const { applied, desk } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const lea = desk('Léa')
    const tom = desk('Tom')
    await vi.advanceTimersByTimeAsync(0)
    lea.desk.send({ type: 'selectTrain', trainId: 't_1' })
    tom.desk.send({ type: 'selectTrain', trainId: 't_2' })
    await vi.advanceTimersByTimeAsync(100)
    expect(lea.desk.getSnapshot().state?.trainId).toBe('t_1')
    expect(tom.desk.getSnapshot().state?.trainId).toBe('t_2')
    tom.desk.send({ type: 'notchStep', step: 1 })
    expect(applied).toEqual([
      [1, { type: 'selectTrain', trainId: 't_1' }],
      [2, { type: 'selectTrain', trainId: 't_2' }],
      [2, { type: 'notchStep', step: 1 }],
    ])
  })

  it('tells the PC when a desk goes, and gives its number back to the desk that returns', async () => {
    const { host, world, desk } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const lea = desk('Léa')
    const tom = desk('Tom')
    await vi.advanceTimersByTimeAsync(0)
    // Léa's connection dies under her (the peer of her link is the first made by a desk)
    const leaPeer = world.peers[0]
    leaPeer.channel!.close()
    expect(host.getSnapshot().desks).toEqual([{ desk: 2, name: 'Tom' }])
    expect(lea.desk.getSnapshot()).toMatchObject({ link: 'connecting', joined: false })
    // Her link tries again by itself, and she is seated under the number she had
    await vi.advanceTimersByTimeAsync(1000)
    expect(lea.desk.getSnapshot()).toMatchObject({ link: 'open', joined: true, desk: 1 })
    expect(host.getSnapshot().desks).toEqual([{ desk: 1, name: 'Léa' }, { desk: 2, name: 'Tom' }])
    expect(tom.desk.getSnapshot().joined).toBe(true)

    // A desk that leaves on purpose is gone for good
    tom.desk.stop()
    expect(host.getSnapshot().desks).toEqual([{ desk: 1, name: 'Léa' }])
  })

  it('takes a desk gone silent as gone within seconds, never the PC itself', async () => {
    const { host, world, desk } = setup()
    await vi.advanceTimersByTimeAsync(0)
    desk('Léa')
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getSnapshot().deskConnected).toBe(true)
    // Her frames no longer arrive, and nothing says the channel closed
    const there = world.peers[1].channel!
    there.onmessage = null
    // …and once she is swept away, her phone cannot get back in
    world.blocked = true
    // Three seconds of silence on a direct link, not the fifteen of the relay: a train must not run on that long
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.getSnapshot().deskConnected).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.getSnapshot().desks).toEqual([])
    expect(host.getSnapshot()).toMatchObject({ link: 'open', ready: true })
  })

  it('draws another code when the one it asked for is held by another PC', async () => {
    const first = setup('ABC234')
    await vi.advanceTimersByTimeAsync(0)
    expect(first.host.getSnapshot()).toMatchObject({ ready: true, room: 'ABC234' })
    // A second PC on the same broker asks for the same code
    const world = new FakeRtcWorld()
    const link = new RtcHostLink({ brokerUrl: BROKER, createSocket: first.broker.createSocket, createPeer: world.createPeer })
    const codes = ['ABC234', 'XYZ789']
    const second = createRemoteHost({ link, getState: () => null, getFleet: () => [], apply: () => {}, generateRoom: () => codes.shift() ?? 'QQQ222' })
    await vi.advanceTimersByTimeAsync(10)
    expect(second.getSnapshot()).toMatchObject({ ready: true, room: 'XYZ789' })
    expect(first.host.getSnapshot()).toMatchObject({ ready: true, room: 'ABC234' })
  })

  it('tells the desk that nobody holds the room it asks for', async () => {
    const { desk } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const lost = desk('Léa', 'NNN222')
    await vi.advanceTimersByTimeAsync(5000)
    expect(lost.desk.getSnapshot()).toMatchObject({ link: 'closed', joined: false, ended: 'unknown-room' })
  })

  it('keeps trying when the networks let nothing through, and says what is wrong', async () => {
    const { world, host, desk } = setup()
    await vi.advanceTimersByTimeAsync(0)
    world.blocked = true
    const lea = desk('Léa')
    await vi.advanceTimersByTimeAsync(0)
    expect(lea.link.status).toBe('connecting')
    expect(lea.link.trouble).toBeNull()
    // A second failure after the PC answered: it is the networks
    await vi.advanceTimersByTimeAsync(1000)
    expect(lea.link.trouble).toBe('direct')
    expect(host.getSnapshot().desks).toEqual([])
    // The way opens: the next attempt gets through, and the trouble is forgotten
    world.blocked = false
    await vi.advanceTimersByTimeAsync(4000)
    expect(lea.desk.getSnapshot()).toMatchObject({ link: 'open', joined: true, desk: 1 })
    expect(lea.link.trouble).toBeNull()
  })

  it('says when it is the broker that cannot be reached, and gets in when it comes back', async () => {
    const { broker, desk, host } = setup()
    await vi.advanceTimersByTimeAsync(0)
    broker.state.down = true
    const lea = desk('Léa')
    await vi.advanceTimersByTimeAsync(8000)
    expect(lea.link.status).toBe('connecting')
    expect(lea.link.trouble).toBe('broker')
    broker.state.down = false
    await vi.advanceTimersByTimeAsync(20_000)
    expect(lea.desk.getSnapshot()).toMatchObject({ joined: true })
    expect(host.getSnapshot().deskConnected).toBe(true)
  })

  it('a broker that drops everyone leaves the desks driving, and new ones get in once the PC is back on it', async () => {
    const { broker, host, desk } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const lea = desk('Léa')
    await vi.advanceTimersByTimeAsync(0)
    broker.dropAll()
    await vi.advanceTimersByTimeAsync(0)
    expect(lea.desk.getSnapshot().joined).toBe(true)
    expect(host.getSnapshot()).toMatchObject({ ready: true, deskConnected: true })
    await vi.advanceTimersByTimeAsync(1000)
    const tom = desk('Tom')
    await vi.advanceTimersByTimeAsync(0)
    expect(tom.desk.getSnapshot()).toMatchObject({ joined: true, desk: 2 })
  })

  it('closing the PC side sends every desk away', async () => {
    const { host, hostLink, broker, desk } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const lea = desk('Léa')
    await vi.advanceTimersByTimeAsync(0)
    host.stop()
    expect(hostLink.status).toBe('closed')
    expect(lea.desk.getSnapshot()).toMatchObject({ ended: 'host-closed' })
    expect(broker.hub.clientCount).toBe(0)
  })
})
