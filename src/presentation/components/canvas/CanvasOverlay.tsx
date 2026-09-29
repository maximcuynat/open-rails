import type { EditorStore } from '@application/state/editorStore'

/** Contextual hint shown at the bottom-center of the canvas. */
function hintText(store: EditorStore): string {
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
    case 'autoconnect':
      return store.autoConnectStartId
        ? 'Clic sur le second bout de voie pour relier automatiquement · Échap pour annuler'
        : 'Clic sur le premier bout de voie à relier'
    case 'crossover':
      return 'Survolez 2 voies parallèles pour insérer une bretelle courbe en S · Échap pour annuler'
    case 'siding':
      return 'Survolez une voie pour positionner l’évitement · Tab pour inverser côté · Clic pour poser'
    case 'loop':
      return 'Survolez une fin de voie pour générer une raquette · Tab pour inverser côté · Clic pour poser'
    case 'split':
      return 'Cliquez sur un rail pour le découper ou sur un nœud pour le détacher'
    case 'measure':
      return store.measureStart
        ? 'Clic pour fixer la mesure · Échap pour réinitialiser'
        : 'Clic pour fixer le point de départ de la mesure'
    case 'select':
      return 'Clic pour sélectionner · Ctrl/Shift+Clic pour multi-sélection · Suppr pour effacer'
    case 'pan':
      return 'Glisser pour déplacer la vue · Molette pour zoomer'
    default:
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

      {curvePhase !== null && (
        <div className="phase-badge">{curvePhase === 0 ? '1/2' : '2/2'}</div>
      )}
      {hint && <div className="canvas-hint">{hint}</div>}
    </div>
  )
}
