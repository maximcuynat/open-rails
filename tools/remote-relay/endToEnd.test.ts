import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type {
  ConsoleCommand,
  ConsoleState,
  FleetEntry,
} from '../../src/application/console/consoleContract'
import { createRemoteDesk, type RemoteDesk } from '../../src/application/remote/remoteDesk'
import { createRemoteHost, type RemoteHost } from '../../src/application/remote/remoteHost'
import {
  WebSocketLink,
  type WebSocketLike,
} from '../../src/infrastructure/remote/webSocketLink'
import { startRelayServer, type RunningRelay } from './server'

/**
 * The whole chain with real sockets: host and desk, each on a `WebSocketLink`, through the relay.
 */

const state = (trainId: string): ConsoleState => ({
  trainId,
  speed: 0,
  maxSpeed: 80,
  stopped: true,
  notch: 0,
  minNotch: -5,
  maxNotch: 5,
  handleEffort: 0,
  reverser: 'neutral',
  reverserLocked: false,
  emergencyBrake: false,
  emergencyReleasable: false,
  brake: { command: 'hold', tone: 'applied', pipeBar: 3.5, cylinderBar: 3.8 },
  acceleration: 0,
  gradientPermille: 0,
  stoppingDistance: 0,
  locoCount: 2,
  wagonCount: 8,
  upcomingTurnout: null,
  canSwitchCab: false,
})

const FLEET: FleetEntry[] = [
  { id: 't_1', rank: 1, model: 'TGV Duplex', locoCount: 2, wagonCount: 8, speed: 0, driven: false },
  { id: 't_2', rank: 2, model: 'TGV M', locoCount: 2, wagonCount: 7, speed: 0, driven: false },
]

/** Lets the sockets and the timers that are due run once */
const yieldToIo = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * A wall clock that only ever moves forward at the pace of time. The real one may be set while a
 * test runs (a time sync, a virtual machine catching up): a jump of hours forward ends every wait
 * at once, and makes the relay and the links take each other for mute — which is how this test
 * used to fail now and then on « brake repeated », its longest wait.
 */
const steadyNow = (): number => performance.timeOrigin + performance.now()

/**
 * Waits for `condition`, on the steady clock. The budget is generous: on a loaded machine (the
 * whole suite runs in parallel) a frame through three real sockets can be a long time coming.
 * When it runs out, what is already in the sockets is given one more turn of the loop and the
 * condition one more look before the wait is called a failure.
 */
async function until(condition: () => boolean, label: string, timeoutMs = 10000): Promise<void> {
  const start = performance.now()
  while (!condition()) {
    if (performance.now() - start > timeoutMs) {
      await yieldToIo()
      if (condition()) return
      throw new Error(`timed out waiting for: ${label}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Real sockets, and a machine that may be busy: far more than the test needs when all goes well */
const TEST_TIMEOUT_MS = 30000

const HOLD: ConsoleCommand = { type: 'brake', command: 'hold' }

/**
 * What stands for the store on the PC: who holds which train, by the rules of the real one (a
 * train another desk holds is refused, a desk that leaves lets go of its train), and every command
 * applied with the desk it came from.
 */
function makeWorld() {
  /** Train held, by desk */
  const held = new Map<number, string>()
  const names = new Map<number, string | undefined>()
  const applied: { desk: number; command: ConsoleCommand }[] = []
  return {
    held,
    names,
    applied,
    by: (desk: number): ConsoleCommand[] => applied.filter((line) => line.desk === desk).map((line) => line.command),
    getState: (desk: number): ConsoleState | null => {
      const trainId = held.get(desk)
      return trainId === undefined ? null : state(trainId)
    },
    getFleet: (): FleetEntry[] =>
      FLEET.map((entry) => {
        const driver = [...held].find(([, trainId]) => trainId === entry.id)?.[0] ?? null
        if (driver === null) return { ...entry, driver }
        return { ...entry, driven: true, driver, driverName: names.get(driver) ?? `Pupitre ${driver}` }
      }),
    apply: (desk: number, command: ConsoleCommand): void => {
      applied.push({ desk, command })
      if (command.type === 'selectTrain' && ![...held].some(([other, trainId]) => other !== desk && trainId === command.trainId)) {
        held.set(desk, command.trainId)
      }
      if (command.type === 'releaseControls') held.delete(desk)
    },
    seat: (desk: number, name: string | undefined): void => void names.set(desk, name),
    unseat: (desk: number): void => {
      held.delete(desk)
      names.delete(desk)
    },
  }
}

describe('host ↔ relay ↔ desk (real sockets)', () => {
  let relay: RunningRelay | null = null
  let host: RemoteHost | null = null
  const desks: RemoteDesk[] = []
  const sockets: WebSocket[] = []

  const createSocket = (address: string) => {
    const socket = new WebSocket(address)
    sockets.push(socket)
    return socket as unknown as WebSocketLike
  }

  /** Starts the relay and a host on it, and waits for its room */
  const openRoom = async (world: ReturnType<typeof makeWorld>) => {
    relay = await startRelayServer({ host: '127.0.0.1' })
    const url = `ws://127.0.0.1:${relay.port}${relay.path}`
    const opened = createRemoteHost({
      link: new WebSocketLink({ url, createSocket }),
      getState: world.getState,
      getFleet: world.getFleet,
      apply: world.apply,
      seat: world.seat,
      unseat: world.unseat,
    })
    host = opened
    await until(() => opened.getSnapshot().ready, 'room opened')
    return { url, host: opened, room: opened.getSnapshot().room }
  }

  /** A desk on its own socket, seated before the next one is started so that the numbers are known */
  const joinDesk = async (url: string, room: string, name?: string) => {
    const desk = createRemoteDesk({ link: new WebSocketLink({ url, createSocket }), room, name })
    desks.push(desk)
    await until(() => desk.getSnapshot().joined, `desk ${desks.length} joined`)
    return desk
  }

  beforeEach(() => {
    // Before the relay and the links are built: they read the clock through `Date.now`
    vi.spyOn(Date, 'now').mockImplementation(steadyNow)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const desk of desks.splice(0)) desk.stop()
    host?.stop()
    await relay?.close()
    relay = host = null
    for (const socket of sockets.splice(0)) socket.terminate()
  })

  it('pairs, drives, and falls back to hold when the phone vanishes', { timeout: TEST_TIMEOUT_MS }, async () => {
    const world = makeWorld()
    const { url, host, room } = await openRoom(world)

    const desk = await joinDesk(url, room)
    await until(() => desk.getSnapshot().fleet.length === 2, 'fleet received')
    expect(desk.getSnapshot().desk).toBe(1)
    expect(desk.getSnapshot().fleet).toEqual(world.getFleet())
    expect(desk.getSnapshot().fleet.map((entry) => entry.driver)).toEqual([null, null])
    expect(desk.getSnapshot().state).toBeNull()
    expect(host.getSnapshot()).toMatchObject({ deskConnected: true, desks: [{ desk: 1 }] })

    // Choosing a train takes its controls
    desk.send({ type: 'selectTrain', trainId: 't_2' })
    await until(() => desk.getSnapshot().state?.trainId === 't_2', 'state of the chosen train')
    expect(desk.getSnapshot().state).toEqual(state('t_2'))
    // The relay said which desk spoke
    expect(world.applied).toEqual([{ desk: 1, command: { type: 'selectTrain', trainId: 't_2' } }])
    await until(() => desk.getSnapshot().fleet[1].driver === 1, 'fleet says who drives')
    expect(desk.getSnapshot().fleet[1]).toMatchObject({ driven: true, driver: 1, driverName: 'Pupitre 1' })

    const seq = desk.send({ type: 'notchSet', notch: 3 })
    await until(() => desk.getSnapshot().ack >= seq, 'command acknowledged')
    expect(world.applied[1]).toEqual({ desk: 1, command: { type: 'notchSet', notch: 3 } })

    // A held brake is repeated by the desk…
    desk.send({ type: 'brake', command: 'release' })
    await until(() => world.applied.filter((line) => line.command.type === 'brake').length >= 3, 'brake repeated')
    expect(world.applied.some((line) => line.command.type === 'brake' && line.command.command === 'hold')).toBe(false)

    // …until the phone drops off the network without a word
    sockets[1].terminate()
    await until(() => world.applied.some((line) => line.command.type === 'brake' && line.command.command === 'hold'), 'brake put back to hold')
    expect(world.applied[world.applied.length - 1]).toEqual({ desk: 1, command: HOLD })
    // Its train is let go with its seat
    await until(() => world.held.size === 0, 'train let go')

    // The desk reconnects by itself and is seated again, under its number, with nothing in hand
    await until(() => desk.getSnapshot().joined && host.getSnapshot().deskConnected, 'desk rejoined')
    expect(desk.getSnapshot().desk).toBe(1)
    expect(host.getSnapshot().desks).toEqual([{ desk: 1 }])
    desk.send({ type: 'selectTrain', trainId: 't_2' })
    await until(() => desk.getSnapshot().state?.trainId === 't_2', 'state after taking the train again')

    // The PC cuts the link: the desk is told and stops
    host.stop()
    await until(() => desk.getSnapshot().ended === 'host-closed', 'desk told of the end')
    await until(() => relay!.relay.roomCount === 0, 'room closed')
  })

  it('seats two desks that drive two trains, each its own, and lets one vanish without the other noticing', { timeout: TEST_TIMEOUT_MS }, async () => {
    const world = makeWorld()
    const { url, host, room } = await openRoom(world)
    const lea = await joinDesk(url, room, 'Léa')
    const other = await joinDesk(url, room)
    expect(lea.getSnapshot().desk).toBe(1)
    expect(other.getSnapshot().desk).toBe(2)
    await until(() => host.getSnapshot().desks.length === 2, 'host saw both desks')
    expect(host.getSnapshot().desks).toEqual([{ desk: 1, name: 'Léa' }, { desk: 2 }])

    // Each takes a train; each is told of its own, and of who drives the other
    lea.send({ type: 'selectTrain', trainId: 't_1' })
    other.send({ type: 'selectTrain', trainId: 't_2' })
    await until(() => lea.getSnapshot().state?.trainId === 't_1' && other.getSnapshot().state?.trainId === 't_2', 'each desk at its train')
    const drivers = (desk: RemoteDesk) => desk.getSnapshot().fleet.map((entry) => [entry.id, entry.driver, entry.driverName])
    const expected = [
      ['t_1', 1, 'Léa'],
      ['t_2', 2, 'Pupitre 2'],
    ]
    await until(() => JSON.stringify(drivers(lea)) === JSON.stringify(expected) && JSON.stringify(drivers(other)) === JSON.stringify(expected), 'both fleets say who drives')

    // A train another desk holds is refused: the desk keeps its own
    const refused = other.send({ type: 'selectTrain', trainId: 't_1' })
    await until(() => other.getSnapshot().ack >= refused, 'refusal acknowledged')
    expect(other.getSnapshot().state?.trainId).toBe('t_2')
    expect(lea.getSnapshot().state?.trainId).toBe('t_1')
    // (in the order the two requests happened to arrive)
    expect([...world.held].sort(([x], [y]) => x - y)).toEqual([[1, 't_1'], [2, 't_2']])

    // Both drive at once, each holding a brake
    const notchLea = lea.send({ type: 'notchSet', notch: 3 })
    const notchOther = other.send({ type: 'notchSet', notch: -2 })
    lea.send({ type: 'brake', command: 'apply' })
    other.send({ type: 'brake', command: 'release' })
    const brakes = (desk: number) => world.by(desk).filter((c) => c.type === 'brake')
    await until(() => brakes(1).length >= 3 && brakes(2).length >= 3, 'both brakes repeated')
    expect(lea.getSnapshot().ack).toBeGreaterThanOrEqual(notchLea)
    expect(other.getSnapshot().ack).toBeGreaterThanOrEqual(notchOther)
    // Nothing crossed over: each command is under the number of the desk that sent it
    expect(world.by(1).slice(0, 2)).toEqual([{ type: 'selectTrain', trainId: 't_1' }, { type: 'notchSet', notch: 3 }])
    expect(world.by(2).slice(0, 3)).toEqual([
      { type: 'selectTrain', trainId: 't_2' },
      { type: 'selectTrain', trainId: 't_1' },
      { type: 'notchSet', notch: -2 },
    ])
    expect(brakes(1).every((c) => c.type === 'brake' && c.command === 'apply')).toBe(true)
    expect(brakes(2).every((c) => c.type === 'brake' && c.command === 'release')).toBe(true)
    // …and each desk only ever saw its own train
    expect(lea.getSnapshot().state?.trainId).toBe('t_1')
    expect(other.getSnapshot().state?.trainId).toBe('t_2')

    // Léa's phone drops off the network: her brake goes back to hold, her train is let go
    sockets[1].terminate()
    await until(() => world.by(1).some((c) => c.type === 'brake' && c.command === 'hold'), 'brake of the vanished desk put back to hold')
    await until(() => !world.held.has(1), 'train of the vanished desk let go')
    // The other desk keeps its seat, its train and its brake, and goes on driving
    expect(world.held.get(2)).toBe('t_2')
    expect(brakes(2).some((c) => c.type === 'brake' && c.command === 'hold')).toBe(false)
    const before = brakes(2).length
    const later = other.send({ type: 'notchSet', notch: 1 })
    await until(() => other.getSnapshot().ack >= later && brakes(2).length >= before + 2, 'the other desk still drives')
    expect(other.getSnapshot().joined).toBe(true)
    expect(other.getSnapshot().state?.trainId).toBe('t_2')
    expect(world.by(2).some((c) => c.type === 'notchSet' && c.notch === 1)).toBe(true)
    expect(brakes(2).some((c) => c.type === 'brake' && c.command === 'hold')).toBe(false)

    // Léa comes back by herself: same number, same name, no train; hers is free to take again
    await until(() => lea.getSnapshot().joined && host.getSnapshot().desks.length === 2, 'vanished desk rejoined')
    expect(lea.getSnapshot().desk).toBe(1)
    expect(host.getSnapshot().desks).toEqual([{ desk: 1, name: 'Léa' }, { desk: 2 }])
    lea.send({ type: 'selectTrain', trainId: 't_1' })
    await until(() => lea.getSnapshot().state?.trainId === 't_1', 'train taken again')
    expect(other.getSnapshot().state?.trainId).toBe('t_2')

    // The PC cuts the link: every desk is told and stops
    host.stop()
    await until(() => lea.getSnapshot().ended === 'host-closed' && other.getSnapshot().ended === 'host-closed', 'both desks told of the end')
    await until(() => relay!.relay.roomCount === 0, 'room closed')
    expect(world.held.size).toBe(0)
  })
})
