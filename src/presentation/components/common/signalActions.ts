import { SIGNAL_ROW_NO_PATH, SIGNAL_ROW_SPACINGS, type EditorStore, type SignalToolResult } from '@application/state/editorStore'
import { SIGNAL_REFUSAL_TEXT, type SignalRefusal, type SignallingLevel } from '@domain/models/signals'
import type { Signal, SignalRole } from '@domain/models/types'
import { formatDistance } from '@domain/models/units'
import { showToast } from './Toast'

/**
 * The signal actions of the signalling mode as the interface runs them: the store call plus the
 * message it owes the user. Shared by the canvas, the contextual bar, the inspector and the
 * keyboard, so they all say the same thing. Also the names of the signals at each level.
 */

/** Feedback shown when signals are edited while driving */
export const SIGNAL_DRIVING_REFUSED = 'Les signaux ne se modifient pas pendant la conduite'

export function signalRefusalMessage(reason: SignalRefusal | 'driving' | 'no-path'): string {
  if (reason === 'driving') return SIGNAL_DRIVING_REFUSED
  if (reason === 'no-path') return SIGNAL_ROW_NO_PATH
  return SIGNAL_REFUSAL_TEXT[reason]
}

/** Short reason written next to a struck-through preview */
export const SIGNAL_REFUSAL_SHORT: Record<SignalRefusal, string> = {
  'off-track': 'Hors voie',
  'on-switch': 'Trop près d’un aiguillage',
  duplicate: 'Signal déjà présent',
}

/** Name of each role at each level: the same stored signal reads both ways */
const ROLE_NAMES: Record<SignallingLevel, Record<SignalRole, string>> = {
  standard: { spacing: 'Signal de block', protection: 'Signal de trajectoire' },
  pro: { spacing: 'Sémaphore', protection: 'Carré' },
}

export function signalRoleLabel(role: SignalRole, level: SignallingLevel): string {
  return ROLE_NAMES[level === 'pro' ? 'pro' : 'standard'][role]
}

/** « Signal de block », « Carré », « Repère de LGV (Nf) »… */
export function signalTypeLabel(signal: Pick<Signal, 'role' | 'cabMarker'>, level: SignallingLevel): string {
  if (level === 'pro' && signal.cabMarker) return `Repère de LGV (${signal.role === 'spacing' ? 'F' : 'Nf'})`
  return signalRoleLabel(signal.role, level)
}

/**
 * Tooltip of the « Sens unique » option of a signal, by role: what it does on a path signal, why it
 * is greyed out on a block signal. The same at both levels.
 */
export const SIGNAL_ONE_WAY_TITLE: Record<SignalRole, string> = {
  protection: 'Sens unique : une rame qui aborde ce signal par l’arrière ne peut pas le franchir (arrêt, comme devant un signal fermé)',
  spacing: 'Sens unique : réservé aux signaux de trajectoire (carrés). Changez d’abord le type du signal',
}

export const otherSignalRole = (role: SignalRole): SignalRole => (role === 'spacing' ? 'protection' : 'spacing')

/** The spacings a row of signals can take, in the length unit of the project */
export function signalRowSpacingChoices(store: EditorStore): { value: number; label: string }[] {
  const scale = store.signalToolSpacing > 0 ? store.signalRowSpacing / store.signalToolSpacing : 1
  return SIGNAL_ROW_SPACINGS.map((value) => ({ value, label: formatDistance(value * scale, store.unit) }))
}

/** Tell the user what a gesture of a signal tool did when it did not all go through. */
export function reportSignalToolResult(result: SignalToolResult | null): void {
  if (!result) return
  if (!result.ok) showToast(signalRefusalMessage(result.reason), 'warning')
  else if (result.refused > 0) {
    showToast(
      `${result.refused} emplacement${result.refused > 1 ? 's' : ''} sauté${result.refused > 1 ? 's' : ''} : trop près d’un aiguillage ou d’un signal déjà posé`,
      'warning',
      4500,
    )
  }
}

/** The button of a signal tool comes up: lay the signal, or the row. */
export function commitSignalGesture(store: EditorStore): void {
  reportSignalToolResult(store.commitSignalGesture())
}

/** Turn a signal round. */
export function flipSignal(store: EditorStore, id: string): void {
  const refusal = store.flipSignalDirection(id)
  if (refusal) showToast(signalRefusalMessage(refusal), 'warning')
}

export function flipSelectedSignal(store: EditorStore): void {
  const signal = store.selectedSignal
  if (signal) flipSignal(store, signal.id)
}
