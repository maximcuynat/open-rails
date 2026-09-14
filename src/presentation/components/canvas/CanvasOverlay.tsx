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
  const layer = store.activePlacementLayer

  // Live placement stats (Clarity & Feedback)
  const isPlacing = (store.tool === 'place' && store.lastNodeId !== null) ||
                    (store.tool === 'curve' && store.curveState.phase === 1 && store.curveState.startId !== null)

  const activeNodeId = store.tool === 'place' ? store.lastNodeId : store.curveState.startId
  const activeNode = activeNodeId ? store.network.nodes.get(activeNodeId) : null
  const cursor = store.snap ? store.snappedCursor : store.cursorWorld
  const currentZ = store.activePlacementAltitude

  let currentDist = 0
  let currentSlope = 0
  if (activeNode) {
    const dx = cursor.x - activeNode.pos.x
    const dy = cursor.y - activeNode.pos.y
    currentDist = Math.hypot(dx, dy)
    const dz = currentZ - (activeNode.z ?? 0)
    currentSlope = currentDist > 0 ? (dz / currentDist) * 1000 : 0
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
          <span className="hud-sep" />
          {store.tool === 'curve' && (
            <>
              <span className="hud-pill hud-pill-amber">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '4px' }}>
                  <path d="M4 20C4 20 7 8 20 5" />
                </svg>
                {store.trackMode === 'freeform' ? 'Flex' : `R${store.selectedCurveRadius}m (${store.selectedCurveAngle}°)`}
              </span>
              <span className="hud-sep" />
            </>
          )}
          <span className="hud-pill hud-pill-emerald">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '4px' }}>
              <path d="M3 20h18L12 4z" />
            </svg>
            Z: {currentZ.toFixed(1)}m {Math.abs(currentSlope) >= 0.5 && `(${currentSlope > 0 ? '+' : ''}${currentSlope.toFixed(1)}‰)`}
          </span>
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
      {layer !== 0 && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: layer > 0 ? 'rgba(2, 132, 199, 0.9)' : 'rgba(51, 65, 85, 0.9)',
            color: '#ffffff',
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: '11px',
            fontWeight: 700,
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>{layer > 0 ? `Pont (+${layer})` : `Tunnel (${layer})`}</span>
          <span style={{ fontSize: '10px', opacity: 0.8 }}>(Touches + / -)</span>
        </div>
      )}
      {hint && <div className="canvas-hint">{hint}</div>}
    </div>
  )
}
