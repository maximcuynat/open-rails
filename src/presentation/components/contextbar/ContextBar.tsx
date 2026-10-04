import type { EditorStore } from '@application/state/editorStore'
import { buildContextBar } from './contextBarModel'

/** Room kept free at the bottom-left of the canvas for the mini-map (160 px wide, 12 px margin). */
const LEFT_RESERVE = 190
/** Room kept free at the bottom-right for the scale bar drawn by the canvas. */
const RIGHT_RESERVE = 190
/** Room taken by the open inspector (290 px wide, 16 px margin). */
const INSPECTOR_RESERVE = 322

/**
 * The contextual bar: one fixed strip at the bottom centre of the canvas whose content follows
 * the tool and its state. Rendering only: what it shows is decided by `buildContextBar`.
 */
export function ContextBar({ store }: { store: EditorStore }) {
  const items = buildContextBar(store)
  if (!items) return null

  return (
    <div
      className="context-bar-zone"
      style={{ left: LEFT_RESERVE, right: store.isSidePanelOpen ? INSPECTOR_RESERVE : RIGHT_RESERVE }}
    >
      <div className="context-bar" role="toolbar" aria-label="Barre contextuelle">
        {items.map((item) => {
          if (item.kind === 'label') {
            return <span key="label" className="cb-label">{item.text}</span>
          }
          if (item.kind === 'value') {
            return (
              <span key={item.id} className={`cb-value cb-${item.tone ?? 'default'}`}>
                {item.caption && <span className="cb-caption">{item.caption}</span>}
                {item.text}
              </span>
            )
          }
          return (
            <button
              key={item.id}
              type="button"
              className={`cb-btn cb-${item.tone ?? 'default'}${item.active ? ' active' : ''}`}
              title={item.title}
              aria-pressed={item.active}
              disabled={item.disabled}
              // Keep the keyboard focus where it is: shortcuts and typed lengths go on working
              onMouseDown={(e) => e.preventDefault()}
              onClick={item.run}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
