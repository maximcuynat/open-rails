import type { EditorStore } from '@application/state/editorStore'

/**
 * PauseControl — the time of the game, top centre while trains run: a button that stops it, and
 * once stopped a notice that says so, with the way back and the only way out. Pausing resets
 * nothing; leaving stops every train and lets go of every pilot, which is why it is asked twice
 * when a train is moving.
 */
export function PauseControl({ store }: { store: EditorStore }) {
  if (!store.isPlayMode) return null
  const hint = store.shortcutHint('drive.pause')
  if (!store.isPaused) {
    return (
      <button type="button" className="pause-button" title={`Mettre en pause${hint}`} aria-label="Mettre en pause" onClick={() => store.setPaused(true)}>
        <span aria-hidden="true">⏸</span>
      </button>
    )
  }
  const moving = store.trains.filter((train) => Math.abs(train.currentSpeed) > 0.1).length
  const piloted = store.autopilots.size
  const leave = (): void => {
    const lost = [moving > 0 ? `${moving} train${moving > 1 ? 's' : ''} en marche` : '', piloted > 0 ? `${piloted} pilote${piloted > 1 ? 's' : ''} automatique${piloted > 1 ? 's' : ''}` : ''].filter(Boolean)
    if (lost.length > 0 && !window.confirm(`Quitter la conduite ? Tous les trains sont remis à l’arrêt (${lost.join(', ')}).`)) return
    store.togglePlayMode()
  }
  return (
    <div className="pause-notice" role="status" aria-label="Simulation en pause">
      <span className="pause-title"><span aria-hidden="true">⏸</span> En pause</span>
      <span className="pause-detail">Les trains restent comme ils sont.</span>
      <div className="pause-actions">
        <button type="button" className="pause-resume" title={`Reprendre${hint}`} onClick={() => store.setPaused(false)} autoFocus>
          ▶ Reprendre
        </button>
        <button type="button" className="pause-leave" onClick={leave}>
          Quitter la conduite
        </button>
      </div>
    </div>
  )
}
