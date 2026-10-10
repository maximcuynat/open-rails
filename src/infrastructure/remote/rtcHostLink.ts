import { decodeMessage, encodeMessage, generateClientId, type RemoteMessage } from '@application/remote/protocol'
import { systemScheduler, type LinkStatus, type RemoteLink, type Scheduler } from '@application/remote/remoteLink'
import { RoomRelay, type RelayConnection } from '@application/remote/roomRelay'
import { PeerBroker, type BrokerSignal } from './peerBroker'
import { answerPayload, candidatePayload, createBrowserPeer, hostPeerId, plain, readPayload, type RtcChannelLike, type RtcPeerFactory, type RtcPeerLike, type RtcPlain } from './rtcPeer'
import type { WebSocketFactory } from './webSocketLink'

/**
 * The link of the PC when desks reach it directly (WebRTC) instead of through the relay of the
 * dev server: the page is its own relay. It runs the very rooms the server runs (`RoomRelay`),
 * with the host as a connection in memory and each desk as the data channel it opened; the host,
 * the session and the store see no difference.
 *
 * A broker introduces the desks (`peerBroker.ts`): the PC holds the id of its room there, answers
 * the offer of each desk, and from then on nothing of the drive goes through it.
 */

export interface RtcHostLinkOptions {
  /** Address of the broker */
  brokerUrl: string
  createSocket?: WebSocketFactory
  createPeer?: RtcPeerFactory
  scheduler?: Scheduler
  /** How often the rooms are swept for desks gone silent, ms */
  sweepMs?: number
  /**
   * Silence of a desk after which it is taken as gone, ms. A data channel does not say that the
   * page at its other end closed: without this a train would run on under power for the fifteen
   * seconds the rooms allow. A desk on a direct link beats every second (`RtcDeskLink`).
   */
  silenceMs?: number
}

interface DeskPeer {
  peer: RtcPeerLike
  channel: RtcChannelLike | null
  conn: RelayConnection | null
  /** When the desk was last heard on its channel */
  lastHeard: number
  /** The name the desk gave this attempt: what is sent back to it carries it */
  connectionId: string
}

export class RtcHostLink implements RemoteLink {
  private current: LinkStatus = 'open'
  private readonly messageListeners = new Set<(message: RemoteMessage) => void>()
  private readonly statusListeners = new Set<(status: LinkStatus) => void>()
  private readonly scheduler: Scheduler
  private readonly createPeer: RtcPeerFactory
  private readonly relay: RoomRelay
  /** The host as the rooms see it */
  private local: RelayConnection | null = null
  private broker: PeerBroker | null = null
  private offBroker: (() => void)[] = []
  /** The room request of the host, kept until the broker gives the id of that room */
  private pending: Extract<RemoteMessage, { t: 'host' }> | null = null
  private readonly desks = new Map<string, DeskPeer>()
  private readonly token = generateClientId()
  private sweepTimer: unknown = null
  private readonly silenceMs: number

  constructor(private readonly options: RtcHostLinkOptions) {
    this.scheduler = options.scheduler ?? systemScheduler
    this.createPeer = options.createPeer ?? createBrowserPeer
    this.relay = new RoomRelay({ now: () => this.scheduler.now() })
    this.silenceMs = options.silenceMs ?? 3000
    this.sweepTimer = this.scheduler.setInterval(() => this.sweep(), options.sweepMs ?? 1000)
    this.seatHost()
  }

  get status(): LinkStatus {
    return this.current
  }

  send(message: RemoteMessage): boolean {
    if (this.current !== 'open' || !this.local) return false
    if (message.t === 'host') {
      // The room exists once the broker has given its id: the rooms are only told then
      this.pending = message
      this.openBroker(message.room)
      return true
    }
    this.relay.receive(this.local, encodeMessage(message))
    return true
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
    if (this.sweepTimer !== null) this.scheduler.clearInterval(this.sweepTimer)
    this.sweepTimer = null
    this.closeBroker()
    for (const id of [...this.desks.keys()]) this.dropDesk(id)
    this.relay.closeAll()
    this.local = null
    this.setStatus('closed')
  }

  /** The host takes its place in the rooms: a connection that hands what it is sent to the listeners */
  private seatHost(): void {
    const local: RelayConnection = {
      send: (data) => {
        if (local !== this.local) return
        const decoded = decodeMessage(data)
        if (!decoded.ok || decoded.message.t === 'pong') return
        for (const listener of [...this.messageListeners]) listener(decoded.message)
      },
      close: () => {},
    }
    this.local = local
    this.relay.connect(local)
  }

  private openBroker(room: string): void {
    this.closeBroker()
    const broker = new PeerBroker({
      url: this.options.brokerUrl,
      id: hostPeerId(room),
      token: this.token,
      createSocket: this.options.createSocket,
      scheduler: this.scheduler,
    })
    this.broker = broker
    const onStatus = () => {
      if (broker !== this.broker) return
      if (broker.status === 'open') {
        // The id is ours: the room opens (the first time), and desks may be introduced
        if (this.pending && this.local) this.relay.receive(this.local, encodeMessage(this.pending))
        this.pending = null
      } else if (broker.status === 'taken') {
        this.roomTaken()
      }
    }
    this.offBroker = [broker.onStatus(onStatus), broker.onSignal((signal) => this.onSignal(signal))]
    onStatus()
  }

  private closeBroker(): void {
    for (const off of this.offBroker) off()
    this.offBroker = []
    this.broker?.close()
    this.broker = null
  }

  /**
   * Another PC holds this code on the broker. As the relay of the dev server does: the host is
   * told, its connection drops, and it asks again under the code it then draws.
   */
  private roomTaken(): void {
    this.closeBroker()
    this.pending = null
    for (const listener of [...this.messageListeners]) listener({ t: 'error', code: 'room-taken' })
    if (this.local) this.relay.disconnect(this.local)
    this.setStatus('connecting')
    this.scheduler.setTimeout(() => {
      if (this.current !== 'connecting') return
      this.seatHost()
      this.setStatus('open')
    }, 0)
  }

  private onSignal(signal: BrokerSignal): void {
    const payload = readPayload(signal.payload)
    if (signal.type === 'OFFER' && payload.sdp && payload.connectionId) return void this.answer(signal.src, payload.sdp, payload.connectionId)
    const desk = this.desks.get(signal.src)
    if (!desk) return
    // A candidate of an attempt the desk gave up is not for this connection
    if (signal.type === 'CANDIDATE' && payload.candidate && payload.connectionId === desk.connectionId) desk.peer.addIceCandidate(payload.candidate).catch(() => {})
    else if (signal.type === 'LEAVE') this.dropDesk(signal.src)
  }

  /** A desk offers a connection: it is answered, and its data channel becomes its seat in the rooms */
  private async answer(deskId: string, offer: RtcPlain, connectionId: string): Promise<void> {
    // The same desk again: its former connection is dead to it
    this.dropDesk(deskId)
    const peer = this.createPeer()
    const desk: DeskPeer = { peer, channel: null, conn: null, lastHeard: this.scheduler.now(), connectionId }
    this.desks.set(deskId, desk)
    const current = (): boolean => this.desks.get(deskId) === desk
    peer.onicecandidate = (event) => {
      if (event.candidate && current()) this.broker?.send('CANDIDATE', deskId, candidatePayload(plain(event.candidate), connectionId))
    }
    peer.onconnectionstatechange = () => {
      // `disconnected`: the browser lost the other end; it may come back, and the desk then asks again
      if (current() && ['failed', 'closed', 'disconnected'].includes(peer.connectionState)) this.dropDesk(deskId)
    }
    peer.ondatachannel = ({ channel }) => {
      if (!current()) return
      desk.channel = channel
      const seat = () => {
        if (!current() || desk.conn) return
        const conn: RelayConnection = {
          send: (data) => {
            try {
              channel.send(data)
            } catch {
              // A channel that died between two frames: its close event cleans up
            }
          },
          close: () => this.dropDesk(deskId),
        }
        desk.conn = conn
        desk.lastHeard = this.scheduler.now()
        this.relay.connect(conn)
      }
      channel.onopen = seat
      channel.onmessage = (event) => {
        desk.lastHeard = this.scheduler.now()
        if (desk.conn) this.relay.receive(desk.conn, typeof event.data === 'string' ? event.data : null)
      }
      channel.onclose = () => {
        if (current()) this.dropDesk(deskId)
      }
      if (channel.readyState === 'open') seat()
    }
    try {
      await peer.setRemoteDescription(offer)
      const description = await peer.createAnswer()
      await peer.setLocalDescription(description)
      if (current()) this.broker?.send('ANSWER', deskId, answerPayload(plain(description), connectionId))
    } catch {
      if (current()) this.dropDesk(deskId)
    }
  }

  private dropDesk(deskId: string): void {
    const desk = this.desks.get(deskId)
    if (!desk) return
    this.desks.delete(deskId)
    if (desk.conn) this.relay.disconnect(desk.conn)
    desk.peer.onicecandidate = desk.peer.ondatachannel = desk.peer.onconnectionstatechange = null
    if (desk.channel) desk.channel.onopen = desk.channel.onmessage = desk.channel.onclose = null
    try {
      desk.channel?.close()
      desk.peer.close()
    } catch {
      // Already closed
    }
  }

  private sweep(): void {
    // The host never falls silent to itself
    if (this.local) this.relay.receive(this.local, encodeMessage({ t: 'ping' }))
    const limit = this.scheduler.now() - this.silenceMs
    for (const [id, desk] of [...this.desks]) if (desk.conn && desk.lastHeard <= limit) this.dropDesk(id)
    this.relay.sweep()
  }

  private setStatus(status: LinkStatus): void {
    if (status === this.current) return
    this.current = status
    for (const listener of [...this.statusListeners]) listener(status)
  }
}
