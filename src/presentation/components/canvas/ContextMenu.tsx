import { useEffect, useRef } from 'react'
import { JUNCTION_OCCUPIED_REFUSED, TRAIN_PLACEMENT_REFUSED, type EditorStore } from '@application/state/editorStore'
import type { ActionId } from '@application/keybindings/keybindings'
import { showToast } from '../common/Toast'
import { performTrackCut } from '@domain/geometry/constructionTemplates'
import { turnoutView } from '@domain/models/junction'

interface ContextMenuProps {
  store: EditorStore
}

export function ContextMenu({ store }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const { isOpen, x, y, target } = store.contextMenu
  const kbd = (action: ActionId) => {
    const label = store.shortcutLabel(action)
    return label ? <kbd className="ctx-kbd">{label}</kbd> : null
  }

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
      const turnout = turnoutView(store.network, junction)
      const branches = [turnout?.divergingSegmentId, turnout?.divergingRightSegmentId].filter(
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
    if (!store.toggleActiveJunction(target.id)) showToast(JUNCTION_OCCUPIED_REFUSED, 'warning')
    store.closeContextMenu()
  }

  const handleFlipTurnoutHand = () => {
    if (target.id && !store.toggleTurnoutHandAtSelection(target.id)) showToast(JUNCTION_OCCUPIED_REFUSED, 'warning')
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
      style={{ left: `${safeX}px`, top: `${safeY}px`, minWidth: `${menuWidth}px` }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {target.type === 'segment' && (
        <>
          <div className="ctx-header">Rail sélectionné</div>
          <button className="ctx-item" onClick={handleCutTrack}>
            <span className="ctx-icon">✂</span>
            <span className="ctx-label">Scinder la voie ici</span>
            {kbd('tool.split')}
          </button>
          <button
            className="ctx-item"
            onClick={handleParallel}
          >
            <span className="ctx-icon">🛤</span>
            <span className="ctx-label">Créer voie parallèle</span>
            {kbd('edit.parallelTrack')}
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
            {kbd('edit.toggleJunction')}
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
            {kbd('tool.place')}
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
            {kbd('view.fit')}
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
            {kbd('view.toggleSnap')}
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
