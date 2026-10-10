// A broker that speaks like the public PeerJS server, with no socket in sight (see the protocol
// at the top of `src/infrastructure/remote/peerBroker.ts`): the tests feed it by hand, and
// `fakeBroker.ts` puts it behind a real WebSocket to try WebRTC with no Internet.

export interface BrokerConnection {
  send(data: string): void
  close(): void
}

interface Client {
  conn: BrokerConnection
  token: string
}

export interface BrokerHubOptions {
  /** How long a message waits for a peer that is not there before `EXPIRE` is answered, ms */
  expireMs?: number
  setTimeout?: (callback: () => void, ms: number) => unknown
}

export class BrokerHub {
  private readonly clients = new Map<string, Client>()
  private readonly ids = new Map<BrokerConnection, string>()
  private readonly waiting = new Map<string, string[]>()
  private readonly expireMs: number
  private readonly later: (callback: () => void, ms: number) => unknown

  constructor(options: BrokerHubOptions = {}) {
    this.expireMs = options.expireMs ?? 5000
    this.later = options.setTimeout ?? ((callback, ms) => setTimeout(callback, ms))
  }

  get clientCount(): number {
    return this.clients.size
  }

  /** A connection arrived, saying who it is in the address it opened */
  connect(conn: BrokerConnection, url: string): void {
    const params = new URL(url, 'ws://broker').searchParams
    const id = params.get('id')
    const token = params.get('token')
    const key = params.get('key')
    if (!id || !token || !key) return this.refuse(conn, 'ERROR', 'No id, token, or key supplied to websocket server')
    if (key !== 'peerjs') return this.refuse(conn, 'ERROR', 'Invalid key provided')
    const known = this.clients.get(id)
    if (known && known.token !== token) return this.refuse(conn, 'ID-TAKEN', 'ID is taken')
    if (known) this.ids.delete(known.conn)
    this.clients.set(id, { conn, token })
    this.ids.set(conn, id)
    if (!known) conn.send(JSON.stringify({ type: 'OPEN' }))
    for (const queued of this.waiting.get(id) ?? []) conn.send(queued)
    this.waiting.delete(id)
  }

  receive(conn: BrokerConnection, raw: string): void {
    const src = this.ids.get(conn)
    if (!src) return
    let message: { type?: unknown; dst?: unknown; payload?: unknown }
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (message.type === 'HEARTBEAT' || typeof message.type !== 'string' || typeof message.dst !== 'string') return
    const dst = message.dst
    const frame = JSON.stringify({ type: message.type, src, dst, payload: message.payload })
    const target = this.clients.get(dst)
    if (target) return target.conn.send(frame)
    if (message.type === 'LEAVE' || message.type === 'EXPIRE') return
    // Kept for a peer that may be about to connect, then given up on
    const queue = this.waiting.get(dst) ?? []
    queue.push(frame)
    this.waiting.set(dst, queue)
    this.later(() => {
      const still = this.waiting.get(dst)
      if (!still || !still.includes(frame)) return
      this.waiting.set(dst, still.filter((f) => f !== frame))
      this.clients.get(src)?.conn.send(JSON.stringify({ type: 'EXPIRE', src: dst, dst: src }))
    }, this.expireMs)
  }

  disconnect(conn: BrokerConnection): void {
    const id = this.ids.get(conn)
    if (!id) return
    this.ids.delete(conn)
    if (this.clients.get(id)?.conn === conn) this.clients.delete(id)
  }

  private refuse(conn: BrokerConnection, type: string, msg: string): void {
    conn.send(JSON.stringify({ type, payload: { msg } }))
    conn.close()
  }
}
