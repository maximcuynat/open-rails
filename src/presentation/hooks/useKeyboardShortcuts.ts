import { useEffect } from 'react'
import type { EditorStore } from '@application/state/editorStore'

/** Global keyboard shortcuts wired to the shared store. */
export function useKeyboardShortcuts(store: EditorStore): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      // --- Play mode controls (highest priority when active) ---
      if (store.isPlayMode) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const step = e.key === 'ArrowUp' ? 1 : -1
          if (!store.selectedTrain) {
            // Legacy locomotive: throttle held while the key is down
            store.setLocomotiveThrottle(step)
          } else if (e.shiftKey) {
            store.shiftSelectedTrainReverser(step)
          } else if (!e.repeat) {
            // One notch per key press: holding the key must not sweep the whole handle
            store.stepSelectedTrainNotch(step)
          }
          return
        } else if (e.key === 'Backspace') {
          e.preventDefault()
          store.toggleSelectedTrainEmergencyBrake()
          return
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          store.steerUpcomingTurnout('left')
          return
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          store.steerUpcomingTurnout('right')
          return
        } else if (e.key === ' ') {
          e.preventDefault()
          store.togglePlayMode()
          return
        } else if (e.key === 'd' || e.key === 'D') {
          e.preventDefault()
          store.toggleTrainDebug()
          return
        } else if (e.key === 'r' || e.key === 'R' || e.key === 'Tab') {
          e.preventDefault()
          // TrainSets change direction through the reverser (Shift+↑/↓)
          if (!store.selectedTrain) store.flipLocomotiveDirection()
          return
        } else if (e.key === 'Escape') {
          store.togglePlayMode()
          return
        }
        // While driving, the editing shortcuts stay off: only view keys pass through
        const isViewKey =
          e.key === 'F5' ||
          e.key === 'f' || e.key === 'F' ||
          e.key === 'i' || e.key === 'I' ||
          ((e.ctrlKey || e.metaKey) && e.key === '0')
        if (!isViewKey) return
      }

      const hasModifier = e.ctrlKey || e.metaKey || e.altKey

      // Numeric CAD input live typing during track placement
      const isPlacing = (store.tool === 'place' && store.lastNodeId !== null) ||
                        (store.tool === 'curve' && store.curveState.phase === 1)
      if (isPlacing && !hasModifier) {
        if (/^[0-9.,]$/.test(e.key)) {
          e.preventDefault()
          store.setNumericInput(store.numericInput + (e.key === ',' ? '.' : e.key))
          return
        } else if (e.key === 'Backspace' && store.isNumericInputActive) {
          e.preventDefault()
          store.setNumericInput(store.numericInput.slice(0, -1))
          return
        } else if (e.key === 'Enter' && store.isNumericInputActive) {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('rail:commit-numeric-placement'))
          return
        }
      }

      if (e.code === 'Space') {
        e.preventDefault()
        // Space is strictly reserved for Canvas Pan in editor mode!
        return
      } else if (e.key === 'F5') {
        e.preventDefault()
        if (store.locomotive || store.trains.length > 0) {
          store.togglePlayMode()
        }
        return
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        // While a rail is being placed the selection is only the tool's working node:
        // these keys (e.g. Backspace after the last typed digit) must not delete it
        if (!store.hasPendingPlacement) store.deleteSelection()
        return
      } else if (e.key === 'Escape') {
        // An open menu or dialog closes itself on Escape: that press must not also cancel a
        // placement or leave the current tool
        if (!document.querySelector('.menu-dropdown, .modal-backdrop')) store.cancelInteraction()
        return
      }

      // --- Ctrl / Cmd combinations ---
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault()
          if (e.shiftKey) {
            store.redo()
          } else {
            store.undo()
          }
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault()
          store.redo()
        } else if (e.key === '0') {
          e.preventDefault()
          store.resetZoom()
        } else if (e.key === 'a' || e.key === 'A') {
          e.preventDefault()
          store.selectAll()
        } else if (e.key === ',' || e.code === 'Comma' || e.key === 'p' || e.key === 'P') {
          e.preventDefault()
          store.toggleSettings()
        }
        return
      }

      // --- Plain keys: never fire with Ctrl / Cmd / Alt, so browser and OS shortcuts stay free ---
      if (hasModifier) return

      if (e.key === 'v' || e.key === 'V') {
        store.setTool('select')
      } else if (e.key === 'n' || e.key === 'N') {
        store.setTool('place')
      } else if (e.key === 'c' || e.key === 'C') {
        store.setTool('curve')
      } else if (e.key === 'p' || e.key === 'P') {
        store.setTool('turnout')
      } else if (e.key === 'k' || e.key === 'K') {
        store.setTool('split')
      } else if (e.key === 'm' || e.key === 'M') {
        store.setTool('measure')
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        store.toggleActiveJunction()
      } else if (e.key === 'h' || e.key === 'H') {
        store.setTool('pan')
      } else if (e.key === 'l' || e.key === 'L') {
        store.setTool('locomotive')
      } else if (e.key === 'g' || e.key === 'G') {
        store.toggleSnap()
      } else if (e.key === 'f' || e.key === 'F') {
        // Fit-to-view handled by App via a custom event (needs viewport size)
        window.dispatchEvent(new CustomEvent('rail:fit-view'))
      } else if (e.key === ',') {
        e.preventDefault()
        store.toggleSettings()
      } else if (e.key === 'Tab') {
        if (store.tool === 'place' && store.lastNodeId) {
          e.preventDefault()
          // Carry on as a curve from the same start node (setTool would discard the placement)
          store.tool = 'curve'
          store.curveState = { phase: 1, startId: store.lastNodeId }
          store.clearNumericInput()
          store.notify()
        } else if (store.tool === 'curve') {
          e.preventDefault()
          store.flipCurveSide()
        } else if (store.tool === 'turnout') {
          e.preventDefault()
          store.toggleTurnoutSide()
        } else if (store.tool === 'locomotive' && store.trainToolSubMode === 'place') {
          e.preventDefault()
          store.flipTrainPlacementDirection()
        }
      } else if (e.key === 'd' || e.key === 'D') {
        if (store.tool === 'select' && store.canCreateParallelTrack) {
          e.preventDefault()
          store.createParallelTrackFromSelection()
        } else if (store.locomotive || store.tool === 'locomotive') {
          e.preventDefault()
          store.toggleTrainDebug()
        }
      } else if (e.key === 'i' || e.key === 'I') {
        store.toggleSidePanel()
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        if (store.tool === 'locomotive' && store.trainToolSubMode === 'place') {
          store.flipTrainPlacementDirection()
        } else if (store.isTrainSelected || store.tool === 'coupling') {
          store.flipLocomotiveDirection()
        } else {
          store.reconcileTopology()
        }
      } else if (e.key === '[') {
        if (store.tool === 'curve') store.cycleCurveProfile(-1)
        else if (store.tool === 'turnout') store.setTurnoutRadius(Math.max(20, store.turnoutRadius - 5))
      } else if (e.key === ']') {
        if (store.tool === 'curve') store.cycleCurveProfile(1)
        else if (store.tool === 'turnout') store.setTurnoutRadius(store.turnoutRadius + 5)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (store.isPlayMode) {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          if (store.locomotiveThrottle === 1) {
            store.setLocomotiveThrottle(0)
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          if (store.locomotiveThrottle === -1) {
            store.setLocomotiveThrottle(0)
          }
        }
      }
    }

    const onBlur = () => {
      if (store.isPlayMode && store.locomotiveThrottle !== 0) {
        store.setLocomotiveThrottle(0)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [store])
}
