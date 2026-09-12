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

  return (
    <div className="canvas-overlay" style={{ pointerEvents: 'none' }}>
      {curvePhase !== null && (
        <div className="phase-badge">{curvePhase === 0 ? '1/2' : '2/2'}</div>
      )}
      {hint && <div className="canvas-hint">{hint}</div>}
    </div>
  )
}
