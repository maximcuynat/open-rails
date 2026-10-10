import { HEARTBEAT_PERIOD_MS, HEARTBEAT_TIMEOUT_MS, decodeMessage, encodeMessage, generateClientId, type RemoteMessage } from '@application/remote/protocol'
import { systemScheduler, type LinkStatus, type RemoteLink, type Scheduler } from '@application/remote/remoteLink'
import { PeerBroker, type BrokerSignal } from './peerBroker'
import { createBrowserPeer, deskPeerId, hostPeerId, plain, type RtcChannelLike, type RtcPeerFactory, type RtcPeerLike, type RtcPlain } from './rtcPeer'
import type { WebSocketFactory } from './webSocketLink'

/**
 * The link of a phone desk when it reaches the PC directly (WebRTC): the broker introduces it to
 * the PC that holds the room, it offers a connection, and its data channel is the link. The
 * frames are those of the relay — the page of the PC is the relay — so the desk above sees no
 * difference. It tries again, with a growing delay, until it is closed.
 */

export interface RtcDeskLinkOptions {
  /** Address of the broker */
  brokerUrl: string
  /** Code of the room to reach */
  room: string
  createSocket?: WebSocketFactory
  createPeer?: RtcPeerFactory
  scheduler?: Scheduler
  minRetryMs?: number
  maxRetryMs?: number
  /** How long an attempt may take to open its channel before it is given up, ms */
  attemptMs?: number
}

/**
 * Why the link is not up, when it can tell: `broker` — the broker cannot be reached; `direct` —
 * the PC answered but the two networks do not let a direct connection through.
 */
export type RtcTrouble = 'broker' | 'direct' | null

export class RtcDeskLink implements RemoteLink {
  private current: LinkStatus = 'connecting'
  private readonly messageListeners = new Set<(message: RemoteMessage) => void>()
  private readonly statusListeners = new Set<(status: LinkStatus) => void>()
  private readonly scheduler: Scheduler
  private readonly createPeer: RtcPeerFactory
  private readonly hostId: string
  private readonly minRetryMs: number
  private readonly maxRetryMs: number
  private readonly attemptMs: number
  private broker: PeerBroker | null = null
  private offBroker: (() => void)[] = []
  private peer: RtcPeerLike | null = null
  private channel: RtcChannelLike | null = null
  /** The PC answered this attempt: a failure from here on is the networks', not an empty room */
  private answered = false
  private failures = 0
  private directFailures = 0
  private lastHeard = 0
  private retryTimer: unknown = null
  private attemptTimer: unknown = null
  private heartbeatTimer: unknown = null
  private troubleNow: RtcTrouble = null

  constructor(private readonly options: RtcDeskLinkOptions) {
    this.scheduler = options.scheduler ?? systemScheduler
    this.createPeer = options.createPeer ?? createBrowserPeer
    this.hostId = hostPeerId(options.room)
    this.minRetryMs = options.minRetryMs ?? 1000
    this.maxRetryMs = options.maxRetryMs ?? 10000
    this.attemptMs = options.attemptMs ?? 15000
    this.connect()
  }

  get status(): LinkStatus {
    return this.current
  }

  /** What keeps the link down, as far as it can tell */
  get trouble(): RtcTrouble {
    return this.troubleNow
  }

  send(message: RemoteMessage): boolean {
    if (this.current !== 'open' || !this.channel) return false
    try {
      this.channel.send(encodeMessage(message))
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
    this.dropAttempt()
    this.setStatus('closed')
  }

  /** One attempt: a place on the broker, an offer to the PC, and the channel that opens — or not */
  private connect(): void {
    this.retryTimer = null
    this.answered = false
    const broker = new PeerBroker({
      url: this.options.brokerUrl,
      // A new id each time: the broker may still hold the one of an attempt that just died
      id: deskPeerId(this.options.room, generateClientId().slice(0, 12)),
      token: generateClientId(),
      createSocket: this.options.createSocket,
      scheduler: this.scheduler,
    })
    this.broker = broker
    const onStatus = () => {
      if (broker !== this.broker) return
      if (broker.status === 'open' && !this.peer) void this.offer(broker)
    }
    this.offBroker = [broker.onStatus(onStatus), broker.onSignal((signal) => this.onSignal(signal))]
    this.attemptTimer = this.scheduler.setTimeout(() => this.failed(), this.attemptMs)
    onStatus()
  }

  private async offer(broker: PeerBroker): Promise<void> {
    const peer = this.createPeer()
    this.peer = peer
    const current = (): boolean => peer === this.peer
    peer.onicecandidate = (event) => {
      if (event.candidate && current()) broker.send('CANDIDATE', this.hostId, { candidate: plain(event.candidate) })
    }
    peer.onconnectionstatechange = () => {
      if (current() && (peer.connectionState === 'failed' || peer.connectionState === 'closed')) this.failed()
    }
    const channel = peer.createDataChannel('desk')
    this.channel = channel
    channel.onopen = () => {
      if (!current()) return
      // The drive goes directly from here on: the broker is let go of
      this.closeBroker()
      if (this.attemptTimer !== null) this.scheduler.clearTimeout(this.attemptTimer)
      this.attemptTimer = null
      this.failures = this.directFailures = 0
      this.troubleNow = null
      this.lastHeard = this.scheduler.now()
      this.heartbeatTimer = this.scheduler.setInterval(() => this.heartbeat(), HEARTBEAT_PERIOD_MS)
      this.setStatus('open')
    }
    channel.onmessage = (event) => {
      if (!current()) return
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
    channel.onclose = () => {
      if (current()) this.failed()
    }
    try {
      const description = await peer.createOffer()
      await peer.setLocalDescription(description)
      if (current()) broker.send('OFFER', this.hostId, { sdp: plain(description) })
    } catch {
      if (current()) this.failed()
    }
  }

  private onSignal(signal: BrokerSignal): void {
    if (signal.src !== this.hostId || !this.peer) return
    const payload = (signal.payload ?? {}) as { sdp?: RtcPlain; candidate?: RtcPlain }
    if (signal.type === 'ANSWER' && payload.sdp) {
      this.answered = true
      this.peer.setRemoteDescription(payload.sdp).catch(() => this.failed())
    } else if (signal.type === 'CANDIDATE' && payload.candidate) {
      this.peer.addIceCandidate(payload.candidate).catch(() => {})
    } else if (signal.type === 'EXPIRE') {
      // Nobody holds this room on the broker: what the relay calls an unknown room
      for (const listener of [...this.messageListeners]) listener({ t: 'error', code: 'unknown-room' })
      this.failed()
    }
  }

  private heartbeat(): void {
    if (this.scheduler.now() - this.lastHeard >= HEARTBEAT_TIMEOUT_MS) {
      // The PC went mute without closing: give this connection up
      this.failed()
      return
    }
    this.send({ t: 'ping' })
  }

  /** This attempt, or the connection it made, is over and nobody asked for it */
  private failed(): void {
    if (this.current === 'closed') return
    const wasOpen = this.current === 'open'
    if (!wasOpen) {
      if (this.broker && this.broker.status !== 'open' && !this.peer) this.troubleNow = 'broker'
      else if (this.answered && ++this.directFailures >= 2) this.troubleNow = 'direct'
    }
    this.dropAttempt()
    const delay = Math.min(this.maxRetryMs, this.minRetryMs * 2 ** this.failures)
    this.failures = wasOpen ? 0 : this.failures + 1
    this.setStatus('connecting')
    this.retryTimer = this.scheduler.setTimeout(() => this.connect(), delay)
  }

  private closeBroker(): void {
    for (const off of this.offBroker) off()
    this.offBroker = []
    this.broker?.close()
    this.broker = null
  }

  private dropAttempt(): void {
    if (this.attemptTimer !== null) this.scheduler.clearTimeout(this.attemptTimer)
    this.attemptTimer = null
    if (this.heartbeatTimer !== null) this.scheduler.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.closeBroker()
    const peer = this.peer
    const channel = this.channel
    this.peer = null
    this.channel = null
    if (channel) channel.onopen = channel.onmessage = channel.onclose = null
    if (peer) peer.onicecandidate = peer.ondatachannel = peer.onconnectionstatechange = null
    try {
      channel?.close()
      peer?.close()
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
