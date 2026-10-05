import type { ConsoleBrakeTone, ConsoleGuidance, ConsoleState, ConsoleTurnout, FleetEntry } from '@application/console/consoleContract'
import {
  BRAKE_CYLINDER_MAX_BAR,
  BRAKE_PIPE_FIRST_REDUCTION,
  BRAKE_PIPE_FULL_SERVICE,
  BRAKE_PIPE_RELEASED,
} from '@domain/models/trainDynamics'

/**
 * What the driving consoles write and graduate, worked out from a `ConsoleState`.
 * Pure description: the React components only render it, the tests read it directly.
 */

/** Handle position: B5 … B1 (electric brake), N, P1 … P5 (traction) */
export function notchLabel(notch: number): string {
  return notch > 0 ? `P${notch}` : notch < 0 ? `B${-notch}` : 'N'
}

/** A number with a French decimal comma */
export function decimal(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits))
  // No "-0,0"
  return (rounded === 0 ? 0 : rounded).toFixed(digits).replace('.', ',')
}

/** Share of an effort applied, as a whole percentage */
export function effortPercent(effort: number): number {
  return Math.round(Math.max(0, Math.min(1, effort)) * 100)
}

/** Signed acceleration without its unit: "+0,32", "−1,10", "0,00" */
export function accelerationValue(acceleration: number): string {
  const text = decimal(Math.abs(acceleration), 2)
  const sign = text === '0,00' ? '' : acceleration > 0 ? '+' : '−'
  return `${sign}${text}`
}

/** Signed acceleration: "+0,32 m/s²" */
export function accelerationLabel(acceleration: number): string {
  return `${accelerationValue(acceleration)} m/s²`
}

/** Slope (‰) under which the track is called level */
const LEVEL_GRADIENT = 0.5

/** Slope under the train: "+4,3 ‰" uphill in the direction of motion, "−35 ‰" downhill, "palier" */
export function gradientLabel(gradientPermille: number): string {
  const size = Math.abs(gradientPermille)
  if (!(size >= LEVEL_GRADIENT)) return 'palier'
  return `${gradientPermille > 0 ? '+' : '−'}${decimal(size, size < 10 ? 1 : 0)} ‰`
}

/**
 * Stopping distance. Always in metres or kilometres, whatever the display unit of the project:
 * trains keep their real dimensions at every scale, and « 3300000 mm » says nothing.
 * `null` (the brake cannot hold the train) reads ∞.
 */
export function stoppingDistanceLabel(metres: number | null): string {
  if (metres === null || !Number.isFinite(metres)) return '∞'
  if (metres >= 1000) return `${decimal(metres / 1000, 1)} km`
  return `${Math.round(metres)} m`
}

const DIAL_STEPS = [5, 10, 20, 25, 40, 50, 80, 100, 200, 250, 500]

/** Round step (km/h) that cuts a dial up to `maxKmh` into at most `maxIntervals` parts */
export function speedDialStep(maxKmh: number, maxIntervals = 5): number {
  return DIAL_STEPS.find((s) => maxKmh / s <= maxIntervals) ?? maxKmh
}

/** Graduations (km/h) of a speed dial: round values from 0 up to the top speed, which is always marked */
export function speedDialTicks(maxKmh: number, maxIntervals = 5): number[] {
  if (!(maxKmh > 0)) return [0]
  const step = speedDialStep(maxKmh, maxIntervals)
  const ticks: number[] = []
  for (let v = 0; v < maxKmh - step / 2; v += step) ticks.push(v)
  ticks.push(maxKmh)
  return ticks
}

/** Unlabelled graduations every `step` km/h, the top speed left out */
export function speedMinorTicks(maxKmh: number, step: number): number[] {
  const ticks: number[] = []
  if (!(maxKmh > 0) || !(step > 0)) return ticks
  for (let v = 0; v < maxKmh; v += step) ticks.push(v)
  return ticks
}

export interface GaugeSpec {
  /** Full scale, bar */
  max: number
  /** Pressures marked on the dial, bar */
  marks: number[]
}

/** Brake pipe: released at 5 bar, first reduction at 4.5, full service at 3.5 */
export const BRAKE_PIPE_GAUGE: GaugeSpec = {
  max: BRAKE_PIPE_RELEASED,
  marks: [BRAKE_PIPE_FULL_SERVICE, BRAKE_PIPE_FIRST_REDUCTION, BRAKE_PIPE_RELEASED],
}

/** Brake cylinders: empty when released, 3.8 bar when full */
export const BRAKE_CYLINDER_GAUGE: GaugeSpec = {
  max: BRAKE_CYLINDER_MAX_BAR,
  marks: [0, BRAKE_CYLINDER_MAX_BAR],
}

/** Position of a pressure on its gauge, 0 … 1 */
export function gaugeRatio(value: number, spec: GaugeSpec): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value / spec.max))
}

/** Longest stopping distance the distance bar shows, m */
export const DISTANCE_BAR_MAX = 4000
export const DISTANCE_BAR_MARKS = [0, 500, 1000, 2000, 4000]

/** Height of a distance on the distance bar, 0 … 1: a square-root scale, so short distances stay readable */
export function distanceRatio(metres: number | null): number {
  if (metres === null || !Number.isFinite(metres)) return 1
  return Math.sqrt(Math.max(0, Math.min(metres, DISTANCE_BAR_MAX)) / DISTANCE_BAR_MAX)
}

export const BRAKE_TONE_LABEL: Record<ConsoleBrakeTone, string> = {
  released: 'Desserré',
  releasing: 'Desserrage…',
  applying: 'Serrage…',
  applied: 'Serré',
  emergency: 'Urgence',
}

const LEGACY_THROTTLE_LABEL: Record<number, string> = { [-1]: 'Frein', 0: 'Inertie', 1: 'Accél.' }

export type HandleSide = 'traction' | 'neutral' | 'brake'

export interface NotchStop {
  notch: number
  label: string
  side: HandleSide
  /** The handle stands on this stop */
  current: boolean
  /** Between neutral and the handle: lit along with it */
  passed: boolean
}

const sideOf = (notch: number): HandleSide => (notch > 0 ? 'traction' : notch < 0 ? 'brake' : 'neutral')

/** Every stop of the handle, from the strongest brake to the strongest traction */
export function notchStops(state: Pick<ConsoleState, 'notch' | 'minNotch' | 'maxNotch' | 'legacyThrottle'>): NotchStop[] {
  const legacy = state.legacyThrottle !== undefined
  const stops: NotchStop[] = []
  for (let notch = state.minNotch; notch <= state.maxNotch; notch++) {
    stops.push({
      notch,
      label: legacy ? LEGACY_THROTTLE_LABEL[notch] ?? String(notch) : notchLabel(notch),
      side: sideOf(notch),
      current: notch === state.notch,
      passed: notch !== state.notch && (state.notch > 0 ? notch >= 0 && notch < state.notch : notch <= 0 && notch > state.notch),
    })
  }
  return stops
}

/** What the two steering buttons say of the turnout ahead */
export interface TurnoutView {
  /** Written between the buttons: the distance to the points, « occupé », or « — » when there is none */
  label: string
  /** The whole situation in one sentence, for the tooltips */
  hint: string
  /** Side the points are set to, when it can be told: that button is lit */
  side: 'left' | 'right' | null
  /** Nothing to throw: no turnout ahead, or a train stands on it */
  disabled: boolean
}

export function turnoutView(turnout: ConsoleTurnout | null): TurnoutView {
  if (!turnout) return { label: '—', hint: 'Aucun aiguillage devant le train', side: null, disabled: true }
  const distance = stoppingDistanceLabel(turnout.distance)
  if (turnout.locked) {
    return { label: 'occupé', hint: `Aiguillage à ${distance}, occupé par un train : manœuvre impossible`, side: turnout.side, disabled: true }
  }
  const open = turnout.side === 'left' ? ', voie ouverte à gauche' : turnout.side === 'right' ? ', voie ouverte à droite' : ''
  return { label: distance, hint: `Aiguillage à ${distance}${open}`, side: turnout.side, disabled: false }
}

// ─────────────────── Speed limits ───────────────────

/**
 * Colour of the speed (its arc and its figure), the gravest first:
 * - `over` (red): the limit in force is exceeded;
 * - `near` (orange): within 10 km/h under the limit in force, the limit included;
 * - `ahead` (yellow): a lower limit is announced ahead and the train still runs faster than it;
 * - `normal` (white): none of these.
 */
export type SpeedTone = 'normal' | 'ahead' | 'near' | 'over'

/** Margin (km/h) under the limit in force from which the speed turns orange */
export const SPEED_NEAR_MARGIN = 10

/**
 * Colour of the speed. Speeds in km/h as the console writes them (whole numbers): the colour
 * changes with the figure. `limit` and `next` are null when there is none.
 */
export function speedTone(kmh: number, limit: number | null, next: number | null): SpeedTone {
  if (limit !== null && kmh > limit) return 'over'
  // At rest nothing is close to being exceeded, however low the limit
  if (limit !== null && kmh > 0 && kmh >= limit - SPEED_NEAR_MARGIN) return 'near'
  if (next !== null && kmh > next) return 'ahead'
  return 'normal'
}

/** A speed limit on the speed scale */
export interface LimitMark {
  kmh: number
  /** Place on the scale of the dial, 0 … 1 */
  ratio: number
  /** « 160 » */
  label: string
}

/** The next lower limit: where it is on the dial and how far ahead it starts */
export interface NextLimitMark extends LimitMark {
  /** « 850 m », « 1,2 km » */
  distance: string
}

export type CurveTone = 'discomfort' | 'danger'

/** How the curve under the train is taken, when it is taken too fast */
export interface CurveView {
  tone: CurveTone
  /** « Courbe : inconfort » */
  label: string
  hint: string
}

const CURVE_VIEWS: Record<CurveTone, CurveView> = {
  discomfort: {
    tone: 'discomfort',
    label: 'Courbe : inconfort',
    hint: 'Courbe prise trop vite pour son dévers : ralentir',
  },
  danger: {
    tone: 'danger',
    label: 'Courbe : danger',
    hint: 'Courbe prise beaucoup trop vite : risque de déraillement, freiner',
  },
}

/** « Déraillement à 235 km/h (limite 160 km/h) » */
export function derailmentMessage(derailed: { speed: number; limit: number }): string {
  return `Déraillement à ${Math.round(derailed.speed)} km/h (limite ${Math.round(derailed.limit)} km/h)`
}

/**
 * The message owed for the derailment of the driven train, once: `announced` remembers the trains
 * it was given for, and forgets a train as soon as it is back on the track. Null when there is
 * nothing new to say.
 */
export function newDerailment(announced: Set<string>, state: ConsoleState | null): string | null {
  if (!state || state.trainId === null) return null
  const derailed = state.guidance?.derailed
  if (!derailed) {
    announced.delete(state.trainId)
    return null
  }
  if (announced.has(state.trainId)) return null
  announced.add(state.trainId)
  return derailmentMessage(derailed)
}

function limitMark(kmh: number, maxKmh: number): LimitMark {
  const rounded = Math.round(kmh)
  return { kmh: rounded, ratio: Math.max(0, Math.min(1, rounded / Math.max(maxKmh, 1))), label: String(rounded) }
}

/** What the consoles show of the speed limits, the curve and a derailment */
export interface GuidanceView {
  speedTone: SpeedTone
  /** Limit in force: the solid mark of the dial, the white-on-black board. Null when unknown */
  limit: LimitMark | null
  /** Next lower limit: the hollow mark of the dial, the black-on-white board */
  nextLimit: NextLimitMark | null
  curve: CurveView | null
  /** « Déraillement à 235 km/h (limite 160 km/h) » while the train is off the rails */
  derailment: string | null
}

export function guidanceView(kmh: number, maxKmh: number, guidance: ConsoleGuidance | undefined): GuidanceView {
  if (!guidance) return { speedTone: 'normal', limit: null, nextLimit: null, curve: null, derailment: null }
  const next = guidance.nextLimit
  return {
    speedTone: speedTone(kmh, guidance.speedLimit, next ? next.speed : null),
    limit: limitMark(guidance.speedLimit, maxKmh),
    nextLimit: next ? { ...limitMark(next.speed, maxKmh), distance: stoppingDistanceLabel(next.distance) } : null,
    curve: guidance.curve === 'ok' ? null : CURVE_VIEWS[guidance.curve],
    derailment: guidance.derailed ? derailmentMessage(guidance.derailed) : null,
  }
}

export interface ConsoleView extends GuidanceView {
  kmh: number
  maxKmh: number
  /** Speed on its scale, 0 … 1 */
  speedRatio: number
  legacy: boolean
  /** Which half of the handle is in use */
  handleSide: HandleSide
  /** « Traction » or « Frein élec. » */
  handleTitle: string
  /** « P3 · 62 % » */
  handleLabel: string
  /** Applied effort, 0 … 100 */
  handlePercent: number
  /** « 2M · 8V » */
  composition: string
  /** « TGV Duplex », when the train is in the fleet list */
  model: string | null
  /** Rank of the driven train and size of the fleet, when there is more than one train */
  rank: number | null
  fleetSize: number
  acceleration: string
  gradient: string
  stopping: string
  brakeLabel: string | null
  emergencyLabel: string
  /** Traction asked for with the reverser in neutral: nothing will move */
  reverserNeeded: boolean
  /** Stopped with the brake on: the driver has to release it to leave */
  releaseHint: boolean
  turnout: TurnoutView
}

/** Everything the three consoles write, from the state and the fleet list */
export function consoleView(state: ConsoleState, fleet: readonly FleetEntry[]): ConsoleView {
  const legacy = state.legacyThrottle !== undefined
  const entry = state.trainId === null ? undefined : fleet.find((f) => f.id === state.trainId)
  const handleSide = sideOf(state.notch)
  const handlePercent = effortPercent(state.handleEffort)
  const tone = state.brake?.tone
  const kmh = Math.round(state.speed * 3.6)
  const maxKmh = Math.round(state.maxSpeed * 3.6)
  return {
    ...guidanceView(kmh, maxKmh, state.guidance),
    kmh,
    maxKmh,
    speedRatio: Math.max(0, Math.min(1, state.speed / Math.max(state.maxSpeed, 1e-6))),
    legacy,
    handleSide,
    handleTitle: legacy ? 'Commande' : handleSide === 'brake' ? 'Frein élec.' : 'Traction',
    handleLabel: legacy ? LEGACY_THROTTLE_LABEL[state.notch] ?? '' : `${notchLabel(state.notch)} · ${handlePercent} %`,
    handlePercent,
    composition: `${state.locoCount}M · ${state.wagonCount}V`,
    model: entry?.model ?? null,
    rank: entry && fleet.length > 1 ? entry.rank : null,
    fleetSize: fleet.length,
    acceleration: accelerationValue(state.acceleration),
    gradient: gradientLabel(state.gradientPermille),
    stopping: stoppingDistanceLabel(state.stoppingDistance),
    brakeLabel: tone ? BRAKE_TONE_LABEL[tone] : null,
    emergencyLabel: !state.emergencyBrake ? 'Urgence' : state.emergencyReleasable ? 'Réarmer' : 'Urgence…',
    reverserNeeded: !legacy && state.notch > 0 && state.reverser === 'neutral',
    releaseHint: state.stopped && (tone === 'applied' || tone === 'applying'),
    turnout: turnoutView(state.upcomingTurnout),
  }
}

const COMPACT_KEYS: Record<string, string> = { 'Retour arrière': '⌫', Espace: 'Esp' }

/** A key name short enough for a key cap drawn on a control */
export function compactKeyLabel(label: string): string {
  return COMPACT_KEYS[label] ?? label
}
