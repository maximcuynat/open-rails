import type { EditorStore, Tool } from '@application/state/editorStore'
import { SCALE_PRESETS, formatDistance } from '@domain/models/units'

const TOOL_LABELS: Record<Tool, string> = {
  select: 'Sélection',
  place: 'Voie droite',
  curve: 'Voie courbe',
  turnout: 'Aiguillage',
  split: 'Ciseaux',
  measure: 'Règle',
  pan: 'Déplacer la vue',
  locomotive: 'Trains',
  coupling: 'Attelage',
}

/** What is currently selected, in words. The how-to hints live in the canvas hint, not here. */
export function selectionSummary(store: EditorStore): string {
  const { nodes, segments } = store.selection
  const parts: string[] = []
  if (segments.size) parts.push(`${segments.size} rail${segments.size > 1 ? 's' : ''}`)
  if (nodes.size) parts.push(`${nodes.size} nœud${nodes.size > 1 ? 's' : ''}`)
  if (parts.length === 0) return 'Aucune sélection'
  const plural = segments.size + nodes.size > 1
  return `${parts.join(', ')} sélectionné${plural ? 's' : ''}`
}

/** Zoom as a percentage of the default zoom of the current scale (the one Ctrl+0 goes back to). */
export function zoomPercent(store: EditorStore): number {
  const reference = SCALE_PRESETS[store.scalePreset]?.defaultCameraScale ?? 2.5
  return Math.round((store.camera.scale / reference) * 100)
}

export function StatusBar({ store }: { store: EditorStore }) {
  // In play mode, the DrivingHUD takes over — hide status bar
  if (store.isPlayMode) return null

  return (
    <div className="status-bar">
      <div className="sb-left">
        <span className="sb-tool">{TOOL_LABELS[store.tool]}</span>
        <span className="sb-status">{selectionSummary(store)}</span>
      </div>
      <div className="sb-center">
        <button
          className="sb-chip on"
          onClick={() => store.openSettings()}
          title="Échelle et unité d’affichage — cliquer pour ouvrir les paramètres (Ctrl+,)"
        >
          {store.scalePreset} · {store.unit}
        </button>
        <button
          className={`sb-chip${store.snap ? ' on' : ''}`}
          onClick={() => store.toggleSnap()}
          title="Activer ou désactiver l’aimantation (G)"
        >
          Aimantation {store.snap ? 'active' : 'inactive'}
        </button>
        <button
          className={`sb-chip${store.showGrid ? ' on' : ''}`}
          onClick={() => store.toggleGrid()}
          title="Afficher ou masquer la grille"
        >
          Grille {store.showGrid ? 'visible' : 'masquée'}
        </button>
      </div>
      <div className="sb-right">
        <button className="sb-chip" onClick={() => store.resetZoom()} title="Revenir au zoom par défaut (Ctrl+0)">
          Zoom {zoomPercent(store)} %
        </button>
        <span className="sb-coord">
          X : {formatDistance(store.cursorWorld.x, store.unit)} · Y : {formatDistance(store.cursorWorld.y, store.unit)}
        </span>
      </div>
    </div>
  )
}
