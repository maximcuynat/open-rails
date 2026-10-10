import type {
  ConsoleCommand,
  ConsoleState,
  ConsoleTrainAhead,
  ConsoleTurnout,
  FleetEntry,
} from '@application/console/consoleContract'
import type { RemoteDeskSnapshot } from '@application/remote/remoteDesk'
import { stoppingDistanceLabel } from '@presentation/components/console/consoleModel'

/**
 * What the phone page shows, worked out from the snapshot of the link. Pure: the components only
 * render it, the tests read it directly.
 */

/** What the page remembers of the link beyond its current snapshot */
export interface DeskSession {
  /** The desk sat in the room at least once: a cut is then a reconnection, not a first connection */
  everJoined: boolean
  /** Last console state received while seated; kept through a cut so the desk stays on screen */
  lastState: ConsoleState | null
}

export const NEW_SESSION: DeskSession = { everJoined: false, lastState: null }

/** The session after a new snapshot. While the link is cut the snapshot carries nothing: keep what was shown. */
export function nextSession(session: DeskSession, snapshot: RemoteDeskSnapshot): DeskSession {
  if (!snapshot.joined) return session
  if (session.everJoined && session.lastState === snapshot.state) return session
  return { everJoined: true, lastState: snapshot.state }
}

export type DeskScreen =
  /** No usable code, or the relay does not know it: ask for one */
  | { kind: 'enter-code'; reason: 'missing' | 'unknown-room' }
  | { kind: 'connecting' }
  | { kind: 'ended'; reason: 'room-full' | 'host-closed' | 'version' | 'error' }
  /** The list of trains; `online` false while the link is being re-established */
  | { kind: 'fleet'; online: boolean }
  | { kind: 'desk'; state: ConsoleState; online: boolean }

/** A state with nothing held: what a desk shows while its link is cut */
export function idleState(state: ConsoleState): ConsoleState {
  if (!state.brake || state.brake.command === 'hold') return state
  return { ...state, brake: { ...state.brake, command: 'hold' } }
}

/**
 * Which screen the page is on. `browsing`: the driver asked for the list of trains while the PC
 * still drives one.
 */
export function deskScreen(
  room: string | null,
  snapshot: RemoteDeskSnapshot,
  session: DeskSession,
  browsing: boolean,
): DeskScreen {
  if (room === null) return { kind: 'enter-code', reason: 'missing' }
  switch (snapshot.ended) {
    case null:
      break
    case 'unknown-room':
      return { kind: 'enter-code', reason: 'unknown-room' }
    case 'room-full':
    case 'host-closed':
    case 'version':
      return { kind: 'ended', reason: snapshot.ended }
    default:
      return { kind: 'ended', reason: 'error' }
  }
  if (snapshot.joined) {
    return snapshot.state && !browsing
      ? { kind: 'desk', state: snapshot.state, online: true }
      : { kind: 'fleet', online: true }
  }
  if (!session.everJoined) return { kind: 'connecting' }
  return session.lastState && !browsing
    ? { kind: 'desk', state: idleState(session.lastState), online: false }
    : { kind: 'fleet', online: false }
}

export type DeskOrientation = 'portrait' | 'landscape'

/** Two pads side by side when the phone is held upright, one at each edge when it lies on its side */
export function deskOrientation(width: number, height: number): DeskOrientation {
  return width > height ? 'landscape' : 'portrait'
}

/** Vibration (ms, or a pattern) that answers a command under the finger; null for none */
export function hapticFor(command: ConsoleCommand): number | number[] | null {
  switch (command.type) {
    case 'notchSet':
    case 'notchStep':
    case 'reverser':
    case 'steer':
    case 'switchCab':
      return 12
    case 'brake':
      // Coming back to the centre is the spring, not a notch
      return command.command === 'hold' ? null : 12
    case 'emergencyBrake':
      return [70, 40, 70]
    default:
      return null
  }
}

const plural = (count: number, word: string): string => `${count} ${word}${count > 1 ? 's' : ''}`

/** « 2 motrices · 8 voitures » */
export function compositionLabel(locoCount: number, wagonCount: number): string {
  const parts: string[] = []
  if (locoCount > 0) parts.push(plural(locoCount, 'motrice'))
  if (wagonCount > 0) parts.push(plural(wagonCount, 'voiture'))
  return parts.length > 0 ? parts.join(' · ') : 'vide'
}

export function fleetSpeedLabel(entry: Pick<FleetEntry, 'speed'>): string {
  const kmh = Math.round(Math.abs(entry.speed) * 3.6)
  return kmh === 0 ? 'À l’arrêt' : `${kmh} km/h`
}

export interface FleetChoice {
  /** What the row says under the speed */
  label: string
  /** This desk holds the train */
  mine: boolean
  /** Another desk holds it: it cannot be picked */
  taken: boolean
}

/**
 * What a train of the list is to this desk: its own, free to take (the PC lets go of the one it
 * drives when a desk takes it), or held by another desk. A PC of an older version does not say
 * who drives: its one driven train is this desk's.
 */
export function fleetChoice(entry: Pick<FleetEntry, 'id' | 'driven' | 'driver' | 'driverName'>, desk: number | null, pending: string | null): FleetChoice {
  if (pending === entry.id) return { label: 'Prise des commandes…', mine: false, taken: false }
  if (entry.driver === undefined) return { label: entry.driven ? 'Aux commandes' : 'Conduire', mine: entry.driven, taken: false }
  if (entry.driver === null) return { label: 'Conduire', mine: false, taken: false }
  if (entry.driver === 'host') return { label: 'Conduit par le PC · prendre', mine: false, taken: false }
  if (entry.driver === desk) return { label: 'Aux commandes', mine: true, taken: false }
  return { label: `Pris par ${entry.driverName ?? `Pupitre ${entry.driver}`}`, mine: false, taken: true }
}

/**
 * Where the train ahead is `elapsed` seconds after the PC said so: both trains are taken to have
 * kept their speed. What the desk shows between two states, and while one is late or lost.
 */
export function extrapolateAhead(ahead: ConsoleTrainAhead, ownSpeed: number, elapsed: number): number {
  return ahead.distance - (ownSpeed - ahead.speed) * Math.max(0, elapsed)
}

/** « 1,2 km · 240 km/h · Léa » — the train ahead as the desk writes it */
export function aheadLabel(distance: number, ahead: Pick<ConsoleTrainAhead, 'speed' | 'driver'>): string {
  const d = Math.max(0, distance)
  const where = d >= 1000 ? `${(d / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : `${Math.round(d / 10) * 10} m`
  const kmh = Math.round(Math.abs(ahead.speed) * 3.6)
  const how = kmh === 0 ? 'à l’arrêt' : ahead.speed < 0 ? `${kmh} km/h, vient vers vous` : `${kmh} km/h`
  return [where, how, ahead.driver].filter(Boolean).join(' · ')
}

/** The key the name of the driver is kept under on the phone */
export const DRIVER_NAME_KEY = 'open-rail:driver-name'

/** A name as it is sent: trimmed, at most `max` characters, null when empty */
export function cleanDriverName(raw: string | null | undefined, max: number): string | null {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim()
  return name === '' ? null : name
}

/** « Train 2/3 · TGV Duplex », or what is known of it */
export function trainTitle(state: ConsoleState, fleet: readonly FleetEntry[]): string {
  const entry = state.trainId === null ? undefined : fleet.find((f) => f.id === state.trainId)
  if (!entry) return state.trainId === null ? 'Locomotive' : 'Train'
  const rank = fleet.length > 1 ? `Train ${entry.rank}/${fleet.length}` : `Train ${entry.rank}`
  return entry.model ? `${rank} · ${entry.model}` : rank
}

export interface TurnoutView {
  label: string
  /** Side the open route leaves on, when the PC could tell */
  side: 'left' | 'right' | null
  /** The two buttons can be used */
  enabled: boolean
}

/**
 * The next turnout as the desk writes it. `undefined` is a PC that does not say (older version):
 * the buttons stay usable, blind.
 */
export function turnoutView(turnout: ConsoleTurnout | null | undefined): TurnoutView {
  if (turnout === undefined) return { label: 'Aiguillage suivant', side: null, enabled: true }
  if (turnout === null) return { label: 'Aucun aiguillage en vue', side: null, enabled: false }
  const distance = stoppingDistanceLabel(Math.max(0, turnout.distance))
  if (turnout.locked) return { label: `Aiguillage à ${distance} · occupé`, side: turnout.side, enabled: false }
  // The side is told by the button that is lit
  return { label: `Aiguillage à ${distance}`, side: turnout.side, enabled: true }
}
