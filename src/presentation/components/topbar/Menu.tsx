import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  separatorAfter?: boolean
  /** Toggle entry: a check mark shows its state, the label never changes */
  checked?: boolean
  /** Opens a nested menu instead of being selected itself */
  submenu?: MenuItem[]
}

export interface MenuDef {
  label: string
  items: MenuItem[]
  onSelect: (id: string) => void
}

/** Next selectable index from `from` in the direction of `step`, wrapping around; -1 if none */
export function nextEnabled(items: MenuItem[], from: number, step: 1 | -1): number {
  const n = items.length
  const start = from < 0 && step === -1 ? 0 : from
  for (let k = 1; k <= n; k++) {
    const i = (((start + step * k) % n) + n) % n
    if (!items[i].disabled) return i
  }
  return -1
}

interface MenuListProps {
  items: MenuItem[]
  active: number
  nested?: boolean
  onHover: (index: number) => void
  onChoose: (item: MenuItem) => void
  /** The open submenu, rendered beside the active entry */
  children?: ReactNode
}

function MenuList({ items, active, nested, onHover, onChoose, children }: MenuListProps) {
  const checkable = items.some((item) => item.checked !== undefined)
  return (
    <div className={`menu-dropdown${nested ? ' menu-submenu' : ''}`} role="menu">
      {items.map((item, i) => (
        <div key={item.id} className="menu-row">
          <button
            className={`menu-item${item.disabled ? ' disabled' : ''}${i === active ? ' active' : ''}`}
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            aria-haspopup={item.submenu ? 'menu' : undefined}
            aria-expanded={item.submenu ? i === active && !!children : undefined}
            disabled={item.disabled}
            onMouseEnter={() => onHover(i)}
            onClick={() => onChoose(item)}
          >
            {checkable && (
              <span className="menu-item-check" aria-hidden="true">
                {item.checked && (
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                )}
              </span>
            )}
            <span className="menu-item-label">{item.label}</span>
            {item.shortcut && <kbd className="menu-item-shortcut">{item.shortcut}</kbd>}
            {item.submenu && (
              <svg className="menu-item-arrow" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 3.5l4.5 4.5L6 12.5" />
              </svg>
            )}
          </button>
          {i === active && children}
          {item.separatorAfter && <div className="menu-sep" />}
        </div>
      ))}
    </div>
  )
}

interface MenuBarProps {
  menus: MenuDef[]
}

/**
 * The application menu bar. One menu is open at a time; once one is open, hovering another title
 * switches to it, and the arrow keys, Enter and Escape drive it.
 */
export function MenuBar({ menus }: MenuBarProps) {
  const [open, setOpen] = useState<number | null>(null)
  /** Highlighted entry of the open menu, -1 for none */
  const [active, setActive] = useState(-1)
  /** Highlighted entry of the open submenu (-1 for none), null while no submenu is open */
  const [subActive, setSubActive] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const openMenu = (index: number | null, highlightFirst = false) => {
    setOpen(index)
    setActive(index !== null && highlightFirst ? nextEnabled(menus[index].items, -1, 1) : -1)
    setSubActive(null)
  }

  const choose = (item: MenuItem) => {
    if (open === null || item.disabled) return
    if (item.submenu) {
      setSubActive(nextEnabled(item.submenu, -1, 1))
      return
    }
    const { onSelect } = menus[open]
    openMenu(null)
    onSelect(item.id)
  }

  const items = open !== null ? menus[open].items : []
  const submenu = subActive !== null ? items[active]?.submenu : undefined

  useEffect(() => {
    if (open === null) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) openMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      // An open menu owns the keyboard: no key reaches the editor or driving shortcuts behind it
      e.stopPropagation()
      switch (e.key) {
        case 'Escape':
          if (submenu) setSubActive(null)
          else openMenu(null)
          break
        case 'ArrowDown':
        case 'ArrowUp': {
          const step = e.key === 'ArrowDown' ? 1 : -1
          if (submenu) setSubActive(nextEnabled(submenu, subActive ?? -1, step))
          else setActive(nextEnabled(items, active, step))
          break
        }
        case 'ArrowRight': {
          const item = items[active]
          if (!submenu && item?.submenu && !item.disabled) setSubActive(nextEnabled(item.submenu, -1, 1))
          else openMenu((open + 1) % menus.length, true)
          break
        }
        case 'ArrowLeft':
          if (submenu) setSubActive(null)
          else openMenu((open + menus.length - 1) % menus.length, true)
          break
        case 'Enter': {
          const item = submenu ? submenu[subActive ?? -1] : items[active]
          // Nothing highlighted: the focused menu title keeps its own Enter
          if (!item) return
          choose(item)
          break
        }
        default:
          return
      }
      e.preventDefault()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  })

  return (
    <div className="menubar" ref={ref} role="menubar">
      {menus.map((menu, i) => (
        <div className="menu" key={menu.label}>
          <button
            className={`menu-trigger${open === i ? ' open' : ''}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={() => openMenu(open === i ? null : i)}
            onMouseEnter={() => {
              if (open !== null && open !== i) openMenu(i)
            }}
          >
            {menu.label}
          </button>
          {open === i && (
            <MenuList
              items={items}
              active={active}
              onHover={(index) => {
                setActive(index)
                setSubActive(items[index].submenu ? -1 : null)
              }}
              onChoose={choose}
            >
              {submenu && (
                <MenuList nested items={submenu} active={subActive ?? -1} onHover={setSubActive} onChoose={choose} />
              )}
            </MenuList>
          )}
        </div>
      ))}
    </div>
  )
}
