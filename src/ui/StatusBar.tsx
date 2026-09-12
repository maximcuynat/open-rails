import type { EditorStore } from './store'

const TOOL_LABELS: Record<string, string> = {
  select: 'Sélection',
  place: 'Voie droite',
  curve: 'Voie courbe',
  pan: 'Panoramique',
}

/** Compute a contextual status message for the current tool + state. */
function toolStatus(store: EditorStore): string {
  const sel = store.selection
  switch (store.tool) {
    case 'place':
      return store.lastNodeId ? 'Prolongement actif · Clic pour poser (accroche auto sur voie)' : 'Clic pour placer le point de départ'
    case 'curve': {
      if (store.curveState.phase === 1) return 'Courbe 2/2 · Clic pour poser le coupon (accroche auto sur voie)'
      return 'Courbe 1/2 · Clic pour définir le départ (ou sur une voie pour brancher)'
    }
    case 'select': {
      if (sel.nodes.size > 0 || sel.segments.size > 0) {
        const parts: string[] = []
        if (sel.nodes.size) parts.push(`${sel.nodes.size} nœud${sel.nodes.size > 1 ? 's' : ''}`)
        if (sel.segments.size) parts.push(`${sel.segments.size} rail${sel.segments.size > 1 ? 's' : ''}`)
        return `${parts.join(', ')} sélectionné${parts.length > 1 ? 's' : ''}`
      }
      return 'Prêt · Clic ou glisser pour sélectionner'
    }
    case 'pan':
      return 'Glisser pour déplacer la vue'
    default:
      return ''
  }
}

export function StatusBar({ store }: { store: EditorStore }) {
  const cam = store.camera
  const cx = store.cursorWorld.x.toFixed(0)
  const cy = store.cursorWorld.y.toFixed(0)
  const isCatalog = store.trackMode === 'catalog'

  return (
    <div className="status-bar">
      <div className="sb-left">
        <span className="sb-tool">{TOOL_LABELS[store.tool] ?? store.tool}</span>
        <span className="sb-status">{toolStatus(store)}</span>
      </div>
      <div className="sb-center">
        <button
          className={`sb-chip${isCatalog ? ' on' : ''}`}
          onClick={() => store.setTrackMode(isCatalog ? 'freeform' : 'catalog')}
          title="Basculer de mode (Raccourci M)"
        >
          {isCatalog ? 'Kato HO' : 'Voie Libre'}
        </button>
        <button
          className={`sb-chip${store.snap ? ' on' : ''}`}
          onClick={() => store.toggleSnap()}
          title="Accrochage grille (Raccourci G)"
        >
          Snap {store.snap ? 'actif' : 'inactif'}
        </button>
        <button
          className={`sb-chip${store.showGrid ? ' on' : ''}`}
          onClick={() => store.toggleGrid()}
          title="Afficher/masquer la grille"
        >
          Grille {store.showGrid ? 'visible' : 'masquée'}
        </button>
      </div>
      <div className="sb-right">
        <button className="sb-chip" onClick={() => store.resetZoom()} title="Reset zoom (Ctrl+0)">
          {cam.scale.toFixed(2)}x
        </button>
        <span className="sb-coord">({cx}, {cy})</span>
      </div>
    </div>
  )
}
