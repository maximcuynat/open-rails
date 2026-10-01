import type { EditorStore } from '@application/state/editorStore'

/** Contextual hint shown at the bottom-center of the canvas. */
function hintText(store: EditorStore): string {
  if (store.isPlayMode) {
    return '▶ Mode Play · ↑ Avancer · ↓ Refouler · ←→ Aiguillage · R Inverser sens · Espace Quitter'
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
        : 'Clic pour sélectionner un nœud · Ctrl/Shift+Clic pour multi-sélection'
    case 'pan':
      return store.selection.nodes.size > 0
        ? 'Glisser les flèches (X/Y) pour déplacer le nœud · Glisser le fond pour déplacer la vue'
        : 'Glisser pour déplacer la vue · Clic sur un nœud pour afficher ses flèches de déplacement'
    default:
      if (store.tool === 'locomotive') {
        return store.locomotive
          ? 'Clic sur un rail pour repositionner · Espace pour Play'
          : 'Clic sur un rail pour poser la locomotive'
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

  return (
    <div className="canvas-overlay" style={{ pointerEvents: 'none' }}>
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

          {/* Badge cinématique : Accélération / Décélération / Inertie / Arrêt */}
          {store.locomotiveThrottle === 1 && (
            <span
              style={{
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid #10b981',
                color: '#34d399',
                borderRadius: '4px',
                padding: '1px 6px',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              ▲ Accélération
            </span>
          )}
          {store.locomotiveThrottle === -1 && (
            <span
              style={{
                background: 'rgba(244, 63, 94, 0.2)',
                border: '1px solid #f43f5e',
                color: '#fb7185',
                borderRadius: '4px',
                padding: '1px 6px',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              ▼ Décélération
            </span>
          )}
          {store.locomotiveThrottle === 0 && store.locomotiveCurrentSpeed > 0.1 && (
            <span
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid #38bdf8',
                color: '#7dd3fc',
                borderRadius: '4px',
                padding: '1px 6px',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              ≋ Inertie
            </span>
          )}
          {store.locomotiveThrottle === 0 && store.locomotiveCurrentSpeed <= 0.1 && (
            <span
              style={{
                background: 'rgba(148, 163, 184, 0.15)',
                border: '1px solid #64748b',
                color: '#94a3b8',
                borderRadius: '4px',
                padding: '1px 6px',
                fontSize: '11px',
              }}
            >
              ⏹ À l'arrêt
            </span>
          )}

          <span className="hud-sep" />

          {/* Guide raccourcis clavier */}
          <span style={{ color: '#94a3b8', fontSize: '10.5px' }}>
            <kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', border: '1px solid #334155' }}>↑</kbd> Accélérer &nbsp;
            <kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', border: '1px solid #334155' }}>↓</kbd> Décélérer &nbsp;
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
            title="Inverser le sens de la locomotive (Touche R ou Tab)"
          >
            ⇄ Sens (R)
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
