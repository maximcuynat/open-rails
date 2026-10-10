import {
  HEARTBEAT_TIMEOUT_MS,
  MAX_DESKS,
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  type RemoteMessage,
  type RoomErrorCode,
} from './protocol'

/**
 * The rooms of the relay, with no socket in sight: connections are whatever can `send` a text
 * frame and `close`. The `ws` layer (`server.ts`) feeds it; the tests feed it by hand.
 *
 * Rules: a room is opened by its host under a code the host drew, seats up to MAX_DESKS desks, each known to the host by a number, and
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

/** A desk seated in a room, known to the host by its number */
interface Desk {
  conn: RelayConnection
  client: string
  name: string | undefined
}

interface Room {
  code: string
  host: RelayConnection
  hostClient: string
  /** The desks seated, by number (1 … MAX_DESKS) */
  desks: Map<number, Desk>
  /** The number each desk that sat here had, by its token: a desk that comes back finds its seat, and its train */
  numbers: Map<string, number>
}

interface Seat {
  lastSeen: number
  room: Room | null
  role: 'host' | 'desk' | null
  /** The number of a desk in its room */
  desk: number | null
}

export class RoomRelay {
  private readonly seats = new Map<RelayConnection, Seat>()
  private readonly rooms = new Map<string, Room>()
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly hosts: () => string[]

  constructor(options: RoomRelayOptions = {}) {
    // Monotonic: a jump of the wall clock must not sweep every connection away
    this.now = options.now ?? (() => performance.now())
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
    this.seats.set(conn, { lastSeen: this.now(), room: null, role: null, desk: null })
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
          : this.joinRoom(conn, seat, message.room, message.client, message.name)
      case 'fleet':
      case 'state':
      case 'bye':
        if (seat.role !== 'host' || !seat.room) return this.fail(conn, 'bad-message')
        // Already validated: the frame is forwarded as it came, to the desk it names or to all
        if (message.t !== 'bye' && message.to !== undefined) {
          const desk = seat.room.desks.get(message.to)
          if (desk) this.sendRaw(desk.conn, raw as string)
          return
        }
        for (const desk of seat.room.desks.values()) this.sendRaw(desk.conn, raw as string)
        return
      case 'command':
        if (seat.role !== 'desk' || !seat.room || seat.desk === null) return this.fail(conn, 'bad-message')
        // The host is told which desk speaks: by the relay, not by the desk
        return this.sendTo(seat.room.host, { ...message, from: seat.desk })
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
      for (const desk of room.desks.values()) {
        this.seats.delete(desk.conn)
        this.sendTo(desk.conn, { t: 'peer-left' })
        this.closeQuietly(desk.conn)
      }
      room.desks.clear()
    } else if (seat.desk !== null && room.desks.get(seat.desk)?.conn === conn) {
      room.desks.delete(seat.desk)
      this.sendTo(room.host, { t: 'peer-left', desk: seat.desk })
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
    const room: Room = existing ?? { code, host: conn, hostClient: client, desks: new Map(), numbers: new Map() }
    this.rooms.set(code, room)
    seat.room = room
    seat.role = 'host'
    this.sendTo(conn, { t: 'opened', room: code, hosts: this.hosts() })
    for (const [desk, seated] of room.desks) this.sendTo(conn, this.arrival(desk, seated.name, true))
  }

  private joinRoom(conn: RelayConnection, seat: Seat, code: string, client: string, name: string | undefined): void {
    const room = this.rooms.get(code)
    if (!room) return this.fail(conn, 'unknown-room')
    let desk: number | null = null
    for (const [number, seated] of room.desks) {
      if (seated.client !== client) continue
      // The same desk is back before its dead connection was noticed: it keeps its number
      desk = number
      this.seats.delete(seated.conn)
      this.closeQuietly(seated.conn)
      this.sendTo(room.host, { t: 'peer-left', desk })
    }
    if (desk === null) {
      // The number it had, when it is back after a cut and nobody took it
      const had = room.numbers.get(client)
      if (had !== undefined && !room.desks.has(had)) desk = had
    }
    const back = desk !== null
    if (desk === null) {
      // Else the lowest number free
      for (let number = 1; number <= MAX_DESKS && desk === null; number++) if (!room.desks.has(number)) desk = number
      if (desk === null) return this.fail(conn, 'room-full')
      // The number is this desk's now, whoever had it
      for (const [token, number] of room.numbers) if (number === desk) room.numbers.delete(token)
    }
    room.numbers.set(client, desk)
    room.desks.set(desk, { conn, client, name })
    seat.room = room
    seat.role = 'desk'
    seat.desk = desk
    this.sendTo(conn, { t: 'joined', room: code, desk })
    this.sendTo(room.host, this.arrival(desk, name, back))
  }

  /** `back`: the desk that had this number, come back; else a desk the host has not seen under it */
  private arrival(desk: number, name: string | undefined, back: boolean): RemoteMessage {
    return { t: 'peer-joined', desk, ...(name === undefined ? {} : { name }), ...(back ? { back: true } : {}) }
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
