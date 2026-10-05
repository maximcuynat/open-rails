import type { SignallingLevel } from '@domain/models/signals'

/** The two signalling levels as the project settings offer them, with the line that explains each */
export const SIGNALLING_LEVEL_CHOICES: { id: SignallingLevel; label: string; hint: string }[] = [
  {
    id: 'standard',
    label: 'Standard',
    hint: 'Deux signaux : le signal de block et le signal de trajectoire. Trois couleurs, et tout signal rouge est un arrêt.',
  },
  {
    id: 'pro',
    label: 'Pro',
    hint: 'Signaux français : sémaphore (franchissable en marche à vue après arrêt), carré (jamais franchissable), repère de LGV et panneaux d’annonce des limites de vitesse. La barre de gauche du mode Signalisation change.',
  },
]
