import { TRAIN_PLACEMENT_REFUSED, type EditorStore } from '@application/state/editorStore'
import { getLocomotiveFrontPos, positionOnSegment } from '@domain/models/locomotive'
import { showToast } from '../common/Toast'
import { screenToWorld } from '@infrastructure/render/camera'
import { formatDistance } from '@domain/models/units'
import { FloatingActionBar } from './FloatingActionBar'
import { ContextMenu } from './ContextMenu'

/** Contextual hint shown at the bottom-center of the canvas. */
function hintText(store: EditorStore): string {
  if (store.isPlayMode) {
    return store.selectedTrain
      ? '▶ Conduite · ↑/↓ Cran traction / frein · Maj+↑/↓ Inverseur · ⌫ Arrêt d’urgence · ←/→ Aiguillage · D Squelette · Espace ou Échap Quitter'
      : '▶ Conduite · ↑ Accélérer · ↓ Freiner (maintenir) · R Inverser le sens · ←/→ Aiguillage · D Squelette · Espace ou Échap Quitter'
  }
  switch (store.tool) {
    case 'place':
      return store.lastNodeId
        ? 'Clic pour poser le prochain rail · Tab pour continuer en courbe · Chiffres puis Entrée pour une longueur exacte · Clic droit ou Échap pour terminer'
        : 'Clic pour poser le premier nœud de voie · Échap pour revenir à la sélection'
    case 'curve':
      return store.curveState.phase === 1
        ? 'Clic pour poser la courbe et enchaîner · Clic droit ou Échap pour terminer'
        : 'Clic pour définir le point de départ de la courbe · Échap pour revenir à la sélection'
    case 'turnout':
      return store.turnoutStartId
        ? 'Déplacez le curseur pour fixer la fin et l’espacement · Clic pour poser · Clic droit ou Échap pour annuler'
        : 'Clic sur une voie pour définir le point de départ de l’aiguillage'
    case 'split':
      return 'Cliquez sur un rail pour le découper ou sur un nœud pour le détacher'
    case 'measure':
      if (!store.measureStart) return 'Clic pour fixer le point de départ de la mesure'
      return store.measureEnd
        ? 'Clic pour commencer une nouvelle mesure · Clic droit ou Échap pour effacer'
        : 'Clic pour fixer la mesure · Clic droit ou Échap pour annuler'
    case 'select':
      return store.selection.nodes.size > 0
        ? 'Glisser les axes (X/Y) ou l’arc pour pivoter · Glisser le fond pour déplacer la vue · Suppr pour effacer'
        : 'Clic gauche pour sélectionner · Glisser le fond pour déplacer la vue · Maj + glisser pour un rectangle de sélection · Molette pour zoomer'
    case 'pan':
      return 'Glisser pour déplacer la vue · Molette pour zoomer'
    default:
      if (store.tool === 'coupling') {
        return 'Attelage · Clic sur une extrémité (bleue) proche d’un autre train pour atteler · Clic sur une pastille orange pour dételer · Échap pour quitter'
      }
      if (store.tool === 'locomotive') {
        if (store.trainToolSubMode === 'place') {
          const what = store.trainPlacementKind === 'tgv_wagon' ? 'le wagon' : 'la motrice'
          if (store.couplerSnapTarget) {
            return `Clic pour atteler ${what} au train · Éloignez le curseur pour commencer un nouveau train · Échap pour terminer`
          }
          if (store.trainPlacementPreview) {
            return `Clic pour poser ${what} (nouveau train) · R ou Tab pour inverser le sens · Échap pour terminer`
          }
          return store.trainChain
            ? 'Train en cours · Approchez de son extrémité pour atteler le véhicule suivant, ou d’un autre rail pour un nouveau train · Échap pour terminer'
            : `Approchez le curseur d’un rail pour poser ${what} · R ou Tab pour inverser le sens · Échap pour terminer`
        }
        if (store.trainToolSubMode === 'delete') {
          return store.hoveredTrainDeleteVehicle
            ? 'Véhicule ciblé (contour rouge) · Clic pour le supprimer · Échap pour quitter'
            : 'Suppression · Survolez une motrice ou un wagon puis cliquez · Échap pour quitter'
        }
        const selected = store.selectedTrain?.vehicles.find(v => v.id === store.selectedTrainVehicleId)
        return store.isTrainSelected && selected
          ? `${selected.kind === 'loco' ? 'Motrice sélectionnée' : 'Wagon sélectionné'} · Suppr pour effacer · F5 pour conduire · Échap pour quitter le mode train`
          : 'Cliquez sur une motrice ou un wagon pour le sélectionner · Échap pour quitter le mode train'
      }
      if (store.isTrainSelected && store.selectedTrain) {
        return 'Train sélectionné · Suppr pour effacer · F5 pour conduire'
      }
      return ''
  }
}

export function CanvasOverlay({ store }: { store: EditorStore }) {
  const hint = hintText(store)
  const curvePhase = store.tool === 'curve' ? store.curveState.phase : null

  // Live placement stats (Clarity & Feedback)
  const isPlacing = (store.tool === 'place' && store.lastNodeId !== null) ||
                    (store.tool === 'curve' && store.curveState.phase === 1 && store.curveState.startId !== null) ||
                    (store.tool === 'turnout' && store.turnoutStartId !== null)

  const activeNodeId = store.tool === 'turnout' ? store.turnoutStartId : store.tool === 'place' ? store.lastNodeId : store.curveState.startId
  const activeNode = activeNodeId ? store.network.nodes.get(activeNodeId) : null
  const cursor = store.snap ? store.snappedCursor : store.cursorWorld

  let currentDist = 0
  if (activeNode) {
    const dx = cursor.x - activeNode.pos.x
    const dy = cursor.y - activeNode.pos.y
    currentDist = Math.hypot(dx, dy)
  }

  // Floating pilot button when locomotive is hovered or train is selected
  let pilotSx = 0
  let pilotSy = 0
  let showPilotBtn = false
  if (store.locomotive && !store.isPlayMode) {
    const anchor = store.hoveredTrainAnchor ?? getLocomotiveFrontPos(store.network, store.locomotive)
    if (anchor && (store.hoveredTrainPart !== null || store.isTrainSelected)) {
      pilotSx = (anchor.x - store.camera.x) * store.camera.scale + store.viewport.w / 2
      pilotSy = (anchor.y - store.camera.y) * store.camera.scale + store.viewport.h / 2
      if (pilotSx >= -80 && pilotSx <= store.viewport.w + 80 && pilotSy >= -80 && pilotSy <= store.viewport.h + 80) {
        showPilotBtn = true
      }
    }
  }

  // Badge on the ghost vehicle in train place mode: "attelé au train" vs "nouveau train"
  let placementBadge: { sx: number; sy: number; coupled: boolean; label: string } | null = null
  const ghost = store.trainPlacementPreview?.vehicles[0]
  const isPlacingVehicle = store.draggingTrainItem !== null || (store.tool === 'locomotive' && store.trainToolSubMode === 'place')
  if (ghost && isPlacingVehicle && !store.isPlayMode) {
    const pos = positionOnSegment(store.network, ghost.front.segId, ghost.front.t)
    if (pos) {
      const snap = store.couplerSnapTarget
      placementBadge = {
        sx: (pos.x - store.camera.x) * store.camera.scale + store.viewport.w / 2,
        sy: (pos.y - store.camera.y) * store.camera.scale + store.viewport.h / 2,
        coupled: snap !== null,
        label: snap
          ? `Attelé au train T${store.trains.indexOf(snap.train) + 1} · ${snap.train.vehicles.length + 1} véhicules`
          : `Nouveau train T${store.trains.length + 1}`,
      }
    }
  }

  return (
    <div
      className="canvas-overlay"
      style={{ pointerEvents: 'none' }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        const rect = e.currentTarget.getBoundingClientRect()
        const world = screenToWorld(store.camera, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
        store.cursorWorld = world
        store.updateTrainDrag(world, { x: e.clientX, y: e.clientY })
        store.notify()
      }}
      onDrop={(e) => {
        e.preventDefault()
        const itemType = (e.dataTransfer.getData('application/open-rails-train') ||
          e.dataTransfer.getData('text/plain')) as 'tgv_loco' | 'tgv_wagon'
        const rect = e.currentTarget.getBoundingClientRect()
        const world = screenToWorld(store.camera, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
        if (itemType === 'tgv_loco' || itemType === 'tgv_wagon') {
          if (!store.handleDropTrainItem(itemType, world)) showToast(TRAIN_PLACEMENT_REFUSED, 'warning')
          store.notify()
        }
      }}
    >
      {/* Floating Drag Badge following pointer */}
      {store.draggingTrainItem && store.dragCursorScreen && (
        <div
          style={{
            position: 'fixed',
            left: `${store.dragCursorScreen.x + 14}px`,
            top: `${store.dragCursorScreen.y + 14}px`,
            pointerEvents: 'none',
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1.5px solid #38bdf8',
            borderRadius: '8px',
            padding: '4px 10px',
            fontSize: '11.5px',
            fontWeight: 700,
            color: '#ffffff',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            userSelect: 'none',
          }}
        >
          <span>{store.draggingTrainItem === 'tgv_loco' ? '🚄' : '🚃'}</span>
          <span>{store.draggingTrainItem === 'tgv_loco' ? 'Poser Motrice TGV' : 'Ajouter Voiture'}</span>
        </div>
      )}
      {/* Placement badge on the ghost vehicle: appended to a train, or starting a new one */}
      {placementBadge && (
        <div
          style={{
            position: 'absolute',
            left: `${placementBadge.sx}px`,
            top: `${placementBadge.sy - 34}px`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            background: 'rgba(15, 23, 42, 0.92)',
            border: `1.5px solid ${placementBadge.coupled ? '#34d399' : '#38bdf8'}`,
            borderRadius: '12px',
            padding: '2px 9px',
            fontSize: '11px',
            fontWeight: 700,
            color: placementBadge.coupled ? '#6ee7b7' : '#7dd3fc',
            whiteSpace: 'nowrap',
            zIndex: 40,
            userSelect: 'none',
          }}
        >
          {placementBadge.label}
        </div>
      )}
      {/* Live Engineering HUD during placement */}
      {isPlacing && activeNode && (
        <div className="hud-realtime-card">
          <span className="hud-pill hud-pill-accent">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '4px' }}>
              <path d="M21 21L3 3v18h18z" />
            </svg>
            {formatDistance(currentDist, store.unit)}
          </span>
          {store.tool === 'curve' && (
            <>
              <span className="hud-sep" />
              <span className="hud-pill hud-pill-amber">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '4px' }}>
                  <path d="M4 20C4 20 7 8 20 5" />
                </svg>
                {store.trackMode === 'freeform' ? 'Flex' : `R${store.selectedCurveRadius}m (${store.selectedCurveAngle}°)`}
              </span>
            </>
          )}
          {store.tool === 'turnout' && (
            <>
              <span className="hud-sep" />
              <span className="hud-pill" style={{ color: '#10b981' }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '4px' }}>
                  <line x1="2" y1="18" x2="22" y2="18" />
                  <path d="M5 18c3-4 6-10 11-10h6" />
                </svg>
                Aiguillage parallèle
              </span>
            </>
          )}
          {store.parallelMode && (
            <>
              <span className="hud-sep" />
              <span className="hud-pill" style={{ color: '#60a5fa' }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '4px' }}>
                  <line x1="4" y1="4" x2="4" y2="20" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                  <line x1="20" y1="4" x2="20" y2="20" />
                </svg>
                Voie double ({formatDistance(store.parallelOffset, store.unit)})
              </span>
            </>
          )}
        </div>
      )}

      {/* Floating "Prendre le contrôle" Button above Locomotive on Hover / Select */}
      {showPilotBtn && (
        <div
          style={{
            position: 'absolute',
            left: `${pilotSx}px`,
            top: `${pilotSy - 40}px`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'auto',
            zIndex: 50,
            animation: 'hud-pop 160ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              store.togglePlayMode()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#ffffff',
              border: '1.5px solid #34d399',
              borderRadius: '24px',
              padding: '7px 16px',
              fontSize: '12.5px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
              whiteSpace: 'nowrap',
              transition: 'transform 0.15s ease',
            }}
            title="Prendre les commandes du train (F5)"
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            <span style={{ fontSize: '15px' }}>🎮</span>
            <span>Prendre le contrôle</span>
          </button>
        </div>
      )}


      {/* Live Play Mode HUD */}
      {store.isPlayMode && store.locomotive && store.trains.length === 0 && (
        <div className="hud-realtime-card" style={{ pointerEvents: 'auto', gap: '8px' }}>
          <span className="hud-pill" style={{ color: '#10b981', fontWeight: 600 }}>
            ▶ Conduite ({store.locomotiveLength}m)
          </span>

          <span className="hud-sep" />

          {/* Vitesse en temps réel */}
          <span
            style={{
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 700,
              fontSize: '13px',
              color: '#f8fafc',
              minWidth: '68px',
            }}
          >
            {Math.round(store.locomotiveCurrentSpeed * 3.6)} km/h
          </span>

          <span className="hud-sep" />

          {/* Guide raccourcis clavier */}
          <span style={{ color: '#94a3b8', fontSize: '10.5px' }}>
            <kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', border: '1px solid #334155' }}>↑</kbd> Accélérer &nbsp;
            <kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', border: '1px solid #334155' }}>↓</kbd> Freiner &nbsp;
            <kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', border: '1px solid #334155' }}>R</kbd> Changer de motrice &nbsp;
            <kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', border: '1px solid #334155' }}>D</kbd> Squelette &nbsp;
            <kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', border: '1px solid #334155' }}>←/→</kbd> Aiguillage
          </span>

          <span className="hud-sep" />

          <button
            onClick={() => {
              store.followLocomotiveCamera = !store.followLocomotiveCamera
              if (store.followLocomotiveCamera) store.focusOnLocomotive()
              store.notify()
            }}
            style={{
              background: store.followLocomotiveCamera ? 'rgba(37,99,235,0.2)' : 'transparent',
              border: `1px solid ${store.followLocomotiveCamera ? 'var(--accent, #2563eb)' : 'var(--border, #475569)'}`,
              borderRadius: '4px',
              color: store.followLocomotiveCamera ? 'var(--accent, #60a5fa)' : 'var(--text-muted, #94a3b8)',
              fontSize: '11px',
              padding: '2px 6px',
              cursor: 'pointer',
            }}
            title="Centrer / Suivre automatiquement la locomotive avec la caméra"
          >
            {store.followLocomotiveCamera ? '🎯 Caméra fixée' : 'Libre'}
          </button>

          <button
            onClick={() => store.flipLocomotiveDirection()}
            style={{
              background: 'transparent',
              border: '1px solid var(--border, #475569)',
              borderRadius: '4px',
              color: '#c084fc',
              fontSize: '11px',
              padding: '2px 6px',
              cursor: 'pointer',
            }}
            title="Changer de cabine / motrice active pour repartir dans l'autre sens (Touche R ou Tab)"
          >
            ⇄ Changer de motrice (R)
          </button>

          <button
            onClick={() => store.toggleTrainDebug()}
            style={{
              background: store.showTrainDebug ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
              border: `1px solid ${store.showTrainDebug ? '#38bdf8' : 'var(--border, #475569)'}`,
              borderRadius: '4px',
              color: store.showTrainDebug ? '#38bdf8' : 'var(--text-muted, #94a3b8)',
              fontSize: '11px',
              padding: '2px 6px',
              cursor: 'pointer',
            }}
            title="Afficher les points d'attache, liaisons et accordéons en mode squelette (Touche D)"
          >
            {store.showTrainDebug ? '⚙ Squelette ON' : '⚙ Squelette (D)'}
          </button>
        </div>
      )}

      {curvePhase !== null && (
        <div className="phase-badge">{curvePhase === 0 ? '1/2' : '2/2'}</div>
      )}

      {/* Floating CAD Numeric Input pill (AutoCAD/Blender style) */}
      {store.isNumericInputActive && (
        <div
          style={{
            position: 'absolute',
            left: `${(store.cursorWorld.x - store.camera.x) * store.camera.scale + store.viewport.w / 2 + 20}px`,
            top: `${(store.cursorWorld.y - store.camera.y) * store.camera.scale + store.viewport.h / 2 - 25}px`,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1.5px solid #38bdf8',
            borderRadius: '6px',
            padding: '3px 8px',
            color: '#38bdf8',
            fontSize: '12px',
            fontWeight: 700,
            boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
            zIndex: 100,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            animation: 'action-pill-pop 100ms ease',
          }}
        >
          <span style={{ fontSize: '10px', color: '#94a3b8' }}>Longueur :</span>
          <span>{store.numericInput}</span>
          <span style={{ fontSize: '10px' }}>{store.unit} ↵</span>
        </div>
      )}

      {/* Contextual Floating Action Bar above selected track / junction */}
      <FloatingActionBar store={store} viewport={store.viewport} />

      {/* Context Menu on right-click without drag */}
      <ContextMenu store={store} />

      {hint && <div className="canvas-hint">{hint}</div>}
    </div>
  )
}
