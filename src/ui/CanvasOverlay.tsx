import type { EditorStore } from './store'

/** Contextual hint shown at the bottom-center of the canvas. */
function hintText(store: EditorStore): string {
  switch (store.tool) {
    case 'place':
      return store.lastNodeId
        ? 'Click to place next node · Right-click or Esc to end chain'
        : 'Click to place the first node'
    case 'curve':
      return store.curveState.phase === 1
        ? 'Click to place the end point · Right-click or Esc to cancel'
        : 'Click to place the start point'
    case 'select':
      return 'Click a node or segment to select · Del to remove · Esc to clear'
    case 'pan':
      return 'Drag to pan · Scroll to zoom'
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
