import { TRAIN_PLACEMENT_REFUSED, type EditorStore } from '@application/state/editorStore'
import { showToast } from '../common/Toast'
import { screenToWorld } from '@infrastructure/render/camera'
import { ContextBar } from '../contextbar/ContextBar'
import { ContextMenu } from './ContextMenu'

/**
 * HTML layer above the canvas. Nothing interactive floats over the drawing: it only holds the
 * contextual bar (bottom centre), the context menu and the badge that follows a drag and drop.
 */
export function CanvasOverlay({ store }: { store: EditorStore }) {
  return (
    <div
      className="canvas-overlay"
      style={{ pointerEvents: 'none' }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        const rect = e.currentTarget.getBoundingClientRect()
        const world = screenToWorld(store.camera, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
        store.cursorWorld = world
        store.updateTrainDrag(world, { x: e.clientX, y: e.clientY })
        store.notify()
      }}
      onDrop={(e) => {
        e.preventDefault()
        const itemType = (e.dataTransfer.getData('application/open-rails-train') ||
          e.dataTransfer.getData('text/plain')) as 'tgv_loco' | 'tgv_wagon'
        const rect = e.currentTarget.getBoundingClientRect()
        const world = screenToWorld(store.camera, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
        if (itemType === 'tgv_loco' || itemType === 'tgv_wagon') {
          if (!store.handleDropTrainItem(itemType, world)) showToast(TRAIN_PLACEMENT_REFUSED, 'warning')
          store.notify()
        }
      }}
    >
      {/* Floating Drag Badge following pointer */}
      {store.draggingTrainItem && store.dragCursorScreen && (
        <div
          className="drag-badge"
          style={{ left: `${store.dragCursorScreen.x + 14}px`, top: `${store.dragCursorScreen.y + 14}px` }}
        >
          <span>{store.draggingTrainItem === 'tgv_loco' ? '🚄' : '🚃'}</span>
          <span>{store.draggingTrainItem === 'tgv_loco' ? 'Poser Motrice TGV' : 'Ajouter Voiture'}</span>
        </div>
      )}
      {/* Contextual bar: the only place for actions and live values of the current tool */}
      <ContextBar store={store} />

      {/* Context Menu on right-click without drag */}
      <ContextMenu store={store} />
    </div>
  )
}
