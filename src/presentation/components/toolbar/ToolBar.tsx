import { useState, useRef, useEffect, type ReactNode } from 'react'
import type { EditorStore, SignalSubMode, Tool } from '@application/state/editorStore'
import type { ActionId } from '@application/keybindings/keybindings'
import { ROLLING_STOCK, type RollingStockModel } from '@domain/models/rollingStock'
import type { SignallingLevel } from '@domain/models/signals'
import { signalPalette } from './signalPalette'
import { DATASET_LOCKED_MESSAGE, DATASET_LOCKED_TOOLS } from '@domain/dataset/datasetRecipe'

interface ToolDef {
  id: Tool
  label: string
  icon: ReactNode
  group: number
  /** Key shown in the tooltip. Absent: the action `tool.<id>`; null: the tool has no key of its own */
  shortcut?: ActionId | null
}

const TOOLS: ToolDef[] = [
  {
    id: 'select',
    label: 'Sélection et déplacement · glisser le fond pour déplacer la vue',
    group: 0,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3l14 7-6 2-2 6z" />
      </svg>
    ),
  },
  {
    id: 'pan',
    label: 'Déplacer la vue uniquement',
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
    id: 'place',
    label: 'Tracé de voie (Smart Track)',
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
  {
    id: 'signal',
    label: 'Signalisation (signaux et limites de vitesse)',
    group: 4,
    // The keys go to the tools inside the mode
    shortcut: null,
    icon: (
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="2" width="8" height="14" rx="3" />
        <circle cx="12" cy="6.5" r="1.4" fill="currentColor" />
        <circle cx="12" cy="11.5" r="1.4" />
        <path d="M12 16v6M8 22h8" />
      </svg>
    ),
  },
]

const SIGNAL_ICON_PROPS = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** Icons of the tools of the signalling mode (see `signalPalette` for the tools themselves) */
const SIGNAL_ICONS: Record<SignallingLevel, Partial<Record<SignalSubMode, ReactNode>>> & { common: Record<'select' | 'speedZone' | 'delete', ReactNode> } = {
  common: {
    select: (
      <svg {...SIGNAL_ICON_PROPS}>
        <path d="M3 3l7 18 3-7 7-3z" />
      </svg>
    ),
    speedZone: (
      <svg {...SIGNAL_ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 15.5v-7M12.5 9.5a1.5 1.5 0 0 1 3 0v5a1.5 1.5 0 0 1-3 0z" strokeWidth="1.8" />
      </svg>
    ),
    delete: (
      <svg {...SIGNAL_ICON_PROPS}>
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    ),
  },
  standard: {
    // A mast and a round lamp
    blockSignal: (
      <svg {...SIGNAL_ICON_PROPS}>
        <circle cx="12" cy="7" r="4.5" />
        <circle cx="12" cy="7" r="1.3" fill="currentColor" />
        <path d="M12 11.5V21M8 21h8" />
      </svg>
    ),
    // A mast and a diamond
    pathSignal: (
      <svg {...SIGNAL_ICON_PROPS}>
        <path d="M12 2l5.5 5.5L12 13 6.5 7.5z" />
        <circle cx="12" cy="7.5" r="1.3" fill="currentColor" />
        <path d="M12 13v8M8 21h8" />
      </svg>
    ),
  },
  pro: {
    // Target with one lamp and its plate
    blockSignal: (
      <svg {...SIGNAL_ICON_PROPS}>
        <rect x="8" y="2" width="8" height="11" rx="4" />
        <circle cx="12" cy="7.5" r="1.5" fill="currentColor" />
        <path d="M12 13v8M9 17h6" />
      </svg>
    ),
    // Target with two lamps
    pathSignal: (
      <svg {...SIGNAL_ICON_PROPS}>
        <rect x="8" y="2" width="8" height="13" rx="4" />
        <circle cx="12" cy="6" r="1.4" fill="currentColor" />
        <circle cx="12" cy="11" r="1.4" fill="currentColor" />
        <path d="M12 15v6M9 21h6" />
      </svg>
    ),
    // Square board with a triangle
    cabMarker: (
      <svg {...SIGNAL_ICON_PROPS}>
        <rect x="5" y="3" width="14" height="14" rx="1" />
        <path d="M9 13l3-6 3 6z" fill="currentColor" />
        <path d="M12 17v4" />
      </svg>
    ),
  },
}

function signalIcon(level: SignallingLevel, mode: SignalSubMode): ReactNode {
  if (mode === 'select' || mode === 'speedZone' || mode === 'delete') return SIGNAL_ICONS.common[mode]
  return SIGNAL_ICONS[level][mode] ?? SIGNAL_ICONS.pro[mode]
}

export function ToolBar({ store }: { store: EditorStore }) {
  const kbd = (action: ActionId) => {
    const label = store.shortcutLabel(action)
    return label ? <kbd>{label}</kbd> : null
  }
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

  const isTrainMode = store.tool === 'locomotive' || store.tool === 'coupling'
  const isSignalMode = store.tool === 'signal'
  const palette = signalPalette(store.signallingLevel)

  const handleDragStart = (e: React.DragEvent, itemType: 'tgv_loco' | 'tgv_wagon') => {
    e.dataTransfer.setData('application/open-rails-train', itemType)
    e.dataTransfer.setData('text/plain', itemType)
    e.dataTransfer.effectAllowed = 'copy'
    store.startTrainDrag(itemType, { x: e.clientX, y: e.clientY })
  }

  // --- ÎLE 1 : RAILS & OUTILS ---
  const toolItems: ReactNode[] = []
  let lastGroup = -1
  for (const t of TOOLS) {
    if (t.group !== lastGroup && toolItems.length > 0) {
      toolItems.push(<div key={`sep-${t.group}`} className="tb-sep" />)
    }
    lastGroup = t.group
    const active = store.tool === t.id
    // The track of a dataset project is read only: its drawing tools are greyed out
    const locked = store.isNetworkLocked && !DATASET_LOCKED_TOOLS.has(t.id)
    toolItems.push(
      <div
        key={t.id}
        className="tb-btn-wrap"
        onMouseEnter={() => setHoverId(t.id)}
        onMouseLeave={() => setHoverId((h) => (h === t.id ? null : h))}
      >
        <button
          className={`tb-btn${active ? ' active' : ''}${locked ? ' is-locked' : ''}`}
          onClick={() => store.setTool(t.id)}
          aria-label={locked ? `${t.label} (${DATASET_LOCKED_MESSAGE})` : t.label}
          aria-pressed={active}
          disabled={locked}
        >
          {t.icon}
        </button>
        {hoverId === t.id && (
          <div className="tb-tooltip">
            {locked ? DATASET_LOCKED_MESSAGE : t.label}
            {!locked && t.shortcut !== null && kbd(t.shortcut ?? (`tool.${t.id}` as ActionId))}
          </div>
        )}
      </div>,
    )
  }

  // Undo / redo: the same two buttons close each of the three panels
  const historyButtons = (
    <>
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
    </>
  )

  // Driving: clean view, the toolbar is reduced to the stop control
  if (store.isPlayMode) {
    return (
      <div className="toolbar-container">
        <div className="toolbar-island">
          <div
            className="tb-btn-wrap"
            onMouseEnter={() => setHoverId('play')}
            onMouseLeave={() => setHoverId((h) => (h === 'play' ? null : h))}
          >
            <button
              className="tb-train-btn active-danger"
              onClick={() => store.togglePlayMode()}
              aria-label="Arrêter la conduite"
            >
              <span style={{ fontSize: '15px' }}>⏹</span>
            </button>
            {hoverId === 'play' && (
              <div className="tb-tooltip">
                Arrêter la conduite
                {kbd('drive.exit')}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="toolbar-container">
      <div className="toolbar-switch-wrapper">
        {isSignalMode ? (
          /* ─── Mode Signalisation ─── */
          <div
            className={`toolbar-island toolbar-train toolbar-panel-enter${palette.badge ? ' toolbar-signal-pro' : ''}`}
            key={`signal-toolbar-${palette.level}`}
            aria-label={palette.title}
          >
            {palette.badge && (
              <div className="tb-level-badge" title={palette.title}>{palette.badge}</div>
            )}
            <div
              className="tb-btn-wrap"
              onMouseEnter={() => setHoverId('back-rails')}
              onMouseLeave={() => setHoverId((h) => (h === 'back-rails' ? null : h))}
            >
              <button
                className="tb-back-btn"
                onClick={() => store.exitSignalMode()}
                aria-label="Retour au tracé des voies"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              {hoverId === 'back-rails' && (
                <div className="tb-tooltip">
                  Retour au tracé des voies
                  <kbd>Échap</kbd>
                </div>
              )}
            </div>

            <div className="tb-sep" />

            {palette.tools.map((t) => {
              const id = `signal-${t.mode}`
              const active = store.signalToolSubMode === t.mode
              return (
                <div
                  key={id}
                  className="tb-btn-wrap"
                  onMouseEnter={() => setHoverId(id)}
                  onMouseLeave={() => setHoverId((h) => (h === id ? null : h))}
                >
                  <button
                    className={`tb-train-btn${active ? (t.danger ? ' active-danger' : ' active') : ''}`}
                    // A second click on a tool goes back to the selection, like the train deletion
                    onClick={() => store.setSignalToolSubMode(active ? 'select' : t.mode)}
                    aria-label={t.label}
                    aria-pressed={active}
                  >
                    {signalIcon(palette.level, t.mode)}
                  </button>
                  {hoverId === id && (
                    <div className="tb-tooltip">
                      {t.label}
                      <span style={{ fontSize: '10px', opacity: 0.8, display: 'block' }}>{t.hint}</span>
                      {t.shortcut && kbd(t.shortcut)}
                      {t.fixedKey && <kbd>{t.fixedKey}</kbd>}
                    </div>
                  )}
                </div>
              )
            })}

            <div className="tb-sep" />

            {/* Displays: blocks, and the track held for each train while driving */}
            {([
              {
                id: 'signal-blocks',
                label: 'Afficher les cantons',
                hint: 'Chaque canton d’une couleur, du côté de son sens de marche · affichés pendant la pose d’un signal, sauf si la case est décochée',
                active: store.signalBlocksVisible,
                toggle: store.toggleSignalBlocks,
                icon: (
                  <svg {...SIGNAL_ICON_PROPS}>
                    <path d="M3 8h7" />
                    <path d="M14 8h7" opacity="0.55" />
                    <path d="M3 16h4" opacity="0.55" />
                    <path d="M11 16h10" />
                  </svg>
                ),
              },
              {
                id: 'signal-reservations',
                label: 'Afficher les réservations',
                hint: 'En conduite : la voie réservée pour chaque rame',
                active: store.showSignalReservations,
                toggle: store.toggleSignalReservations,
                icon: (
                  <svg {...SIGNAL_ICON_PROPS}>
                    <rect x="3" y="9" width="8" height="6" rx="1" />
                    <path d="M13 12h8M18 9l3 3-3 3" />
                  </svg>
                ),
              },
            ] as const).map((d) => (
              <div
                key={d.id}
                className="tb-btn-wrap"
                onMouseEnter={() => setHoverId(d.id)}
                onMouseLeave={() => setHoverId((h) => (h === d.id ? null : h))}
              >
                <button
                  className={`tb-train-btn tb-display-btn${d.active ? ' active' : ''}`}
                  onClick={() => d.toggle()}
                  aria-label={d.label}
                  aria-pressed={d.active}
                >
                  {d.icon}
                </button>
                {hoverId === d.id && (
                  <div className="tb-tooltip">
                    {d.label}
                    <span style={{ fontSize: '10px', opacity: 0.8, display: 'block' }}>{d.hint}</span>
                  </div>
                )}
              </div>
            ))}

            <div className="tb-sep" />

            {historyButtons}
          </div>
        ) : isTrainMode ? (
          /* ─── Mode Train Sidebar ─── */
          <div className="toolbar-island toolbar-train toolbar-panel-enter" key="train-toolbar">
            {/* Bouton Retour aux Voies */}
            <div
              className="tb-btn-wrap"
              onMouseEnter={() => setHoverId('back-rails')}
              onMouseLeave={() => setHoverId((h) => (h === 'back-rails' ? null : h))}
            >
              <button
                className="tb-back-btn"
                onClick={() => store.exitTrainMode()}
                aria-label="Retour au tracé des voies"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              {hoverId === 'back-rails' && (
                <div className="tb-tooltip">
                  Retour au tracé des voies
                  <kbd>Échap</kbd>
                </div>
              )}
            </div>

            <div className="tb-sep" />

            {/* Outil 1 : Sélection Train / Véhicule */}
            <div
              className="tb-btn-wrap"
              onMouseEnter={() => setHoverId('train-select')}
              onMouseLeave={() => setHoverId((h) => (h === 'train-select' ? null : h))}
            >
              <button
                onClick={() => store.setTrainToolSubMode('select')}
                className={`tb-train-btn${store.tool === 'locomotive' && store.trainToolSubMode === 'select' ? ' active' : ''}`}
                aria-label="Sélectionner train ou wagon"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l7 18 3-7 7-3z" />
                </svg>
              </button>
              {hoverId === 'train-select' && (
                <div className="tb-tooltip">
                  Sélectionner un convoi ou un wagon
                  <span style={{ fontSize: '10px', opacity: 0.8, display: 'block' }}>
                    Cliquer sur un véhicule pour le cibler ou le supprimer
                  </span>
                </div>
              )}
            </div>

            {/* Outil 2 : Poser Locomotive TGV (Draggable & Clickable) */}
            <div
              className="tb-btn-wrap"
              onMouseEnter={() => setHoverId('train-loco')}
              onMouseLeave={() => setHoverId((h) => (h === 'train-loco' ? null : h))}
            >
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, 'tgv_loco')}
                onDragEnd={() => store.cancelTrainDrag()}
                onClick={() => store.setTrainPlacementKind('tgv_loco')}
                className={`tb-train-btn${store.tool === 'locomotive' && store.trainToolSubMode === 'place' && store.trainPlacementKind === 'tgv_loco' ? ' active' : ''}`}
                aria-label="Locomotive"
                style={{ cursor: 'grab' }}
              >
                <svg viewBox="0 0 24 24" width="22" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 14h14c1.5 0 3-1 4-3l-2-3H5c-1.5 0-3 1-3 3v3z" fill="currentColor" fillOpacity="0.25" />
                  <path d="M12 8l2 3H8V8h4z" fill="currentColor" fillOpacity="0.4" />
                  <circle cx="6" cy="17" r="1.8" fill="currentColor" />
                  <circle cx="14" cy="17" r="1.8" fill="currentColor" />
                </svg>
              </div>
              {hoverId === 'train-loco' && (
                <div className="tb-tooltip">
                  Motrice TGV
                  <span style={{ fontSize: '10px', opacity: 0.8, display: 'block' }}>
                    Cliquer puis poser sur la voie, clic après clic · ou glisser sur la voie
                  </span>
                </div>
              )}
            </div>

            {/* Outil 3 : Poser Wagon Voyageurs (Draggable & Clickable) */}
            <div
              className="tb-btn-wrap"
              onMouseEnter={() => setHoverId('train-wagon')}
              onMouseLeave={() => setHoverId((h) => (h === 'train-wagon' ? null : h))}
            >
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, 'tgv_wagon')}
                onDragEnd={() => store.cancelTrainDrag()}
                onClick={() => store.setTrainPlacementKind('tgv_wagon')}
                className={`tb-train-btn${store.tool === 'locomotive' && store.trainToolSubMode === 'place' && store.trainPlacementKind === 'tgv_wagon' ? ' active' : ''}`}
                aria-label="Wagon"
                style={{ cursor: 'grab' }}
              >
                <svg viewBox="0 0 24 24" width="22" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="8" rx="1.5" fill="currentColor" fillOpacity="0.25" />
                  <rect x="5" y="9" width="3" height="3" rx="0.5" fill="currentColor" fillOpacity="0.5" />
                  <rect x="10" y="9" width="3" height="3" rx="0.5" fill="currentColor" fillOpacity="0.5" />
                  <rect x="15" y="9" width="3" height="3" rx="0.5" fill="currentColor" fillOpacity="0.5" />
                  <circle cx="6" cy="18" r="1.8" fill="currentColor" />
                  <circle cx="17" cy="18" r="1.8" fill="currentColor" />
                </svg>
              </div>
              {hoverId === 'train-wagon' && (
                <div className="tb-tooltip">
                  Wagon voyageurs
                  <span style={{ fontSize: '10px', opacity: 0.8, display: 'block' }}>
                    Cliquer puis poser sur la voie, clic après clic · ou glisser sur la voie
                  </span>
                </div>
              )}
            </div>

            {/* Matériel des véhicules posés : TGV Duplex / TGV M */}
            {(Object.keys(ROLLING_STOCK) as RollingStockModel[]).map((model) => (
              <div
                key={model}
                className="tb-btn-wrap"
                onMouseEnter={() => setHoverId(`train-model-${model}`)}
                onMouseLeave={() => setHoverId((h) => (h === `train-model-${model}` ? null : h))}
              >
                <button
                  onClick={() => store.setTrainPlacementModel(model)}
                  className={`tb-train-btn${store.trainPlacementModel === model ? ' active' : ''}`}
                  aria-label={ROLLING_STOCK[model].label}
                  aria-pressed={store.trainPlacementModel === model}
                >
                  <span style={{ fontSize: '9px', fontWeight: 700 }}>{ROLLING_STOCK[model].label.replace('TGV ', '')}</span>
                </button>
                {hoverId === `train-model-${model}` && (
                  <div className="tb-tooltip">
                    {ROLLING_STOCK[model].label}
                    <span style={{ fontSize: '10px', opacity: 0.8, display: 'block' }}>
                      Matériel des motrices et remorques posées ensuite
                    </span>
                  </div>
                )}
              </div>
            ))}

            {/* Outil Inverser sens / orientation (R) */}
            <div
              className="tb-btn-wrap"
              onMouseEnter={() => setHoverId('flip')}
              onMouseLeave={() => setHoverId((h) => (h === 'flip' ? null : h))}
            >
              <button
                className="tb-train-btn"
                onClick={() => {
                  if (store.tool === 'locomotive' && store.trainToolSubMode === 'place') {
                    store.flipTrainPlacementDirection()
                  } else {
                    store.flipLocomotiveDirection()
                  }
                }}
                aria-label="Inverser le sens"
                style={{ color: '#c084fc' }}
              >
                <span style={{ fontSize: '16px' }}>⇄</span>
              </button>
              {hoverId === 'flip' && (
                <div className="tb-tooltip">
                  {store.tool === 'locomotive' && store.trainToolSubMode === 'place'
                    ? 'Inverser l’orientation de pose'
                    : 'Inverser le sens de conduite'}
                  <kbd>R</kbd>
                </div>
              )}
            </div>

            <div className="tb-sep" />

            {/* Outil 4 : Couplage / Découplage */}
            <div
              className="tb-btn-wrap"
              onMouseEnter={() => setHoverId('coupling')}
              onMouseLeave={() => setHoverId((h) => (h === 'coupling' ? null : h))}
            >
              <button
                className={`tb-train-btn${store.tool === 'coupling' ? ' active' : ''}`}
                onClick={() => store.toggleCouplingMode()}
                aria-label="Coupler"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                </svg>
              </button>
              {hoverId === 'coupling' && (
                <div className="tb-tooltip">
                  Mode Couplage
                  <span style={{ fontSize: '10px', opacity: 0.8, display: 'block' }}>
                    Cliquer deux extrémités pour atteler / joint pour découpler
                  </span>
                </div>
              )}
            </div>

            {/* Outil 5 : Supprimer Véhicule / Train (Mode Suppression interactif) */}
            <div
              className="tb-btn-wrap"
              onMouseEnter={() => setHoverId('delete-train')}
              onMouseLeave={() => setHoverId((h) => (h === 'delete-train' ? null : h))}
            >
              <button
                className={`tb-train-btn${store.tool === 'locomotive' && store.trainToolSubMode === 'delete' ? ' active-danger' : ''}`}
                onClick={() => {
                  store.setTrainToolSubMode(store.trainToolSubMode === 'delete' ? 'select' : 'delete')
                }}
                aria-label="Outil suppression de train"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
              {hoverId === 'delete-train' && (
                <div className="tb-tooltip">
                  Outil Suppression
                  <span style={{ fontSize: '10px', opacity: 0.8, display: 'block' }}>
                    {store.trainToolSubMode === 'delete'
                      ? 'Mode suppression actif : survol rouge et clic pour supprimer'
                      : 'Activer la suppression au survol (contour rouge) et clic'}
                  </span>
                  <kbd>Suppr</kbd>
                </div>
              )}
            </div>

            {/* Contrôles du train */}
            {(store.trains.length > 0 || store.locomotive) && (
              <>
                <div className="tb-sep" />

                {/* Piloter / Stop */}
                <div
                  className="tb-btn-wrap"
                  onMouseEnter={() => setHoverId('play')}
                  onMouseLeave={() => setHoverId((h) => (h === 'play' ? null : h))}
                >
                  <button
                    className="tb-train-btn"
                    style={{ color: '#10b981' }}
                    onClick={() => store.togglePlayMode()}
                    aria-label="Piloter le train"
                  >
                    <span style={{ fontSize: '15px' }}>▶</span>
                  </button>
                  {hoverId === 'play' && (
                    <div className="tb-tooltip">
                      Prendre les commandes
                      {kbd('sim.togglePlay')}
                    </div>
                  )}
                </div>

                {/* Debug squelette */}
                <div
                  className="tb-btn-wrap"
                  onMouseEnter={() => setHoverId('debug')}
                  onMouseLeave={() => setHoverId((h) => (h === 'debug' ? null : h))}
                >
                  <button
                    className={`tb-train-btn${store.showTrainDebug ? ' active' : ''}`}
                    onClick={() => store.toggleTrainDebug()}
                    aria-label="Debug squelette"
                  >
                    <span style={{ fontSize: '15px' }}>⚙</span>
                  </button>
                  {hoverId === 'debug' && (
                    <div className="tb-tooltip">
                      Squelette cinématique
                      {kbd('train.debug')}
                    </div>
                  )}
                </div>

                {/* Fleet counter badge */}
                {store.trains.length > 0 && (
                  <div
                    style={{
                      marginTop: '2px',
                      padding: '2px',
                      borderRadius: '5px',
                      background: 'rgba(56, 189, 248, 0.15)',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      fontSize: '8px',
                      fontWeight: 700,
                      color: '#38bdf8',
                      textAlign: 'center',
                      width: '34px',
                      boxSizing: 'border-box',
                      lineHeight: 1.1,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      const idx = store.trains.findIndex(t => t.id === store.selectedTrainId)
                      const nextIdx = (idx + 1) % store.trains.length
                      store.selectTrainById(store.trains[nextIdx].id)
                    }}
                    title="Cliquer pour sélectionner le convoi suivant"
                  >
                    <div>{store.trains.length} r.</div>
                    <div style={{ fontSize: '7px', opacity: 0.8 }}>
                      T{store.trains.findIndex(t => t.id === store.selectedTrainId) + 1}/{store.trains.length}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="tb-sep" />

            {historyButtons}
          </div>
        ) : (
          /* ─── Mode Rails Toolbar ─── */
          <div className="toolbar-island toolbar-rails-panel toolbar-panel-enter" key="rails-toolbar">
            {toolItems}

            <div className="tb-sep" />

            {historyButtons}

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
                title={`Créer une voie double parallèle à partir des 2 nœuds sélectionnés${store.shortcutHint('edit.parallelTrack')}`}
                onClick={() => store.createParallelTrackFromSelection()}
              >
                <div>+2v</div>
                <div style={{ fontSize: '8px', opacity: 0.8 }}>{store.shortcutHint('edit.parallelTrack').trim()}</div>
              </div>
            )}
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
            aria-label="Activer ou désactiver l’aimantation"
            aria-pressed={store.snap}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4v16M4 12h16M20 4v16M12 4v16" opacity="0.5" />
              <circle cx="12" cy="12" r="3" fill="currentColor" />
            </svg>
          </button>
          {hoverId === 'snap' && (
            <div className="tb-tooltip">
              Aimantation {store.snap ? '(active)' : '(inactive)'}
              {kbd('view.toggleSnap')}
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
              {store.showGrid ? 'Masquer la grille' : 'Afficher la grille'}
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
                <span style={{ fontSize: '10px', opacity: 0.7 }}>Aimantation :</span>
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
                  {store.snap ? `Activé${store.shortcutHint('view.toggleSnap')}` : 'Désactivé'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
