import type { EditorStore } from '@application/state/editorStore'
import { TRAIN_DEBUG_LAYERS } from './trainDebugLayers'

interface TrainDebugPanelProps {
  store: EditorStore
}

/**
 * TrainDebugPanel — the layers of the train debug view, one switch per row. It opens with the
 * debug view, on its own in the editor and above the driving console while driving.
 */
export function TrainDebugPanel({ store }: TrainDebugPanelProps) {
  if (!store.showTrainDebug) return null

  const shortcut = store.shortcutLabel('train.debug')

  return (
    <section className="debug-panel" aria-label="Debug des trains">
      <header className="debug-panel-header">
        <span className="debug-panel-title">Debug des trains</span>
        {shortcut && <kbd>{shortcut}</kbd>}
        <button
          className="debug-panel-close"
          onClick={() => store.toggleTrainDebug()}
          aria-label="Fermer le debug des trains"
          title={`Fermer${store.shortcutHint('train.debug')}`}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M2 2 L10 10 M10 2 L2 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {TRAIN_DEBUG_LAYERS.map(({ key, label, hint }) => {
        const active = store.trainDebugOptions[key]
        return (
          <button
            key={key}
            className="debug-row"
            role="switch"
            aria-checked={active}
            onClick={() => store.toggleTrainDebugOption(key)}
            title={hint}
          >
            <span className="debug-row-label">{label}</span>
            <span className="debug-switch" aria-hidden="true" />
          </button>
        )
      })}
    </section>
  )
}
