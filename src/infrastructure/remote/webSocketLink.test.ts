import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteMessage } from '@application/remote/protocol'
import { WebSocketLink, type WebSocketLike } from './webSocketLink'

class FakeSocket implements WebSocketLike {
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  sent: RemoteMessage[] = []
  closed = false
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as RemoteMessage)
  }
  close(): void {
    this.closed = true
  }
  open(): void {
    this.onopen?.({})
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) })
  }
  /** The other end (or the network) closes the connection */
  drop(): void {
    this.onerror?.({})
    this.onclose?.({})
  }
}

function setup(options: { failFirst?: boolean } = {}) {
  const sockets: FakeSocket[] = []
  let failNext = options.failFirst ?? false
  const link = new WebSocketLink({
    url: 'ws://pc.test/open-rails/__remote',
    createSocket: (url) => {
      if (failNext) {
        failNext = false
        throw new Error('blocked')
      }
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    minRetryMs: 500,
    maxRetryMs: 8000,
    stableMs: 5000,
    heartbeatMs: 5000,
    timeoutMs: 15000,
  })
  const statuses: string[] = []
  link.onStatus((status) => statuses.push(status))
  const received: RemoteMessage[] = []
  link.onMessage((message) => received.push(message))
  return { link, sockets, statuses, received, last: () => sockets[sockets.length - 1] }
}

describe('WebSocketLink', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects at once and reports its status', () => {
    const { link, sockets, statuses } = setup()
    expect(link.status).toBe('connecting')
    expect(sockets).toHaveLength(1)
    expect(sockets[0].url).toBe('ws://pc.test/open-rails/__remote')
    expect(link.send({ t: 'ping' })).toBe(false)
    sockets[0].open()
    expect(link.status).toBe('open')
    expect(statuses).toEqual(['open'])
    expect(link.send({ t: 'bye' })).toBe(true)
    expect(sockets[0].sent).toEqual([{ t: 'bye' }])
  })

  it('delivers valid messages only, and keeps heartbeats to itself', () => {
    const { sockets, received } = setup()
    const socket = sockets[0]
    socket.open()
    socket.receive({ t: 'peer-joined' })
    socket.receive('{broken')
    socket.receive({ t: 'command', seq: 1, trainId: 't_1', command: { type: 'notchSet', notch: 999 } })
    socket.receive({ t: 'whatever' })
    socket.onmessage?.({ data: new ArrayBuffer(8) })
    socket.receive({ t: 'pong' })
    socket.receive({ t: 'ping' })
    socket.receive({ t: 'state', state: null, ack: 2 })
    expect(received).toEqual([{ t: 'peer-joined' }, { t: 'state', state: null, ack: 2 }])
    // A ping is answered
    expect(socket.sent).toEqual([{ t: 'pong' }])
  })

  it('stops delivering to a listener that unsubscribed', () => {
    const { link, sockets } = setup()
    const listener = vi.fn()
    const off = link.onMessage(listener)
    sockets[0].open()
    sockets[0].receive({ t: 'bye' })
    off()
    sockets[0].receive({ t: 'bye' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('reconnects with a delay that doubles up to the cap', () => {
    const { link, sockets, statuses, last } = setup()
    sockets[0].open()
    sockets[0].drop()
    expect(link.status).toBe('connecting')
    const delays: number[] = []
    for (let attempt = 0; attempt < 7; attempt++) {
      const count = sockets.length
      let waited = 0
      while (sockets.length === count) {
        vi.advanceTimersByTime(250)
        waited += 250
      }
      delays.push(waited)
      last().drop()
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000])
    expect(statuses).toEqual(['open', 'connecting'])
  })

  it('starts from the short delay again after a connection that held', () => {
    const { sockets, last } = setup()
    sockets[0].drop()
    vi.advanceTimersByTime(500)
    last().drop()
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(3)
    // Opened but closed right away (a refusal of the relay): the delay keeps growing
    last().open()
    last().drop()
    vi.advanceTimersByTime(1999)
    expect(sockets).toHaveLength(3)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(4)
    // This one holds for a while
    last().open()
    vi.advanceTimersByTime(4000)
    last().receive({ t: 'pong' })
    vi.advanceTimersByTime(2000)
    last().drop()
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(5)
  })

  it('retries when the socket cannot even be created', () => {
    const { link, sockets } = setup({ failFirst: true })
    expect(sockets).toHaveLength(0)
    expect(link.status).toBe('connecting')
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(1)
  })

  it('pings the relay and gives the connection up when it goes mute', () => {
    const { link, sockets, statuses } = setup()
    const socket = sockets[0]
    socket.open()
    vi.advanceTimersByTime(5000)
    expect(socket.sent).toEqual([{ t: 'ping' }])
    socket.receive({ t: 'pong' })
    vi.advanceTimersByTime(10000)
    expect(socket.sent).toHaveLength(3)
    expect(link.status).toBe('open')
    // 15 s after the last pong
    vi.advanceTimersByTime(10000)
    expect(socket.closed).toBe(true)
    expect(link.status).toBe('connecting')
    expect(statuses).toEqual(['open', 'connecting'])
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(2)
  })

  it('ignores the events of a socket it gave up', () => {
    const { link, sockets, received } = setup()
    const first = sockets[0]
    first.open()
    const handlers = { onmessage: first.onmessage, onclose: first.onclose }
    first.drop()
    vi.advanceTimersByTime(500)
    sockets[1].open()
    handlers.onmessage?.({ data: JSON.stringify({ t: 'bye' }) })
    handlers.onclose?.({})
    expect(received).toEqual([])
    expect(link.status).toBe('open')
  })

  it('closes for good', () => {
    const { link, sockets, statuses } = setup()
    sockets[0].open()
    link.close()
    expect(link.status).toBe('closed')
    expect(sockets[0].closed).toBe(true)
    expect(link.send({ t: 'ping' })).toBe(false)
    vi.advanceTimersByTime(60000)
    expect(sockets).toHaveLength(1)
    expect(sockets[0].sent).toEqual([])
    expect(statuses).toEqual(['open', 'closed'])
    link.close()
    expect(statuses).toEqual(['open', 'closed'])
  })

  it('does not reconnect when closed while waiting for a retry', () => {
    const { link, sockets } = setup()
    sockets[0].drop()
    link.close()
    vi.advanceTimersByTime(60000)
    expect(sockets).toHaveLength(1)
    expect(link.status).toBe('closed')
  })
})
