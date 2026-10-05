import {
  HEARTBEAT_TIMEOUT_MS,
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  type RemoteMessage,
  type RoomErrorCode,
} from '../../src/application/remote/protocol'

/**
 * The rooms of the relay, with no socket in sight: connections are whatever can `send` a text
 * frame and `close`. The `ws` layer (`server.ts`) feeds it; the tests feed it by hand.
 *
 * Rules: a room is opened by its host under a code the host drew, holds one desk at most, and
 * dies with its host. Nothing is kept once a connection is gone — no account, no history.
 */

export interface RelayConnection {
  send(data: string): void
  close(): void
}

export interface RoomRelayOptions {
  /** Clock, ms. Injectable for tests. */
  now?: () => number
  /** A connection that sent nothing for this long is closed by `sweep()` */
  timeoutMs?: number
  /** Addresses the relay can be reached at, told to a host when its room opens */
  hosts?: () => string[]
}

interface Room {
  code: string
  host: RelayConnection
  hostClient: string
  desk: RelayConnection | null
  deskClient: string | null
}

interface Seat {
  lastSeen: number
  room: Room | null
  role: 'host' | 'desk' | null
}

export class RoomRelay {
  private readonly seats = new Map<RelayConnection, Seat>()
  private readonly rooms = new Map<string, Room>()
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly hosts: () => string[]

  constructor(options: RoomRelayOptions = {}) {
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? HEARTBEAT_TIMEOUT_MS
    this.hosts = options.hosts ?? (() => [])
  }

  get roomCount(): number {
    return this.rooms.size
  }

  get connectionCount(): number {
    return this.seats.size
  }

  /** A connection arrived. It has `timeoutMs` to say something. */
  connect(conn: RelayConnection): void {
    this.seats.set(conn, { lastSeen: this.now(), room: null, role: null })
  }

  /** One text frame from a connection. Pass `null` for anything that is not text. */
  receive(conn: RelayConnection, raw: string | null): void {
    const seat = this.seats.get(conn)
    if (!seat) return
    seat.lastSeen = this.now()
    const decoded = decodeMessage(raw)
    if (!decoded.ok) return this.fail(conn, 'bad-message')
    const message = decoded.message
    switch (message.t) {
      case 'ping':
        return this.sendTo(conn, { t: 'pong' })
      case 'pong':
        return
      case 'host':
      case 'join':
        if (seat.role) return this.fail(conn, 'bad-message')
        if (message.v !== PROTOCOL_VERSION) return this.fail(conn, 'version')
        return message.t === 'host'
          ? this.openRoom(conn, seat, message.room, message.client)
          : this.joinRoom(conn, seat, message.room, message.client)
      case 'fleet':
      case 'state':
      case 'bye':
        if (seat.role !== 'host' || !seat.room) return this.fail(conn, 'bad-message')
        // Already validated: the frame is forwarded as it came
        if (seat.room.desk) this.sendRaw(seat.room.desk, raw as string)
        return
      case 'command':
        if (seat.role !== 'desk' || !seat.room) return this.fail(conn, 'bad-message')
        return this.sendRaw(seat.room.host, raw as string)
      default:
        // Messages only the relay itself may emit
        return this.fail(conn, 'bad-message')
    }
  }

  /** The connection is gone (closed by either side). Safe to call twice. */
  disconnect(conn: RelayConnection): void {
    const seat = this.seats.get(conn)
    if (!seat) return
    this.seats.delete(conn)
    const room = seat.room
    if (!room) return
    if (seat.role === 'host') {
      this.rooms.delete(room.code)
      const desk = room.desk
      if (desk) {
        this.seats.delete(desk)
        this.sendTo(desk, { t: 'peer-left' })
        this.closeQuietly(desk)
      }
    } else if (room.desk === conn) {
      room.desk = null
      room.deskClient = null
      this.sendTo(room.host, { t: 'peer-left' })
    }
  }

  /** Closes every connection that stayed mute for too long. Call it on a timer. */
  sweep(): void {
    const limit = this.now() - this.timeoutMs
    for (const [conn, seat] of [...this.seats]) {
      if (seat.lastSeen > limit) continue
      this.disconnect(conn)
      this.closeQuietly(conn)
    }
  }

  /** Closes everything (the server stops) */
  closeAll(): void {
    for (const conn of [...this.seats.keys()]) {
      this.seats.delete(conn)
      this.closeQuietly(conn)
    }
    this.rooms.clear()
  }

  private openRoom(conn: RelayConnection, seat: Seat, code: string, client: string): void {
    const existing = this.rooms.get(code)
    if (existing) {
      if (existing.hostClient !== client) return this.fail(conn, 'room-taken')
      // The same host is back before its dead connection was noticed: it keeps its room
      const ghost = existing.host
      this.seats.delete(ghost)
      this.closeQuietly(ghost)
      existing.host = conn
    }
    const room: Room =
      existing ?? { code, host: conn, hostClient: client, desk: null, deskClient: null }
    this.rooms.set(code, room)
    seat.room = room
    seat.role = 'host'
    this.sendTo(conn, { t: 'opened', room: code, hosts: this.hosts() })
    if (room.desk) this.sendTo(conn, { t: 'peer-joined' })
  }

  private joinRoom(conn: RelayConnection, seat: Seat, code: string, client: string): void {
    const room = this.rooms.get(code)
    if (!room) return this.fail(conn, 'unknown-room')
    if (room.desk) {
      if (room.deskClient !== client) return this.fail(conn, 'room-full')
      // The same desk is back before its dead connection was noticed
      const ghost = room.desk
      this.seats.delete(ghost)
      this.closeQuietly(ghost)
      this.sendTo(room.host, { t: 'peer-left' })
    }
    room.desk = conn
    room.deskClient = client
    seat.room = room
    seat.role = 'desk'
    this.sendTo(conn, { t: 'joined', room: code })
    this.sendTo(room.host, { t: 'peer-joined' })
  }

  private fail(conn: RelayConnection, code: RoomErrorCode): void {
    this.sendTo(conn, { t: 'error', code })
    this.disconnect(conn)
    this.closeQuietly(conn)
  }

  private sendTo(conn: RelayConnection, message: RemoteMessage): void {
    this.sendRaw(conn, encodeMessage(message))
  }

  private sendRaw(conn: RelayConnection, data: string): void {
    try {
      conn.send(data)
    } catch {
      // A socket that died between two frames: its close event cleans up
    }
  }

  private closeQuietly(conn: RelayConnection): void {
    try {
      conn.close()
    } catch {
      // Already closed
    }
  }
}
