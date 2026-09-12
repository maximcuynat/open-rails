import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorStore, useEditorVersion } from './ui/store'
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts'
import { Canvas } from './ui/Canvas'
import { TopBar } from './ui/TopBar'
import { ToolBar } from './ui/ToolBar'
import { SidePanel } from './ui/SidePanel'
import { StatusBar } from './ui/StatusBar'
import { CanvasOverlay } from './ui/CanvasOverlay'
import { MiniMap } from './ui/MiniMap'
import { TrackPalette } from './ui/TrackPalette'

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
        <ToolBar store={store} />
        <div className="app-canvas-area">
          <Canvas store={store} onViewport={onViewport} />
          <TrackPalette store={store} />
          <CanvasOverlay store={store} />
          {store.showMinimap && <MiniMap store={store} viewportW={vp.w} viewportH={vp.h} />}
        </div>
        <SidePanel store={store} />
      </div>
      <StatusBar store={store} />
    </div>
  )
}
