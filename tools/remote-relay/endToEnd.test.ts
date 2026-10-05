import { afterEach, describe, expect, it } from 'vitest'
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

async function until(condition: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('host ↔ relay ↔ desk (real sockets)', () => {
  let relay: RunningRelay | null = null
  let host: RemoteHost | null = null
  let desk: RemoteDesk | null = null

  afterEach(async () => {
    desk?.stop()
    host?.stop()
    await relay?.close()
    relay = host = desk = null
  })

  it('pairs, drives, and falls back to hold when the phone vanishes', async () => {
    relay = await startRelayServer({ host: '127.0.0.1' })
    const url = `ws://127.0.0.1:${relay.port}${relay.path}`
    const sockets: WebSocket[] = []
    const createSocket = (address: string) => {
      const socket = new WebSocket(address)
      sockets.push(socket)
      return socket as unknown as WebSocketLike
    }

    let driven: ConsoleState | null = null
    const applied: ConsoleCommand[] = []
    host = createRemoteHost({
      link: new WebSocketLink({ url, createSocket }),
      getState: () => driven,
      getFleet: () => FLEET,
      apply: (command) => {
        applied.push(command)
        if (command.type === 'selectTrain') driven = state(command.trainId)
      },
    })
    await until(() => host!.getSnapshot().ready, 'room opened')
    const room = host.getSnapshot().room

    desk = createRemoteDesk({ link: new WebSocketLink({ url, createSocket }), room })
    await until(() => desk!.getSnapshot().joined, 'desk joined')
    await until(() => desk!.getSnapshot().fleet.length === 2, 'fleet received')
    expect(desk.getSnapshot().fleet).toEqual(FLEET)
    expect(desk.getSnapshot().state).toBeNull()
    expect(host.getSnapshot().deskConnected).toBe(true)

    // Choosing a train takes the controls on the PC
    desk.send({ type: 'selectTrain', trainId: 't_2' })
    await until(() => desk!.getSnapshot().state?.trainId === 't_2', 'state of the chosen train')
    expect(desk.getSnapshot().state).toEqual(state('t_2'))
    expect(applied).toEqual([{ type: 'selectTrain', trainId: 't_2' }])

    const seq = desk.send({ type: 'notchSet', notch: 3 })
    await until(() => desk!.getSnapshot().ack >= seq, 'command acknowledged')
    expect(applied[1]).toEqual({ type: 'notchSet', notch: 3 })

    // A held brake is repeated by the desk…
    desk.send({ type: 'brake', command: 'release' })
    await until(() => applied.filter((c) => c.type === 'brake').length >= 3, 'brake repeated')
    expect(applied.some((c) => c.type === 'brake' && c.command === 'hold')).toBe(false)

    // …until the phone drops off the network without a word
    sockets[1].terminate()
    await until(() => !host!.getSnapshot().deskConnected, 'host saw the desk leave')
    expect(applied[applied.length - 1]).toEqual({ type: 'brake', command: 'hold' })

    // The desk reconnects by itself and is seated again
    await until(() => desk!.getSnapshot().joined, 'desk rejoined')
    await until(() => desk!.getSnapshot().state?.trainId === 't_2', 'state after rejoining')

    // The PC cuts the link: the desk is told and stops
    host.stop()
    await until(() => desk!.getSnapshot().ended === 'host-closed', 'desk told of the end')
    await until(() => relay!.relay.roomCount === 0, 'room closed')
  })
})
