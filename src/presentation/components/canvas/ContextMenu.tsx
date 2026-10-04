import { useEffect, useRef } from 'react'
import { TRAIN_PLACEMENT_REFUSED, type EditorStore } from '@application/state/editorStore'
import { showToast } from '../common/Toast'
import { performTrackCut } from '@domain/geometry/constructionTemplates'
import { toggleTurnoutHand } from '@domain/models/junction'

interface ContextMenuProps {
  store: EditorStore
}

export function ContextMenu({ store }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const { isOpen, x, y, target } = store.contextMenu

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        store.closeContextMenu()
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        store.closeContextMenu()
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, store])

  if (!isOpen || !target) return null

  // Ensure menu stays within window bounds
  const menuWidth = 230
  const menuHeight = 260
  const safeX = Math.min(window.innerWidth - menuWidth - 10, Math.max(10, x))
  const safeY = Math.min(window.innerHeight - menuHeight - 10, Math.max(10, y))

  const handleCutTrack = () => {
    if (target.worldPos) {
      const cut = performTrackCut(store.network, target.worldPos, 18 / store.camera.scale, store.getPlacementThresholds().detachGap)
      if (cut) {
        store.reconcileNetwork()
        store.markDirty()
      }
    }
    store.closeContextMenu()
  }

  const handleParallel = () => {
    // The right-clicked rail, or the whole selection when it is part of it
    if (target.id) {
      const segs = store.selection.segments.has(target.id) ? store.selection.segments : [target.id]
      store.createParallelTrackFromSelection(undefined, segs)
    }
    store.closeContextMenu()
  }

  const handleDelete = () => {
    const junction = target.type === 'junction' && target.id ? store.network.junctions.get(target.id) : null
    if (junction) {
      // Removing a turnout = removing its diverging branch at the points; the main line stays
      const branches = [junction.divergingSegmentId, junction.divergingRightSegmentId].filter(
        (sid): sid is string => !!sid && store.network.segments.has(sid),
      )
      store.selection = { nodes: new Set(), segments: new Set(branches) }
      store.deleteSelection()
    } else if (target.type === 'junction') {
      // The turnout is already gone: nothing to delete, and certainly not the previous selection
    } else if (target.type === 'node' && target.id) {
      store.selection = { nodes: new Set([target.id]), segments: new Set() }
      store.deleteSelection()
    } else if (target.type === 'segment' && target.id) {
      store.selection = { nodes: new Set(), segments: new Set([target.id]) }
      store.deleteSelection()
    } else {
      store.deleteSelection()
    }
    store.closeContextMenu()
  }

  const handleToggleTurnout = () => {
    if (target.id) {
      store.toggleActiveJunction(target.id)
    } else {
      store.toggleActiveJunction()
    }
    store.closeContextMenu()
  }

  const handleFlipTurnoutHand = () => {
    if (target.id) {
      toggleTurnoutHand(store.network, target.id)
      store.markDirty()
    }
    store.closeContextMenu()
  }

  const handlePlaceTrain = () => {
    if (target.worldPos) {
      if (!store.handleDropTrainItem('tgv_loco', target.worldPos)) showToast(TRAIN_PLACEMENT_REFUSED, 'warning')
    }
    store.closeContextMenu()
  }

  const handleFitView = () => {
    window.dispatchEvent(new CustomEvent('rail:fit-view'))
    store.closeContextMenu()
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        left: `${safeX}px`,
        top: `${safeY}px`,
        zIndex: 1000,
        minWidth: `${menuWidth}px`,
        background: 'rgba(15, 23, 42, 0.94)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(56, 189, 248, 0.28)',
        borderRadius: '8px',
        padding: '6px',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        userSelect: 'none',
        animation: 'context-pop 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {target.type === 'segment' && (
        <>
          <div className="ctx-header">Rail sélectionné</div>
          <button className="ctx-item" onClick={handleCutTrack}>
            <span className="ctx-icon">✂</span>
            <span className="ctx-label">Scinder la voie ici</span>
            <kbd className="ctx-kbd">K</kbd>
          </button>
          <button
            className="ctx-item"
            onClick={handleParallel}
          >
            <span className="ctx-icon">🛤</span>
            <span className="ctx-label">Créer voie parallèle</span>
            <kbd className="ctx-kbd">D</kbd>
          </button>
          <button className="ctx-item" onClick={handlePlaceTrain}>
            <span className="ctx-icon">🚄</span>
            <span className="ctx-label">Poser une motrice ici</span>
          </button>
          <div className="ctx-sep" />
          <button className="ctx-item ctx-danger" onClick={handleDelete}>
            <span className="ctx-icon">🗑</span>
            <span className="ctx-label">Supprimer ce rail</span>
            <kbd className="ctx-kbd">Suppr</kbd>
          </button>
        </>
      )}

      {target.type === 'junction' && (
        <>
          <div className="ctx-header">Aiguillage</div>
          <button className="ctx-item" onClick={handleToggleTurnout}>
            <span className="ctx-icon">🔀</span>
            <span className="ctx-label">Basculer la voie</span>
            <kbd className="ctx-kbd">T</kbd>
          </button>
          <button className="ctx-item" onClick={handleFlipTurnoutHand}>
            <span className="ctx-icon">⇄</span>
            <span className="ctx-label">Inverser déviation G/D</span>
          </button>
          <div className="ctx-sep" />
          <button className="ctx-item ctx-danger" onClick={handleDelete}>
            <span className="ctx-icon">🗑</span>
            <span className="ctx-label">Supprimer l’aiguillage</span>
            <kbd className="ctx-kbd">Suppr</kbd>
          </button>
        </>
      )}

      {target.type === 'node' && (
        <>
          <div className="ctx-header">Nœud de voie</div>
          <button
            className="ctx-item"
            onClick={() => {
              store.setTool('place')
              store.lastNodeId = target.id ?? null
              store.closeContextMenu()
            }}
          >
            <span className="ctx-icon">✏</span>
            <span className="ctx-label">Prolonger la voie</span>
            <kbd className="ctx-kbd">N</kbd>
          </button>
          <div className="ctx-sep" />
          <button className="ctx-item ctx-danger" onClick={handleDelete}>
            <span className="ctx-icon">🗑</span>
            <span className="ctx-label">Supprimer le nœud</span>
            <kbd className="ctx-kbd">Suppr</kbd>
          </button>
        </>
      )}

      {target.type === 'canvas' && (
        <>
          <div className="ctx-header">Vue & Réseau</div>
          <button className="ctx-item" onClick={handleFitView}>
            <span className="ctx-icon">🔍</span>
            <span className="ctx-label">Ajuster la vue (Centrer)</span>
            <kbd className="ctx-kbd">F</kbd>
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              store.resetZoom()
              store.closeContextMenu()
            }}
          >
            <span className="ctx-icon">⟲</span>
            <span className="ctx-label">Zoom 100%</span>
            <kbd className="ctx-kbd">Ctrl+0</kbd>
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              store.toggleGrid()
              store.closeContextMenu()
            }}
          >
            <span className="ctx-icon">▦</span>
            <span className="ctx-label">{store.showGrid ? 'Masquer la grille' : 'Afficher la grille'}</span>
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              store.toggleSnap()
              store.closeContextMenu()
            }}
          >
            <span className="ctx-icon">🧲</span>
            <span className="ctx-label">{store.snap ? 'Désactiver l’aimantation' : 'Activer l’aimantation'}</span>
            <kbd className="ctx-kbd">G</kbd>
          </button>
          <div className="ctx-sep" />
          <button
            className="ctx-item"
            disabled={!store.canUndo}
            onClick={() => {
              store.undo()
              store.closeContextMenu()
            }}
          >
            <span className="ctx-icon">↩</span>
            <span className="ctx-label">Annuler</span>
            <kbd className="ctx-kbd">Ctrl+Z</kbd>
          </button>
          <button
            className="ctx-item"
            disabled={!store.canRedo}
            onClick={() => {
              store.redo()
              store.closeContextMenu()
            }}
          >
            <span className="ctx-icon">↪</span>
            <span className="ctx-label">Rétablir</span>
            <kbd className="ctx-kbd">Ctrl+Y</kbd>
          </button>
        </>
      )}
    </div>
  )
}
