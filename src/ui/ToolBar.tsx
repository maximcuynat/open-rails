import { useState, type ReactNode } from 'react'
import type { EditorStore, Tool } from './store'

interface ToolDef {
  id: Tool
  label: string
  shortcut: string
  icon: ReactNode
  group: number
}

const TOOLS: ToolDef[] = [
  {
    id: 'select',
    label: 'Sélection / Déplacement',
    shortcut: 'V',
    group: 0,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3l14 7-6 2-2 6z" />
      </svg>
    ),
  },
  {
    id: 'place',
    label: 'Voie droite',
    shortcut: 'N',
    group: 1,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="8" x2="21" y2="8" />
        <line x1="3" y1="16" x2="21" y2="16" />
        <line x1="7" y1="5" x2="7" y2="19" />
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="17" y1="5" x2="17" y2="19" />
      </svg>
    ),
  },
  {
    id: 'curve',
    label: 'Voie courbe',
    shortcut: 'C',
    group: 1,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20C4 20 7 8 20 5" />
        <path d="M7 21C7 21 10 11 21 8" />
      </svg>
    ),
  },
  {
    id: 'pan',
    label: 'Déplacer la vue',
    shortcut: 'H',
    group: 2,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v6M9 5l3-3 3 3" />
        <path d="M5 9l-3 3 3 3M19 9l3 3-3 3" />
        <path d="M12 22v-6M9 19l3 3 3-3" />
      </svg>
    ),
  },
]

export function ToolBar({ store }: { store: EditorStore }) {
  const [hoverId, setHoverId] = useState<string | null>(null)

  // Group separators: insert a divider when group changes
  const items: ReactNode[] = []
  let lastGroup = -1
  for (const t of TOOLS) {
    if (t.group !== lastGroup && items.length > 0) {
      items.push(<div key={`sep-${t.group}`} className="tb-sep" />)
    }
    lastGroup = t.group
    const active = store.tool === t.id
    items.push(
      <div
        key={t.id}
        className="tb-btn-wrap"
        onMouseEnter={() => setHoverId(t.id)}
        onMouseLeave={() => setHoverId((h) => (h === t.id ? null : h))}
      >
        <button
          className={`tb-btn${active ? ' active' : ''}`}
          onClick={() => store.setTool(t.id)}
          aria-label={t.label}
          aria-pressed={active}
        >
          {t.icon}
        </button>
        {hoverId === t.id && (
          <div className="tb-tooltip">
            {t.label}
            <kbd>{t.shortcut}</kbd>
          </div>
        )}
      </div>,
    )
  }

  // Toggles: grid + snap
  items.push(<div key="sep-toggles" className="tb-sep" />)
  items.push(
    <div key="snap" className="tb-btn-wrap" onMouseEnter={() => setHoverId('snap')} onMouseLeave={() => setHoverId((h) => (h === 'snap' ? null : h))}>
      <button
        className={`tb-btn${store.snap ? ' active' : ''}`}
        onClick={() => store.toggleSnap()}
        aria-label="Toggle snap"
        aria-pressed={store.snap}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4v16M4 12h16M20 4v16M12 4v16" opacity="0.5" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      </button>
      {hoverId === 'snap' && (
        <div className="tb-tooltip">
          Accrochage grille
          <kbd>G</kbd>
        </div>
      )}
    </div>,
  )
  items.push(
    <div key="grid" className="tb-btn-wrap" onMouseEnter={() => setHoverId('grid')} onMouseLeave={() => setHoverId((h) => (h === 'grid' ? null : h))}>
      <button
        className={`tb-btn${store.showGrid ? ' active' : ''}`}
        onClick={() => store.toggleGrid()}
        aria-label="Toggle grid"
        aria-pressed={store.showGrid}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="1" />
          <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
        </svg>
      </button>
      {hoverId === 'grid' && (
        <div className="tb-tooltip">
          Afficher la grille
        </div>
      )}
    </div>,
  )

  return <div className="toolbar-vert">{items}</div>
}
