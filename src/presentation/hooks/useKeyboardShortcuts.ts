import { useEffect } from 'react'
import type { EditorStore } from '@application/state/editorStore'

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
        store.autoConnectStartId = null
        store.crossoverFirstSegId = null
        store.turnoutStartId = null
        store.measureStart = null
        store.measureEnd = null
        store.isMeasuring = false
        store.clearSelection()
      } else if (e.key === 'v' || e.key === 'V') {
        store.setTool('select')
      } else if (e.key === 'n' || e.key === 'N') {
        store.setTool('place')
      } else if (e.key === 'c' || e.key === 'C') {
        store.setTool('curve')
      } else if (e.key === 'p' || e.key === 'P') {
        store.setTool('turnout')
      } else if (e.key === 'j' || e.key === 'J') {
        store.setTool('autoconnect')
      } else if (e.key === 'x' || e.key === 'X') {
        store.setTool('crossover')
      } else if (e.key === 'b' || e.key === 'B') {
        store.setTool('siding')
      } else if (e.key === 'l' || e.key === 'L') {
        store.setTool('loop')
      } else if (e.key === 'k' || e.key === 'K') {
        store.setTool('split')
      } else if (e.key === 'm' || e.key === 'M') {
        store.setTool('measure')
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
        } else if (store.tool === 'turnout') {
          e.preventDefault()
          store.toggleTurnoutSide()
        } else if (store.tool === 'siding') {
          e.preventDefault()
          store.toggleSidingSide()
        } else if (store.tool === 'loop') {
          e.preventDefault()
          store.toggleLoopSide()
        }
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
        if (store.tool === 'curve') store.cycleCurveProfile(-1)
        else if (store.tool === 'turnout') store.setTurnoutRadius(Math.max(20, store.turnoutRadius - 5))
        else if (store.tool === 'siding') store.setSidingLength(Math.max(20, store.sidingLength - 10))
        else if (store.tool === 'loop') store.setLoopRadius(Math.max(15, store.loopRadius - 5))
      } else if (e.key === ']') {
        if (store.tool === 'curve') store.cycleCurveProfile(1)
        else if (store.tool === 'turnout') store.setTurnoutRadius(store.turnoutRadius + 5)
        else if (store.tool === 'siding') store.setSidingLength(store.sidingLength + 10)
        else if (store.tool === 'loop') store.setLoopRadius(store.loopRadius + 5)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}
