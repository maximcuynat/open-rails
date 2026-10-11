import type { EditorStore } from '@application/state/editorStore'

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`

/** What is running, in words: « 2 trains en marche, 1 pilote automatique » */
function runningSummary(store: EditorStore): string {
  const moving = store.trains.filter((train) => Math.abs(train.currentSpeed) > 0.1).length
  const piloted = store.autopilots.size
  return [moving > 0 ? plural(moving, 'train en marche', 'trains en marche') : '', piloted > 0 ? plural(piloted, 'pilote automatique', 'pilotes automatiques') : ''].filter(Boolean).join(', ')
}

/**
 * PauseControl — the time of the game, top centre. While trains run: a button that stops it, and
 * once stopped a notice that says so, with the way back and the way out. Out of the game with
 * trains left running: a notice that the simulation is held, with the way to go on from there or
 * to put every train at rest. Neither pausing nor leaving resets anything.
 */
export function PauseControl({ store }: { store: EditorStore }) {
  const hint = store.shortcutHint('drive.pause')
  if (!store.isPlayMode) {
    if (!store.isSimulationHeld) return null
    return (
      <div className="pause-notice" role="status" aria-label="Simulation suspendue">
        <span className="pause-title"><span aria-hidden="true">⏸</span> Simulation suspendue</span>
        <span className="pause-detail">{runningSummary(store)} — rien n’est perdu.</span>
        <div className="pause-actions">
          <button type="button" className="pause-resume" title={`Reprendre la simulation${store.shortcutHint('sim.togglePlay')}`} onClick={() => store.togglePlayMode()}>
            ▶ Reprendre
          </button>
          <button type="button" className="pause-leave" title="Tous les trains à l’arrêt, freins serrés, sans pilote" onClick={() => store.haltAllTrains()}>
            Tout remettre à l’arrêt
          </button>
        </div>
      </div>
    )
  }
  if (!store.isPaused) {
    return (
      <button type="button" className="pause-button" title={`Mettre en pause${hint}`} aria-label="Mettre en pause" onClick={() => store.setPaused(true)}>
        <span aria-hidden="true">⏸</span>
      </button>
    )
  }
  return (
    <div className="pause-notice" role="status" aria-label="Simulation en pause">
      <span className="pause-title"><span aria-hidden="true">⏸</span> En pause</span>
      <span className="pause-detail">Les trains restent comme ils sont.</span>
      <div className="pause-actions">
        <button type="button" className="pause-resume" title={`Reprendre${hint}`} onClick={() => store.setPaused(false)} autoFocus>
          ▶ Reprendre
        </button>
        {store.hasBuildMode && (
          <button type="button" className="pause-leave" title="Les trains restent comme ils sont : la simulation reprendra d’ici" onClick={() => store.togglePlayMode()}>
            Quitter la conduite
          </button>
        )}
      </div>
    </div>
  )
}
