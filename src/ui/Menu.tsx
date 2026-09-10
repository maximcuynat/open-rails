import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  separatorAfter?: boolean
}

interface MenuProps {
  label: string
  items: MenuItem[]
  onSelect: (id: string) => void
}

export function Menu({ label, items, onSelect }: MenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu" ref={ref}>
      <button
        className={`menu-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className="menu-dropdown" role="menu">
          {items.map((item) => (
            <div key={item.id}>
              <button
                className={`menu-item${item.disabled ? ' disabled' : ''}`}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return
                  setOpen(false)
                  onSelect(item.id)
                }}
              >
                <span className="menu-item-label">{item.label}</span>
                {item.shortcut && <kbd className="menu-item-shortcut">{item.shortcut}</kbd>}
              </button>
              {item.separatorAfter && <div className="menu-sep" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export interface MenuBarProps {
  children: ReactNode[]
}

export function MenuBar({ children }: MenuBarProps) {
  return <div className="menubar">{children}</div>
}
