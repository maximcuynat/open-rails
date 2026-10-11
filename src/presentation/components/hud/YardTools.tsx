import type { EditorStore } from '@application/state/editorStore'
import type { TrainSet } from '@domain/models/train'
import { showToast } from '../common/Toast'

/** Why a train cannot be taken out of the game now; null when it can */
export function removalRefusal(store: EditorStore, train: TrainSet): string | null {
  if (store.trains.length < 2) return 'C’est le seul train de la partie'
  if (Math.abs(train.currentSpeed) > 0.1) return 'Arrêtez le train avant de le retirer'
  return null
}

/** Take a train out of the game, with a word when it is refused */
export function removeTrain(store: EditorStore, train: TrainSet): void {
  const result = store.removeTrainInGame(train.id)
  if (result === 'moving') showToast('Arrêtez le train avant de le retirer.', 'warning')
  else if (result === 'last') showToast('C’est le seul train de la partie.', 'warning')
}

/**
 * YardTools — what is done to the rakes themselves while the game runs: arming the coupling
 * click (two rakes at rest end to end are coupled, a rake is parted between two units).
 */
export function YardTools({ store }: { store: EditorStore }) {
  const armed = store.couplingArmed
  return (
    <div className="yard-tools">
      <button type="button" className={`itinerary-aid-choice${armed ? ' is-active' : ''}`} aria-pressed={armed} onClick={() => store.armCoupling(!armed)}>
        Atteler / dételer
      </button>
      {armed && <p className="itinerary-empty">Cliquez sur un attelage : entre deux rames à l’arrêt bout à bout pour les atteler, entre deux éléments d’une rame pour les séparer.</p>}
    </div>
  )
}
