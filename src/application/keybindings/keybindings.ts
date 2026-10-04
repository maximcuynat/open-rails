/**
 * Rebindable keyboard shortcuts: the action catalog, its default keys, and the pure helpers that
 * match a key press to an action. No DOM access here.
 */

/** The two keyboard contexts: driving a train (play mode) and editing the layout */
export type KeyContext = 'drive' | 'edit'

/**
 * One key assignment.
 * - `code`: a physical key position (`KeyboardEvent.code`), so driving keys sit under the same
 *   fingers on QWERTY and AZERTY. May require Shift.
 * - `key`: the character the key produces (`KeyboardEvent.key`, lower-cased), so mnemonic tool
 *   letters stay the printed letter on every layout.
 */
export type KeyChord = { code: string; shift?: boolean } | { key: string }

/** The part of a KeyboardEvent the matching needs */
export interface KeyInput {
  code: string
  key: string
  shiftKey: boolean
}

export type ActionGroup = 'drive' | 'tools'

interface ActionDef {
  id: string
  label: string
  group: ActionGroup
  contexts: readonly KeyContext[]
  /** What a newly captured key is stored as: its position or its character */
  by: 'code' | 'key'
  defaults: readonly [KeyChord | null, KeyChord | null]
}

const DRIVE: readonly KeyContext[] = ['drive']
const EDIT: readonly KeyContext[] = ['edit']
const BOTH: readonly KeyContext[] = ['drive', 'edit']

export const ACTIONS = [
  { id: 'drive.notchUp', label: 'Manipulateur : un cran vers la traction', group: 'drive', contexts: DRIVE, by: 'code', defaults: [{ code: 'KeyA' }, { code: 'ArrowUp' }] },
  { id: 'drive.notchDown', label: 'Manipulateur : un cran vers le frein', group: 'drive', contexts: DRIVE, by: 'code', defaults: [{ code: 'KeyD' }, { code: 'ArrowDown' }] },
  { id: 'drive.reverserForward', label: 'Inverseur vers l’avant', group: 'drive', contexts: DRIVE, by: 'code', defaults: [{ code: 'KeyW' }, { code: 'ArrowUp', shift: true }] },
  { id: 'drive.reverserBackward', label: 'Inverseur vers l’arrière', group: 'drive', contexts: DRIVE, by: 'code', defaults: [{ code: 'KeyS' }, { code: 'ArrowDown', shift: true }] },
  { id: 'drive.emergencyBrake', label: 'Freinage d’urgence', group: 'drive', contexts: DRIVE, by: 'code', defaults: [{ code: 'Backspace' }, null] },
  { id: 'drive.steerLeft', label: 'Aiguille suivante à gauche', group: 'drive', contexts: DRIVE, by: 'code', defaults: [{ code: 'ArrowLeft' }, null] },
  { id: 'drive.steerRight', label: 'Aiguille suivante à droite', group: 'drive', contexts: DRIVE, by: 'code', defaults: [{ code: 'ArrowRight' }, null] },
  { id: 'drive.exit', label: 'Quitter la conduite', group: 'drive', contexts: DRIVE, by: 'code', defaults: [{ code: 'Space' }, null] },
  { id: 'drive.flipLegacy', label: 'Inverser le sens (ancienne locomotive)', group: 'drive', contexts: DRIVE, by: 'code', defaults: [{ code: 'KeyR' }, null] },

  { id: 'tool.select', label: 'Outil Sélection', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 'v' }, null] },
  { id: 'tool.place', label: 'Outil Voie droite', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 'n' }, null] },
  { id: 'tool.curve', label: 'Outil Courbe', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 'c' }, null] },
  { id: 'tool.turnout', label: 'Outil Aiguillage', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 'p' }, null] },
  { id: 'tool.split', label: 'Outil Scinder', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 'k' }, null] },
  { id: 'tool.measure', label: 'Outil Mesure', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 'm' }, null] },
  { id: 'tool.pan', label: 'Outil Déplacer la vue', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 'h' }, null] },
  { id: 'tool.locomotive', label: 'Outil Train', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 'l' }, null] },
  { id: 'edit.toggleJunction', label: 'Basculer l’aiguillage', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 't' }, null] },
  { id: 'edit.parallelTrack', label: 'Créer une voie parallèle', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 'd' }, null] },
  { id: 'edit.paramDecrease', label: 'Profil de courbe / rayon d’aiguillage −', group: 'tools', contexts: EDIT, by: 'code', defaults: [{ code: 'BracketLeft' }, null] },
  { id: 'edit.paramIncrease', label: 'Profil de courbe / rayon d’aiguillage +', group: 'tools', contexts: EDIT, by: 'code', defaults: [{ code: 'BracketRight' }, null] },
  { id: 'view.toggleSnap', label: 'Aimantation', group: 'tools', contexts: EDIT, by: 'key', defaults: [{ key: 'g' }, null] },
  { id: 'view.fit', label: 'Cadrer la vue', group: 'tools', contexts: BOTH, by: 'key', defaults: [{ key: 'f' }, null] },
  { id: 'view.toggleInspector', label: 'Afficher / masquer l’inspecteur', group: 'tools', contexts: BOTH, by: 'key', defaults: [{ key: 'i' }, null] },
  { id: 'sim.togglePlay', label: 'Prendre / rendre les commandes', group: 'tools', contexts: BOTH, by: 'code', defaults: [{ code: 'F5' }, null] },
  { id: 'train.debug', label: 'Squelette debug des trains', group: 'tools', contexts: BOTH, by: 'code', defaults: [{ code: 'F3' }, null] },
] as const satisfies readonly ActionDef[]

export type ActionId = (typeof ACTIONS)[number]['id']

/** Two slots per action: primary and secondary */
export type KeySlots = [KeyChord | null, KeyChord | null]
export type Keybindings = Record<ActionId, KeySlots>

export const ACTION_GROUP_LABELS: Record<ActionGroup, string> = {
  drive: 'Conduite',
  tools: 'Outils et affichage',
}

const ACTION_BY_ID = new Map<string, ActionDef>(ACTIONS.map((a) => [a.id, a]))

export function actionLabel(id: ActionId): string {
  return ACTION_BY_ID.get(id)!.label
}

export function defaultKeybindings(): Keybindings {
  const out = {} as Keybindings
  for (const a of ACTIONS) out[a.id] = [a.defaults[0], a.defaults[1]]
  return out
}

function parseChord(raw: unknown): KeyChord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.code === 'string' && r.code) return r.shift === true ? { code: r.code, shift: true } : { code: r.code }
  if (typeof r.key === 'string' && r.key) return { key: r.key.toLowerCase() }
  return null
}

/** Saved bindings laid over the defaults: unknown actions are dropped, new actions keep their defaults */
export function mergeWithDefaults(saved: unknown): Keybindings {
  const out = defaultKeybindings()
  if (!saved || typeof saved !== 'object') return out
  for (const a of ACTIONS) {
    const slots = (saved as Record<string, unknown>)[a.id]
    if (Array.isArray(slots)) out[a.id] = [parseChord(slots[0]), parseChord(slots[1])]
  }
  return out
}

function chordMatches(chord: KeyChord, e: KeyInput, exactShift: boolean): boolean {
  if ('key' in chord) return chord.key === e.key.toLowerCase()
  if (chord.code !== e.code) return false
  return exactShift ? !!chord.shift === e.shiftKey : !chord.shift
}

function findBound(bindings: Keybindings, e: KeyInput, exactShift: boolean, accept: (a: ActionDef) => boolean): ActionId | null {
  for (const a of ACTIONS) {
    if (!accept(a)) continue
    for (const chord of bindings[a.id]) {
      if (chord && chordMatches(chord, e, exactShift)) return a.id
    }
  }
  return null
}

/**
 * The action bound to a key press in a context. A chord with the same Shift state wins; failing
 * that, a chord without Shift still fires while Shift is held.
 */
export function findAction(bindings: Keybindings, context: KeyContext, e: KeyInput): ActionId | null {
  const inContext = (a: ActionDef) => a.contexts.includes(context)
  return findBound(bindings, e, true, inContext) ?? (e.shiftKey ? findBound(bindings, e, false, inContext) : null)
}

/** Another action, live in a shared context, that the same key press already triggers */
export function findConflict(bindings: Keybindings, actionId: ActionId, e: KeyInput): ActionId | null {
  const contexts = ACTION_BY_ID.get(actionId)!.contexts
  return findBound(bindings, e, true, (a) => a.id !== actionId && a.contexts.some((c) => contexts.includes(c)))
}

const NEVER_BINDABLE = new Set([
  '', 'Escape', 'Tab', 'Enter', 'NumpadEnter', 'Delete', 'CapsLock', 'ContextMenu',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
])

/** Keys the editor keeps for itself: view panning, deletion, typed lengths, settings, reconcile */
const EDIT_RESERVED_CODES = new Set(['Space', 'Backspace'])
const EDIT_RESERVED_KEYS = /^[0-9.,r]$/

/** Whether a key may be assigned to an action (fixed shortcuts keep their keys) */
export function isBindable(actionId: ActionId, e: Pick<KeyInput, 'code' | 'key'>): boolean {
  if (NEVER_BINDABLE.has(e.code)) return false
  if (!ACTION_BY_ID.get(actionId)!.contexts.includes('edit')) return true
  return !EDIT_RESERVED_CODES.has(e.code) && !e.code.startsWith('Numpad') && !EDIT_RESERVED_KEYS.test(e.key.toLowerCase())
}

/** The chord to store when the user presses a key for an action */
export function captureChord(actionId: ActionId, e: KeyInput): KeyChord {
  if (ACTION_BY_ID.get(actionId)!.by === 'key' && e.key.length === 1) return { key: e.key.toLowerCase() }
  return e.shiftKey ? { code: e.code, shift: true } : { code: e.code }
}

/** Assign a chord to a slot; the action's other slot is cleared if it held the same chord */
export function withChord(bindings: Keybindings, actionId: ActionId, slot: 0 | 1, chord: KeyChord | null): Keybindings {
  const slots: KeySlots = [...bindings[actionId]]
  slots[slot] = chord
  const other = slot === 0 ? 1 : 0
  if (chord && JSON.stringify(slots[other]) === JSON.stringify(chord)) slots[other] = null
  return { ...bindings, [actionId]: slots }
}

/** Remove from an action every chord that the key press triggers */
export function withoutInput(bindings: Keybindings, actionId: ActionId, e: KeyInput): Keybindings {
  const slots = bindings[actionId].map((c) => (c && chordMatches(c, e, true) ? null : c)) as KeySlots
  return { ...bindings, [actionId]: slots }
}

/** Keys named the same on every layout */
const NAMED_KEYS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: 'Retour arrière',
  Space: 'Espace',
  Insert: 'Inser',
  Home: 'Début',
  End: 'Fin',
  PageUp: 'Page préc.',
  PageDown: 'Page suiv.',
}

/** QWERTY legend of the punctuation keys, used until the user's layout is known */
const QWERTY_PUNCTUATION: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: '\'',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
}

function codeLabel(code: string, labels: Record<string, string>): string {
  if (code in NAMED_KEYS) return NAMED_KEYS[code]
  if (code.startsWith('Numpad')) return `Pavé ${code.slice(6)}`
  const learned = labels[code]
  if (learned) return learned.toUpperCase()
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return QWERTY_PUNCTUATION[code] ?? code
}

/**
 * Text shown for a chord. `labels` maps a key position to the character it produces on the
 * user's layout (KeyW → "z" on AZERTY); without an entry the QWERTY legend is used.
 */
export function chordLabel(chord: KeyChord, labels: Record<string, string> = {}): string {
  if ('key' in chord) return chord.key.toUpperCase()
  return (chord.shift ? 'Maj+' : '') + codeLabel(chord.code, labels)
}

/** Label of the first assigned key of an action, or '' when it has none */
export function shortcutLabel(bindings: Keybindings, actionId: ActionId, labels: Record<string, string> = {}): string {
  const chord = bindings[actionId][0] ?? bindings[actionId][1]
  return chord ? chordLabel(chord, labels) : ''
}
