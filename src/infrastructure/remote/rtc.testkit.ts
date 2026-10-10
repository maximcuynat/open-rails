import { BrokerHub, type BrokerConnection } from '../../../tools/remote-relay/brokerHub'
import type { RtcChannelLike, RtcPeerLike, RtcPlain } from './rtcPeer'
import type { WebSocketFactory, WebSocketLike } from './webSocketLink'

// What the WebRTC links need to run under Node: a broker in memory behind fake sockets, and
// peer connections that find each other through the descriptions they exchange.

/** Sockets onto a broker in memory. `down`: the broker cannot be reached (every socket closes at once). */
export function fakeBroker(options: { expireMs?: number } = {}) {
  const hub = new BrokerHub({ expireMs: options.expireMs })
  const state = { down: false, opened: [] as string[] }
  const sockets = new Set<WebSocketLike & { conn: BrokerConnection }>()
  const createSocket: WebSocketFactory = (url) => {
    state.opened.push(url)
    const socket: WebSocketLike & { conn: BrokerConnection } = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      conn: {
        send: (data) => socket.onmessage?.({ data }),
        close: () => {
          hub.disconnect(socket.conn)
          sockets.delete(socket)
          const closed = socket.onclose
          queueMicrotask(() => closed?.({}))
        },
      },
      send: (data) => hub.receive(socket.conn, data),
      close: () => {
        hub.disconnect(socket.conn)
        sockets.delete(socket)
      },
    }
    sockets.add(socket)
    // The handlers are set after the socket is made: the broker answers a moment later
    queueMicrotask(() => {
      if (state.down) return socket.conn.close()
      socket.onopen?.({})
      hub.connect(socket.conn, url)
    })
    return socket
  }
  /** The broker drops everyone, as when it restarts */
  const dropAll = () => {
    for (const socket of [...sockets]) socket.conn.close()
  }
  return { hub, createSocket, state, dropAll }
}

/** A description that names its peer, in the dress of a real one (the broker looks at it) */
const fakeSdp = (index: number): string => `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=peer:${index}\r\nt=0 0\r\n`

class FakeChannel implements RtcChannelLike {
  readyState = 'connecting'
  other: FakeChannel | null = null
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error('channel not open')
    this.sent.push(data)
    this.other?.onmessage?.({ data })
  }

  close(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    const other = this.other
    this.other = null
    // As in a browser: closing a channel fires `close` on both of its ends
    this.onclose?.()
    if (other && other.readyState !== 'closed') {
      other.readyState = 'closed'
      other.other = null
      other.onclose?.()
    }
  }
}

class FakePeer implements RtcPeerLike {
  connectionState = 'new'
  channel: FakeChannel | null = null
  candidates: RtcPlain[] = []
  closed = false
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null
  ondatachannel: ((event: { channel: RtcChannelLike }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor(private readonly world: FakeRtcWorld, readonly index: number) {}

  createDataChannel(): RtcChannelLike {
    return (this.channel = new FakeChannel())
  }

  async createOffer(): Promise<RtcPlain> {
    return { type: 'offer', sdp: fakeSdp(this.index) }
  }

  async createAnswer(): Promise<RtcPlain> {
    return { type: 'answer', sdp: fakeSdp(this.index) }
  }

  async setLocalDescription(): Promise<void> {
    this.onicecandidate?.({ candidate: { candidate: `candidate:${this.index}`, sdpMid: '0' } })
  }

  async setRemoteDescription(description: RtcPlain): Promise<void> {
    const remote = this.world.peers[Number(/s=peer:(\d+)/.exec(String(description.sdp))?.[1])]
    if (!remote) throw new Error('unknown peer')
    // The one that receives the answer made the offer: the two can now meet
    if (description.type === 'answer') this.world.meet(this, remote)
  }

  async addIceCandidate(candidate: RtcPlain): Promise<void> {
    this.candidates.push(candidate)
  }

  close(): void {
    this.closed = true
    this.connectionState = 'closed'
    this.channel?.close()
  }

  fail(): void {
    this.connectionState = 'failed'
    this.onconnectionstatechange?.()
  }
}

/** Peer connections in memory. `blocked`: the networks let nothing through (every meeting fails). */
export class FakeRtcWorld {
  peers: FakePeer[] = []
  blocked = false

  createPeer = (): RtcPeerLike => {
    const peer = new FakePeer(this, this.peers.length)
    this.peers.push(peer)
    return peer
  }

  meet(offerer: FakePeer, answerer: FakePeer): void {
    if (this.blocked) {
      offerer.fail()
      answerer.fail()
      return
    }
    const here = offerer.channel
    if (!here) return
    const there = new FakeChannel()
    answerer.channel = there
    here.other = there
    there.other = here
    offerer.connectionState = answerer.connectionState = 'connected'
    answerer.ondatachannel?.({ channel: there })
    here.readyState = there.readyState = 'open'
    there.onopen?.()
    here.onopen?.()
  }
}
