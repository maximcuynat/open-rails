import type { EditorStore } from './store'

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
      return 'Clic pour sélectionner · Glisser un nœud pour ajuster · Suppr pour effacer'
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

  return (
    <div className="canvas-overlay" style={{ pointerEvents: 'none' }}>
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
          <span>{layer > 0 ? `🌉 Mode Pont (+${layer})` : `🚇 Mode Tunnel (${layer})`}</span>
          <span style={{ fontSize: '10px', opacity: 0.8 }}>(Touches + / -)</span>
        </div>
      )}
      {hint && <div className="canvas-hint">{hint}</div>}
    </div>
  )
}
