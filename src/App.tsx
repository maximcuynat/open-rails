import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorStore, useEditorVersion } from '@application/state/editorStore'
import { useKeyboardShortcuts } from '@presentation/hooks/useKeyboardShortcuts'
import { Canvas } from '@presentation/components/canvas/Canvas'
import { TopBar } from '@presentation/components/topbar/TopBar'
import { ToolBar } from '@presentation/components/toolbar/ToolBar'
import { SidePanel } from '@presentation/components/sidepanel/SidePanel'
import { CanvasOverlay } from '@presentation/components/canvas/CanvasOverlay'
import { MiniMap } from '@presentation/components/minimap/MiniMap'
import { StatusBar } from '@presentation/components/statusbar/StatusBar'
import { ToastContainer } from '@presentation/components/common/Toast'

export default function App() {
  const storeRef = useRef<EditorStore | null>(null)
  if (storeRef.current === null) storeRef.current = new EditorStore()
  const store = storeRef.current

  // Subscribe so App re-renders on store changes (drives child components).
  useEditorVersion(store)
  useKeyboardShortcuts(store)

  const [vp, setVp] = useState({ w: 800, h: 600 })
  const onViewport = useCallback((w: number, h: number) => setVp({ w, h }), [])

  // Fit-to-view: from menu (F shortcut dispatches a window event)
  const fitView = useCallback(() => {
    store.fitView(vp.w, vp.h)
  }, [store, vp])

  useEffect(() => {
    const handler = () => store.fitView(vp.w, vp.h)
    window.addEventListener('rail:fit-view', handler)
    return () => window.removeEventListener('rail:fit-view', handler)
  }, [store, vp])

  // Persist state when reloading or navigating away
  useEffect(() => {
    const handleUnload = () => {
      store.savePersistedState()
    }
    window.addEventListener('beforeunload', handleUnload)
    window.addEventListener('pagehide', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('pagehide', handleUnload)
    }
  }, [store])

  // Apply theme: auto = follow prefers-color-scheme, light/dark = explicit override.
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const mode =
        store.theme === 'auto'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : store.theme
      root.setAttribute('data-theme', mode)
    }
    apply()
    if (store.theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [store.theme])

  return (
    <div className="app-layout">
      <TopBar store={store} onFitView={fitView} />
      <div className="app-middle">
        <div className="app-canvas-area">
          <Canvas store={store} onViewport={onViewport} />
          <ToolBar store={store} />
          <CanvasOverlay store={store} />
          <SidePanel store={store} />
          {store.showMinimap && <MiniMap store={store} viewportW={vp.w} viewportH={vp.h} />}
        </div>
      </div>
      <StatusBar store={store} />
      <ToastContainer />
    </div>
  )
}

