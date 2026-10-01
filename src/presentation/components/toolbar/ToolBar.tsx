import { useState, useRef, useEffect, type ReactNode } from 'react'
import type { EditorStore, Tool } from '@application/state/editorStore'

interface ToolDef {
  id: Tool
  label: string
  shortcut: string
  icon: ReactNode
  group: number
}

const TOOLS: ToolDef[] = [
  {
    id: 'pan',
    label: 'Déplacer la vue',
    shortcut: 'H',
    group: 0,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v6M9 5l3-3 3 3" />
        <path d="M5 9l-3 3 3 3M19 9l3 3-3 3" />
        <path d="M12 22v-6M9 19l3 3 3-3" />
      </svg>
    ),
  },
  {
    id: 'select',
    label: 'Sélection',
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
    id: 'turnout',
    label: 'Aiguillage parallèle',
    shortcut: 'P',
    group: 2,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="2" y1="18" x2="22" y2="18" />
        <path d="M5 18c3-4 6-10 11-10h6" />
      </svg>
    ),
  },
  {
    id: 'split',
    label: 'Ciseaux / Découpe',
    shortcut: 'K',
    group: 3,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <line x1="20" y1="4" x2="8.12" y2="15.88" />
        <line x1="14.47" y1="14.48" x2="20" y2="20" />
        <line x1="8.12" y1="8.12" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    id: 'measure',
    label: 'Règle / Mesureur',
    shortcut: 'M',
    group: 3,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21l18-18" />
        <path d="M7 5l2 2M11 9l2 2M15 13l2 2M19 17l2 2" />
        <circle cx="3" cy="21" r="2" fill="currentColor" />
        <circle cx="21" cy="3" r="2" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'locomotive',
    label: 'Locomotive (Pose & Simulation)',
    shortcut: 'L',
    group: 4,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="8" width="16" height="8" rx="1" />
        <polygon points="18,8 22,12 18,16" />
        <circle cx="6" cy="18" r="2" />
        <circle cx="14" cy="18" r="2" />
      </svg>
    ),
  },
]

export function ToolBar({ store }: { store: EditorStore }) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [showGridMenu, setShowGridMenu] = useState(false)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const flyoutBtnRef = useRef<HTMLDivElement>(null)

  // Close flyout when clicking outside
  useEffect(() => {
    if (!showGridMenu) return
    const onPointerDown = (e: PointerEvent) => {
      if (
        flyoutRef.current &&
        !flyoutRef.current.contains(e.target as Node) &&
        flyoutBtnRef.current &&
        !flyoutBtnRef.current.contains(e.target as Node)
      ) {
        setShowGridMenu(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [showGridMenu])

  // --- ÎLE 1 : RAILS & OUTILS ---
  const toolItems: ReactNode[] = []
  let lastGroup = -1
  for (const t of TOOLS) {
    if (t.group !== lastGroup && toolItems.length > 0) {
      toolItems.push(<div key={`sep-${t.group}`} className="tb-sep" />)
    }
    lastGroup = t.group
    const active = store.tool === t.id
    toolItems.push(
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

  return (
    <div className="toolbar-container">
      {/* Île 1 : Rails, Sélection, Navigation, Historique */}
      <div className="toolbar-island">
        {toolItems}

        <div className="tb-sep" />

        {/* Undo */}
        <div
          className="tb-btn-wrap"
          onMouseEnter={() => setHoverId('undo')}
          onMouseLeave={() => setHoverId((h) => (h === 'undo' ? null : h))}
        >
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
        </div>

        {/* Redo */}
        <div
          className="tb-btn-wrap"
          onMouseEnter={() => setHoverId('redo')}
          onMouseLeave={() => setHoverId((h) => (h === 'redo' ? null : h))}
        >
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
        </div>

        {/* Badge Voie double si actif */}
        {store.parallelMode && (
          <div
            style={{
              margin: '4px 0 0',
              padding: '4px 2px',
              background: 'rgba(37,99,235,0.18)',
              border: '1px solid var(--accent, #2563eb)',
              borderRadius: '6px',
              fontSize: '9px',
              fontWeight: 700,
              color: 'var(--accent, #60a5fa)',
              textAlign: 'center',
              lineHeight: 1.2,
              cursor: 'pointer',
              width: '34px',
            }}
            title="Cliquer pour quitter le mode double voie (ou Echap)"
            onClick={() => store.exitParallelMode()}
          >
            <div>2v</div>
            <div style={{ fontSize: '8px', opacity: 0.8 }}>{store.parallelOffset}m</div>
          </div>
        )}

        {store.selection.nodes.size === 2 && !store.parallelMode && (
          <div
            style={{
              margin: '4px 0 0',
              padding: '4px 2px',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10b981',
              borderRadius: '6px',
              fontSize: '9px',
              fontWeight: 700,
              color: '#34d399',
              textAlign: 'center',
              lineHeight: 1.2,
              cursor: 'pointer',
              width: '34px',
            }}
            title="Créer une voie double parallèle à partir des 2 nœuds sélectionnés (D)"
            onClick={() => store.createParallelTrackFromSelection()}
          >
            <div>+2v</div>
            <div style={{ fontSize: '8px', opacity: 0.8 }}>(D)</div>
          </div>
        )}

        {/* Locomotive status badge */}
        {store.locomotive && (
          <div
            style={{
              margin: '4px 0 0',
              padding: '4px 2px',
              background: store.isPlayMode ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.15)',
              border: `1px solid ${store.isPlayMode ? '#10b981' : '#3b82f6'}`,
              borderRadius: '6px',
              fontSize: '9px',
              fontWeight: 700,
              color: store.isPlayMode ? '#34d399' : '#60a5fa',
              textAlign: 'center',
              lineHeight: 1.2,
              cursor: 'pointer',
              width: '34px',
            }}
            title={store.isPlayMode ? 'Mode Play actif · Espace pour arrêter' : 'Cliquer pour démarrer le mode Play (Espace)'}
            onClick={() => store.togglePlayMode()}
          >
            <div>{store.isPlayMode ? '⏹' : '▶'}</div>
            <div style={{ fontSize: '7px', opacity: 0.8 }}>{store.isPlayMode ? 'Stop' : 'Play'}</div>
          </div>
        )}

        {/* Flip direction button */}
        {store.locomotive && (
          <div
            style={{
              margin: '2px 0 0',
              padding: '4px 2px',
              background: 'rgba(168, 85, 247, 0.15)',
              border: '1px solid #a855f7',
              borderRadius: '6px',
              fontSize: '9px',
              fontWeight: 700,
              color: '#c084fc',
              textAlign: 'center',
              lineHeight: 1.2,
              cursor: 'pointer',
              width: '34px',
            }}
            title="Inverser le sens de la locomotive (Touche R ou Tab)"
            onClick={() => store.flipLocomotiveDirection()}
          >
            <div>⇄</div>
            <div style={{ fontSize: '7px', opacity: 0.8 }}>Sens</div>
          </div>
        )}

        {/* Remove locomotive button */}
        {store.locomotive && !store.isPlayMode && (
          <div
            style={{
              margin: '2px 0 0',
              padding: '4px 2px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid #ef4444',
              borderRadius: '6px',
              fontSize: '9px',
              fontWeight: 700,
              color: '#f87171',
              textAlign: 'center',
              lineHeight: 1.2,
              cursor: 'pointer',
              width: '34px',
            }}
            title="Retirer la locomotive"
            onClick={() => store.removeLocomotive()}
          >
            <div>✕</div>
            <div style={{ fontSize: '7px', opacity: 0.8 }}>Loco</div>
          </div>
        )}
      </div>

      {/* Île 2 : Snap & Grille statique réglable */}
      <div className="toolbar-island">
        {/* Toggle Accrochage (Snap) */}
        <div
          className="tb-btn-wrap"
          onMouseEnter={() => setHoverId('snap')}
          onMouseLeave={() => setHoverId((h) => (h === 'snap' ? null : h))}
        >
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
              Accrochage grille {store.snap ? '(Actif)' : '(Inactif)'}
              <kbd>G</kbd>
            </div>
          )}
        </div>

        {/* Toggle Affichage Grille */}
        <div
          className="tb-btn-wrap"
          onMouseEnter={() => setHoverId('grid')}
          onMouseLeave={() => setHoverId((h) => (h === 'grid' ? null : h))}
        >
          <button
            className={`tb-btn${store.showGrid ? ' active' : ''}`}
            onClick={() => store.toggleGrid()}
            aria-label="Afficher ou masquer la grille"
            aria-pressed={store.showGrid}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="1" />
              <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
            </svg>
          </button>
          {hoverId === 'grid' && (
            <div className="tb-tooltip">
              Grille : {store.showGrid ? 'Visible' : 'Masquée'}
            </div>
          )}
        </div>

        <div className="tb-sep" />

        {/* Réglage du pas de la grille statique */}
        <div
          className="tb-btn-wrap"
          ref={flyoutBtnRef}
          onMouseEnter={() => setHoverId('grid-step')}
          onMouseLeave={() => setHoverId((h) => (h === 'grid-step' ? null : h))}
        >
          <button
            className={`tb-step-btn${showGridMenu ? ' active' : ''}`}
            onClick={() => setShowGridMenu(!showGridMenu)}
            title="Cliquer pour régler le pas de la grille statique"
            aria-label="Régler le pas de grille"
          >
            <span style={{ fontSize: '8px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pas</span>
            <span>{store.gridSpacing}m</span>
          </button>

          {hoverId === 'grid-step' && !showGridMenu && (
            <div className="tb-tooltip">
              Grille statique : <strong>{store.gridSpacing} m</strong>
              <span style={{ fontSize: '9px', opacity: 0.8, display: 'block' }}>
                Cliquer pour régler le pas
              </span>
            </div>
          )}

          {/* Flyout de réglage de la grille statique (ne change pas la dimension de l'île) */}
          {showGridMenu && (
            <div className="tb-flyout" ref={flyoutRef} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 700, fontSize: '12px' }}>Grille statique</span>
                  <span
                    style={{
                      fontSize: '9px',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      background: store.gridMode === 'fixed' ? 'rgba(37,99,235,0.18)' : 'rgba(255,255,255,0.1)',
                      color: store.gridMode === 'fixed' ? 'var(--accent)' : 'inherit',
                      fontWeight: 600,
                    }}
                  >
                    {store.gridMode === 'fixed' ? 'Fixe' : 'Auto'}
                  </span>
                </div>
                <button
                  onClick={() => setShowGridMenu(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--ink)',
                    opacity: 0.6,
                    cursor: 'pointer',
                    fontSize: '13px',
                    lineHeight: 1,
                    padding: '2px 4px',
                  }}
                  title="Fermer"
                >
                  ✕
                </button>
              </div>

              {/* Mode switch */}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontSize: '10px',
                    borderRadius: '5px',
                    border: store.gridMode === 'fixed' ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: store.gridMode === 'fixed' ? 'var(--accent)' : 'transparent',
                    color: store.gridMode === 'fixed' ? 'var(--accent-fg)' : 'inherit',
                    cursor: 'pointer',
                    fontWeight: store.gridMode === 'fixed' ? 700 : 500,
                  }}
                  onClick={() => {
                    store.setGridMode('fixed')
                    if (!store.showGrid) store.toggleGrid()
                  }}
                >
                  Statique (fixe)
                </button>
                <button
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontSize: '10px',
                    borderRadius: '5px',
                    border: store.gridMode === 'auto' ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: store.gridMode === 'auto' ? 'var(--accent)' : 'transparent',
                    color: store.gridMode === 'auto' ? 'var(--accent-fg)' : 'inherit',
                    cursor: 'pointer',
                    fontWeight: store.gridMode === 'auto' ? 700 : 500,
                  }}
                  onClick={() => {
                    store.setGridMode('auto')
                    if (!store.showGrid) store.toggleGrid()
                  }}
                >
                  Auto (zoom)
                </button>
              </div>

              {/* Presets de pas rapides */}
              <div style={{ fontSize: '10px', fontWeight: 600, opacity: 0.7, marginTop: '2px' }}>
                Pas prédéfinis :
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                {[0.5, 1, 2, 5, 10, 20, 25, 50].map((val) => {
                  const isSelected = store.gridMode === 'fixed' && store.gridSpacing === val
                  return (
                    <button
                      key={val}
                      style={{
                        padding: '4px 2px',
                        fontSize: '10px',
                        borderRadius: '4px',
                        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                        background: isSelected ? 'var(--accent)' : 'var(--panel-2)',
                        color: isSelected ? 'var(--accent-fg)' : 'inherit',
                        cursor: 'pointer',
                        fontWeight: isSelected ? 700 : 500,
                        textAlign: 'center',
                      }}
                      onClick={() => {
                        store.setGridSpacing(val)
                        if (!store.showGrid) store.toggleGrid()
                      }}
                    >
                      {val}m
                    </button>
                  )
                })}
              </div>

              {/* Réglage précis avec stepper */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginTop: '4px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: '10px', opacity: 0.7 }}>Pas sur mesure :</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <button
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      background: 'var(--panel-2)',
                      color: 'inherit',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                    }}
                    onClick={() => {
                      const step = store.gridSpacing > 2 ? 1 : 0.5
                      const next = Math.max(0.1, Math.round((store.gridSpacing - step) * 10) / 10)
                      store.setGridSpacing(next)
                    }}
                    title="Diminuer le pas"
                  >
                    -
                  </button>
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
                      width: '46px',
                      padding: '2px 4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      background: 'var(--paper)',
                      color: 'var(--ink)',
                      textAlign: 'center',
                    }}
                  />
                  <span style={{ fontSize: '10px', opacity: 0.8 }}>m</span>
                  <button
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      background: 'var(--panel-2)',
                      color: 'inherit',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                    }}
                    onClick={() => {
                      const step = store.gridSpacing >= 2 ? 1 : 0.5
                      const next = Math.round((store.gridSpacing + step) * 10) / 10
                      store.setGridSpacing(next)
                    }}
                    title="Augmenter le pas"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Accrochage quick toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: '10px', opacity: 0.7 }}>Aimantation (Snap) :</span>
                <button
                  onClick={() => store.toggleSnap()}
                  style={{
                    padding: '2px 8px',
                    fontSize: '10px',
                    fontWeight: 600,
                    borderRadius: '10px',
                    border: 'none',
                    background: store.snap ? 'var(--accent)' : 'var(--panel-2)',
                    color: store.snap ? 'var(--accent-fg)' : 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {store.snap ? 'Activé (G)' : 'Désactivé'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
