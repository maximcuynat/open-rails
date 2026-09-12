import { useEffect } from 'react'
import { removeNode, removeSegment } from '../core/network'
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
        const sel = store.selection
        for (const sid of sel.segments) removeSegment(store.network, sid)
        for (const nid of sel.nodes) removeNode(store.network, nid)
        store.clearSelection()
        store.lastNodeId = null
        store.markDirty()
        store.notify()
      } else if (e.key === 'Escape') {
        store.lastNodeId = null
        store.curveState = { phase: 0, startId: null }
        store.clearSelection()
      } else if (e.key === 'v' || e.key === 'V') {
        store.setTool('select')
      } else if (e.key === 'n' || e.key === 'N') {
        store.setTool('place')
      } else if (e.key === 'c' || e.key === 'C') {
        store.setTool('curve')
      } else if (e.key === 'h' || e.key === 'H') {
        store.setTool('pan')
      } else if (e.key === 'g' || e.key === 'G') {
        store.toggleSnap()
      } else if (e.key === 'f' || e.key === 'F') {
        // Fit-to-view handled by App via a custom event (needs viewport size)
        window.dispatchEvent(new CustomEvent('rail:fit-view'))
      } else if ((e.key === '0' || e.key === '0') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        store.resetZoom()
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        store.selectAll()
      } else if (e.key === '[') {
        store.cycleCurveProfile(-1)
      } else if (e.key === ']') {
        store.cycleCurveProfile(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}
