import type { TrainDebugOptions } from '@application/state/editorStore'

export interface TrainDebugLayer {
  key: keyof TrainDebugOptions
  label: string
  hint: string
}

/** The layers of the train debug view, in the order the panel lists them */
export const TRAIN_DEBUG_LAYERS: TrainDebugLayer[] = [
  { key: 'vectors', label: 'Vecteurs', hint: 'Vitesse V, accélération a, centrifuge ac, ruban d’arrêt' },
  { key: 'yawAngles', label: 'Angles de lacet', hint: 'Angles de lacet des bogies et articulation entre caisses' },
  { key: 'gauge', label: 'Gabarit', hint: 'Gabarit cinématique de libre passage et balayage en courbe' },
  { key: 'lookahead', label: 'Trajet 50 m', hint: 'Projection du trajet et détection d’un heurtoir ou d’une fin de voie' },
  { key: 'xray', label: 'Rayons X', hint: 'Carrosserie transparente laissant voir les essieux' },
]
