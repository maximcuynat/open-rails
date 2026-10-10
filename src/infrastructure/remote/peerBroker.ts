import { systemScheduler, type Scheduler } from '@application/remote/remoteLink'
import type { WebSocketFactory, WebSocketLike } from './webSocketLink'

// The broker that introduces two browsers to each other before they talk directly (WebRTC): the
// public PeerJS server, spoken to by hand — its protocol is a WebSocket carrying small JSON
// messages, read from the source of `peerjs-server`:
//   server → client  { type: 'OPEN' }                       the id is ours
//                    { type: 'ID-TAKEN', payload: { msg } }  someone else holds it (then it closes)
//                    { type: 'ERROR', payload: { msg } }     bad key, server full (then it closes)
//   client → server  { type: 'HEARTBEAT' }                   or the server forgets us
//   both ways        { type: 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'LEAVE', dst, payload }
//                    forwarded to `dst` with `src` added; kept a few seconds for a `dst` that is
//                    not there yet, then answered by { type: 'EXPIRE', src: dst }
// This client knows nothing of WebRTC: it opens an id, sends, and hands over what it receives.

/** The public broker of the PeerJS project */
export const DEFAULT_BROKER_URL = 'wss://0.peerjs.com/peerjs'
/** The key the public broker expects */
const BROKER_KEY = 'peerjs'
/** The server forgets a client that stays silent; the PeerJS client beats every five seconds */
const BROKER_HEARTBEAT_MS = 5000

export type BrokerSignalType = 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'LEAVE' | 'EXPIRE'
const SIGNAL_TYPES: readonly string[] = ['OFFER', 'ANSWER', 'CANDIDATE', 'LEAVE', 'EXPIRE']

/** What another peer sent us through the broker (`EXPIRE`: the broker itself, about a peer that is not there) */
export interface BrokerSignal {
  type: BrokerSignalType
  /** Id of the peer it comes from, or is about */
  src: string
  payload: unknown
}

/** `taken`: another peer holds the id; the broker is not asked again until `reopen` */
export type BrokerStatus = 'connecting' | 'open' | 'taken' | 'closed'

export interface PeerBrokerOptions {
  /** Address of the broker, e.g. `wss://0.peerjs.com/peerjs` */
  url: string
  /** The id to hold: letters, digits, dashes */
  id: string
  /** Lets this client take its own id back after a reconnection */
  token: string
  createSocket?: WebSocketFactory
  scheduler?: Scheduler
  minRetryMs?: number
  maxRetryMs?: number
}

/** The address a client opens: the broker's, with who it is */
export function brokerSocketUrl(url: string, id: string, token: string): string {
  const address = new URL(url)
  address.searchParams.set('key', BROKER_KEY)
  address.searchParams.set('id', id)
  address.searchParams.set('token', token)
  return address.toString()
}

/** A place on the broker: connects as soon as built, beats, and reconnects with a growing delay until closed */
export class PeerBroker {
  private current: BrokerStatus = 'connecting'
  private socket: WebSocketLike | null = null
  private readonly statusListeners = new Set<(status: BrokerStatus) => void>()
  private readonly signalListeners = new Set<(signal: BrokerSignal) => void>()
  private readonly address: string
  private readonly createSocket: WebSocketFactory
  private readonly scheduler: Scheduler
  private readonly minRetryMs: number
  private readonly maxRetryMs: number
  private failures = 0
  private retryTimer: unknown = null
  private heartbeatTimer: unknown = null
  readonly id: string

  constructor(options: PeerBrokerOptions) {
    this.id = options.id
    this.address = brokerSocketUrl(options.url, options.id, options.token)
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as WebSocketLike)
    this.scheduler = options.scheduler ?? systemScheduler
    this.minRetryMs = options.minRetryMs ?? 1000
    this.maxRetryMs = options.maxRetryMs ?? 15000
    this.connect()
  }

  get status(): BrokerStatus {
    return this.current
  }

  onStatus(listener: (status: BrokerStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onSignal(listener: (signal: BrokerSignal) => void): () => void {
    this.signalListeners.add(listener)
    return () => this.signalListeners.delete(listener)
  }

  /** Sends to another peer; false when the broker is not there to take it */
  send(type: Exclude<BrokerSignalType, 'EXPIRE'>, dst: string, payload: unknown): boolean {
    if (this.current !== 'open' || !this.socket) return false
    try {
      this.socket.send(JSON.stringify({ type, dst, payload }))
      return true
    } catch {
      return false
    }
  }

  close(): void {
    if (this.current === 'closed') return
    if (this.retryTimer !== null) this.scheduler.clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.dropSocket()
    this.setStatus('closed')
  }

  private connect(): void {
    this.retryTimer = null
    let socket: WebSocketLike
    try {
      socket = this.createSocket(this.address)
    } catch {
      this.retryLater()
      return
    }
    this.socket = socket
    socket.onopen = () => {}
    socket.onmessage = (event) => {
      if (socket !== this.socket) return
      const message = readBrokerMessage(event.data)
      if (!message) return
      if (message.type === 'OPEN') {
        this.failures = 0
        this.heartbeatTimer ??= this.scheduler.setInterval(() => this.beat(), BROKER_HEARTBEAT_MS)
        this.setStatus('open')
      } else if (message.type === 'ID-TAKEN') {
        this.dropSocket()
        this.setStatus('taken')
      } else if (message.type === 'ERROR') {
        this.lost()
      } else if (SIGNAL_TYPES.includes(message.type) && typeof message.src === 'string') {
        const signal: BrokerSignal = { type: message.type as BrokerSignalType, src: message.src, payload: message.payload }
        for (const listener of [...this.signalListeners]) listener(signal)
      }
    }
    socket.onclose = () => {
      if (socket !== this.socket) return
      this.lost()
    }
    // A failed connection also fires `close`, which is where the retry is scheduled
    socket.onerror = () => {}
  }

  private beat(): void {
    try {
      this.socket?.send(JSON.stringify({ type: 'HEARTBEAT' }))
    } catch {
      // The close event that follows schedules the retry
    }
  }

  private lost(): void {
    this.dropSocket()
    this.retryLater()
  }

  private retryLater(): void {
    const delay = Math.min(this.maxRetryMs, this.minRetryMs * 2 ** this.failures)
    this.failures++
    this.setStatus('connecting')
    this.retryTimer = this.scheduler.setTimeout(() => this.connect(), delay)
  }

  private dropSocket(): void {
    if (this.heartbeatTimer !== null) this.scheduler.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    const socket = this.socket
    this.socket = null
    if (!socket) return
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    try {
      socket.close()
    } catch {
      // Already closed
    }
  }

  private setStatus(status: BrokerStatus): void {
    if (status === this.current) return
    this.current = status
    for (const listener of [...this.statusListeners]) listener(status)
  }
}

/** A frame of the broker as an object with a `type`; null for anything else */
function readBrokerMessage(data: unknown): { type: string; src?: unknown; payload?: unknown } | null {
  if (typeof data !== 'string' || data.length > 64 * 1024) return null
  try {
    const value: unknown = JSON.parse(data)
    if (!value || typeof value !== 'object') return null
    const message = value as { type?: unknown; src?: unknown; payload?: unknown }
    return typeof message.type === 'string' ? { type: message.type, src: message.src, payload: message.payload } : null
  } catch {
    return null
  }
}
