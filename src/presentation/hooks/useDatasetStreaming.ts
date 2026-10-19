import { useEffect } from 'react'
import type { EditorStore } from '@application/state/editorStore'

/** How long (ms) the view has to stay put before the lines it nears are looked for */
export const DATASET_VIEW_DEBOUNCE_MS = 250
/** How often (ms) the lines are looked for whatever happens: the view panned without a pause, a paused game */
export const DATASET_REFRESH_PERIOD_MS = 1000

/**
 * The lines of a dataset project follow the view, in every mode, paused or not: once the camera
 * (or the size of the canvas) has stayed put for `DATASET_VIEW_DEBOUNCE_MS`, and every
 * `DATASET_REFRESH_PERIOD_MS` besides — unless the simulation has just done it for its trains.
 * `store.refreshDatasetLines` decides what comes and what goes.
 */
export function useDatasetStreaming(store: EditorStore): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let seen = ''
    const refresh = (): void => {
      timer = null
      store.refreshDatasetLines()
    }
    const unsubscribe = store.subscribe(() => {
      if (!store.dataset || !store.datasetIndex) return
      const cam = store.camera
      const view = `${cam.x}|${cam.y}|${cam.scale}|${store.viewport.w}|${store.viewport.h}`
      if (view === seen) return
      seen = view
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(refresh, DATASET_VIEW_DEBOUNCE_MS)
    })
    const interval = setInterval(() => {
      if (!store.dataset || !store.datasetIndex) return
      if (performance.now() - store.datasetRefreshedAt < DATASET_REFRESH_PERIOD_MS * 0.9) return
      store.refreshDatasetLines()
    }, DATASET_REFRESH_PERIOD_MS)
    return () => {
      unsubscribe()
      clearInterval(interval)
      if (timer !== null) clearTimeout(timer)
    }
  }, [store])
}
