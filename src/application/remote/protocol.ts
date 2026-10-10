import type {
  ConsoleBrake,
  ConsoleCommand,
  ConsoleCabSignal,
  ConsoleGuidance,
  ConsoleSignal,
  ConsoleSignals,
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
export const PROTOCOL_VERSION = 2

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
/** Desks a room seats at most; a desk is known by its number, 1 … MAX_DESKS */
export const MAX_DESKS = 8
/** The name a driver gives is at most this long */
export const MAX_DRIVER_NAME_LENGTH = 20
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
  /** The room already seats its MAX_DESKS desks */
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
  /** Join a room as a desk; `name` is what the driver wants to be called */
  | { t: 'join'; v: number; room: string; client: string; name?: string }

/** Relay → client */
export type RoomEvent =
  /** To the host: the room exists. `hosts` lists the LAN addresses the relay can be reached at. */
  | { t: 'opened'; room: string; hosts: string[] }
  /** To the desk: it sits in the room under this number, the host is there */
  | { t: 'joined'; room: string; desk: number }
  /** A desk arrived (only ever sent to the host: a desk joins a room that has its host); `back`: the one that had this number */
  | { t: 'peer-joined'; desk: number; name?: string; back?: boolean }
  /** To the host: that desk left. To a desk, without a number: the host left, the room is gone. */
  | { t: 'peer-left'; desk?: number }
  /** The relay closes the connection right after an error */
  | { t: 'error'; code: RoomErrorCode }

export type Heartbeat = { t: 'ping' } | { t: 'pong' }

/** Host → desks, forwarded by the relay: to the desk `to` names, to every desk without it */
export type HostMessage =
  | { t: 'fleet'; fleet: FleetEntry[]; to?: number }
  /** `state` is null while that desk holds no train; `ack` is its last command sequence applied or dropped */
  | { t: 'state'; state: ConsoleState | null; ack: number; to?: number }
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
  /** The desk it comes from: written by the relay, whatever the desk put there */
  from?: number
}

export type RemoteMessage = RoomRequest | RoomEvent | Heartbeat | HostMessage | DeskMessage
export type RemoteMessageType = RemoteMessage['t']

export type DecodeError = 'too-large' | 'not-json' | 'malformed'
export type DecodeResult =
  | { ok: true; message: RemoteMessage }
  | { ok: false; error: DecodeError }

// ─── Room code ───────────────────────────────────────────────────────────────

type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => unknown

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
    case 'rerail':
      return { type: 'rerail' }
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

const CURVE_STATES = ['ok', 'discomfort', 'danger'] as const

/** Speed limits and curve: read as a whole, `null` when anything in it is off */
function readGuidance(value: unknown): ConsoleGuidance | null {
  if (!isObject(value)) return null
  if (!isFiniteNumber(value.speedLimit) || !isOneOf(value.curve, CURVE_STATES)) return null
  let nextLimit: ConsoleGuidance['nextLimit'] = null
  if (value.nextLimit !== null) {
    const next = value.nextLimit
    if (!isObject(next) || !isFiniteNumber(next.speed) || !isFiniteNumber(next.distance) || next.distance < 0) return null
    nextLimit = { speed: next.speed, distance: next.distance }
  }
  let derailed: ConsoleGuidance['derailed'] = null
  if (value.derailed !== null) {
    const d = value.derailed
    if (!isObject(d) || !isFiniteNumber(d.speed) || !isFiniteNumber(d.limit)) return null
    derailed = { speed: d.speed, limit: d.limit }
  }
  return { speedLimit: value.speedLimit, nextLimit, curve: value.curve, derailed }
}

const SIGNALLING_LEVELS = ['standard', 'pro'] as const
const SIGNAL_COLORS = ['green', 'yellow', 'red'] as const
const SIGNAL_INDICATIONS = ['voie-libre', 'avertissement', 'semaphore', 'carre', 'ralentissement', 'rappel'] as const
const SLOWDOWN_SPEEDS = [30, 60] as const
const SIGNAL_PLATES = ['F', 'Nf'] as const
const CAB_KINDS = ['line', 'execute', 'announce', 'stop', 'sight'] as const
/** Speeds on the wire are km/h within this */
const MAX_SPEED_KMH = 1000

function isDistance(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function readSignal(value: unknown): ConsoleSignal | null {
  if (!isObject(value)) return null
  if (!isDistance(value.distance) || !isOneOf(value.color, SIGNAL_COLORS)) return null
  if (value.indication !== null && !isOneOf(value.indication, SIGNAL_INDICATIONS)) return null
  if (value.plate !== null && !isOneOf(value.plate, SIGNAL_PLATES)) return null
  if (typeof value.lit !== 'boolean' || !isText(value.label, MAX_LABEL_LENGTH)) return null
  // Only there when lit; absent from a PC of an older version
  if (value.slowdown !== undefined && !isOneOf(value.slowdown, SLOWDOWN_SPEEDS)) return null
  if (value.reminder !== undefined && !isOneOf(value.reminder, SLOWDOWN_SPEEDS)) return null
  const signal: ConsoleSignal = {
    distance: value.distance,
    color: value.color,
    indication: value.indication,
    plate: value.plate,
    lit: value.lit,
    label: value.label,
  }
  if (value.slowdown !== undefined) signal.slowdown = value.slowdown
  if (value.reminder !== undefined) signal.reminder = value.reminder
  return signal
}

function readCabSignal(value: unknown): ConsoleCabSignal | null {
  if (!isObject(value)) return null
  if (!isOneOf(value.kind, CAB_KINDS) || !isIntIn(value.speed, 0, MAX_SPEED_KMH)) return null
  if (typeof value.flashing !== 'boolean') return null
  if (value.markerDistance !== null && !isDistance(value.markerDistance)) return null
  return { kind: value.kind, speed: value.speed, flashing: value.flashing, markerDistance: value.markerDistance }
}

/** What the signals say: read as a whole, `null` when anything in it is off */
function readSignals(value: unknown): ConsoleSignals | null {
  if (!isObject(value)) return null
  if (!isOneOf(value.level, SIGNALLING_LEVELS)) return null
  let next: ConsoleSignal | null = null
  if (value.next !== null) {
    next = readSignal(value.next)
    if (!next) return null
  }
  if (value.closedDistance !== null && !isDistance(value.closedDistance)) return null
  if (typeof value.brakeAlert !== 'boolean' || typeof value.waiting !== 'boolean' || typeof value.onSight !== 'boolean') return null
  if (!isIntIn(value.onSightSpeed, 0, MAX_SPEED_KMH)) return null
  let passed: ConsoleSignals['passed'] = null
  if (value.passed !== null) {
    if (!isObject(value.passed) || typeof value.passed.braked !== 'boolean') return null
    passed = { braked: value.passed.braked }
  }
  let cab: ConsoleCabSignal | null = null
  if (value.cab !== null) {
    cab = readCabSignal(value.cab)
    if (!cab) return null
  }
  const signals: ConsoleSignals = {
    level: value.level,
    next,
    closedDistance: value.closedDistance,
    brakeAlert: value.brakeAlert,
    waiting: value.waiting,
    onSight: value.onSight,
    onSightSpeed: value.onSightSpeed,
    passed,
    cab,
  }
  // Only there while it lasts; absent from a PC of an older version
  if (value.overspeed !== undefined) {
    if (!isObject(value.overspeed) || typeof value.overspeed.braked !== 'boolean') return null
    signals.overspeed = { braked: value.overspeed.braked }
  }
  return signals
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
  // Optional: a PC of an older version does not send it, and the desk then shows no limit
  if (v.guidance !== undefined) {
    const guidance = readGuidance(v.guidance)
    if (!guidance) return null
    state.guidance = guidance
  }
  // Optional too: absent on a network without signal, and from a PC that knows no signalling
  if (v.signals !== undefined) {
    const signals = readSignals(v.signals)
    if (!signals) return null
    state.signals = signals
  }
  // Optional too: absent from an older PC; null when the route ahead is clear
  if (v.ahead !== undefined) {
    if (v.ahead === null) state.ahead = null
    else {
      const ahead = v.ahead
      if (!isObject(ahead) || !isFiniteNumber(ahead.distance) || !isFiniteNumber(ahead.speed)) return null
      if (ahead.driver !== null && !isText(ahead.driver, MAX_LABEL_LENGTH)) return null
      state.ahead = { distance: ahead.distance, speed: ahead.speed, driver: ahead.driver }
    }
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
  const entry: FleetEntry = {
    id: value.id,
    rank: value.rank,
    model: value.model,
    locoCount: value.locoCount,
    wagonCount: value.wagonCount,
    speed: value.speed,
    driven: value.driven,
  }
  if (value.driver !== undefined) {
    if (value.driver !== null && value.driver !== 'host' && !isIntIn(value.driver, 1, MAX_DESKS)) return null
    entry.driver = value.driver
  }
  if (value.driverName !== undefined) {
    if (!isText(value.driverName, MAX_LABEL_LENGTH)) return null
    entry.driverName = value.driverName
  }
  return entry
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

const isDesk = (value: unknown): value is number => isIntIn(value, 1, MAX_DESKS)

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
      const request: RoomRequest = { t: value.t, v: value.v, room: value.room, client: value.client }
      if (request.t === 'join' && value.name !== undefined) {
        if (!isText(value.name, MAX_DRIVER_NAME_LENGTH)) return null
        // No name is no name: an empty one is not carried
        if (value.name !== '') request.name = value.name
      }
      return request
    }
    case 'opened': {
      const hosts = readHosts(value.hosts)
      return isRoomCode(value.room) && hosts ? { t: 'opened', room: value.room, hosts } : null
    }
    case 'joined':
      return isRoomCode(value.room) && isDesk(value.desk) ? { t: 'joined', room: value.room, desk: value.desk } : null
    case 'peer-joined': {
      if (!isDesk(value.desk)) return null
      if (value.name !== undefined && !isText(value.name, MAX_DRIVER_NAME_LENGTH)) return null
      if (value.back !== undefined && typeof value.back !== 'boolean') return null
      const arrival: Extract<RoomEvent, { t: 'peer-joined' }> = { t: 'peer-joined', desk: value.desk }
      if (value.name !== undefined) arrival.name = value.name
      // Only said when true: the desk that had this number is back
      if (value.back === true) arrival.back = true
      return arrival
    }
    case 'peer-left':
      if (value.desk === undefined) return { t: 'peer-left' }
      return isDesk(value.desk) ? { t: 'peer-left', desk: value.desk } : null
    case 'error':
      return isOneOf(value.code, ROOM_ERROR_CODES) ? { t: 'error', code: value.code } : null
    case 'ping':
      return { t: 'ping' }
    case 'pong':
      return { t: 'pong' }
    case 'fleet': {
      const fleet = readFleet(value.fleet)
      if (!fleet || (value.to !== undefined && !isDesk(value.to))) return null
      return value.to === undefined ? { t: 'fleet', fleet } : { t: 'fleet', fleet, to: value.to }
    }
    case 'state': {
      if (!isIntIn(value.ack, 0, Number.MAX_SAFE_INTEGER)) return null
      if (value.to !== undefined && !isDesk(value.to)) return null
      const state = value.state === null ? null : readState(value.state)
      if (value.state !== null && !state) return null
      return value.to === undefined ? { t: 'state', state, ack: value.ack } : { t: 'state', state, ack: value.ack, to: value.to }
    }
    case 'bye':
      return { t: 'bye' }
    case 'command': {
      if (!isIntIn(value.seq, 1, Number.MAX_SAFE_INTEGER)) return null
      if (value.trainId !== null && !isText(value.trainId, MAX_ID_LENGTH, 1)) return null
      const command = readCommand(value.command)
      if (!command || (value.from !== undefined && !isDesk(value.from))) return null
      const message: DeskMessage = { t: 'command', seq: value.seq, trainId: value.trainId, command }
      if (value.from !== undefined) message.from = value.from
      return message
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
  // The way the PC is reached is the phone's too: what forces it on the PC's page is carried over
  const page = new URL(pageUrl).searchParams
  const carried = [LINK_QUERY_PARAM, BROKER_QUERY_PARAM].flatMap((name) => {
    const value = page.get(name)
    return value === null ? [] : [`&${name}=${encodeURIComponent(value)}`]
  })
  url.search = `?${DESK_QUERY_PARAM}=${room}${carried.join('')}`
  url.hash = ''
  return url.toString()
}

// ─── The two ways to the PC ──────────────────────────────────────────────────

/** `relay`: through the WebSocket relay of the server that serves the page; `direct`: WebRTC, introduced by a broker */
export type RemoteTransport = 'relay' | 'direct'

/** Path of the broker the dev server serves, under the application base, with the `/peerjs` the protocol adds */
export const LOCAL_BROKER_PATH = '__broker/peerjs'
/** `?liaison=webrtc` forces the direct link where the relay would be used (to try it under `npm run dev`) */
export const LINK_QUERY_PARAM = 'liaison'
/** `?courtier=local` uses the broker of the dev server; `?courtier=wss://…` another one */
export const BROKER_QUERY_PARAM = 'courtier'

export interface RemoteRoute {
  transport: RemoteTransport
  /** Address of the broker for the direct link; null: the public one */
  broker: string | null
}

/**
 * Which way a page reaches the other side. A page served over HTTPS (the published site) has no
 * relay to talk to — and a browser forbids it `ws://` on the local network anyway: it goes
 * direct. A page served by the PC uses the relay of that server, unless told otherwise.
 */
export function remoteRoute(pageUrl: string, baseUrl: string): RemoteRoute {
  const page = new URL(pageUrl)
  const direct = page.protocol === 'https:' || page.searchParams.get(LINK_QUERY_PARAM) === 'webrtc'
  if (!direct) return { transport: 'relay', broker: null }
  const asked = page.searchParams.get(BROKER_QUERY_PARAM)
  if (asked === 'local') {
    const url = new URL(baseUrl.replace(/\/?$/, '/') + LOCAL_BROKER_PATH, pageUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.search = ''
    url.hash = ''
    return { transport: 'direct', broker: url.toString() }
  }
  return { transport: 'direct', broker: asked !== null && /^wss?:\/\//.test(asked) ? asked : null }
}

/** Room code carried by the page address, when the page was opened as a desk */
export function roomFromPageUrl(pageUrl: string): string | null {
  const value = new URL(pageUrl).searchParams.get(DESK_QUERY_PARAM)
  return value === null ? null : normalizeRoomCode(value)
}
