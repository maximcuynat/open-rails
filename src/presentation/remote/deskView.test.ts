import { describe, expect, it } from 'vitest'
import type { ConsoleState, FleetEntry } from '@application/console/consoleContract'
import type { RemoteDeskSnapshot } from '@application/remote/remoteDesk'
import {
  BAND_DESIGN,
  NEW_SESSION,
  PORTRAIT_DESIGN,
  SIGNALS_HEIGHT,
  compositionLabel,
  deskDesign,
  deskOrientation,
  deskScreen,
  fitStage,
  fleetSpeedLabel,
  hapticFor,
  idleState,
  nextSession,
  trainTitle,
  turnoutView,
} from './deskView'

const state = (patch: Partial<ConsoleState> = {}): ConsoleState => ({
  trainId: 't_1',
  speed: 20,
  maxSpeed: 88,
  stopped: false,
  notch: 2,
  minNotch: -5,
  maxNotch: 5,
  handleEffort: 0.5,
  reverser: 'forward',
  reverserLocked: true,
  emergencyBrake: false,
  emergencyReleasable: false,
  brake: { command: 'hold', tone: 'released', pipeBar: 5, cylinderBar: 0 },
  acceleration: 0.3,
  gradientPermille: 0,
  stoppingDistance: 400,
  locoCount: 2,
  wagonCount: 8,
  upcomingTurnout: null,
  canSwitchCab: false,
  ...patch,
})

const snapshot = (patch: Partial<RemoteDeskSnapshot> = {}): RemoteDeskSnapshot => ({
  link: 'open',
  joined: true,
  fleet: [],
  state: null,
  ack: 0,
  ended: null,
  ...patch,
})

const entry = (patch: Partial<FleetEntry> = {}): FleetEntry => ({
  id: 't_1',
  rank: 1,
  model: 'TGV Duplex',
  locoCount: 2,
  wagonCount: 8,
  speed: 0,
  driven: false,
  ...patch,
})

describe('deskScreen', () => {
  it('asks for a code when the address carries none', () => {
    expect(deskScreen(null, snapshot({ joined: false }), NEW_SESSION, false)).toEqual({ kind: 'enter-code', reason: 'missing' })
  })

  it('is connecting until the desk sits in the room for the first time', () => {
    const connecting = snapshot({ link: 'connecting', joined: false })
    expect(deskScreen('ABCDEF', connecting, NEW_SESSION, false)).toEqual({ kind: 'connecting' })
    // The socket is open but the relay has not answered the join yet
    expect(deskScreen('ABCDEF', snapshot({ joined: false }), NEW_SESSION, false)).toEqual({ kind: 'connecting' })
  })

  it('asks for another code when the relay does not know the room', () => {
    const ended = snapshot({ link: 'closed', joined: false, ended: 'unknown-room' })
    expect(deskScreen('ABCDEF', ended, NEW_SESSION, false)).toEqual({ kind: 'enter-code', reason: 'unknown-room' })
  })

  it('tells a full room, a session closed by the PC and a version mismatch apart', () => {
    const ended = (reason: RemoteDeskSnapshot['ended']) =>
      deskScreen('ABCDEF', snapshot({ link: 'closed', joined: false, ended: reason }), NEW_SESSION, false)
    expect(ended('room-full')).toEqual({ kind: 'ended', reason: 'room-full' })
    expect(ended('host-closed')).toEqual({ kind: 'ended', reason: 'host-closed' })
    expect(ended('version')).toEqual({ kind: 'ended', reason: 'version' })
    expect(ended('bad-message')).toEqual({ kind: 'ended', reason: 'error' })
    expect(ended('room-taken')).toEqual({ kind: 'ended', reason: 'error' })
  })

  it('an ended session wins over whatever was on screen', () => {
    const session = { everJoined: true, lastState: state() }
    const ended = snapshot({ link: 'closed', joined: false, ended: 'host-closed' })
    expect(deskScreen('ABCDEF', ended, session, false)).toEqual({ kind: 'ended', reason: 'host-closed' })
  })

  it('shows the list while the PC drives nothing, the desk as soon as it drives', () => {
    expect(deskScreen('ABCDEF', snapshot(), NEW_SESSION, false)).toEqual({ kind: 'fleet', online: true })
    const driving = state()
    expect(deskScreen('ABCDEF', snapshot({ state: driving }), NEW_SESSION, false)).toEqual({ kind: 'desk', state: driving, online: true })
  })

  it('goes back to the list on request without the PC leaving its train', () => {
    expect(deskScreen('ABCDEF', snapshot({ state: state() }), NEW_SESSION, true)).toEqual({ kind: 'fleet', online: true })
  })

  it('keeps the desk on screen, with nothing held, while the link is cut', () => {
    const applying = state({ brake: { command: 'apply', tone: 'applying', pipeBar: 4.2, cylinderBar: 1.5 } })
    const session = { everJoined: true, lastState: applying }
    const cut = snapshot({ link: 'connecting', joined: false })
    const screen = deskScreen('ABCDEF', cut, session, false)
    expect(screen.kind).toBe('desk')
    if (screen.kind !== 'desk') return
    expect(screen.online).toBe(false)
    expect(screen.state.brake?.command).toBe('hold')
    // The pressures are the last ones known
    expect(screen.state.brake?.pipeBar).toBe(4.2)
  })

  it('keeps the list on screen while the link is cut when that is where the driver was', () => {
    const cut = snapshot({ link: 'connecting', joined: false })
    expect(deskScreen('ABCDEF', cut, { everJoined: true, lastState: null }, false)).toEqual({ kind: 'fleet', online: false })
    expect(deskScreen('ABCDEF', cut, { everJoined: true, lastState: state() }, true)).toEqual({ kind: 'fleet', online: false })
  })
})

describe('nextSession', () => {
  it('remembers the first join and the last state received', () => {
    const driving = state()
    const joined = nextSession(NEW_SESSION, snapshot())
    expect(joined).toEqual({ everJoined: true, lastState: null })
    expect(nextSession(joined, snapshot({ state: driving }))).toEqual({ everJoined: true, lastState: driving })
  })

  it('keeps what it knew through a cut, where the snapshot is emptied', () => {
    const session = { everJoined: true, lastState: state() }
    expect(nextSession(session, snapshot({ link: 'connecting', joined: false }))).toBe(session)
  })

  it('forgets the train once the PC stops driving', () => {
    const session = { everJoined: true, lastState: state() }
    expect(nextSession(session, snapshot())).toEqual({ everJoined: true, lastState: null })
  })

  it('returns the same object when nothing changed', () => {
    const driving = state()
    const session = { everJoined: true, lastState: driving }
    expect(nextSession(session, snapshot({ state: driving, ack: 4 }))).toBe(session)
  })
})

describe('idleState', () => {
  it('leaves a state with nothing held untouched', () => {
    const s = state()
    expect(idleState(s)).toBe(s)
    const legacy = state({ brake: null })
    expect(idleState(legacy)).toBe(legacy)
  })
})

describe('deskOrientation', () => {
  it('follows the way the phone is held', () => {
    expect(deskOrientation(390, 844)).toBe('portrait')
    expect(deskOrientation(844, 390)).toBe('landscape')
    expect(deskOrientation(360, 640)).toBe('portrait')
    expect(deskOrientation(600, 600)).toBe('portrait')
  })
})

describe('fitStage', () => {
  it('scales the band to the width of a phone lying on its side', () => {
    const fit = fitStage(844, 334, BAND_DESIGN)
    expect(fit.scale).toBeCloseTo(844 / 984)
    expect(fit.width).toBeCloseTo(984)
    expect(fit.height * fit.scale).toBeCloseTo(334)
  })

  it('scales the portrait desk to the width, or to the height on a short screen', () => {
    expect(fitStage(390, 700, PORTRAIT_DESIGN).scale).toBeCloseTo(1)
    expect(fitStage(360, 520, PORTRAIT_DESIGN).scale).toBeCloseTo(360 / 390)
    const short = fitStage(390, 432, PORTRAIT_DESIGN)
    expect(short.scale).toBeCloseTo(0.8)
    // The stage then gets wider than its design: scaled, it still covers the box
    expect(short.width * short.scale).toBeCloseTo(390)
  })

  it('never grows past its largest scale', () => {
    expect(fitStage(1024, 1366, PORTRAIT_DESIGN).scale).toBe(PORTRAIT_DESIGN.maxScale)
    expect(fitStage(2560, 1200, BAND_DESIGN).scale).toBe(BAND_DESIGN.maxScale)
  })

  it('survives a box that has no size yet', () => {
    expect(fitStage(0, 0, PORTRAIT_DESIGN).scale).toBe(1)
  })
})

describe('hapticFor', () => {
  it('answers every notch and control with a short tick', () => {
    expect(hapticFor({ type: 'notchSet', notch: 3 })).toBe(12)
    expect(hapticFor({ type: 'notchStep', step: -1 })).toBe(12)
    expect(hapticFor({ type: 'brake', command: 'apply' })).toBe(12)
    expect(hapticFor({ type: 'reverser', reverser: 'forward' })).toBe(12)
  })

  it('stays silent when the brake lever springs back', () => {
    expect(hapticFor({ type: 'brake', command: 'hold' })).toBeNull()
  })

  it('marks the emergency stop with a longer pattern', () => {
    expect(hapticFor({ type: 'emergencyBrake' })).toEqual([70, 40, 70])
  })

  it('does not buzz for the commands of the list', () => {
    expect(hapticFor({ type: 'selectTrain', trainId: 't_1' })).toBeNull()
    expect(hapticFor({ type: 'releaseControls' })).toBeNull()
  })
})

describe('labels', () => {
  it('writes a composition in full', () => {
    expect(compositionLabel(2, 8)).toBe('2 motrices · 8 voitures')
    expect(compositionLabel(1, 1)).toBe('1 motrice · 1 voiture')
    expect(compositionLabel(1, 0)).toBe('1 motrice')
    expect(compositionLabel(0, 3)).toBe('3 voitures')
  })

  it('writes the speed of a train of the list', () => {
    expect(fleetSpeedLabel({ speed: 0 })).toBe('À l’arrêt')
    expect(fleetSpeedLabel({ speed: 0.1 })).toBe('À l’arrêt')
    expect(fleetSpeedLabel({ speed: 25 })).toBe('90 km/h')
  })

  it('names the driven train', () => {
    const fleet = [entry(), entry({ id: 't_2', rank: 2, model: 'BB 26000' })]
    expect(trainTitle(state({ trainId: 't_2' }), fleet)).toBe('Train 2/2 · BB 26000')
    expect(trainTitle(state(), [entry()])).toBe('Train 1 · TGV Duplex')
    expect(trainTitle(state({ trainId: 't_9' }), fleet)).toBe('Train')
    expect(trainTitle(state({ trainId: null }), fleet)).toBe('Locomotive')
  })
})

describe('turnoutView', () => {
  it('tells where the next turnout is and which way it is set', () => {
    expect(turnoutView({ distance: 120.4, side: 'left', locked: false })).toEqual({ label: 'Aiguillage à 120 m', side: 'left', enabled: true })
    expect(turnoutView({ distance: 1500, side: null, locked: false })).toEqual({ label: 'Aiguillage à 1,5 km', side: null, enabled: true })
  })

  it('locks the buttons on an occupied turnout and when there is none', () => {
    expect(turnoutView({ distance: 8, side: 'right', locked: true })).toEqual({ label: 'Aiguillage à 8 m · occupé', side: 'right', enabled: false })
    expect(turnoutView(null)).toEqual({ label: 'Aucun aiguillage en vue', side: null, enabled: false })
  })

  it('leaves the buttons usable when the PC does not say', () => {
    expect(turnoutView(undefined)).toEqual({ label: 'Aiguillage suivant', side: null, enabled: true })
  })
})

describe('deskDesign', () => {
  it('is the band on its side and the levers upright, as before, on a network without signal', () => {
    expect(deskDesign('landscape', state())).toBe(BAND_DESIGN)
    expect(deskDesign('portrait', state())).toBe(PORTRAIT_DESIGN)
  })

  it('makes room for the signalling block on a network that has signals', () => {
    const signals = {
      level: 'standard' as const,
      next: null,
      closedDistance: null,
      brakeAlert: false,
      waiting: false,
      onSight: false,
      onSightSpeed: 30,
      passed: null,
      cab: null,
    }
    expect(deskDesign('landscape', state({ signals }))).toEqual({ ...BAND_DESIGN, minHeight: BAND_DESIGN.minHeight + SIGNALS_HEIGHT })
    expect(deskDesign('portrait', state({ signals }))).toEqual({ ...PORTRAIT_DESIGN, minHeight: PORTRAIT_DESIGN.minHeight + SIGNALS_HEIGHT })
  })
})
