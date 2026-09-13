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
  const [showGridMenu, setShowGridMenu] = useState(false)

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

  // Undo / Redo
  items.push(<div key="sep-undoredo" className="tb-sep" />)
  items.push(
    <div key="undo" className="tb-btn-wrap" onMouseEnter={() => setHoverId('undo')} onMouseLeave={() => setHoverId((h) => (h === 'undo' ? null : h))}>
      <button
        className="tb-btn"
        disabled={!store.canUndo}
        onClick={() => store.undo()}
        aria-label="Annuler"
        style={{ opacity: store.canUndo ? 1 : 0.4, cursor: store.canUndo ? 'pointer' : 'not-allowed' }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
        </svg>
      </button>
      {hoverId === 'undo' && (
        <div className="tb-tooltip">
          Annuler
          <kbd>Ctrl+Z</kbd>
        </div>
      )}
    </div>,
  )
  items.push(
    <div key="redo" className="tb-btn-wrap" onMouseEnter={() => setHoverId('redo')} onMouseLeave={() => setHoverId((h) => (h === 'redo' ? null : h))}>
      <button
        className="tb-btn"
        disabled={!store.canRedo}
        onClick={() => store.redo()}
        aria-label="Rétablir"
        style={{ opacity: store.canRedo ? 1 : 0.4, cursor: store.canRedo ? 'pointer' : 'not-allowed' }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6" />
          <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13" />
        </svg>
      </button>
      {hoverId === 'redo' && (
        <div className="tb-tooltip">
          Rétablir
          <kbd>Ctrl+Y</kbd>
        </div>
      )}
    </div>,
  )

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
    <div
      key="grid"
      className="tb-btn-wrap"
      style={{ position: 'relative' }}
      onMouseEnter={() => setHoverId('grid')}
      onMouseLeave={() => setHoverId((h) => (h === 'grid' ? null : h))}
    >
      <button
        className={`tb-btn${store.showGrid ? ' active' : ''}`}
        onClick={() => store.toggleGrid()}
        onContextMenu={(e) => {
          e.preventDefault()
          setShowGridMenu(!showGridMenu)
        }}
        aria-label="Afficher la grille"
        aria-pressed={store.showGrid}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="1" />
          <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
        </svg>
      </button>
      {hoverId === 'grid' && !showGridMenu && (
        <div className="tb-tooltip">
          Grille ({store.gridMode === 'auto' ? 'Auto' : `${store.gridSpacing}m`})
          <span style={{ fontSize: '9px', opacity: 0.7, display: 'block', marginTop: '2px' }}>
            Clic-droit ou bouton pour régler le pas
          </span>
        </div>
      )}

      {showGridMenu && (
        <div
          style={{
            position: 'absolute',
            left: '100%',
            top: '0',
            marginLeft: '8px',
            background: 'var(--panel-bg, #1e293b)',
            border: '1px solid var(--border, #334155)',
            borderRadius: '6px',
            padding: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            zIndex: 200,
            minWidth: '170px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '11px',
            color: 'var(--ink, #f8fafc)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 600, borderBottom: '1px solid var(--border, #334155)', paddingBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Pas de la grille</span>
            <button
              onClick={() => setShowGridMenu(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer', fontSize: '11px' }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: '10px',
                borderRadius: '4px',
                border: store.gridMode === 'auto' ? '1px solid var(--accent, #3b82f6)' : '1px solid var(--border, #334155)',
                background: store.gridMode === 'auto' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: 'var(--ink, #f8fafc)',
                cursor: 'pointer',
                fontWeight: store.gridMode === 'auto' ? 700 : 500,
              }}
              onClick={() => {
                store.setGridMode('auto')
                if (!store.showGrid) store.toggleGrid()
              }}
            >
              Mode Auto
            </button>
            <button
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: '10px',
                borderRadius: '4px',
                border: store.gridMode === 'fixed' ? '1px solid var(--accent, #3b82f6)' : '1px solid var(--border, #334155)',
                background: store.gridMode === 'fixed' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: 'var(--ink, #f8fafc)',
                cursor: 'pointer',
                fontWeight: store.gridMode === 'fixed' ? 700 : 500,
              }}
              onClick={() => {
                store.setGridMode('fixed')
                if (!store.showGrid) store.toggleGrid()
              }}
            >
              Mode Fixe
            </button>
          </div>

          {store.gridMode === 'fixed' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
              <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                {[1, 2, 5, 10, 25, 50].map((val) => (
                  <button
                    key={val}
                    style={{
                      padding: '3px 6px',
                      fontSize: '10px',
                      borderRadius: '3px',
                      border: store.gridSpacing === val ? '1px solid var(--accent, #3b82f6)' : '1px solid var(--border, #334155)',
                      background: store.gridSpacing === val ? 'var(--accent, #3b82f6)' : 'var(--panel-2, rgba(255,255,255,0.05))',
                      color: store.gridSpacing === val ? '#fff' : 'var(--ink, #f8fafc)',
                      cursor: 'pointer',
                      fontWeight: store.gridSpacing === val ? 700 : 500,
                    }}
                    onClick={() => {
                      store.setGridSpacing(val)
                      if (!store.showGrid) store.toggleGrid()
                    }}
                  >
                    {val}m
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted, #94a3b8)' }}>Perso :</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={store.gridSpacing}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!isNaN(v) && v > 0) store.setGridSpacing(v)
                  }}
                  style={{
                    width: '50px',
                    padding: '2px 4px',
                    fontSize: '10px',
                    borderRadius: '3px',
                    border: '1px solid var(--border, #334155)',
                    background: 'var(--input-bg, #0f172a)',
                    color: 'var(--ink, #f8fafc)',
                    textAlign: 'right',
                  }}
                />
                <span style={{ fontSize: '10px' }}>m</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>,
  )

  return <div className="toolbar-vert">{items}</div>
}
