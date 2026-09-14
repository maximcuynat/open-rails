import { useEffect } from 'react'
import type { EditorStore } from './store'

/** Global keyboard shortcuts wired to the shared store. */
export function useKeyboardShortcuts(store: EditorStore): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        store.deleteSelection()
      } else if (e.key === 'Escape') {
        store.lastNodeId = null
        store.curveState = { phase: 0, startId: null }
        store.parallelMode = false
        store.parallelLastNodeId = null
        store.clearSelection()
      } else if (e.key === 'v' || e.key === 'V') {
        store.setTool('select')
      } else if (e.key === 'n' || e.key === 'N') {
        store.setTool('place')
      } else if (e.key === 'c' || e.key === 'C') {
        store.setTool('curve')
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        store.toggleActiveJunction()
      } else if (e.key === 'h' || e.key === 'H') {
        store.setTool('pan')
      } else if (e.key === 'g' || e.key === 'G') {
        store.toggleSnap()
      } else if (e.key === 'f' || e.key === 'F') {
        // Fit-to-view handled by App via a custom event (needs viewport size)
        window.dispatchEvent(new CustomEvent('rail:fit-view'))
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) {
          store.redo()
        } else {
          store.undo()
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        store.redo()
      } else if ((e.key === '0' || e.key === '0') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        store.resetZoom()
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        store.selectAll()
      } else if (e.key === 'Tab') {
        if (store.tool === 'curve') {
          e.preventDefault()
          store.flipCurveSide()
        }
      } else if (e.key === 'm' || e.key === 'M') {
        store.setTrackMode(store.trackMode === 'catalog' ? 'freeform' : 'catalog')
      } else if (e.key === 'd' || e.key === 'D') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          if (store.selection.nodes.size === 2) {
            e.preventDefault()
            store.createParallelTrackFromSelection()
          }
        }
      } else if (e.key === 'i' || e.key === 'I') {
        store.toggleSidePanel()
      } else if (e.key === 'r' || e.key === 'R') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          store.reconcileTopology()
        }
      } else if (e.key === '[') {
        store.cycleCurveProfile(-1)
      } else if (e.key === ']') {
        store.cycleCurveProfile(1)
      } else if (e.key === '+' || e.key === '=') {
        // Monter de niveau : si un coupon/section est sélectionné, on monte sa couche, sinon on monte la couche de pose
        if (store.selection.segments.size > 0) {
          for (const sid of store.selection.segments) {
            const seg = store.network.segments.get(sid)
            if (seg) {
              const cur = seg.layer ?? (seg.overpass ? 1 : 0)
              seg.layer = Math.min(3, cur + 1)
              seg.overpass = seg.layer > 0
            }
          }
          store.markDirty()
          store.notify()
        } else {
          store.adjustActivePlacementLayer(1)
        }
      } else if (e.key === '-' || e.key === '_') {
        // Descendre de niveau : si sélection, on descend sa couche, sinon couche de pose
        if (store.selection.segments.size > 0) {
          for (const sid of store.selection.segments) {
            const seg = store.network.segments.get(sid)
            if (seg) {
              const cur = seg.layer ?? (seg.overpass ? 1 : 0)
              seg.layer = Math.max(-3, cur - 1)
              seg.overpass = seg.layer > 0
            }
          }
          store.markDirty()
          store.notify()
        } else {
          store.adjustActivePlacementLayer(-1)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}
