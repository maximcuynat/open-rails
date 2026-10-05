import { useEffect } from 'react'
import { JUNCTION_OCCUPIED_REFUSED, type EditorStore } from '@application/state/editorStore'
import { findAction, type ActionId } from '@application/keybindings/keybindings'
import { showToast } from '../components/common/Toast'

/** Run a rebindable action. The caller has already checked that it is live in the current context. */
function runAction(store: EditorStore, action: ActionId, e: KeyboardEvent): void {
  switch (action) {
    case 'drive.notchUp':
    case 'drive.notchDown': {
      e.preventDefault()
      const step = action === 'drive.notchUp' ? 1 : -1
      if (!store.selectedTrain) {
        // Legacy locomotive: throttle held while the key is down
        store.setLocomotiveThrottle(step)
      } else if (!e.repeat) {
        // One notch per key press: holding the key must not sweep the whole handle
        store.stepSelectedTrainNotch(step)
      }
      return
    }
    case 'drive.reverserForward':
    case 'drive.reverserBackward':
      e.preventDefault()
      if (store.selectedTrain) store.shiftSelectedTrainReverser(action === 'drive.reverserForward' ? 1 : -1)
      return
    case 'drive.emergencyBrake':
      e.preventDefault()
      store.toggleSelectedTrainEmergencyBrake()
      return
    case 'drive.steerLeft':
    case 'drive.steerRight':
      e.preventDefault()
      store.steerUpcomingTurnout(action === 'drive.steerLeft' ? 'left' : 'right')
      return
    case 'drive.exit':
      e.preventDefault()
      store.togglePlayMode()
      return
    case 'drive.flipLegacy':
      e.preventDefault()
      // TrainSets change direction through the reverser
      if (!store.selectedTrain) store.flipLocomotiveDirection()
      return
    case 'tool.select': store.setTool('select'); return
    case 'tool.place': store.setTool('place'); return
    case 'tool.curve': store.setTool('curve'); return
    case 'tool.turnout': store.setTool('turnout'); return
    case 'tool.split': store.setTool('split'); return
    case 'tool.measure': store.setTool('measure'); return
    case 'tool.pan': store.setTool('pan'); return
    case 'tool.locomotive': store.setTool('locomotive'); return
    case 'edit.toggleJunction':
      e.preventDefault()
      if (!store.toggleActiveJunction()) showToast(JUNCTION_OCCUPIED_REFUSED, 'warning')
      return
    case 'edit.parallelTrack':
      if (store.tool === 'select' && store.canCreateParallelTrack) {
        e.preventDefault()
        store.createParallelTrackFromSelection()
      }
      return
    case 'edit.paramDecrease':
      if (store.tool === 'curve') store.cycleCurveProfile(-1)
      else if (store.tool === 'turnout') store.setTurnoutRadius(Math.max(20, store.turnoutRadius - 5))
      return
    case 'edit.paramIncrease':
      if (store.tool === 'curve') store.cycleCurveProfile(1)
      else if (store.tool === 'turnout') store.setTurnoutRadius(store.turnoutRadius + 5)
      return
    case 'view.toggleSnap': store.toggleSnap(); return
    case 'view.fit':
      // Fit-to-view handled by App via a custom event (needs viewport size)
      window.dispatchEvent(new CustomEvent('rail:fit-view'))
      return
    case 'view.toggleInspector': store.toggleSidePanel(); return
    case 'sim.togglePlay':
      e.preventDefault()
      if (store.locomotive || store.trains.length > 0) store.togglePlayMode()
      return
    case 'train.debug':
      e.preventDefault()
      store.toggleTrainDebug()
      return
  }
}

export function handleKeyDown(store: EditorStore, e: KeyboardEvent): void {
  // Don't intercept when typing in an input/textarea
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return
  }

  const hasModifier = e.ctrlKey || e.metaKey || e.altKey

  // --- Play mode controls (highest priority when active) ---
  if (store.isPlayMode) {
    if (e.key === 'Escape') {
      store.togglePlayMode()
      return
    } else if (e.key === 'Tab') {
      e.preventDefault()
      // TrainSet: take the cab at the other end; legacy locomotive: turn around
      if (store.selectedTrain) store.switchSelectedTrainCab()
      else store.flipLocomotiveDirection()
      return
    }
    const action = hasModifier ? null : findAction(store.keybindings, 'drive', e)
    if (action) {
      runAction(store, action, e)
      return
    }
    // While driving, the editing shortcuts stay off: only the zoom reset passes through
    if (!((e.ctrlKey || e.metaKey) && e.key === '0')) return
  }


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

  const action = findAction(store.keybindings, 'edit', e)
  if (action) {
    runAction(store, action, e)
    return
  }

  if (e.key === ',') {
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
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault()
    if (store.tool === 'locomotive' && store.trainToolSubMode === 'place') {
      store.flipTrainPlacementDirection()
    } else if (store.isTrainSelected || store.tool === 'coupling') {
      store.flipLocomotiveDirection()
    } else {
      store.reconcileTopology()
    }
  }
}

export function handleKeyUp(store: EditorStore, e: KeyboardEvent): void {
  if (!store.isPlayMode) return
  // Legacy locomotive: releasing the key that holds the throttle lets it coast
  const action = findAction(store.keybindings, 'drive', { code: e.code, key: e.key, shiftKey: false })
  if (action === 'drive.notchUp' && store.locomotiveThrottle === 1) {
    e.preventDefault()
    store.setLocomotiveThrottle(0)
  } else if (action === 'drive.notchDown' && store.locomotiveThrottle === -1) {
    e.preventDefault()
    store.setLocomotiveThrottle(0)
  }
}

/** Characters of the user's layout by key position, where the browser exposes them (Chromium) */
function readLayoutMap(store: EditorStore): void {
  const keyboard = (navigator as { keyboard?: { getLayoutMap?: () => Promise<Iterable<[string, string]>> } }).keyboard
  keyboard?.getLayoutMap?.().then((map) => store.setKeyLabels(Object.fromEntries(map))).catch(() => {})
}

/** Global keyboard shortcuts wired to the shared store. */
export function useKeyboardShortcuts(store: EditorStore): void {
  useEffect(() => {
    readLayoutMap(store)

    const onKeyDown = (e: KeyboardEvent) => {
      // Other browsers: learn the layout one key press at a time
      if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        store.setKeyLabels({ [e.code]: e.key })
      }
      handleKeyDown(store, e)
    }

    const onKeyUp = (e: KeyboardEvent) => handleKeyUp(store, e)

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
