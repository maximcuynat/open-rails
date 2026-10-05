import {
  HEARTBEAT_PERIOD_MS,
  HEARTBEAT_TIMEOUT_MS,
  decodeMessage,
  encodeMessage,
  relayUrl,
  type RemoteMessage,
} from '@application/remote/protocol'
import {
  systemScheduler,
  type LinkStatus,
  type RemoteLink,
  type Scheduler,
} from '@application/remote/remoteLink'

export type { LinkStatus, RemoteLink } from '@application/remote/remoteLink'

/** The part of the browser `WebSocket` the link uses, so a test can hand it a fake */
export interface WebSocketLike {
  send(data: string): void
  close(): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
}

export type WebSocketFactory = (url: string) => WebSocketLike

export interface WebSocketLinkOptions {
  /** Absolute `ws://` or `wss://` address of the relay (see `defaultRelayUrl`) */
  url: string
  /** Default: the global `WebSocket` */
  createSocket?: WebSocketFactory
  scheduler?: Scheduler
  /** First wait before a retry; doubles on every failure… */
  minRetryMs?: number
  /** …up to this */
  maxRetryMs?: number
  /** A connection that held this long was a good one: the next retry starts from `minRetryMs` */
  stableMs?: number
  heartbeatMs?: number
  /** Silence from the relay after which the connection is given up and retried */
  timeoutMs?: number
}

/**
 * Address of the relay for this page: the server that served it, under the application base.
 * `override` is an external relay (`wss://…`), for the published site.
 */
export function defaultRelayUrl(override?: string): string {
  return relayUrl(globalThis.location.href, import.meta.env.BASE_URL, override)
}

/**
 * WebSocket transport to the relay. It connects as soon as it is built, keeps the connection
 * alive with pings, and reconnects with a growing, capped delay until `close()` is called.
 */
export class WebSocketLink implements RemoteLink {
  private current: LinkStatus = 'connecting'
  private socket: WebSocketLike | null = null
  private readonly messageListeners = new Set<(message: RemoteMessage) => void>()
  private readonly statusListeners = new Set<(status: LinkStatus) => void>()
  private readonly url: string
  private readonly createSocket: WebSocketFactory
  private readonly scheduler: Scheduler
  private readonly minRetryMs: number
  private readonly maxRetryMs: number
  private readonly stableMs: number
  private readonly heartbeatMs: number
  private readonly timeoutMs: number
  private failures = 0
  private openedAt: number | null = null
  private lastHeard = 0
  private retryTimer: unknown = null
  private heartbeatTimer: unknown = null

  constructor(options: WebSocketLinkOptions) {
    this.url = options.url
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as WebSocketLike)
    this.scheduler = options.scheduler ?? systemScheduler
    this.minRetryMs = options.minRetryMs ?? 500
    this.maxRetryMs = options.maxRetryMs ?? 8000
    this.stableMs = options.stableMs ?? 5000
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_PERIOD_MS
    this.timeoutMs = options.timeoutMs ?? HEARTBEAT_TIMEOUT_MS
    this.connect()
  }

  get status(): LinkStatus {
    return this.current
  }

  send(message: RemoteMessage): boolean {
    if (this.current !== 'open' || !this.socket) return false
    try {
      this.socket.send(encodeMessage(message))
      return true
    } catch {
      return false
    }
  }

  onMessage(listener: (message: RemoteMessage) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onStatus(listener: (status: LinkStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
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
      socket = this.createSocket(this.url)
    } catch {
      this.retryLater()
      return
    }
    this.socket = socket
    socket.onopen = () => {
      if (socket !== this.socket) return
      this.openedAt = this.lastHeard = this.scheduler.now()
      this.heartbeatTimer = this.scheduler.setInterval(() => this.heartbeat(), this.heartbeatMs)
      this.setStatus('open')
    }
    socket.onmessage = (event) => {
      if (socket !== this.socket) return
      this.lastHeard = this.scheduler.now()
      const decoded = decodeMessage(event.data)
      if (!decoded.ok) return
      const message = decoded.message
      if (message.t === 'pong') return
      if (message.t === 'ping') {
        this.send({ t: 'pong' })
        return
      }
      for (const listener of [...this.messageListeners]) listener(message)
    }
    socket.onclose = () => {
      if (socket !== this.socket) return
      this.lost()
    }
    // A failed connection also fires `close`, which is where the retry is scheduled
    socket.onerror = () => {}
  }

  private heartbeat(): void {
    if (this.scheduler.now() - this.lastHeard >= this.timeoutMs) {
      // The relay went mute without closing: give this connection up
      this.lost()
      return
    }
    this.send({ t: 'ping' })
  }

  /** The connection is gone and nobody asked for it */
  private lost(): void {
    const openedAt = this.openedAt
    this.dropSocket()
    if (openedAt !== null && this.scheduler.now() - openedAt >= this.stableMs) this.failures = 0
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
    this.openedAt = null
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

  private setStatus(status: LinkStatus): void {
    if (status === this.current) return
    this.current = status
    for (const listener of [...this.statusListeners]) listener(status)
  }
}

/** The link to the relay of this page (or to an external one) */
export function createWebSocketLink(relayOverride?: string): WebSocketLink {
  return new WebSocketLink({ url: defaultRelayUrl(relayOverride) })
}
