import type { EditorStore } from './store'

const TOOL_LABELS: Record<string, string> = {
  select: 'Select',
  place: 'Place',
  curve: 'Curve',
  pan: 'Pan',
}

/** Compute a contextual status message for the current tool + state. */
function toolStatus(store: EditorStore): string {
  const sel = store.selection
  switch (store.tool) {
    case 'place':
      return store.lastNodeId ? 'Place — chain active' : 'Place — click to add a node'
    case 'curve': {
      if (store.curveState.phase === 1) return 'Curve — click 2/2 to place end'
      return 'Curve — click 1/2 to set start'
    }
    case 'select': {
      if (sel.nodes.size > 0 || sel.segments.size > 0) {
        const parts: string[] = []
        if (sel.nodes.size) parts.push(`${sel.nodes.size} node${sel.nodes.size > 1 ? 's' : ''}`)
        if (sel.segments.size) parts.push(`${sel.segments.size} segment${sel.segments.size > 1 ? 's' : ''}`)
        return `Select — ${parts.join(', ')}`
      }
      return 'Select'
    }
    case 'pan':
      return 'Pan — drag to move'
    default:
      return ''
  }
}

export function StatusBar({ store }: { store: EditorStore }) {
  const cam = store.camera
  const cx = store.cursorWorld.x.toFixed(0)
  const cy = store.cursorWorld.y.toFixed(0)

  return (
    <div className="status-bar">
      <div className="sb-left">
        <span className="sb-tool">{TOOL_LABELS[store.tool] ?? store.tool}</span>
        <span className="sb-status">{toolStatus(store)}</span>
      </div>
      <div className="sb-center">
        <button
          className={`sb-chip${store.snap ? ' on' : ''}`}
          onClick={() => store.toggleSnap()}
          title="Toggle snap (G)"
        >
          Snap {store.snap ? 'on' : 'off'}
        </button>
        <button
          className={`sb-chip${store.showGrid ? ' on' : ''}`}
          onClick={() => store.toggleGrid()}
          title="Toggle grid"
        >
          Grid {store.showGrid ? 'on' : 'off'}
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
