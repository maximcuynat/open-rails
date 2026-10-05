import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  type RemoteMessage,
} from '../../src/application/remote/protocol'
import { startRelayServer, type RunningRelay } from './server'

/** A real `ws` client that queues what it receives so a test can await each message in turn */
class Client {
  readonly socket: WebSocket
  private readonly queue: RemoteMessage[] = []
  private readonly waiters: ((message: RemoteMessage) => void)[] = []
  readonly closed: Promise<number>

  constructor(url: string) {
    this.socket = new WebSocket(url)
    this.socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as RemoteMessage
      const waiter = this.waiters.shift()
      if (waiter) waiter(message)
      else this.queue.push(message)
    })
    this.socket.on('error', () => {})
    this.closed = new Promise((resolve) => this.socket.on('close', (code) => resolve(code)))
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('open', () => resolve())
      this.socket.once('error', reject)
    })
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message))
  }

  next(): Promise<RemoteMessage> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no message within 2 s')), 2000)
      this.waiters.push((message) => {
        clearTimeout(timer)
        resolve(message)
      })
    })
  }
}

const COMMAND: RemoteMessage = {
  t: 'command',
  seq: 1,
  trainId: 't_1',
  command: { type: 'notchSet', notch: 3 },
}
const STATE: RemoteMessage = { t: 'state', state: null, ack: 1 }

describe('relay server (real sockets)', () => {
  let running: RunningRelay | null = null
  const clients: Client[] = []

  const start = async (options: Parameters<typeof startRelayServer>[0] = {}) => {
    running = await startRelayServer({ host: '127.0.0.1', hosts: () => ['192.168.1.42'], ...options })
    return running
  }
  const client = async (path = '/__remote') => {
    const c = new Client(`ws://127.0.0.1:${running?.port}${path}`)
    clients.push(c)
    await c.opened()
    return c
  }
  const host = async (room = 'ABC234') => {
    const c = await client()
    c.send({ t: 'host', v: PROTOCOL_VERSION, room, client: 'host-token' })
    return c
  }
  const desk = async (room = 'ABC234', token = 'desk-token') => {
    const c = await client()
    c.send({ t: 'join', v: PROTOCOL_VERSION, room, client: token })
    return c
  }

  afterEach(async () => {
    for (const c of clients.splice(0)) c.socket.terminate()
    await running?.close()
    running = null
  })

  it('pairs a host and a desk and forwards both ways', async () => {
    await start()
    const pc = await host()
    expect(await pc.next()).toEqual({ t: 'opened', room: 'ABC234', hosts: ['192.168.1.42'] })
    const phone = await desk()
    expect(await phone.next()).toEqual({ t: 'joined', room: 'ABC234' })
    expect(await pc.next()).toEqual({ t: 'peer-joined' })

    pc.send({ t: 'fleet', fleet: [] })
    pc.send(STATE)
    expect(await phone.next()).toEqual({ t: 'fleet', fleet: [] })
    expect(await phone.next()).toEqual(STATE)

    phone.send(COMMAND)
    expect(await pc.next()).toEqual(COMMAND)

    phone.send({ t: 'ping' })
    expect(await phone.next()).toEqual({ t: 'pong' })
  })

  it('refuses a second desk, an unknown room and another version', async () => {
    await start()
    const pc = await host()
    await pc.next()
    const phone = await desk()
    await phone.next()
    await pc.next()

    const second = await desk('ABC234', 'second-desk-token')
    expect(await second.next()).toEqual({ t: 'error', code: 'room-full' })
    expect(await second.closed).toBe(1000)

    const lost = await desk('ZZZZZZ')
    expect(await lost.next()).toEqual({ t: 'error', code: 'unknown-room' })
    await lost.closed

    const old = await client()
    old.send({ t: 'join', v: PROTOCOL_VERSION + 1, room: 'ABC234', client: 'old-desk-token' })
    expect(await old.next()).toEqual({ t: 'error', code: 'version' })
    await old.closed

    // The seated desk is untouched by all that
    phone.send(COMMAND)
    expect(await pc.next()).toEqual(COMMAND)
  })

  it('closes the room when the host leaves', async () => {
    const relay = await start()
    const pc = await host()
    await pc.next()
    const phone = await desk()
    await phone.next()
    await pc.next()

    pc.socket.close()
    expect(await phone.next()).toEqual({ t: 'peer-left' })
    await phone.closed
    expect(relay.relay.roomCount).toBe(0)
    expect(relay.relay.connectionCount).toBe(0)

    const late = await desk()
    expect(await late.next()).toEqual({ t: 'error', code: 'unknown-room' })
  })

  it('tells the host when the desk leaves', async () => {
    await start()
    const pc = await host()
    await pc.next()
    const phone = await desk()
    await phone.next()
    await pc.next()
    phone.socket.terminate()
    expect(await pc.next()).toEqual({ t: 'peer-left' })
  })

  it('closes a connection that sends garbage or too much', async () => {
    const relay = await start()
    const garbage = await client()
    garbage.socket.send('{nope')
    expect(await garbage.next()).toEqual({ t: 'error', code: 'bad-message' })
    await garbage.closed

    const binary = await client()
    binary.socket.send(Buffer.from([1, 2, 3]))
    expect(await binary.next()).toEqual({ t: 'error', code: 'bad-message' })
    await binary.closed

    const big = await client()
    big.socket.send('x'.repeat(MAX_MESSAGE_BYTES + 1))
    // `ws` refuses the frame itself: 1009, message too big
    expect(await big.closed).toBe(1009)
    expect(relay.relay.connectionCount).toBe(0)
  })

  it('closes mute connections', async () => {
    const relay = await start({ timeoutMs: 120, sweepMs: 30 })
    const pc = await host()
    await pc.next()
    const mute = await client()
    const pinger = setInterval(() => pc.send({ t: 'ping' }), 40)
    try {
      await mute.closed
      expect(relay.relay.connectionCount).toBe(1)
      expect(relay.relay.roomCount).toBe(1)
    } finally {
      clearInterval(pinger)
    }
    await pc.closed
    expect(relay.relay.roomCount).toBe(0)
  })

  it('only answers on its own path', async () => {
    await start({ path: '/open-rails/__remote' })
    const ok = await client('/open-rails/__remote')
    ok.send({ t: 'ping' })
    expect(await ok.next()).toEqual({ t: 'pong' })
    const elsewhere = new Client(`ws://127.0.0.1:${running?.port}/open-rails/`)
    clients.push(elsewhere)
    await expect(elsewhere.opened()).rejects.toBeDefined()
  })
})
