import { describe, expect, it } from 'vitest'
import { CONSOLE_COMMAND_TYPES } from '../console/consoleContract'
import type { ConsoleCommand, ConsoleState, FleetEntry } from '../console/consoleContract'
import {
  MAX_FLEET_ENTRIES,
  MAX_MESSAGE_BYTES,
  NOTCH_LIMIT,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  decodeMessage,
  encodeMessage,
  generateClientId,
  generateRoomCode,
  isRoomCode,
  normalizeRoomCode,
  pairingUrl,
  relayUrl,
  roomFromPageUrl,
  type RemoteMessage,
} from './protocol'

const STATE: ConsoleState = {
  trainId: 't_1',
  speed: 12.5,
  maxSpeed: 88.9,
  stopped: false,
  notch: 3,
  minNotch: -5,
  maxNotch: 5,
  handleEffort: 0.6,
  reverser: 'forward',
  reverserLocked: true,
  emergencyBrake: false,
  emergencyReleasable: false,
  brake: { command: 'hold', tone: 'released', pipeBar: 5, cylinderBar: 0 },
  acceleration: 0.4,
  gradientPermille: -3,
  stoppingDistance: 310,
  locoCount: 2,
  wagonCount: 8,
  upcomingTurnout: null,
  canSwitchCab: false,
}

const ENTRY: FleetEntry = {
  id: 't_1',
  rank: 1,
  model: 'TGV Duplex',
  locoCount: 2,
  wagonCount: 8,
  speed: 0,
  driven: true,
}

const COMMANDS: ConsoleCommand[] = [
  { type: 'notchStep', step: 1 },
  { type: 'notchStep', step: -1 },
  { type: 'notchSet', notch: -5 },
  { type: 'brake', command: 'apply' },
  { type: 'brake', command: 'hold' },
  { type: 'reverser', reverser: 'reverse' },
  { type: 'emergencyBrake' },
  { type: 'steer', side: 'left' },
  { type: 'switchCab' },
  { type: 'selectTrain', trainId: 't_2' },
  { type: 'selectTrainByOffset', offset: -1 },
  { type: 'releaseControls' },
]

const decode = (value: unknown) => decodeMessage(JSON.stringify(value))
const command = (c: unknown) => ({ t: 'command', seq: 1, trainId: 't_1', command: c })

describe('protocol: round trip', () => {
  it('reads back every message it writes', () => {
    const messages: RemoteMessage[] = [
      { t: 'host', v: PROTOCOL_VERSION, room: 'ABC234', client: 'client-token' },
      { t: 'join', v: PROTOCOL_VERSION, room: 'ABC234', client: 'client-token' },
      { t: 'opened', room: 'ABC234', hosts: ['192.168.1.42'] },
      { t: 'joined', room: 'ABC234' },
      { t: 'peer-joined' },
      { t: 'peer-left' },
      { t: 'error', code: 'room-full' },
      { t: 'ping' },
      { t: 'pong' },
      { t: 'fleet', fleet: [ENTRY, { ...ENTRY, id: 't_2', rank: 2, driven: false }] },
      { t: 'state', state: STATE, ack: 12 },
      { t: 'state', state: null, ack: 0 },
      { t: 'state', state: { ...STATE, trainId: null, brake: null, legacyThrottle: -1 }, ack: 3 },
      { t: 'state', state: { ...STATE, stoppingDistance: null }, ack: 3 },
      { t: 'state', state: { ...STATE, upcomingTurnout: { distance: 240.5, side: 'left', locked: false } }, ack: 3 },
      { t: 'state', state: { ...STATE, upcomingTurnout: { distance: 0, side: null, locked: true }, canSwitchCab: true }, ack: 3 },
      { t: 'bye' },
      ...COMMANDS.map((c, i): RemoteMessage => ({ t: 'command', seq: i + 1, trainId: 't_1', command: c })),
      { t: 'command', seq: 99, trainId: null, command: { type: 'emergencyBrake' } },
    ]
    for (const message of messages) {
      expect(decodeMessage(encodeMessage(message))).toEqual({ ok: true, message })
    }
  })

  it('covers every command type of the contract', () => {
    expect(new Set(COMMANDS.map((c) => c.type))).toEqual(new Set(CONSOLE_COMMAND_TYPES))
  })

  it('drops the fields it does not know', () => {
    const result = decode({ ...command({ type: 'switchCab', extra: 1 }), evil: true })
    expect(result).toEqual({
      ok: true,
      message: { t: 'command', seq: 1, trainId: 't_1', command: { type: 'switchCab' } },
    })
  })
})

describe('protocol: rejection', () => {
  const malformed = { ok: false, error: 'malformed' }

  it('rejects what is not a JSON object with a known type', () => {
    expect(decodeMessage('{"t":"state"')).toEqual({ ok: false, error: 'not-json' })
    expect(decodeMessage('')).toEqual({ ok: false, error: 'not-json' })
    expect(decodeMessage(undefined)).toEqual(malformed)
    expect(decodeMessage(new Uint8Array(4))).toEqual(malformed)
    expect(decodeMessage('null')).toEqual(malformed)
    expect(decodeMessage('42')).toEqual(malformed)
    expect(decodeMessage('[]')).toEqual(malformed)
    expect(decode({})).toEqual(malformed)
    expect(decode({ t: 'launch' })).toEqual(malformed)
    expect(decode({ t: 7 })).toEqual(malformed)
  })

  it('rejects a message that is too large, before parsing it', () => {
    const big = JSON.stringify({ t: 'ping', pad: 'x'.repeat(MAX_MESSAGE_BYTES) })
    expect(decodeMessage(big)).toEqual({ ok: false, error: 'too-large' })
    // Under the limit in characters, over it in bytes
    const wide = JSON.stringify({ t: 'ping', pad: 'é'.repeat(MAX_MESSAGE_BYTES / 2) })
    expect(wide.length).toBeLessThan(MAX_MESSAGE_BYTES)
    expect(decodeMessage(wide)).toEqual({ ok: false, error: 'too-large' })
    const fits = JSON.stringify({ t: 'ping', pad: 'x'.repeat(MAX_MESSAGE_BYTES - 100) })
    expect(decodeMessage(fits)).toEqual({ ok: true, message: { t: 'ping' } })
  })

  it('rejects a notch out of bounds or not an integer', () => {
    expect(decode(command({ type: 'notchSet', notch: NOTCH_LIMIT })).ok).toBe(true)
    expect(decode(command({ type: 'notchSet', notch: -NOTCH_LIMIT })).ok).toBe(true)
    for (const notch of [NOTCH_LIMIT + 1, -NOTCH_LIMIT - 1, 1e9, 2.5, '3', null, undefined]) {
      expect(decode(command({ type: 'notchSet', notch }))).toEqual(malformed)
    }
    // NaN and Infinity do not survive JSON: they arrive as null
    expect(decodeMessage(encodeMessage(command({ type: 'notchSet', notch: NaN }) as RemoteMessage))).toEqual(malformed)
  })

  it('rejects a step that is not 1 or -1', () => {
    for (const step of [0, 2, -2, 0.5, '1', true]) {
      expect(decode(command({ type: 'notchStep', step }))).toEqual(malformed)
      expect(decode(command({ type: 'selectTrainByOffset', offset: step }))).toEqual(malformed)
    }
  })

  it('rejects an unknown command type and unknown enum values', () => {
    expect(decode(command({ type: 'deleteNetwork' }))).toEqual(malformed)
    expect(decode(command({ type: 'removeSegment', id: 's_1' }))).toEqual(malformed)
    expect(decode(command({}))).toEqual(malformed)
    expect(decode(command(null))).toEqual(malformed)
    expect(decode(command('emergencyBrake'))).toEqual(malformed)
    expect(decode(command({ type: 'brake', command: 'emergency' }))).toEqual(malformed)
    expect(decode(command({ type: 'reverser', reverser: 'sideways' }))).toEqual(malformed)
    expect(decode(command({ type: 'steer', side: 'up' }))).toEqual(malformed)
    // Inherited names are not command types
    expect(decode(command({ type: 'constructor' }))).toEqual(malformed)
    expect(decode({ t: 'toString' })).toEqual(malformed)
  })

  it('rejects a command with a bad envelope', () => {
    const ok = { type: 'switchCab' }
    expect(decode({ t: 'command', seq: 0, trainId: 't_1', command: ok })).toEqual(malformed)
    expect(decode({ t: 'command', seq: 1.5, trainId: 't_1', command: ok })).toEqual(malformed)
    expect(decode({ t: 'command', trainId: 't_1', command: ok })).toEqual(malformed)
    expect(decode({ t: 'command', seq: 1, command: ok })).toEqual(malformed)
    expect(decode({ t: 'command', seq: 1, trainId: 5, command: ok })).toEqual(malformed)
    expect(decode({ t: 'command', seq: 1, trainId: 'x'.repeat(65), command: ok })).toEqual(malformed)
    expect(decode(command({ type: 'selectTrain', trainId: '' }))).toEqual(malformed)
    expect(decode(command({ type: 'selectTrain', trainId: 'x'.repeat(65) }))).toEqual(malformed)
  })

  it('rejects a state as a whole when one field is wrong', () => {
    const state = (patch: object) => decode({ t: 'state', ack: 0, state: { ...STATE, ...patch } })
    expect(state({}).ok).toBe(true)
    expect(state({ speed: '12' })).toEqual(malformed)
    expect(state({ speed: null })).toEqual(malformed)
    expect(state({ notch: 1.5 })).toEqual(malformed)
    expect(state({ notch: 999 })).toEqual(malformed)
    expect(state({ minNotch: 1 })).toEqual(malformed)
    expect(state({ reverser: 'up' })).toEqual(malformed)
    expect(state({ stopped: 0 })).toEqual(malformed)
    expect(state({ brake: { ...STATE.brake, tone: 'purple' } })).toEqual(malformed)
    expect(state({ brake: { ...STATE.brake, pipeBar: null } })).toEqual(malformed)
    expect(state({ brake: undefined })).toEqual(malformed)
    expect(state({ legacyThrottle: 2 })).toEqual(malformed)
    expect(state({ trainId: 7 })).toEqual(malformed)
    expect(state({ locoCount: -1 })).toEqual(malformed)
    const turnout = { distance: 120, side: 'right', locked: false }
    expect(state({ upcomingTurnout: turnout }).ok).toBe(true)
    expect(state({ upcomingTurnout: undefined })).toEqual(malformed)
    expect(state({ upcomingTurnout: { ...turnout, side: 'middle' } })).toEqual(malformed)
    expect(state({ upcomingTurnout: { ...turnout, side: undefined } })).toEqual(malformed)
    expect(state({ upcomingTurnout: { ...turnout, distance: -1 } })).toEqual(malformed)
    expect(state({ upcomingTurnout: { ...turnout, distance: null } })).toEqual(malformed)
    expect(state({ upcomingTurnout: { ...turnout, locked: 1 } })).toEqual(malformed)
    expect(state({ canSwitchCab: undefined })).toEqual(malformed)
    expect(state({ canSwitchCab: 'yes' })).toEqual(malformed)
    expect(decode({ t: 'state', state: STATE })).toEqual(malformed)
    expect(decode({ t: 'state', ack: 0 })).toEqual(malformed)
    expect(decode({ t: 'state', ack: 0, state: [] })).toEqual(malformed)
  })

  it('rejects a fleet as a whole when one entry is wrong or there are too many', () => {
    expect(decode({ t: 'fleet', fleet: [] }).ok).toBe(true)
    expect(decode({ t: 'fleet', fleet: [ENTRY, { ...ENTRY, rank: 0 }] })).toEqual(malformed)
    expect(decode({ t: 'fleet', fleet: [{ ...ENTRY, model: 'x'.repeat(81) }] })).toEqual(malformed)
    expect(decode({ t: 'fleet', fleet: [{ ...ENTRY, driven: 'yes' }] })).toEqual(malformed)
    expect(decode({ t: 'fleet', fleet: 'all' })).toEqual(malformed)
    expect(decode({ t: 'fleet', fleet: new Array(MAX_FLEET_ENTRIES).fill(ENTRY) }).ok).toBe(true)
    expect(decode({ t: 'fleet', fleet: new Array(MAX_FLEET_ENTRIES + 1).fill(ENTRY) })).toEqual(malformed)
  })

  it('rejects malformed room messages', () => {
    const host = { t: 'host', v: PROTOCOL_VERSION, room: 'ABC234', client: 'client-token' }
    expect(decode(host).ok).toBe(true)
    expect(decode({ ...host, room: 'abc234' })).toEqual(malformed)
    expect(decode({ ...host, room: 'ABC10O' })).toEqual(malformed)
    expect(decode({ ...host, room: 'ABC2345' })).toEqual(malformed)
    expect(decode({ ...host, v: '1' })).toEqual(malformed)
    expect(decode({ ...host, v: undefined })).toEqual(malformed)
    expect(decode({ ...host, client: 'short' })).toEqual(malformed)
    expect(decode({ ...host, client: 'x'.repeat(33) })).toEqual(malformed)
    expect(decode({ t: 'error', code: 'out-of-coffee' })).toEqual(malformed)
    expect(decode({ t: 'opened', room: 'ABC234' })).toEqual(malformed)
    expect(decode({ t: 'opened', room: 'ABC234', hosts: [5] })).toEqual(malformed)
  })

  it('lets a request of another version through, so the relay can answer it', () => {
    // The relay is the one that says `version`: see the relay tests
    const result = decode({ t: 'join', v: PROTOCOL_VERSION + 1, room: 'ABC234', client: 'client-token' })
    expect(result.ok).toBe(true)
  })
})

describe('protocol: room code', () => {
  it('draws six unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode()
      expect(code).toHaveLength(ROOM_CODE_LENGTH)
      expect(isRoomCode(code)).toBe(true)
      expect(code).not.toMatch(/[IO01a-z]/)
    }
    expect(ROOM_CODE_ALPHABET).toHaveLength(32)
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(32)
  })

  it('maps random bytes evenly on the alphabet', () => {
    const bytes = [0, 31, 32, 63, 255, 128]
    const code = generateRoomCode((out) => out.set(bytes))
    expect(code).toBe('A9A99A')
  })

  it('does not draw the same code twice in a row', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRoomCode()))
    expect(codes.size).toBeGreaterThan(45)
    expect(generateClientId()).toMatch(/^[0-9a-f]{32}$/)
    expect(generateClientId()).not.toBe(generateClientId())
  })

  it('normalizes what a person types', () => {
    expect(normalizeRoomCode(' abc234 ')).toBe('ABC234')
    expect(normalizeRoomCode('ABC10O')).toBeNull()
    expect(normalizeRoomCode('ABC')).toBeNull()
  })
})

describe('protocol: addresses', () => {
  it('derives the relay address from the page', () => {
    expect(relayUrl('http://192.168.1.42:8900/open-rails/?pupitre=ABC234#x', '/open-rails/')).toBe(
      'ws://192.168.1.42:8900/open-rails/__remote',
    )
    expect(relayUrl('https://example.org/open-rails/index.html', './')).toBe(
      'wss://example.org/open-rails/__remote',
    )
    expect(relayUrl('http://localhost:8900/', '/')).toBe('ws://localhost:8900/__remote')
    expect(relayUrl('http://localhost:8900/', '/open-rails/', 'wss://relay.example.org/r')).toBe(
      'wss://relay.example.org/r',
    )
  })

  it('builds the address the phone opens', () => {
    expect(pairingUrl('http://localhost:8900/open-rails/?x=1#y', '/open-rails/', 'ABC234', '192.168.1.42')).toBe(
      'http://192.168.1.42:8900/open-rails/?pupitre=ABC234',
    )
    expect(pairingUrl('http://192.168.1.42:8900/open-rails/', '/open-rails/', 'ABC234')).toBe(
      'http://192.168.1.42:8900/open-rails/?pupitre=ABC234',
    )
  })

  it('reads the room code of a desk page', () => {
    expect(roomFromPageUrl('http://192.168.1.42:8900/open-rails/?pupitre=abc234')).toBe('ABC234')
    expect(roomFromPageUrl('http://192.168.1.42:8900/open-rails/')).toBeNull()
    expect(roomFromPageUrl('http://192.168.1.42:8900/open-rails/?pupitre=nope')).toBeNull()
  })
})
