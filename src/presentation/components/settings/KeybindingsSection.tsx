import { useEffect, useState } from 'react'
import type { EditorStore } from '@application/state/editorStore'
import {
  ACTIONS,
  ACTION_GROUP_LABELS,
  actionLabel,
  captureChord,
  chordLabel,
  defaultKeybindings,
  findConflict,
  isBindable,
  withChord,
  withoutInput,
  type ActionGroup,
  type ActionId,
  type KeyInput,
  type Keybindings,
} from '@application/keybindings/keybindings'

interface KeybindingsSectionProps {
  store: EditorStore
  /** Draft bindings: committed by the settings dialog on save */
  bindings: Keybindings
  onChange: (bindings: Keybindings) => void
}

interface Slot {
  actionId: ActionId
  index: 0 | 1
}

const GROUPS: ActionGroup[] = ['drive', 'tools']

export function KeybindingsSection({ store, bindings, onChange }: KeybindingsSectionProps) {
  const [listening, setListening] = useState<Slot | null>(null)
  /** A captured key that another action already uses, awaiting the user's choice */
  const [pending, setPending] = useState<(Slot & { input: KeyInput; conflict: ActionId }) | null>(null)
  const [refused, setRefused] = useState<Slot | null>(null)

  useEffect(() => {
    if (!listening) return
    const onKeyDown = (e: KeyboardEvent) => {
      // Capture phase: neither the dialog (Escape) nor the global shortcuts may see this press
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        setListening(null)
        return
      }
      if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return
      if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        store.setKeyLabels({ [e.code]: e.key })
      }
      const input: KeyInput = { code: e.code, key: e.key, shiftKey: e.shiftKey }
      setListening(null)
      if (!isBindable(listening.actionId, input)) {
        setRefused(listening)
        return
      }
      const conflict = findConflict(bindings, listening.actionId, input)
      if (conflict) {
        setPending({ ...listening, input, conflict })
        return
      }
      onChange(withChord(bindings, listening.actionId, listening.index, captureChord(listening.actionId, input)))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [listening, bindings, onChange, store])

  const startListening = (slot: Slot) => {
    setPending(null)
    setRefused(null)
    setListening(slot)
  }

  const replaceConflict = () => {
    if (!pending) return
    const freed = withoutInput(bindings, pending.conflict, pending.input)
    onChange(withChord(freed, pending.actionId, pending.index, captureChord(pending.actionId, pending.input)))
    setPending(null)
  }

  const isSlot = (slot: Slot | null, actionId: ActionId, index: number) =>
    slot !== null && slot.actionId === actionId && slot.index === index

  return (
    <div className="settings-section">
      <label className="settings-label">
        Raccourcis clavier
        <span className="settings-hint">
          Cliquez sur une touche puis appuyez sur la nouvelle. Les touches de conduite suivent la position sur le
          clavier (identique en QWERTY et AZERTY) ; les touches d’outils suivent la lettre.
        </span>
      </label>

      {GROUPS.map((group) => (
        <div key={group} className="keybind-group">
          <div className="keybind-group-title">{ACTION_GROUP_LABELS[group]}</div>
          {ACTIONS.filter((a) => a.group === group).map((action) => (
            <div key={action.id} className="keybind-row">
              <span className="keybind-action">{action.label}</span>
              <div className="keybind-slots">
                {([0, 1] as const).map((index) => {
                  const chord = bindings[action.id][index]
                  const active = isSlot(listening, action.id, index)
                  return (
                    <span key={index} className="keybind-slot">
                      <button
                        type="button"
                        className={`keybind-key ${active ? 'listening' : ''} ${chord ? '' : 'empty'}`}
                        title={index === 0 ? 'Touche principale' : 'Touche secondaire'}
                        onClick={() => (active ? setListening(null) : startListening({ actionId: action.id, index }))}
                      >
                        {active ? 'Appuyez sur une touche…' : chord ? chordLabel(chord, store.keyLabels) : '—'}
                      </button>
                      {chord && !active && (
                        <button
                          type="button"
                          className="keybind-clear"
                          aria-label={`Retirer la touche de « ${action.label} »`}
                          title="Retirer cette touche"
                          onClick={() => onChange(withChord(bindings, action.id, index, null))}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
              {pending && pending.actionId === action.id && (
                <div className="keybind-notice">
                  Touche déjà utilisée par « {actionLabel(pending.conflict)} ».
                  <button type="button" className="preset-btn" onClick={replaceConflict}>Remplacer</button>
                  <button type="button" className="preset-btn" onClick={() => setPending(null)}>Annuler</button>
                </div>
              )}
              {refused && refused.actionId === action.id && (
                <div className="keybind-notice">Cette touche est réservée et ne peut pas être assignée ici.</div>
              )}
            </div>
          ))}
        </div>
      ))}

      <div>
        <button
          type="button"
          className="preset-btn"
          onClick={() => {
            setPending(null)
            setRefused(null)
            onChange(defaultKeybindings())
          }}
        >
          Réinitialiser les raccourcis
        </button>
      </div>
    </div>
  )
}
