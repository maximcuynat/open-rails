import type { EditorStore } from '@application/state/editorStore'
import { getGizmoAnchor } from './gizmo'
import { findJunctionAtNode, findJunctionBySegment, toggleTurnoutHand } from '@domain/models/junction'
import { performTrackCut } from '@domain/geometry/constructionTemplates'

interface FloatingActionBarProps {
  store: EditorStore
  viewport: { w: number; h: number }
}

export function FloatingActionBar({ store, viewport }: FloatingActionBarProps) {
  if (store.tool !== 'select' || (store.selection.nodes.size === 0 && store.selection.segments.size === 0)) {
    return null
  }

  const anchor = getGizmoAnchor(store.network, store.selection)
  if (!anchor) return null

  const sx = (anchor.worldPos.x - store.camera.x) * store.camera.scale + viewport.w / 2
  const sy = (anchor.worldPos.y - store.camera.y) * store.camera.scale + viewport.h / 2

  // Hide if offscreen
  if (sx < -100 || sx > viewport.w + 100 || sy < 40 || sy > viewport.h + 100) {
    return null
  }

  // Detect if an active junction is selected
  let junctionId: string | null = null
  if (anchor.type === 'node' && store.selection.nodes.size === 1) {
    const nid = [...store.selection.nodes][0]
    const junc = findJunctionAtNode(store.network, nid)
    if (junc) junctionId = junc.id
  } else if (anchor.type === 'section' && store.selection.segments.size > 0) {
    for (const sid of store.selection.segments) {
      const junc = findJunctionBySegment(store.network, sid)
      if (junc) {
        junctionId = junc.id
        break
      }
    }
  }

  const handleCut = () => {
    const cut = performTrackCut(store.network, anchor.worldPos, 18 / store.camera.scale, store.getPlacementThresholds().detachGap)
    if (cut) {
      store.reconcileNetwork()
      store.markDirty()
    }
  }

  const handleFlipTurnout = () => {
    if (junctionId) {
      toggleTurnoutHand(store.network, junctionId)
      store.markDirty()
    }
  }

  return (
    <div
      className="floating-action-bar"
      style={{
        position: 'absolute',
        left: `${sx}px`,
        top: `${sy - 54}px`,
        transform: 'translateX(-50%)',
        zIndex: 45,
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(56, 189, 248, 0.35)',
        borderRadius: '24px',
        padding: '3px 8px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        pointerEvents: 'auto',
        animation: 'action-pill-pop 140ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {junctionId && (
        <>
          <button
            className="fab-btn fab-btn-accent"
            onClick={() => store.toggleActiveJunction(junctionId!)}
            title="Basculer la voie active de l'aiguillage (Touche T)"
          >
            <span>🔀</span>
            <span>Aiguiller (T)</span>
          </button>
          <button
            className="fab-btn"
            onClick={handleFlipTurnout}
            title="Inverser le côté de déviation (Gauche/Droite)"
          >
            <span>⇄</span>
            <span>Inverser D/G</span>
          </button>
          <div className="fab-sep" />
        </>
      )}

      {store.selection.segments.size > 0 && !junctionId && (
        <button className="fab-btn" onClick={handleCut} title="Scinder la voie au centre de la sélection (K)">
          <span>✂</span>
          <span>Scinder</span>
        </button>
      )}

      {store.canCreateParallelTrack && (
        <button
          className="fab-btn fab-btn-cyan"
          onClick={() => store.createParallelTrackFromSelection()}
          title="Créer une voie parallèle à la sélection (D)"
        >
          <span>🛤</span>
          <span>Voie double (D)</span>
        </button>
      )}

      {store.selection.nodes.size === 1 && (
        <button
          className="fab-btn fab-btn-accent"
          onClick={() => {
            const nid = [...store.selection.nodes][0]
            store.setTool('place')
            store.lastNodeId = nid
            store.notify()
          }}
          title="Prolonger la voie à partir de ce nœud (N)"
        >
          <span>✏</span>
          <span>Prolonger</span>
        </button>
      )}

      <div className="fab-sep" />

      <button
        className="fab-btn fab-btn-danger"
        onClick={() => store.deleteSelection()}
        title="Supprimer la sélection (Suppr / Retour arrière)"
      >
        <span>🗑</span>
      </button>
    </div>
  )
}
