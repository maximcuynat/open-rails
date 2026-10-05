import type { EditorStore } from '@application/state/editorStore'
import { chordLabel, type ActionId } from '@application/keybindings/keybindings'
import { Modal } from '../common/Modal'

interface ShortcutsModalProps {
  store: EditorStore
  isOpen: boolean
  onClose: () => void
}

export function ShortcutsModal({ store, isOpen, onClose }: ShortcutsModalProps) {
  /** Every key assigned to an action */
  const keys = (action: ActionId) => {
    const chords = store.keybindings[action].filter((c) => c !== null)
    if (chords.length === 0) return '—'
    return chords.map((c, i) => (
      <span key={i}>
        {i > 0 && ' ou '}
        <span className="shortcut-kbd">{chordLabel(c, store.keyLabels)}</span>
      </span>
    ))
  }

  return (
    <Modal isOpen={isOpen} title="Raccourcis clavier Open Rails" closeLabel="Fermer" onClose={onClose}>
      <div className="shortcuts-grid">
        <div className="shortcuts-section">Outils</div>
        <div>{keys('tool.select')}</div>
        <div>Sélection et déplacement</div>
        <div>{keys('tool.place')}</div>
        <div>Voie droite</div>
        <div>{keys('tool.curve')}</div>
        <div>Voie courbe</div>
        <div>{keys('tool.turnout')}</div>
        <div>Aiguillage</div>
        <div>{keys('tool.split')}</div>
        <div>Ciseaux (scinder une voie)</div>
        <div>{keys('tool.measure')}</div>
        <div>Règle (mesurer)</div>
        <div>{keys('tool.pan')}</div>
        <div>Déplacer la vue</div>
        <div>{keys('tool.locomotive')}</div>
        <div>Trains (pose et sélection)</div>
        <div className="shortcuts-section">Pose des voies</div>
        <div><span className="shortcut-kbd">0</span>–<span className="shortcut-kbd">9</span> puis <span className="shortcut-kbd">Entrée</span></div>
        <div>Saisir la longueur exacte de la voie droite en cours</div>
        <div><span className="shortcut-kbd">Tab</span></div>
        <div>Continuer en courbe depuis le nœud de la voie droite en cours ; changer de côté (courbe, aiguillage)</div>
        <div><span className="shortcut-kbd">Maj</span> + clic</div>
        <div>Poser une voie double</div>
        <div>{keys('edit.paramDecrease')} / {keys('edit.paramIncrease')}</div>
        <div>Rayon précédent / suivant (courbe, aiguillage)</div>
        <div>Clic droit</div>
        <div>Terminer la pose en cours</div>
        <div><span className="shortcut-kbd">Échap</span></div>
        <div>Annuler la pose en cours, puis revenir à l’outil Sélection</div>
        <div className="shortcuts-section">Édition</div>
        <div>{keys('edit.toggleJunction')}</div>
        <div>Basculer l’aiguillage sélectionné</div>
        <div>{keys('edit.parallelTrack')}</div>
        <div>Créer une voie parallèle à la sélection</div>
        <div><span className="shortcut-kbd">R</span></div>
        <div>Réconcilier les jonctions et aiguillages</div>
        <div><span className="shortcut-kbd">Suppr</span> ou <span className="shortcut-kbd">Retour arrière</span></div>
        <div>Supprimer la sélection</div>
        <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">A</span></div>
        <div>Tout sélectionner</div>
        <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">Z</span></div>
        <div>Annuler</div>
        <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">Maj</span> + <span className="shortcut-kbd">Z</span> ou <span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">Y</span></div>
        <div>Rétablir</div>
        <div className="shortcuts-section">Trains</div>
        <div><span className="shortcut-kbd">R</span> ou <span className="shortcut-kbd">Tab</span></div>
        <div>Inverser le sens du véhicule à poser</div>
        <div><span className="shortcut-kbd">Suppr</span></div>
        <div>Supprimer le véhicule sélectionné</div>
        <div>{keys('train.debug')}</div>
        <div>Afficher / masquer le squelette des trains</div>
        <div className="shortcuts-section">Affichage</div>
        <div><span className="shortcut-kbd">Espace</span> + glisser</div>
        <div>Déplacer la vue</div>
        <div>{keys('view.fit')}</div>
        <div>Ajuster tout le réseau à la vue</div>
        <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">0</span></div>
        <div>Zoom par défaut</div>
        <div>{keys('view.toggleSnap')}</div>
        <div>Activer / désactiver l’aimantation</div>
        <div>{keys('view.toggleInspector')}</div>
        <div>Afficher / masquer l’inspecteur</div>
        <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">,</span> ou <span className="shortcut-kbd">,</span></div>
        <div>Paramètres du réseau (échelles, unités)</div>
        <div className="shortcuts-section">Conduite</div>
        <div>{keys('sim.togglePlay')}</div>
        <div>Entrer en mode conduite / le quitter</div>
        <div>{keys('drive.exit')} ou <span className="shortcut-kbd">Échap</span></div>
        <div>Quitter la conduite</div>
        <div>{keys('drive.notchUp')}</div>
        <div>Traction : un cran de plus (N à P5)</div>
        <div>{keys('drive.notchDown')}</div>
        <div>Traction : un cran de moins</div>
        <div>{keys('drive.brakeApply')} (maintenir)</div>
        <div>Serrer le frein</div>
        <div>{keys('drive.brakeRelease')} (maintenir)</div>
        <div>Desserrer le frein — à faire pour partir : les trains démarrent freins serrés</div>
        <div>{keys('drive.reverserForward')}</div>
        <div>Inverseur vers l’avant</div>
        <div>{keys('drive.reverserBackward')}</div>
        <div>Inverseur vers l’arrière</div>
        <div>{keys('drive.emergencyBrake')}</div>
        <div>Arrêt d’urgence</div>
        <div>{keys('drive.steerLeft')} / {keys('drive.steerRight')}</div>
        <div>Orienter le prochain aiguillage</div>
        <div className="shortcuts-note">
          Les touches de conduite et d’outils se modifient dans les paramètres (Ctrl + ,).
        </div>
      </div>
    </Modal>
  )
}
