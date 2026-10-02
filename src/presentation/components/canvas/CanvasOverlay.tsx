import type { EditorStore } from '@application/state/editorStore'
import { getLocomotiveFrontPos } from '@domain/models/locomotive'
import { screenToWorld } from '@infrastructure/render/camera'
import { TrainBuilderPalette } from '../train-builder/TrainBuilderPalette'

/** Contextual hint shown at the bottom-center of the canvas. */
function hintText(store: EditorStore): string {
  if (store.isPlayMode) {
    return '▶ Conduite · ↑ Accélérer · ↓ Freiner · R Changer de motrice · D Squelette · ←/→ Aiguillage · Espace Quitter'
  }
  switch (store.tool) {
    case 'place':
      return store.lastNodeId
        ? 'Clic pour poser le prochain rail · Clic-droit ou Échap pour terminer'
        : 'Clic pour poser le premier nœud de voie'
    case 'curve':
      return store.curveState.phase === 1
        ? 'Clic pour poser le coupon · Tab pour inverser côté · Échap pour annuler'
        : 'Clic pour définir le point de départ de la courbe'
    case 'turnout':
      return store.turnoutStartId
        ? 'Déplacez le curseur pour fixer la fin et l’espacement · Clic pour poser · Échap pour annuler'
        : 'Clic pour définir le point de départ de l’aiguillage sur une voie'
    case 'split':
      return 'Cliquez sur un rail pour le découper ou sur un nœud pour le détacher'
    case 'measure':
      return store.measureStart
        ? 'Clic pour fixer la mesure · Échap pour réinitialiser'
        : 'Clic pour fixer le point de départ de la mesure'
    case 'select':
      return store.selection.nodes.size > 0
        ? 'Glisser les flèches orthogonales (X/Y) pour déplacer le nœud · Glisser le centre pour déplacement libre · Suppr pour effacer'
        : 'Clic pour sélectionner un élément · Glissez un train ou un wagon sur les rails'
    case 'pan':
      return store.selection.nodes.size > 0
        ? 'Glisser les flèches (X/Y) pour déplacer le nœud · Glisser le fond pour déplacer la vue'
        : 'Glisser pour déplacer la vue · Clic sur un nœud pour afficher ses flèches de déplacement'
    default:
      if (store.tool === 'locomotive' || store.isTrainSelected) {
        return store.locomotive
          ? 'Glissez un wagon sur le train ou cliquez sur la motrice pour Prendre le contrôle (Espace)'
          : 'Glissez une motrice ou un wagon sur les rails pour poser le train'
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
          store.handleDropTrainItem(itemType, world)
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
      {/* Live Engineering HUD during placement */}
      {isPlacing && activeNode && (
        <div className="hud-realtime-card">
          <span className="hud-pill hud-pill-accent">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '4px' }}>
              <path d="M21 21L3 3v18h18z" />
            </svg>
            {currentDist.toFixed(1)} m
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
                Voie double ({store.parallelOffset}m)
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
            title="Prendre les commandes du train (Espace)"
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            <span style={{ fontSize: '15px' }}>🎮</span>
            <span>Prendre le contrôle</span>
          </button>
        </div>
      )}

      {/* Train Builder Palette (Drag & drop motrice + wagons + controls) */}
      {(store.tool === 'locomotive' || store.isTrainSelected) && !store.isPlayMode && (
        <div
          style={{
            position: 'absolute',
            bottom: '54px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
            pointerEvents: 'auto',
          }}
        >
          <TrainBuilderPalette store={store} />
        </div>
      )}

      {/* Live Play Mode HUD */}
      {store.isPlayMode && store.locomotive && (
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
      {hint && <div className="canvas-hint">{hint}</div>}
    </div>
  )
}
