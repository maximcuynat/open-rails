import type { EditorStore } from '@application/state/editorStore'

/** One side of the mode switch of the top bar */
export interface ModeChoice {
  label: string
  title: string
  active: boolean
  disabled: boolean
}

export interface ModeSwitchView {
  build: ModeChoice
  play: ModeChoice
  /** What the time of the game is doing, said next to the switch; null when there is nothing to say */
  status: 'running' | 'paused' | 'held' | null
}

export const MODE_STATUS_LABELS = { running: 'en marche', paused: 'en pause', held: 'suspendue' } as const

/**
 * The two modes of the application as the top bar shows them, always: building (the track and the
 * trains; the trains only on a real network, whose track is locked) and playing. Going from one to
 * the other loses nothing, and the titles say so.
 */
export function modeSwitchView(store: EditorStore): ModeSwitchView {
  const playing = store.isPlayMode
  const hasTrain = store.trains.length > 0 || store.locomotive !== null
  const locked = store.dataset !== null
  return {
    build: {
      label: locked ? 'Trains' : 'Édition',
      title: playing
        ? `${locked ? 'Composer et retirer des trains (la voie d’un réseau réel ne se modifie pas)' : 'Revenir à l’édition de la voie et des trains'} — les trains restent comme ils sont, la simulation reprendra d’ici`
        : locked ? 'Réseau réel : la voie ne se modifie pas, les trains se composent et se retirent ici' : 'Édition de la voie et des trains',
      active: !playing,
      disabled: false,
    },
    play: {
      label: 'Jeu',
      title: playing
        ? store.isPaused ? 'Le jeu est en pause' : 'Les trains roulent'
        : !hasTrain ? 'Posez un train pour jouer'
        : store.isSimulationHeld ? `Reprendre la simulation là où elle s’est arrêtée${store.shortcutHint('sim.togglePlay')}`
        : `Prendre les commandes${store.shortcutHint('sim.togglePlay')}`,
      active: playing,
      disabled: !playing && !hasTrain,
    },
    status: playing ? (store.isPaused ? 'paused' : 'running') : store.isSimulationHeld ? 'held' : null,
  }
}
