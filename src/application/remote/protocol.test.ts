import { describe, expect, it } from 'vitest'
import { CONSOLE_COMMAND_TYPES } from '../console/consoleContract'
import type { ConsoleCommand, ConsoleSignals, ConsoleState, FleetEntry } from '../console/consoleContract'
import {
  MAX_DESKS,
  MAX_DRIVER_NAME_LENGTH,
  MAX_FLEET_ENTRIES,
  MAX_LABEL_LENGTH,
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
  remoteRoute,
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

const SIGNALS: ConsoleSignals = {
  level: 'standard',
  next: { distance: 850.5, color: 'yellow', indication: null, plate: null, lit: true, label: 'Attention' },
  closedDistance: null,
  brakeAlert: false,
  waiting: false,
  onSight: false,
  onSightSpeed: 30,
  passed: null,
  cab: null,
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
  { type: 'rerail' },
]

const decode = (value: unknown) => decodeMessage(JSON.stringify(value))
const command = (c: unknown) => ({ t: 'command', seq: 1, trainId: 't_1', command: c })

describe('protocol: round trip', () => {
  it('reads back every message it writes', () => {
    const messages: RemoteMessage[] = [
      { t: 'host', v: PROTOCOL_VERSION, room: 'ABC234', client: 'client-token' },
      { t: 'join', v: PROTOCOL_VERSION, room: 'ABC234', client: 'client-token' },
      { t: 'join', v: PROTOCOL_VERSION, room: 'ABC234', client: 'client-token', name: 'Léa' },
      { t: 'join', v: PROTOCOL_VERSION, room: 'ABC234', client: 'client-token', name: 'x'.repeat(MAX_DRIVER_NAME_LENGTH) },
      { t: 'opened', room: 'ABC234', hosts: ['192.168.1.42'] },
      { t: 'joined', room: 'ABC234', desk: 1 },
      { t: 'joined', room: 'ABC234', desk: MAX_DESKS },
      { t: 'peer-joined', desk: 1 },
      { t: 'peer-joined', desk: MAX_DESKS, name: 'Léa' },
      { t: 'peer-left' },
      { t: 'peer-left', desk: 1 },
      { t: 'peer-left', desk: MAX_DESKS },
      { t: 'error', code: 'room-full' },
      { t: 'ping' },
      { t: 'pong' },
      { t: 'fleet', fleet: [ENTRY, { ...ENTRY, id: 't_2', rank: 2, driven: false }] },
      { t: 'fleet', fleet: [ENTRY], to: 1 },
      {
        t: 'fleet',
        fleet: [
          { ...ENTRY, driver: 'host', driverName: 'PC' },
          { ...ENTRY, id: 't_2', rank: 2, driver: 1, driverName: 'Léa' },
          { ...ENTRY, id: 't_3', rank: 3, driver: MAX_DESKS, driverName: `Pupitre ${MAX_DESKS}` },
          { ...ENTRY, id: 't_4', rank: 4, driven: false, driver: null },
        ],
        to: MAX_DESKS,
      },
      { t: 'state', state: STATE, ack: 12 },
      { t: 'state', state: STATE, ack: 12, to: 1 },
      { t: 'state', state: null, ack: 0, to: MAX_DESKS },
      { t: 'state', state: null, ack: 0 },
      { t: 'state', state: { ...STATE, trainId: null, brake: null, legacyThrottle: -1 }, ack: 3 },
      { t: 'state', state: { ...STATE, stoppingDistance: null }, ack: 3 },
      { t: 'state', state: { ...STATE, upcomingTurnout: { distance: 240.5, side: 'left', locked: false } }, ack: 3 },
      { t: 'state', state: { ...STATE, upcomingTurnout: { distance: 0, side: null, locked: true }, canSwitchCab: true }, ack: 3 },
      { t: 'state', state: { ...STATE, guidance: { speedLimit: 160, nextLimit: null, curve: 'ok', derailed: null } }, ack: 3 },
      {
        t: 'state',
        state: { ...STATE, guidance: { speedLimit: 160, nextLimit: { speed: 90, distance: 1250.5 }, curve: 'danger', derailed: { speed: 235, limit: 160 } } },
        ack: 3,
      },
      { t: 'state', state: { ...STATE, signals: SIGNALS }, ack: 3 },
      {
        t: 'state',
        state: {
          ...STATE,
          signals: {
            ...SIGNALS,
            level: 'pro',
            next: { distance: 0, color: 'red', indication: 'carre', plate: 'Nf', lit: false, label: 'Carré' },
            closedDistance: 2440.5,
            brakeAlert: true,
            waiting: true,
            onSight: true,
            passed: { braked: true },
            cab: { kind: 'announce', speed: 270, flashing: false, markerDistance: 1200 },
          },
        },
        ack: 3,
      },
      { t: 'state', state: { ...STATE, signals: { ...SIGNALS, next: null, cab: { kind: 'stop', speed: 0, flashing: false, markerDistance: null } } }, ack: 3 },
      { t: 'bye' },
      ...COMMANDS.map((c, i): RemoteMessage => ({ t: 'command', seq: i + 1, trainId: 't_1', command: c })),
      { t: 'command', seq: 99, trainId: null, command: { type: 'emergencyBrake' } },
      { t: 'command', seq: 4, trainId: 't_1', command: { type: 'switchCab' }, from: 1 },
      { t: 'command', seq: 5, trainId: null, command: { type: 'selectTrain', trainId: 't_2' }, from: MAX_DESKS },
    ]
    for (const message of messages) {
      expect(decodeMessage(encodeMessage(message))).toEqual({ ok: true, message })
    }
  })

  it('covers every command type of the contract', () => {
    expect(new Set(COMMANDS.map((c) => c.type))).toEqual(new Set(CONSOLE_COMMAND_TYPES))
  })

  it('writes no optional field that was not there', () => {
    const keys = (value: unknown) => {
      const result = decode(value)
      return result.ok ? Object.keys(result.message).sort() : null
    }
    expect(MAX_DESKS).toBe(8)
    expect(MAX_DRIVER_NAME_LENGTH).toBe(20)
    expect(PROTOCOL_VERSION).toBe(2)
    expect(keys({ t: 'join', v: PROTOCOL_VERSION, room: 'ABC234', client: 'client-token' })).toEqual(['client', 'room', 't', 'v'])
    expect(keys({ t: 'peer-joined', desk: 1 })).toEqual(['desk', 't'])
    expect(keys({ t: 'peer-left' })).toEqual(['t'])
    expect(keys({ t: 'fleet', fleet: [] })).toEqual(['fleet', 't'])
    expect(keys({ t: 'state', state: null, ack: 0 })).toEqual(['ack', 'state', 't'])
    expect(keys(command({ type: 'switchCab' }))).toEqual(['command', 'seq', 't', 'trainId'])
    const fleet = decode({ t: 'fleet', fleet: [ENTRY] })
    expect(fleet.ok && fleet.message.t === 'fleet' && Object.keys(fleet.message.fleet[0]).sort()).toEqual(Object.keys(ENTRY).sort())
    // A name is the business of a desk: a host has none
    expect(keys({ t: 'host', v: PROTOCOL_VERSION, room: 'ABC234', client: 'client-token', name: 'Léa' })).toEqual(['client', 'room', 't', 'v'])
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

  it('rejects a desk number out of 1 … 8, wherever it stands', () => {
    const fleet = { t: 'fleet', fleet: [ENTRY] }
    const state = { t: 'state', state: null, ack: 0 }
    const ok = command({ type: 'switchCab' })
    for (const desk of [1, 2, MAX_DESKS]) {
      expect(decode({ t: 'joined', room: 'ABC234', desk }).ok).toBe(true)
      expect(decode({ t: 'peer-joined', desk }).ok).toBe(true)
      expect(decode({ t: 'peer-left', desk }).ok).toBe(true)
      expect(decode({ ...fleet, to: desk }).ok).toBe(true)
      expect(decode({ ...state, to: desk }).ok).toBe(true)
      expect(decode({ ...ok, from: desk }).ok).toBe(true)
    }
    for (const desk of [0, -1, MAX_DESKS + 1, 1.5, 1e9, '1', null, true, [1], {}]) {
      expect(decode({ t: 'joined', room: 'ABC234', desk })).toEqual(malformed)
      expect(decode({ t: 'peer-joined', desk })).toEqual(malformed)
      expect(decode({ t: 'peer-joined', desk, name: 'Léa' })).toEqual(malformed)
      expect(decode({ t: 'peer-left', desk })).toEqual(malformed)
      expect(decode({ ...fleet, to: desk })).toEqual(malformed)
      expect(decode({ ...state, to: desk })).toEqual(malformed)
      expect(decode({ ...state, state: STATE, to: desk })).toEqual(malformed)
      expect(decode({ ...ok, from: desk })).toEqual(malformed)
    }
    // A desk is told its number, and the host which desk arrived: neither may be left out
    expect(decode({ t: 'joined', room: 'ABC234' })).toEqual(malformed)
    expect(decode({ t: 'peer-joined' })).toEqual(malformed)
    expect(decode({ t: 'peer-joined', name: 'Léa' })).toEqual(malformed)
  })

  it('rejects a driver name that is too long or not a text', () => {
    const join = { t: 'join', v: PROTOCOL_VERSION, room: 'ABC234', client: 'client-token' }
    const exact = 'x'.repeat(MAX_DRIVER_NAME_LENGTH)
    expect(decode({ ...join, name: exact })).toEqual({ ok: true, message: { ...join, name: exact } })
    // No name is no name: an empty one is not carried
    expect(decode({ ...join, name: '' })).toEqual({ ok: true, message: join })
    expect(decode({ t: 'peer-joined', desk: 2, back: true })).toEqual({ ok: true, message: { t: 'peer-joined', desk: 2, back: true } })
    expect(decode({ t: 'peer-joined', desk: 2, back: false })).toEqual({ ok: true, message: { t: 'peer-joined', desk: 2 } })
    expect(decode({ t: 'peer-joined', desk: 2, back: 'yes' }).ok).toBe(false)
    expect(decode({ t: 'peer-joined', desk: 2, name: exact })).toEqual({ ok: true, message: { t: 'peer-joined', desk: 2, name: exact } })
    for (const name of [exact + 'x', 'x'.repeat(200), 7, null, true, ['Léa'], { name: 'Léa' }]) {
      expect(decode({ ...join, name })).toEqual(malformed)
      expect(decode({ t: 'peer-joined', desk: 2, name })).toEqual(malformed)
    }
  })

  it('rejects a fleet entry whose driver is not the host, a desk or nobody', () => {
    const fleet = (patch: object) => decode({ t: 'fleet', fleet: [ENTRY, { ...ENTRY, ...patch }] })
    for (const driver of ['host', 1, MAX_DESKS, null]) expect(fleet({ driver }).ok).toBe(true)
    for (const driver of [0, -1, MAX_DESKS + 1, 2.5, 'pc', 'Host', '1', true, {}, [1]]) expect(fleet({ driver })).toEqual(malformed)
    expect(fleet({ driver: 2, driverName: 'x'.repeat(MAX_LABEL_LENGTH) }).ok).toBe(true)
    expect(fleet({ driver: 2, driverName: 'x'.repeat(MAX_LABEL_LENGTH + 1) })).toEqual(malformed)
    expect(fleet({ driver: 2, driverName: 7 })).toEqual(malformed)
    expect(fleet({ driver: 2, driverName: null })).toEqual(malformed)
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

  it('takes the signals as optional, and rejects the state when anything in them is wrong', () => {
    const signals = (patch: object) => decode({ t: 'state', ack: 0, state: { ...STATE, signals: { ...SIGNALS, ...patch } } })
    const next = (patch: object) => signals({ next: { ...SIGNALS.next, ...patch } })
    const cab = (patch: object) => signals({ cab: { kind: 'line', speed: 300, flashing: false, markerDistance: 900, ...patch } })
    // A PC that knows no signalling, or a network without signal: no `signals`, and none comes out
    const plain = decode({ t: 'state', ack: 0, state: STATE })
    expect(plain.ok && plain.message.t === 'state' && plain.message.state && 'signals' in plain.message.state).toBe(false)
    expect(signals({}).ok).toBe(true)
    expect(signals({ next: null }).ok).toBe(true)
    expect(cab({}).ok).toBe(true)

    expect(decode({ t: 'state', ack: 0, state: { ...STATE, signals: null } })).toEqual(malformed)
    expect(decode({ t: 'state', ack: 0, state: { ...STATE, signals: [] } })).toEqual(malformed)
    expect(signals({ level: 'expert' })).toEqual(malformed)
    expect(signals({ next: undefined })).toEqual(malformed)
    expect(signals({ closedDistance: -1 })).toEqual(malformed)
    expect(signals({ closedDistance: undefined })).toEqual(malformed)
    expect(signals({ brakeAlert: 1 })).toEqual(malformed)
    expect(signals({ waiting: undefined })).toEqual(malformed)
    expect(signals({ onSight: 'yes' })).toEqual(malformed)
    expect(signals({ onSightSpeed: 30.5 })).toEqual(malformed)
    expect(signals({ passed: {} })).toEqual(malformed)
    expect(signals({ passed: true })).toEqual(malformed)
    expect(signals({ cab: undefined })).toEqual(malformed)
    expect(next({ distance: -5 })).toEqual(malformed)
    expect(next({ distance: null })).toEqual(malformed)
    expect(next({ color: 'blue' })).toEqual(malformed)
    expect(next({ indication: 'feu-vert' })).toEqual(malformed)
    // The announcement and the reminder of a diverging route: 30 or 60, or not there at all
    expect(next({ indication: 'ralentissement', slowdown: 60 }).ok).toBe(true)
    expect(next({ indication: 'rappel', reminder: 30 }).ok).toBe(true)
    expect(next({ slowdown: 40 })).toEqual(malformed)
    expect(next({ reminder: null })).toEqual(malformed)
    expect(signals({ overspeed: { braked: true } }).ok).toBe(true)
    expect(signals({ overspeed: true })).toEqual(malformed)
    expect(signals({ overspeed: {} })).toEqual(malformed)
    expect(next({ plate: 'A' })).toEqual(malformed)
    expect(next({ lit: 1 })).toEqual(malformed)
    expect(next({ label: 'x'.repeat(200) })).toEqual(malformed)
    expect(cab({ kind: 'rouge' })).toEqual(malformed)
    expect(cab({ speed: -10 })).toEqual(malformed)
    expect(cab({ speed: 270.5 })).toEqual(malformed)
    expect(cab({ flashing: null })).toEqual(malformed)
    expect(cab({ markerDistance: -1 })).toEqual(malformed)
    // Unknown fields are dropped, here like everywhere
    const extra = next({ evil: true })
    expect(extra.ok && extra.message.t === 'state' && extra.message.state?.signals?.next).toEqual(SIGNALS.next)
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

describe('protocol: the two ways to the PC', () => {
  const base = '/open-rails/'

  it('goes through the relay of the server on a page served by the PC, directly from the published site', () => {
    expect(remoteRoute('http://localhost:8900/open-rails/', base)).toEqual({ transport: 'relay', broker: null })
    expect(remoteRoute('http://192.168.1.42:8900/open-rails/?pupitre=ABC234', base)).toEqual({ transport: 'relay', broker: null })
    expect(remoteRoute('https://maximcuynat.github.io/open-rails/', base)).toEqual({ transport: 'direct', broker: null })
    expect(remoteRoute('https://maximcuynat.github.io/open-rails/?pupitre=ABC234', base)).toEqual({ transport: 'direct', broker: null })
  })

  it('can be told to go directly, and through which broker', () => {
    expect(remoteRoute('http://localhost:8900/open-rails/?liaison=webrtc', base)).toEqual({ transport: 'direct', broker: null })
    expect(remoteRoute('http://localhost:8900/open-rails/?liaison=webrtc&courtier=local', base)).toEqual({ transport: 'direct', broker: 'ws://localhost:8900/open-rails/__broker/peerjs' })
    expect(remoteRoute('https://example.org/open-rails/?courtier=local', base).broker).toBe('wss://example.org/open-rails/__broker/peerjs')
    expect(remoteRoute('https://example.org/open-rails/?courtier=wss%3A%2F%2Fbroker.example%2Fpeerjs', base).broker).toBe('wss://broker.example/peerjs')
    // Not an address of a broker: the public one
    expect(remoteRoute('https://example.org/open-rails/?courtier=javascript:alert(1)', base).broker).toBeNull()
    // The broker is only asked for by a direct link
    expect(remoteRoute('http://localhost:8900/open-rails/?courtier=local', base)).toEqual({ transport: 'relay', broker: null })
  })

  it('gives the phone the way the PC uses', () => {
    expect(pairingUrl('http://localhost:8900/open-rails/?liaison=webrtc&courtier=local&x=1#h', base, 'ABC234', '192.168.1.42')).toBe(
      'http://192.168.1.42:8900/open-rails/?pupitre=ABC234&liaison=webrtc&courtier=local',
    )
    expect(pairingUrl('https://maximcuynat.github.io/open-rails/', base, 'ABC234')).toBe('https://maximcuynat.github.io/open-rails/?pupitre=ABC234')
  })
})
