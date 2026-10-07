import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { EditorStore, useEditorVersion } from '@application/state/editorStore'
import { useKeyboardShortcuts } from '@presentation/hooks/useKeyboardShortcuts'
import { Canvas } from '@presentation/components/canvas/Canvas'
import { TopBar } from '@presentation/components/topbar/TopBar'
import { ToolBar } from '@presentation/components/toolbar/ToolBar'
import { SidePanel } from '@presentation/components/sidepanel/SidePanel'
import { CanvasOverlay } from '@presentation/components/canvas/CanvasOverlay'
import { MiniMap } from '@presentation/components/minimap/MiniMap'
import { ToastContainer, showToast } from '@presentation/components/common/Toast'
import { DrivingDock } from '@presentation/components/hud/DrivingDock'
import { arrangeConsole } from '@presentation/components/console/consoleLayout'
import { createRemoteSession, type RemoteSession } from '@application/remote/remoteSession'
import { createWebSocketLink } from '@infrastructure/remote/webSocketLink'
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from '@domain/import/osmTypes'
import { installLineStreaming, reloadDataset } from '@application/dataset/journeyLoader'
import { datasetErrorMessage, loadDatasetIndex } from '@application/dataset/datasetClient'

export default function App() {
  const storeRef = useRef<EditorStore | null>(null)
  if (storeRef.current === null) storeRef.current = new EditorStore()
  const store = storeRef.current

  // The phone desk belongs to this page: opened from the Simulation menu, gone with the page
  const remoteRef = useRef<RemoteSession | null>(null)
  if (remoteRef.current === null) remoteRef.current = createRemoteSession({ store, createLink: createWebSocketLink })
  const remote = remoteRef.current

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

  // A project saved as a recipe of the dataset: its lines are fetched again at start. A full
  // export of such a project, imported back, only needs the index so that the lines a train
  // nears can be fetched.
  useEffect(() => {
    if (store.datasetReloadPending) {
      showToast('Rechargement de la ligne…', 'info')
      void reloadDataset(store)
        .then(() => showToast(`Ligne « ${store.projectName} » rechargée`, 'success'))
        .catch((error: unknown) => showToast(datasetErrorMessage(error), 'error', 8000))
    } else if (store.dataset && !store.datasetIndex) {
      void loadDatasetIndex()
        .then((index) => installLineStreaming(store, index))
        .catch(() => {})
    }
  }, [store, store.dataset])

  // Persist state when reloading or navigating away
  useEffect(() => {
    const handleUnload = () => {
      // At once: the write that waits for the edits to pause would come too late
      store.flushPersistedState()
    }
    window.addEventListener('beforeunload', handleUnload)
    window.addEventListener('pagehide', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('pagehide', handleUnload)
    }
  }, [store])

  // Closing the page closes the room: the phone is told at once instead of waiting for a timeout
  useEffect(() => {
    const handleLeave = () => remote.close()
    window.addEventListener('pagehide', handleLeave)
    return () => {
      window.removeEventListener('pagehide', handleLeave)
      remote.close()
    }
  }, [remote])

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

  // Which driving console fits the canvas area, and what it pushes aside (mini-map, debug panel)
  const arrangement = arrangeConsole(vp.w, vp.h, store.consolePreference, store.isPlayMode && !store.isSpectating, store.showTrainDebug)
  const canvasAreaStyle = {
    '--console-scale': arrangement.scale,
    '--minimap-lift': `${arrangement.placement.minimapLift}px`,
    '--dock-right': `${arrangement.placement.debug.right}px`,
    '--dock-bottom': `${arrangement.placement.debug.bottom}px`,
  } as CSSProperties

  return (
    <div className="app-layout">
      <TopBar store={store} remote={remote} onFitView={fitView} />
      <div className="app-middle">
        <div className="app-canvas-area" style={canvasAreaStyle}>
          <Canvas store={store} onViewport={onViewport} />
          <ToolBar store={store} />
          <CanvasOverlay store={store} />
          <SidePanel store={store} />
          {store.showMinimap && !store.isPlainDrivingView && <MiniMap store={store} viewportW={vp.w} viewportH={vp.h} />}
          {/* The mention the ODbL asks for, as long as the network shown comes from OpenStreetMap */}
          {store.osmSource && (
            <a
              className={`osm-attribution${store.showMinimap && !store.isPlainDrivingView ? ' above-minimap' : ''}`}
              href={OSM_COPYRIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {OSM_ATTRIBUTION}
            </a>
          )}
          <DrivingDock store={store} remote={remote} arrangement={arrangement} />
        </div>
      </div>
      <ToastContainer />
    </div>
  )
}

