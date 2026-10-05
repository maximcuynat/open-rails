import type {
  ConsoleBrake,
  ConsoleCommand,
  ConsoleState,
  ConsoleTurnout,
  FleetEntry,
} from '../console/consoleContract'

/**
 * Wire protocol of the phone desk. Three parties talk over WebSocket text frames holding one JSON
 * object each: the host (the PC, the only one that simulates), the desk (the phone) and the relay
 * that pairs them by room code.
 *
 * This module is pure (no DOM, no Node API beyond `crypto.getRandomValues` and `TextEncoder`) and
 * only imports types, so the browser, the relay and the tests all share it. Keep it free of
 * path-alias value imports: the relay loads it from `vite.config.ts`, where aliases do not exist.
 *
 * Everything that comes off the wire goes through `decodeMessage`, which rebuilds the message
 * field by field: an invalid message is rejected as a whole, never half applied.
 */

/** Bumped on any change a peer of another version could misread */
export const PROTOCOL_VERSION = 1

/** Largest frame anyone accepts, in UTF-8 bytes */
export const MAX_MESSAGE_BYTES = 32 * 1024

/** Path of the relay endpoint under the application base, e.g. `/open-rails/__remote` */
export const REMOTE_RELAY_PATH = '__remote'

/** Query parameter that turns the page into a desk: `?pupitre=ABC123` */
export const DESK_QUERY_PARAM = 'pupitre'

export const ROOM_CODE_LENGTH = 6
/** No I, O, 0 or 1: nothing that reads two ways on a screen. 32 symbols, so a byte maps evenly. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Wire bound of `notchSet`; whoever applies the command clamps it to the train's own range */
export const NOTCH_LIMIT = 32
export const MAX_FLEET_ENTRIES = 64
export const MAX_ID_LENGTH = 64
export const MAX_LABEL_LENGTH = 80
export const MIN_CLIENT_ID_LENGTH = 8
export const MAX_CLIENT_ID_LENGTH = 32
export const MAX_ADVERTISED_HOSTS = 8

/** The desk repeats a held brake command at this period… */
export const BRAKE_REPEAT_MS = 200
/** …and the host falls back to `hold` after this much silence */
export const BRAKE_HOLD_TIMEOUT_MS = 600
/** Period of the `state` messages */
export const STATE_PERIOD_MS = 100
/** Every client pings the relay at this period… */
export const HEARTBEAT_PERIOD_MS = 5000
/** …and a connection that stayed mute this long is closed, on both ends */
export const HEARTBEAT_TIMEOUT_MS = 15000

// ─── Messages ────────────────────────────────────────────────────────────────

export type RoomErrorCode =
  /** No host holds this room (wrong code, or the PC closed it) */
  | 'unknown-room'
  /** The room already has its one desk */
  | 'room-full'
  /** Another host already holds this code */
  | 'room-taken'
  /** Client and relay do not speak the same protocol version */
  | 'version'
  /** The relay could not read the message, or it made no sense in this state */
  | 'bad-message'

export const ROOM_ERROR_CODES = [
  'unknown-room',
  'room-full',
  'room-taken',
  'version',
  'bad-message',
] as const satisfies readonly RoomErrorCode[]

/**
 * Client → relay. `client` is a random token the client keeps for its lifetime: a reconnection
 * carrying the same token takes its own seat back instead of being refused by its own ghost.
 */
export type RoomRequest =
  /** Open a room as the host, under a code the host drew */
  | { t: 'host'; v: number; room: string; client: string }
  /** Join a room as its desk */
  | { t: 'join'; v: number; room: string; client: string }

/** Relay → client */
export type RoomEvent =
  /** To the host: the room exists. `hosts` lists the LAN addresses the relay can be reached at. */
  | { t: 'opened'; room: string; hosts: string[] }
  /** To the desk: it sits in the room, the host is there */
  | { t: 'joined'; room: string }
  /** The other side arrived (only ever sent to the host: a desk joins a room that has its host) */
  | { t: 'peer-joined' }
  /** The other side left. For a desk this means the room is gone. */
  | { t: 'peer-left' }
  /** The relay closes the connection right after an error */
  | { t: 'error'; code: RoomErrorCode }

export type Heartbeat = { t: 'ping' } | { t: 'pong' }

/** Host → desk, forwarded by the relay */
export type HostMessage =
  | { t: 'fleet'; fleet: FleetEntry[] }
  /** `state` is null while the PC drives nothing; `ack` is the last command sequence applied or dropped */
  | { t: 'state'; state: ConsoleState | null; ack: number }
  /** The PC cuts the link on purpose */
  | { t: 'bye' }

/** Desk → host, forwarded by the relay */
export type DeskMessage = {
  t: 'command'
  /** Strictly increasing for the life of a desk; the host drops anything not newer than the last */
  seq: number
  /** Train the desk believed it was driving (`ConsoleState.trainId`) when the command was issued */
  trainId: string | null
  command: ConsoleCommand
}

export type RemoteMessage = RoomRequest | RoomEvent | Heartbeat | HostMessage | DeskMessage
export type RemoteMessageType = RemoteMessage['t']

export type DecodeError = 'too-large' | 'not-json' | 'malformed'
export type DecodeResult =
  | { ok: true; message: RemoteMessage }
  | { ok: false; error: DecodeError }

// ─── Room code ───────────────────────────────────────────────────────────────

type RandomSource = (bytes: Uint8Array) => unknown

const cryptoRandom: RandomSource = (bytes) => globalThis.crypto.getRandomValues(bytes)

/** Draws a room code. `random` is only there for tests. */
export function generateRoomCode(random: RandomSource = cryptoRandom): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH)
  random(bytes)
  let code = ''
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]
  return code
}

export function isRoomCode(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== ROOM_CODE_LENGTH) return false
  for (const char of value) if (!ROOM_CODE_ALPHABET.includes(char)) return false
  return true
}

/** What a person typed, brought to the canonical form (or null when it cannot be a code) */
export function normalizeRoomCode(input: string): string | null {
  const code = input.trim().toUpperCase()
  return isRoomCode(code) ? code : null
}

/** Random token identifying one client for the relay (see `RoomRequest`) */
export function generateClientId(random: RandomSource = cryptoRandom): string {
  const bytes = new Uint8Array(16)
  random(bytes)
  let id = ''
  for (const byte of bytes) id += byte.toString(16).padStart(2, '0')
  return id
}

// ─── Encoding ────────────────────────────────────────────────────────────────

export function encodeMessage(message: RemoteMessage): string {
  return JSON.stringify(message)
}

function utf8Length(text: string): number {
  // A UTF-16 code unit never takes more than 3 UTF-8 bytes
  if (text.length * 3 <= MAX_MESSAGE_BYTES) return text.length
  return new TextEncoder().encode(text).length
}

/** Reads one frame. Never throws; never returns anything it did not check field by field. */
export function decodeMessage(raw: unknown): DecodeResult {
  if (typeof raw !== 'string') return { ok: false, error: 'malformed' }
  if (raw.length > MAX_MESSAGE_BYTES || utf8Length(raw) > MAX_MESSAGE_BYTES) {
    return { ok: false, error: 'too-large' }
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'not-json' }
  }
  const message = readMessage(json)
  return message ? { ok: true, message } : { ok: false, error: 'malformed' }
}

// ─── Validation ──────────────────────────────────────────────────────────────

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isCount(value: unknown): value is number {
  return isIntIn(value, 0, 10000)
}

function isText(value: unknown, maxLength: number, minLength = 0): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength
}

function isOneOf<T extends string | number>(value: unknown, choices: readonly T[]): value is T {
  return (choices as readonly unknown[]).includes(value)
}

const BRAKE_COMMANDS = ['apply', 'hold', 'release'] as const
const REVERSERS = ['forward', 'neutral', 'reverse'] as const
const BRAKE_TONES = ['released', 'releasing', 'applying', 'applied', 'emergency'] as const
const STEPS = [1, -1] as const

function readCommand(value: unknown): ConsoleCommand | null {
  if (!isObject(value)) return null
  switch (value.type) {
    case 'notchStep':
      return isOneOf(value.step, STEPS) ? { type: 'notchStep', step: value.step } : null
    case 'notchSet':
      return isIntIn(value.notch, -NOTCH_LIMIT, NOTCH_LIMIT)
        ? { type: 'notchSet', notch: value.notch }
        : null
    case 'brake':
      return isOneOf(value.command, BRAKE_COMMANDS)
        ? { type: 'brake', command: value.command }
        : null
    case 'reverser':
      return isOneOf(value.reverser, REVERSERS)
        ? { type: 'reverser', reverser: value.reverser }
        : null
    case 'emergencyBrake':
      return { type: 'emergencyBrake' }
    case 'steer':
      return value.side === 'left' || value.side === 'right'
        ? { type: 'steer', side: value.side }
        : null
    case 'switchCab':
      return { type: 'switchCab' }
    case 'selectTrain':
      return isText(value.trainId, MAX_ID_LENGTH, 1)
        ? { type: 'selectTrain', trainId: value.trainId }
        : null
    case 'selectTrainByOffset':
      return isOneOf(value.offset, STEPS)
        ? { type: 'selectTrainByOffset', offset: value.offset }
        : null
    case 'releaseControls':
      return { type: 'releaseControls' }
    default:
      return null
  }
}

function readBrake(value: unknown): ConsoleBrake | null {
  if (!isObject(value)) return null
  if (!isOneOf(value.command, BRAKE_COMMANDS) || !isOneOf(value.tone, BRAKE_TONES)) return null
  if (!isFiniteNumber(value.pipeBar) || !isFiniteNumber(value.cylinderBar)) return null
  return {
    command: value.command,
    tone: value.tone,
    pipeBar: value.pipeBar,
    cylinderBar: value.cylinderBar,
  }
}

const SIDES = ['left', 'right'] as const

function readTurnout(value: unknown): ConsoleTurnout | null {
  if (!isObject(value)) return null
  if (!isFiniteNumber(value.distance) || value.distance < 0) return null
  if (value.side !== null && !isOneOf(value.side, SIDES)) return null
  if (typeof value.locked !== 'boolean') return null
  return { distance: value.distance, side: value.side, locked: value.locked }
}

function readState(value: unknown): ConsoleState | null {
  if (!isObject(value)) return null
  const v = value
  if (v.trainId !== null && !isText(v.trainId, MAX_ID_LENGTH, 1)) return null
  // Continuous quantities are only required to be finite numbers: their range is the
  // simulation's business, and a rounding hair must not freeze the desk.
  if (!isFiniteNumber(v.speed) || !isFiniteNumber(v.maxSpeed)) return null
  if (!isIntIn(v.notch, -NOTCH_LIMIT, NOTCH_LIMIT)) return null
  if (!isIntIn(v.minNotch, -NOTCH_LIMIT, 0) || !isIntIn(v.maxNotch, 0, NOTCH_LIMIT)) return null
  if (!isFiniteNumber(v.handleEffort)) return null
  if (!isOneOf(v.reverser, REVERSERS)) return null
  if (typeof v.stopped !== 'boolean' || typeof v.reverserLocked !== 'boolean') return null
  if (typeof v.emergencyBrake !== 'boolean' || typeof v.emergencyReleasable !== 'boolean') {
    return null
  }
  let brake: ConsoleBrake | null = null
  if (v.brake !== null) {
    brake = readBrake(v.brake)
    if (!brake) return null
  }
  if (!isFiniteNumber(v.acceleration) || !isFiniteNumber(v.gradientPermille)) return null
  if (v.stoppingDistance !== null && !isFiniteNumber(v.stoppingDistance)) return null
  if (!isCount(v.locoCount) || !isCount(v.wagonCount)) return null
  let upcomingTurnout: ConsoleTurnout | null = null
  if (v.upcomingTurnout !== null) {
    upcomingTurnout = readTurnout(v.upcomingTurnout)
    if (!upcomingTurnout) return null
  }
  if (typeof v.canSwitchCab !== 'boolean') return null
  const state: ConsoleState = {
    trainId: v.trainId,
    speed: v.speed,
    maxSpeed: v.maxSpeed,
    stopped: v.stopped,
    notch: v.notch,
    minNotch: v.minNotch,
    maxNotch: v.maxNotch,
    handleEffort: v.handleEffort,
    reverser: v.reverser,
    reverserLocked: v.reverserLocked,
    emergencyBrake: v.emergencyBrake,
    emergencyReleasable: v.emergencyReleasable,
    brake,
    acceleration: v.acceleration,
    gradientPermille: v.gradientPermille,
    stoppingDistance: v.stoppingDistance,
    locoCount: v.locoCount,
    wagonCount: v.wagonCount,
    upcomingTurnout,
    canSwitchCab: v.canSwitchCab,
  }
  if (v.legacyThrottle !== undefined) {
    if (!isOneOf(v.legacyThrottle, [-1, 0, 1] as const)) return null
    state.legacyThrottle = v.legacyThrottle
  }
  return state
}

function readFleetEntry(value: unknown): FleetEntry | null {
  if (!isObject(value)) return null
  if (!isText(value.id, MAX_ID_LENGTH, 1) || !isText(value.model, MAX_LABEL_LENGTH)) return null
  if (!isIntIn(value.rank, 1, 10000)) return null
  if (!isCount(value.locoCount) || !isCount(value.wagonCount)) return null
  if (!isFiniteNumber(value.speed)) return null
  if (typeof value.driven !== 'boolean') return null
  return {
    id: value.id,
    rank: value.rank,
    model: value.model,
    locoCount: value.locoCount,
    wagonCount: value.wagonCount,
    speed: value.speed,
    driven: value.driven,
  }
}

function readFleet(value: unknown): FleetEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_FLEET_ENTRIES) return null
  const fleet: FleetEntry[] = []
  for (const item of value) {
    const entry = readFleetEntry(item)
    if (!entry) return null
    fleet.push(entry)
  }
  return fleet
}

function readHosts(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ADVERTISED_HOSTS) return null
  const hosts: string[] = []
  for (const item of value) {
    if (!isText(item, MAX_LABEL_LENGTH, 1)) return null
    hosts.push(item)
  }
  return hosts
}

function readMessage(value: unknown): RemoteMessage | null {
  if (!isObject(value)) return null
  switch (value.t) {
    case 'host':
    case 'join': {
      // The version is only required to be a sane integer here: telling a peer of another
      // version that it is one is the relay's job, and it needs to read the request to do so.
      if (!isIntIn(value.v, 0, 1_000_000) || !isRoomCode(value.room)) return null
      if (!isText(value.client, MAX_CLIENT_ID_LENGTH, MIN_CLIENT_ID_LENGTH)) return null
      return { t: value.t, v: value.v, room: value.room, client: value.client }
    }
    case 'opened': {
      const hosts = readHosts(value.hosts)
      return isRoomCode(value.room) && hosts ? { t: 'opened', room: value.room, hosts } : null
    }
    case 'joined':
      return isRoomCode(value.room) ? { t: 'joined', room: value.room } : null
    case 'peer-joined':
      return { t: 'peer-joined' }
    case 'peer-left':
      return { t: 'peer-left' }
    case 'error':
      return isOneOf(value.code, ROOM_ERROR_CODES) ? { t: 'error', code: value.code } : null
    case 'ping':
      return { t: 'ping' }
    case 'pong':
      return { t: 'pong' }
    case 'fleet': {
      const fleet = readFleet(value.fleet)
      return fleet ? { t: 'fleet', fleet } : null
    }
    case 'state': {
      if (!isIntIn(value.ack, 0, Number.MAX_SAFE_INTEGER)) return null
      if (value.state === null) return { t: 'state', state: null, ack: value.ack }
      const state = readState(value.state)
      return state ? { t: 'state', state, ack: value.ack } : null
    }
    case 'bye':
      return { t: 'bye' }
    case 'command': {
      if (!isIntIn(value.seq, 1, Number.MAX_SAFE_INTEGER)) return null
      if (value.trainId !== null && !isText(value.trainId, MAX_ID_LENGTH, 1)) return null
      const command = readCommand(value.command)
      return command ? { t: 'command', seq: value.seq, trainId: value.trainId, command } : null
    }
    default:
      return null
  }
}

// ─── Addresses ───────────────────────────────────────────────────────────────

/**
 * WebSocket address of the relay. By default it is the server that served the page
 * (`ws://host/base/__remote`); `override` is an absolute `ws://` / `wss://` address of an
 * external relay.
 */
export function relayUrl(pageUrl: string, baseUrl: string, override?: string): string {
  if (override) return override
  const url = new URL(baseUrl.replace(/\/?$/, '/') + REMOTE_RELAY_PATH, pageUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = ''
  url.hash = ''
  return url.toString()
}

/**
 * Address the phone opens, e.g. `http://192.168.1.42:8900/open-rails/?pupitre=ABC123`.
 * `host` replaces the host name of the page (which is often `localhost` on the PC) by an address
 * the phone can reach — see `hosts` in the `opened` message.
 */
export function pairingUrl(pageUrl: string, baseUrl: string, room: string, host?: string): string {
  const url = new URL(baseUrl.replace(/\/?$/, '/'), pageUrl)
  if (host) url.hostname = host
  url.search = `?${DESK_QUERY_PARAM}=${room}`
  url.hash = ''
  return url.toString()
}

/** Room code carried by the page address, when the page was opened as a desk */
export function roomFromPageUrl(pageUrl: string): string | null {
  const value = new URL(pageUrl).searchParams.get(DESK_QUERY_PARAM)
  return value === null ? null : normalizeRoomCode(value)
}
