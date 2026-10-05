import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import type { EditorStore } from '@application/state/editorStore'
import { buildContextBar, type ContextBarItem } from './contextBarModel'

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
      <ContextBarStrip items={items} />
    </div>
  )
}

// Keep the keyboard focus where it is: shortcuts and typed lengths go on working
const keepFocus = (e: MouseEvent) => e.preventDefault()

/**
 * The strip itself. Two things keep its buttons from slipping away from under the pointer, since
 * a centred strip moves all of them whenever its content changes width:
 * - while the pointer is over it, its left edge is pinned where it was (it is centred again once
 *   the pointer has left);
 * - a readout only ever grows: it keeps the widest size it has had since the bar last changed
 *   subject (its label), so a length going from « 9 m » to « 12 m » and back resizes it once.
 */
function ContextBarStrip({ items }: { items: ContextBarItem[] }) {
  const stripRef = useRef<HTMLDivElement>(null)
  const [pinnedLeft, setPinnedLeft] = useState<number | null>(null)
  const widest = useRef({ subject: '', widths: new Map<string, number>() })

  const subject = items.find((item) => item.kind === 'label')?.text ?? ''

  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const memory = widest.current
    const sameSubject = memory.subject === subject
    if (!sameSubject) {
      memory.subject = subject
      memory.widths.clear()
    }
    for (const el of strip.querySelectorAll<HTMLElement>('[data-grow-only]')) {
      if (!sameSubject) el.style.minWidth = ''
      const id = el.dataset.growOnly!
      const width = Math.max(memory.widths.get(id) ?? 0, Math.ceil(el.getBoundingClientRect().width))
      memory.widths.set(id, width)
      el.style.minWidth = `${width}px`
    }
  })

  const pin = () => {
    const strip = stripRef.current
    const zone = strip?.parentElement
    if (!strip || !zone) return
    setPinnedLeft(strip.getBoundingClientRect().left - zone.getBoundingClientRect().left)
  }

  return (
    <div
      ref={stripRef}
      className="context-bar"
      role="toolbar"
      aria-label="Barre contextuelle"
      // Pinned: the auto margin on the right takes over from the centring of the zone
      style={pinnedLeft === null ? undefined : { marginLeft: pinnedLeft, marginRight: 'auto', maxWidth: `calc(100% - ${pinnedLeft}px)` }}
      onMouseEnter={pin}
      onMouseLeave={() => setPinnedLeft(null)}
    >
      {items.map((item) => {
        if (item.kind === 'label') {
          return <span key="label" className="cb-label">{item.text}</span>
        }
        if (item.kind === 'value') {
          return (
            <span key={item.id} data-grow-only={item.id} className={`cb-value cb-${item.tone ?? 'default'}`}>
              {item.caption && <span className="cb-caption">{item.caption}</span>}
              {item.text}
            </span>
          )
        }
        if (item.kind === 'stepper') {
          return (
            <span key={item.id} className="cb-stepper" role="group" aria-label={item.caption}>
              <span className="cb-caption">{item.caption}</span>
              <button
                type="button"
                className="cb-btn cb-step"
                title={item.decrease.title}
                aria-label={item.decrease.title}
                disabled={item.decrease.disabled}
                onMouseDown={keepFocus}
                onClick={item.decrease.run}
              >
                −
              </button>
              {item.choices && item.pick ? (
                <select
                  className="cb-step-value cb-step-select"
                  aria-label={item.caption}
                  value={item.value}
                  onChange={(e) => {
                    item.pick?.(Number(e.target.value))
                    // Hand the keyboard back to the canvas: shortcuts go on working
                    e.target.blur()
                  }}
                >
                  {item.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>{choice.label}</option>
                  ))}
                </select>
              ) : (
                <span className="cb-step-value" aria-live="polite">{item.text}</span>
              )}
              <button
                type="button"
                className="cb-btn cb-step"
                title={item.increase.title}
                aria-label={item.increase.title}
                disabled={item.increase.disabled}
                onMouseDown={keepFocus}
                onClick={item.increase.run}
              >
                +
              </button>
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
            onMouseDown={keepFocus}
            onClick={item.run}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
