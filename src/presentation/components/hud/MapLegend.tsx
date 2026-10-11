import type { EditorStore } from '@application/state/editorStore'
import { LINE_CATEGORIES, LINE_CATEGORY_LABELS, lineCategory } from '@domain/dataset/datasetIndex'
import { LINE_CATEGORY_COLORS } from '@infrastructure/render/datasetOverview'

/**
 * MapLegend — what the colours of the lines mean on the map of a dataset project: one line per
 * kind of line the dataset has. The colours show from the line tier out, and on the lines that
 * are not loaded at every zoom.
 */
export function MapLegend({ store }: { store: EditorStore }) {
  const index = store.dataset ? store.datasetIndex : null
  if (!index) return null
  const present = new Set(index.lines.map(lineCategory))
  const kinds = LINE_CATEGORIES.filter((kind) => present.has(kind))
  if (kinds.length === 0) return null
  return (
    <ul className={`map-legend${store.showMinimap && !store.isPlainDrivingView ? ' above-minimap' : ''}`} aria-label="Légende de la carte">
      {kinds.map((kind) => (
        <li key={kind}>
          <span className="map-legend-swatch" style={{ background: LINE_CATEGORY_COLORS[kind] }} aria-hidden="true" />
          {LINE_CATEGORY_LABELS[kind]}
        </li>
      ))}
    </ul>
  )
}
