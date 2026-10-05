import type {
  ConsoleCommand,
  ConsoleState,
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

/** Levers under the thumbs when the phone is held upright, the band when it lies on its side */
export function deskOrientation(width: number, height: number): DeskOrientation {
  return width > height ? 'landscape' : 'portrait'
}

export interface StageDesign {
  /** Width the layout is drawn for, CSS pixels at scale 1 */
  width: number
  /** Height under which the layout no longer fits at scale 1 */
  minHeight: number
  /** A tablet does not need instruments three times their size */
  maxScale: number
}

/** The band of the PC with its margins (`BAND` and `CONSOLE_MARGIN` in `consoleLayout.ts`), without its row of tools */
export const BAND_DESIGN: StageDesign = { width: 984, minHeight: 200, maxScale: 1.6 }
export const PORTRAIT_DESIGN: StageDesign = { width: 390, minHeight: 540, maxScale: 1.8 }

/** Height the signalling block adds to a desk, its gap included (`.console-signals`) */
export const SIGNALS_HEIGHT = 62

/**
 * The design a desk is laid out for: the band on its side, the levers upright, both taller on a
 * network that has signals — the signalling block then sits in the flow, above the band or under
 * the speed.
 */
export function deskDesign(orientation: DeskOrientation, state: Pick<ConsoleState, 'signals'>): StageDesign {
  const design = orientation === 'landscape' ? BAND_DESIGN : PORTRAIT_DESIGN
  return state.signals ? { ...design, minHeight: design.minHeight + SIGNALS_HEIGHT } : design
}

export interface StageFit {
  scale: number
  /** Size of the stage before it is scaled: scaled, it covers the box exactly */
  width: number
  height: number
}

/** Scale at which a layout fills a box of `width` × `height`, and the size it is laid out at */
export function fitStage(width: number, height: number, design: StageDesign): StageFit {
  const fit = Math.min(width / design.width, height / design.minHeight, design.maxScale)
  const scale = Number.isFinite(fit) && fit > 0 ? fit : 1
  return { scale, width: width / scale, height: height / scale }
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
