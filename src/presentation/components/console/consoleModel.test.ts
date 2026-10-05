import { describe, expect, it } from 'vitest'
import type { ConsoleGuidance, ConsoleSignal, ConsoleSignals, ConsoleState, FleetEntry } from '@application/console/consoleContract'
import { signalPassedMessage } from '@application/state/editorStore'
import {
  BRAKE_CYLINDER_GAUGE,
  BRAKE_PIPE_GAUGE,
  accelerationLabel,
  accelerationValue,
  cabView,
  compactKeyLabel,
  consoleView,
  derailmentMessage,
  distanceRatio,
  effortPercent,
  gaugeRatio,
  gradientLabel,
  guidanceView,
  newDerailment,
  newSignalPassed,
  notchLabel,
  notchStops,
  signalHeadView,
  signalPassedLabel,
  signalsView,
  speedDialTicks,
  speedMinorTicks,
  speedTone,
  stoppingDistanceLabel,
  targetLamps,
  turnoutView,
} from './consoleModel'

const baseState: ConsoleState = {
  trainId: 't_1',
  speed: 187 / 3.6,
  maxSpeed: 320 / 3.6,
  stopped: false,
  notch: 3,
  minNotch: -5,
  maxNotch: 5,
  handleEffort: 0.62,
  reverser: 'forward',
  reverserLocked: true,
  emergencyBrake: false,
  emergencyReleasable: false,
  brake: { command: 'hold', tone: 'released', pipeBar: 5, cylinderBar: 0 },
  acceleration: 0.21,
  gradientPermille: 4,
  stoppingDistance: 1240,
  locoCount: 2,
  wagonCount: 8,
  upcomingTurnout: null,
  canSwitchCab: false,
}

const fleet: FleetEntry[] = [
  { id: 't_1', rank: 1, model: 'TGV Duplex', locoCount: 2, wagonCount: 8, speed: 52, driven: true },
  { id: 't_2', rank: 2, model: 'TGV M', locoCount: 1, wagonCount: 0, speed: 0, driven: false },
]

describe('driving console model', () => {
  it('names the notches B5 … B1, N, P1 … P5', () => {
    expect([-5, -1, 0, 1, 5].map(notchLabel)).toEqual(['B5', 'B1', 'N', 'P1', 'P5'])
  })

  it('gives the applied effort as a percentage', () => {
    expect(effortPercent(0)).toBe(0)
    expect(effortPercent(0.604)).toBe(60)
    expect(effortPercent(1.2)).toBe(100)
  })

  it('signs the real acceleration and never prints a negative zero', () => {
    expect(accelerationLabel(0.318)).toBe('+0,32 m/s²')
    expect(accelerationLabel(-1.1)).toBe('−1,10 m/s²')
    expect(accelerationLabel(0)).toBe('0,00 m/s²')
    expect(accelerationValue(-0.001)).toBe('0,00')
  })

  it('gives the slope with its sign', () => {
    expect(gradientLabel(35)).toBe('+35 ‰')
    expect(gradientLabel(-35)).toBe('−35 ‰')
    expect(gradientLabel(4.26)).toBe('+4,3 ‰')
    expect(gradientLabel(0)).toBe('palier')
    expect(gradientLabel(-0.2)).toBe('palier')
    expect(gradientLabel(NaN)).toBe('palier')
  })

  it('graduates the speed dial in round steps up to the top speed', () => {
    expect(speedDialTicks(320)).toEqual([0, 80, 160, 240, 320])
    expect(speedDialTicks(300)).toEqual([0, 80, 160, 240, 300])
    expect(speedDialTicks(160)).toEqual([0, 40, 80, 120, 160])
    expect(speedDialTicks(0)).toEqual([0])
    // The needle dial has room for twice as many figures
    expect(speedDialTicks(320, 8)).toEqual([0, 40, 80, 120, 160, 200, 240, 280, 320])
    expect(speedMinorTicks(100, 20)).toEqual([0, 20, 40, 60, 80])
    expect(speedMinorTicks(0, 20)).toEqual([])
  })

  it('scales the gauges on the brake pressures', () => {
    expect(BRAKE_PIPE_GAUGE).toEqual({ max: 5, marks: [3.5, 4.5, 5] })
    expect(BRAKE_CYLINDER_GAUGE).toEqual({ max: 3.8, marks: [0, 3.8] })
    expect(gaugeRatio(3.5, BRAKE_PIPE_GAUGE)).toBeCloseTo(0.7)
    expect(gaugeRatio(0, BRAKE_PIPE_GAUGE)).toBe(0)
    expect(gaugeRatio(4.2, BRAKE_CYLINDER_GAUGE)).toBe(1)
    expect(gaugeRatio(NaN, BRAKE_CYLINDER_GAUGE)).toBe(0)
  })

  it('writes the stopping distance in metres, then kilometres, and ∞ when the brake cannot hold', () => {
    expect(stoppingDistanceLabel(0)).toBe('0 m')
    expect(stoppingDistanceLabel(29.6)).toBe('30 m')
    expect(stoppingDistanceLabel(999.4)).toBe('999 m')
    expect(stoppingDistanceLabel(3344)).toBe('3,3 km')
    expect(stoppingDistanceLabel(null)).toBe('∞')
    expect(stoppingDistanceLabel(Infinity)).toBe('∞')
  })

  it('draws the stopping distance on a square-root scale capped at 4 km', () => {
    expect(distanceRatio(0)).toBe(0)
    expect(distanceRatio(1000)).toBeCloseTo(0.5)
    expect(distanceRatio(4000)).toBe(1)
    expect(distanceRatio(9000)).toBe(1)
    expect(distanceRatio(null)).toBe(1)
  })

  it('shortens the long key names for a key cap', () => {
    expect(compactKeyLabel('Retour arrière')).toBe('⌫')
    expect(compactKeyLabel('Espace')).toBe('Esp')
    expect(compactKeyLabel('Q')).toBe('Q')
    expect(compactKeyLabel('')).toBe('')
  })
})

describe('notch stops', () => {
  it('lists the whole handle from B5 to P5 and lights the traction notches up to the handle', () => {
    const stops = notchStops(baseState)
    expect(stops.map((s) => s.label)).toEqual(['B5', 'B4', 'B3', 'B2', 'B1', 'N', 'P1', 'P2', 'P3', 'P4', 'P5'])
    expect(stops.filter((s) => s.current).map((s) => s.label)).toEqual(['P3'])
    expect(stops.filter((s) => s.passed).map((s) => s.label)).toEqual(['N', 'P1', 'P2'])
    expect(stops.find((s) => s.label === 'B2')!.side).toBe('brake')
    expect(stops.find((s) => s.label === 'N')!.side).toBe('neutral')
    expect(stops.find((s) => s.label === 'P4')!.side).toBe('traction')
  })

  it('lights the electric brake notches down to the handle', () => {
    const stops = notchStops({ ...baseState, notch: -2 })
    expect(stops.filter((s) => s.current).map((s) => s.label)).toEqual(['B2'])
    expect(stops.filter((s) => s.passed).map((s) => s.label)).toEqual(['B1', 'N'])
  })

  it('lights nothing but N in neutral', () => {
    const stops = notchStops({ ...baseState, notch: 0 })
    expect(stops.filter((s) => s.current || s.passed).map((s) => s.label)).toEqual(['N'])
  })

  it('names the three positions of the legacy throttle', () => {
    const stops = notchStops({ notch: 1, minNotch: -1, maxNotch: 1, legacyThrottle: 1 })
    expect(stops.map((s) => s.label)).toEqual(['Frein', 'Inertie', 'Accél.'])
  })
})

describe('console view', () => {
  it('writes what the consoles show of a train in traction', () => {
    expect(consoleView(baseState, fleet)).toEqual({
      kmh: 187,
      maxKmh: 320,
      speedRatio: 187 / 320,
      legacy: false,
      handleSide: 'traction',
      handleTitle: 'Traction',
      handleLabel: 'P3 · 62 %',
      handlePercent: 62,
      composition: '2M · 8V',
      model: 'TGV Duplex',
      rank: 1,
      fleetSize: 2,
      acceleration: '+0,21',
      gradient: '+4,0 ‰',
      stopping: '1,2 km',
      brakeLabel: 'Desserré',
      emergencyLabel: 'Urgence',
      reverserNeeded: false,
      releaseHint: false,
      turnout: { label: '—', hint: 'Aucun aiguillage devant le train', side: null, disabled: true },
      // No speed limit known (state without `guidance`): the speed stays white and nothing is marked
      speedTone: 'normal',
      limit: null,
      nextLimit: null,
      curve: null,
      derailment: null,
      // No signal on the network (state without `signals`): nothing of the signalling is shown
      signals: null,
    })
  })

  it('names the electric brake on the negative notches', () => {
    const view = consoleView({ ...baseState, notch: -4, handleEffort: 0.8 }, fleet)
    expect(view).toMatchObject({ handleSide: 'brake', handleTitle: 'Frein élec.', handleLabel: 'B4 · 80 %' })
  })

  it('gives no rank to a train alone on the layout, and none when the fleet is unknown', () => {
    expect(consoleView(baseState, fleet.slice(0, 1))).toMatchObject({ rank: null, model: 'TGV Duplex', fleetSize: 1 })
    expect(consoleView(baseState, [])).toMatchObject({ rank: null, model: null })
  })

  it('points at the brake of a stopped train and at a reverser left in neutral', () => {
    const stopped: ConsoleState = {
      ...baseState,
      speed: 0,
      stopped: true,
      notch: 1,
      reverser: 'neutral',
      brake: { command: 'hold', tone: 'applied', pipeBar: 3.5, cylinderBar: 3.8 },
    }
    expect(consoleView(stopped, fleet)).toMatchObject({ releaseHint: true, reverserNeeded: true, brakeLabel: 'Serré', kmh: 0 })
    // Braking on the move is not a hint to release
    expect(consoleView({ ...stopped, speed: 10, stopped: false }, fleet).releaseHint).toBe(false)
  })

  it('follows the emergency brake: triggered, then ready to reset', () => {
    const brake = { command: 'hold' as const, tone: 'emergency' as const, pipeBar: 0, cylinderBar: 3.8 }
    expect(consoleView({ ...baseState, emergencyBrake: true, brake }, fleet)).toMatchObject({ emergencyLabel: 'Urgence…', brakeLabel: 'Urgence' })
    expect(consoleView({ ...baseState, emergencyBrake: true, emergencyReleasable: true, brake }, fleet).emergencyLabel).toBe('Réarmer')
  })

  it('reduces to a throttle for the legacy locomotive', () => {
    const legacy: ConsoleState = {
      ...baseState,
      trainId: null,
      notch: -1,
      minNotch: -1,
      maxNotch: 1,
      handleEffort: 1,
      brake: null,
      legacyThrottle: -1,
      stoppingDistance: null,
    }
    expect(consoleView(legacy, fleet)).toMatchObject({
      legacy: true,
      handleTitle: 'Commande',
      handleLabel: 'Frein',
      brakeLabel: null,
      model: null,
      rank: null,
      reverserNeeded: false,
      releaseHint: false,
      stopping: '∞',
    })
  })
})

describe('turnout ahead', () => {
  it('says there is none, and disables the steering', () => {
    expect(turnoutView(null)).toEqual({ label: '—', hint: 'Aucun aiguillage devant le train', side: null, disabled: true })
  })

  it('gives the distance and the side of the open route', () => {
    expect(turnoutView({ distance: 239.6, side: 'left', locked: false })).toEqual({
      label: '240 m',
      hint: 'Aiguillage à 240 m, voie ouverte à gauche',
      side: 'left',
      disabled: false,
    })
    expect(turnoutView({ distance: 1520, side: 'right', locked: false })).toMatchObject({
      label: '1,5 km',
      hint: 'Aiguillage à 1,5 km, voie ouverte à droite',
    })
    // Side unknown (three-way on its middle route, or met by a branch): both buttons stay usable
    expect(turnoutView({ distance: 80, side: null, locked: false })).toEqual({
      label: '80 m',
      hint: 'Aiguillage à 80 m',
      side: null,
      disabled: false,
    })
  })

  it('disables the steering of a turnout a train stands on', () => {
    expect(turnoutView({ distance: 12, side: 'right', locked: true })).toEqual({
      label: 'occupé',
      hint: 'Aiguillage à 12 m, occupé par un train : manœuvre impossible',
      side: 'right',
      disabled: true,
    })
  })
})

describe('speed limits on the console', () => {
  const guidance = (over: Partial<ConsoleGuidance> = {}): ConsoleGuidance => ({
    speedLimit: 160,
    nextLimit: null,
    curve: 'ok',
    derailed: null,
    ...over,
  })
  const at = (kmh: number, over: Partial<ConsoleGuidance> = {}) =>
    consoleView({ ...baseState, speed: kmh / 3.6, guidance: guidance(over) }, fleet)

  it('colours the speed against the limit in force: white, orange within 10 km/h, red above', () => {
    // Limit at 160 km/h
    expect(speedTone(140, 160, null)).toBe('normal')
    expect(speedTone(149, 160, null)).toBe('normal')
    expect(speedTone(150, 160, null)).toBe('near')
    expect(speedTone(160, 160, null)).toBe('near')
    expect(speedTone(161, 160, null)).toBe('over')
  })

  it('turns yellow when a lower limit is announced ahead and the train still runs faster than it', () => {
    // 200 km/h on a 320 km/h line, a 160 km/h zone ahead
    expect(speedTone(200, 320, 160)).toBe('ahead')
    // Already under the announced limit: nothing to do
    expect(speedTone(160, 320, 160)).toBe('normal')
    expect(speedTone(120, 320, 160)).toBe('normal')
  })

  it('the gravest colour wins: red, then orange, then yellow', () => {
    expect(speedTone(205, 200, 160)).toBe('over')
    expect(speedTone(195, 200, 160)).toBe('near')
    expect(speedTone(180, 200, 160)).toBe('ahead')
  })

  it('stays white at rest, and without any limit', () => {
    expect(speedTone(0, 10, null)).toBe('normal')
    expect(speedTone(250, null, null)).toBe('normal')
  })

  it('colours the view from the speed the console writes', () => {
    expect(at(140).speedTone).toBe('normal')
    expect(at(150).speedTone).toBe('near')
    expect(at(160).speedTone).toBe('near')
    // 160,4 km/h is written 160: still orange, like the figure
    expect(at(160.4).speedTone).toBe('near')
    expect(at(161).speedTone).toBe('over')
    expect(at(200, { speedLimit: 320, nextLimit: { speed: 160, distance: 5000 } }).speedTone).toBe('ahead')
    expect(at(330, { speedLimit: 320, nextLimit: { speed: 160, distance: 5000 } }).speedTone).toBe('over')
  })

  it('places the solid mark at the limit in force and the hollow one at the next lower limit', () => {
    const view = at(200, { speedLimit: 240, nextLimit: { speed: 160, distance: 850 } })
    expect(view.limit).toEqual({ kmh: 240, ratio: 240 / 320, label: '240' })
    expect(view.nextLimit).toEqual({ kmh: 160, ratio: 0.5, label: '160', distance: '850 m' })
    // No lower limit in sight: no hollow mark
    expect(at(200).nextLimit).toBeNull()
  })

  it('keeps a mark on the scale when the limit is above the top speed of the train', () => {
    expect(guidanceView(100, 200, guidance({ speedLimit: 320 })).limit).toEqual({ kmh: 320, ratio: 1, label: '320' })
  })

  it('writes the distance to the next limit in metres, then in kilometres, like the stopping distance', () => {
    const next = (distance: number) => at(200, { nextLimit: { speed: 90, distance } }).nextLimit!.distance
    expect(next(0)).toBe('0 m')
    expect(next(849.6)).toBe('850 m')
    expect(next(999)).toBe('999 m')
    expect(next(1000)).toBe('1,0 km')
    expect(next(5230)).toBe('5,2 km')
  })

  it('says how the curve is taken, only when it is taken too fast', () => {
    expect(at(100).curve).toBeNull()
    expect(at(100, { curve: 'discomfort' }).curve).toMatchObject({ tone: 'discomfort', label: 'Courbe : inconfort' })
    expect(at(100, { curve: 'danger' }).curve).toMatchObject({ tone: 'danger', label: 'Courbe : danger' })
  })

  it('writes a derailment with the speed and the limit of that moment', () => {
    expect(at(0).derailment).toBeNull()
    expect(derailmentMessage({ speed: 234.6, limit: 160 })).toBe('Déraillement à 235 km/h (limite 160 km/h)')
    expect(at(0, { derailed: { speed: 235, limit: 160 } }).derailment).toBe('Déraillement à 235 km/h (limite 160 km/h)')
  })

  it('announces a derailment once, and again only after the train was put back on the track', () => {
    const announced = new Set<string>()
    const derailed: ConsoleState = { ...baseState, guidance: guidance({ derailed: { speed: 235, limit: 160 } }) }
    const onTrack: ConsoleState = { ...baseState, guidance: guidance() }

    expect(newDerailment(announced, onTrack)).toBeNull()
    expect(newDerailment(announced, derailed)).toBe('Déraillement à 235 km/h (limite 160 km/h)')
    expect(newDerailment(announced, derailed)).toBeNull()
    // Another train derails: its own message
    expect(newDerailment(announced, { ...derailed, trainId: 't_2' })).not.toBeNull()
    expect(newDerailment(announced, derailed)).toBeNull()
    // Back on the track, then off again
    expect(newDerailment(announced, onTrack)).toBeNull()
    expect(newDerailment(announced, derailed)).not.toBeNull()
    // Nothing driven, legacy locomotive, state without limits
    expect(newDerailment(announced, null)).toBeNull()
    expect(newDerailment(announced, { ...derailed, trainId: null })).toBeNull()
    expect(newDerailment(announced, { ...baseState, trainId: 't_9' })).toBeNull()
  })
})

describe('signals', () => {
  const signal = (patch: Partial<ConsoleSignal> = {}): ConsoleSignal => ({
    distance: 850,
    color: 'green',
    indication: null,
    plate: null,
    lit: true,
    label: 'Voie libre',
    ...patch,
  })
  const signals = (patch: Partial<ConsoleSignals> = {}): ConsoleSignals => ({
    level: 'standard',
    next: signal(),
    closedDistance: null,
    brakeAlert: false,
    waiting: false,
    onSight: false,
    onSightSpeed: 30,
    passed: null,
    cab: null,
    ...patch,
  })
  const pro = (patch: Partial<ConsoleSignal>): ConsoleSignal => signal({ plate: 'F', indication: 'voie-libre', ...patch })
  const withSignals = (patch: Partial<ConsoleSignals> = {}, state: Partial<ConsoleState> = {}): ConsoleState => ({
    ...baseState,
    guidance: { speedLimit: 320, nextLimit: null, curve: 'ok', derailed: null },
    ...state,
    signals: signals(patch),
  })

  it('shows nothing at all on a network without signal: every other field of the view is what it was', () => {
    const plain = consoleView({ ...baseState, guidance: { speedLimit: 160, nextLimit: null, curve: 'ok', derailed: null } }, fleet)
    expect(plain.signals).toBeNull()
    // With signals, only `signals` is added: the rest of the view does not change
    const signalled = consoleView(withSignals({}, { guidance: { speedLimit: 160, nextLimit: null, curve: 'ok', derailed: null } }), fleet)
    expect({ ...signalled, signals: null }).toEqual(plain)
    expect(signalled.signals).not.toBeNull()
  })

  it('shows the next signal of the standard level as one lamp of its colour, with its distance', () => {
    const view = signalsView(signals())
    expect(view).toEqual({
      next: { kind: 'light', lamps: [{ color: 'green', on: true }], plate: null, label: 'Voie libre', color: 'green', distance: '850 m' },
      cab: null,
      title: 'Prochain signal',
      empty: 'Aucun signal en vue',
      notes: [],
      brakeAlert: false,
    })
    expect(signalsView(signals({ next: signal({ color: 'yellow', label: 'Attention' }) })).next).toMatchObject({
      lamps: [{ color: 'yellow', on: true }],
      label: 'Attention',
    })
    expect(signalsView(signals({ next: signal({ color: 'red', label: 'Arrêt' }) })).next).toMatchObject({
      lamps: [{ color: 'red', on: true }],
      color: 'red',
    })
  })

  it('writes the distance to the signal in metres, then in kilometres, like the other distances', () => {
    const distance = (metres: number) => signalsView(signals({ next: signal({ distance: metres }) })).next!.distance
    expect(distance(0)).toBe('0 m')
    expect(distance(849.6)).toBe('850 m')
    expect(distance(1000)).toBe('1,0 km')
    expect(distance(2440)).toBe('2,4 km')
  })

  it('says so when no signal is in sight', () => {
    const view = signalsView(signals({ next: null }))
    expect(view.next).toBeNull()
    expect(view.empty).toBe('Aucun signal en vue')
    expect(view.notes).toEqual([])
  })

  it('tells the first closed signal when it is not the next one', () => {
    const view = signalsView(signals({ next: signal({ color: 'yellow', label: 'Attention' }), closedDistance: 2440 }))
    expect(view.notes).toEqual([{ tone: 'info', text: 'Signal fermé à 2,4 km' }])
    expect(view.brakeAlert).toBe(false)
  })

  it('raises the brake alert first, with the distance to the closed signal', () => {
    // The next signal is the closed one
    const near = signalsView(signals({ next: signal({ color: 'red', label: 'Arrêt', distance: 640 }), brakeAlert: true }))
    expect(near.brakeAlert).toBe(true)
    expect(near.notes[0]).toEqual({ tone: 'alert', text: 'Freinez : signal fermé à 640 m' })
    // The closed signal is further than the next one: its own distance, written once
    const far = signalsView(signals({ next: signal({ color: 'yellow' }), closedDistance: 1800, brakeAlert: true }))
    expect(far.notes).toEqual([{ tone: 'alert', text: 'Freinez : signal fermé à 1,8 km' }])
  })

  it('tells a train waiting for its route before a closed path signal', () => {
    const view = signalsView(signals({ next: signal({ color: 'red', label: 'Arrêt', distance: 40 }), waiting: true }))
    expect(view.notes).toEqual([{ tone: 'warning', text: 'Attente de l’itinéraire' }])
  })

  it('orders the notes, the most pressing first', () => {
    const view = signalsView(signals({ brakeAlert: true, closedDistance: 900, passed: { braked: true }, onSight: true, waiting: true }))
    expect(view.notes.map((note) => note.text)).toEqual([
      'Freinez : signal fermé à 900 m',
      'Signal fermé franchi : freinage d’urgence',
      'Marche à vue — 30 km/h',
      'Attente de l’itinéraire',
    ])
  })

  describe('pro level', () => {
    it('lights the lamps of the target for each indication', () => {
      const lit = (plate: 'F' | 'Nf', indication: ConsoleSignal['indication']) =>
        targetLamps(plate, indication).map((lamp) => (lamp.on ? lamp.color.toUpperCase() : lamp.color))
      // Block signal: green, red, yellow from top to bottom
      expect(lit('F', 'voie-libre')).toEqual(['GREEN', 'red', 'yellow'])
      expect(lit('F', 'avertissement')).toEqual(['green', 'red', 'YELLOW'])
      expect(lit('F', 'semaphore')).toEqual(['green', 'RED', 'yellow'])
      // Path signal: a second red on top, both lit for the carré
      expect(lit('Nf', 'voie-libre')).toEqual(['red', 'GREEN', 'red', 'yellow'])
      expect(lit('Nf', 'avertissement')).toEqual(['red', 'green', 'red', 'YELLOW'])
      expect(lit('Nf', 'carre')).toEqual(['RED', 'green', 'RED', 'yellow'])
      // A sémaphore shown on a target with two reds is the lower one alone
      expect(lit('Nf', 'semaphore')).toEqual(['red', 'green', 'RED', 'yellow'])
    })

    it('shows the next signal as a target seen from the front, with its plate and the name of the indication', () => {
      expect(signalHeadView(pro({ color: 'yellow', indication: 'avertissement', label: 'Avertissement', distance: 1500 }))).toEqual({
        kind: 'target',
        lamps: [{ color: 'green', on: false }, { color: 'red', on: false }, { color: 'yellow', on: true }],
        plate: 'F',
        label: 'Avertissement',
        color: 'yellow',
        distance: '1,5 km',
      })
      const names = (['voie-libre', 'avertissement', 'semaphore'] as const).map(
        (indication, i) => signalHeadView(pro({ indication, label: ['Voie libre', 'Avertissement', 'Sémaphore'][i] })).label,
      )
      expect(names).toEqual(['Voie libre', 'Avertissement', 'Sémaphore'])
      const carre = signalHeadView(pro({ color: 'red', plate: 'Nf', indication: 'carre', label: 'Carré' }))
      expect(carre).toMatchObject({ kind: 'target', plate: 'Nf', label: 'Carré' })
      expect(carre.lamps.filter((lamp) => lamp.on).map((lamp) => lamp.color)).toEqual(['red', 'red'])
    })

    it('shows a marker board without lamps as a marker, not as a target', () => {
      expect(signalHeadView(pro({ lit: false, plate: 'Nf', indication: 'carre', color: 'red', label: 'Carré' }))).toEqual({
        kind: 'marker',
        lamps: [],
        plate: 'Nf',
        label: 'Repère Nf',
        color: null,
        distance: '850 m',
      })
    })

    it('tells the running on sight; its 30 km/h is the limit in force the domain gives', () => {
      // The domain counts the running on sight in the speed limit of the train (`signalSpeedCap`):
      // the console shows the limit of the guidance as it stands
      const onSight = { guidance: { speedLimit: 30, nextLimit: null, curve: 'ok' as const, derailed: null } }
      const state = withSignals({ level: 'pro', next: pro({}), onSight: true }, onSight)
      const view = consoleView({ ...state, speed: 25 / 3.6 }, fleet)
      expect(view.signals!.notes).toEqual([{ tone: 'warning', text: 'Marche à vue — 30 km/h' }])
      expect(view.limit).toEqual({ kmh: 30, ratio: 30 / 320, label: '30' })
      // The colour of the speed follows that limit: orange from 20, red above 30
      expect(view.speedTone).toBe('near')
      expect(consoleView({ ...state, speed: 15 / 3.6 }, fleet).speedTone).toBe('normal')
      expect(consoleView({ ...state, speed: 31 / 3.6 }, fleet).speedTone).toBe('over')
      // Not on sight: the limit of the track
      const free = consoleView({ ...withSignals({ level: 'pro', next: pro({}) }), speed: 31 / 3.6 }, fleet)
      expect(free.limit!.kmh).toBe(320)
      expect(free.speedTone).toBe('normal')
    })

    it('adds nothing of its own to the limit: the flag alone does not lower it', () => {
      // No second computation on the display side: what the domain says is what is shown
      expect(consoleView(withSignals({ onSight: true }), fleet).limit!.kmh).toBe(320)
      const state = withSignals({ onSight: true }, { guidance: { speedLimit: 20, nextLimit: null, curve: 'ok', derailed: null } })
      expect(consoleView(state, fleet).limit!.kmh).toBe(20)
    })

    it('draws the announcement and the reminder of a diverging route as two yellow lamps apart, flashing for 60', () => {
      const announce = signalHeadView(pro({ indication: 'ralentissement', color: 'yellow', label: 'Ralentissement 30', slowdown: 30 }))
      expect(announce.slow).toEqual({ kind: 'slowdown', flashing: false })
      // None of the lamps of the column is lit for it
      expect(announce.lamps.every((lamp) => !lamp.on)).toBe(true)
      expect(announce.label).toBe('Ralentissement 30')
      const reminder = signalHeadView(pro({ plate: 'Nf', indication: 'rappel', color: 'yellow', label: 'Rappel 60', reminder: 60 }))
      expect(reminder.slow).toEqual({ kind: 'reminder', flashing: true })
      expect(reminder.lamps.every((lamp) => !lamp.on)).toBe(true)
      // With the avertissement the yellow of the column is lit too
      const both = signalHeadView(pro({ plate: 'Nf', indication: 'avertissement', color: 'yellow', label: 'Avertissement · rappel 30', reminder: 30 }))
      expect(both.slow).toEqual({ kind: 'reminder', flashing: false })
      expect(both.lamps.filter((lamp) => lamp.on).map((lamp) => lamp.color)).toEqual(['yellow'])
      // A signal that shows neither is drawn as it always was
      expect('slow' in signalHeadView(pro({}))).toBe(false)
    })

    it('tells an overspeed caught by the cab, with or without the emergency brake', () => {
      expect(signalsView(signals({ overspeed: { braked: true } })).notes).toEqual([{ tone: 'alert', text: 'Survitesse : freinage d’urgence' }])
      expect(signalsView(signals({ overspeed: { braked: false } })).notes).toEqual([{ tone: 'alert', text: 'Survitesse' }])
    })
  })

  describe('cab display', () => {
    const cab = (kind: 'line' | 'execute' | 'announce' | 'stop' | 'sight', speed: number, flashing = false, markerDistance: number | null = 1200) =>
      ({ kind, speed, flashing, markerDistance })

    it('writes three figures in the colours of what they ask', () => {
      expect(cabView(cab('line', 300))).toEqual({ tone: 'line', figures: '300', flashing: false, label: 'Voie libre', distance: '1,2 km' })
      expect(cabView(cab('line', 300, true))).toMatchObject({ tone: 'line', flashing: true, label: 'Voie libre, annonce à suivre' })
      expect(cabView(cab('announce', 270))).toMatchObject({ tone: 'announce', figures: '270', label: 'Annonce 270' })
      expect(cabView(cab('execute', 160))).toMatchObject({ tone: 'execute', figures: '160', label: 'Exécution 160' })
      expect(cabView(cab('stop', 0))).toMatchObject({ tone: 'stop', figures: '000', label: 'Arrêt au repère' })
      expect(cabView(cab('sight', 30))).toMatchObject({ tone: 'sight', figures: '30', label: 'Marche à vue' })
      expect(cabView(cab('line', 300, false, null)).distance).toBe('—')
    })

    it('takes the place of the next signal when the cab stands for the lineside signals', () => {
      const view = signalsView(signals({ level: 'pro', next: pro({ lit: false }), cab: cab('announce', 220) }))
      expect(view.next).toBeNull()
      expect(view.cab).toMatchObject({ tone: 'announce', figures: '220' })
      expect(view.title).toBe('Vitesse en cabine')
      // Without cab display the marker is shown like any next signal
      expect(signalsView(signals({ level: 'pro', next: pro({ lit: false }) })).next).toMatchObject({ kind: 'marker' })
    })

    it('colours the speed like a lower limit ahead while it announces a speed or a stop', () => {
      const tone = (kmh: number, display: ReturnType<typeof cab> | null) =>
        consoleView({ ...withSignals({ level: 'pro', cab: display }), speed: kmh / 3.6 }, fleet).speedTone
      expect(tone(290, null)).toBe('normal')
      expect(tone(290, cab('line', 300, true))).toBe('normal')
      expect(tone(290, cab('announce', 270))).toBe('ahead')
      expect(tone(260, cab('announce', 270))).toBe('normal')
      expect(tone(60, cab('stop', 0))).toBe('ahead')
      expect(tone(0, cab('stop', 0))).toBe('normal')
      // An execution is the limit in force already: nothing more ahead
      expect(tone(150, cab('execute', 160))).toBe('normal')
    })
  })

  it('announces a closed signal passed once, in the words of the PC, and again only for another passing', () => {
    expect(signalPassedLabel(true)).toBe(signalPassedMessage(true))
    expect(signalPassedLabel(false)).toBe(signalPassedMessage(false))

    const announced = new Set<string>()
    const clean = withSignals()
    const passed = withSignals({ passed: { braked: true } })
    expect(newSignalPassed(announced, clean)).toBeNull()
    expect(newSignalPassed(announced, passed)).toBe('Signal fermé franchi : freinage d’urgence')
    expect(newSignalPassed(announced, passed)).toBeNull()
    expect(newSignalPassed(announced, passed)).toBeNull()
    // Another train: its own message
    expect(newSignalPassed(announced, { ...passed, trainId: 't_2' })).not.toBeNull()
    // The trace is gone (next signal passed properly), then another closed signal is passed
    expect(newSignalPassed(announced, clean)).toBeNull()
    expect(newSignalPassed(announced, withSignals({ passed: { braked: false } }))).toBe('Signal fermé franchi')
    // Nothing driven, legacy locomotive, network without signal
    expect(newSignalPassed(announced, null)).toBeNull()
    expect(newSignalPassed(announced, { ...passed, trainId: null })).toBeNull()
    expect(newSignalPassed(announced, { ...baseState, trainId: 't_9' })).toBeNull()
  })
})
