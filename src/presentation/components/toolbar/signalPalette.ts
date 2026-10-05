import { signalSubModesFor, type SignalSubMode } from '@application/state/editorStore'
import type { ActionId } from '@application/keybindings/keybindings'
import type { SignallingLevel } from '@domain/models/signals'

/**
 * The tools of the signalling mode for each signalling level, in the order of the panel. Pure
 * description: `ToolBar.tsx` adds the icons and renders it, the tests read it directly.
 *
 * The standard level lays a block signal and a path signal. The pro level has a panel of its own,
 * with the French names of the same two signals (sémaphore, carré) and the marker board of a
 * cab-signalled line. A signal laid at one level reads at the other without any conversion.
 */

export interface SignalToolDef {
  mode: SignalSubMode
  label: string
  hint: string
  danger?: boolean
  shortcut?: ActionId
  /** Fixed key shown in the tooltip, when the tool has no rebindable one */
  fixedKey?: string
}

export interface SignalPalette {
  level: SignallingLevel
  /** Short name shown at the top of the panel; null: the plain panel of the standard level */
  badge: string | null
  title: string
  tools: SignalToolDef[]
}

const SIGNAL_HINT = 'Un clic pose le signal du côté de la voie où est le curseur · glisser le long de la voie pour une série'

const TOOL_DEFS: Record<SignallingLevel, Record<SignalSubMode, Omit<SignalToolDef, 'mode'>>> = {
  standard: {
    select: {
      label: 'Sélectionner un signal ou une limite de vitesse',
      hint: 'Cliquer pour modifier dans l’inspecteur · glisser un signal pour le déplacer le long de la voie',
    },
    blockSignal: { label: 'Signal de block', hint: SIGNAL_HINT, shortcut: 'tool.signalBlock' },
    pathSignal: {
      label: 'Signal de trajectoire',
      hint: 'À poser avant une aiguille ou un croisement : il ne s’ouvre que si le trajet est libre',
      shortcut: 'tool.signalPath',
    },
    // Never offered at the standard level (see `signalSubModesFor`)
    cabMarker: { label: 'Repère de LGV', hint: SIGNAL_HINT },
    speedZone: {
      label: 'Limite de vitesse',
      hint: 'Un clic sur la voie pour le début de la zone, un clic pour la fin',
      shortcut: 'tool.speedZone',
    },
    delete: {
      label: 'Supprimer un signal ou une limite de vitesse',
      hint: 'Survol rouge et clic pour supprimer',
      danger: true,
      fixedKey: 'Suppr',
    },
  },
  pro: {
    select: {
      label: 'Sélectionner un signal ou une limite de vitesse',
      hint: 'Cliquer pour modifier dans l’inspecteur · glisser un signal pour le déplacer le long de la voie',
    },
    blockSignal: { label: 'Sémaphore (panneau de block, plaque F)', hint: SIGNAL_HINT, shortcut: 'tool.signalBlock' },
    pathSignal: {
      label: 'Carré (plaque Nf)',
      hint: 'À poser avant une aiguille ou un croisement : jamais franchissable fermé',
      shortcut: 'tool.signalPath',
    },
    cabMarker: {
      label: 'Repère de LGV',
      hint: 'Repère de canton sans feu d’une ligne à signalisation en cabine · F ou Nf dans la barre du bas',
    },
    speedZone: {
      label: 'Limite de vitesse',
      hint: 'Un clic sur la voie pour le début de la zone, un clic pour la fin · les panneaux d’annonce se placent seuls',
      shortcut: 'tool.speedZone',
    },
    delete: {
      label: 'Supprimer un signal ou une limite de vitesse',
      hint: 'Survol rouge et clic pour supprimer',
      danger: true,
      fixedKey: 'Suppr',
    },
  },
}

/** The panel of the signalling mode at a signalling level */
export function signalPalette(level: SignallingLevel): SignalPalette {
  const key: SignallingLevel = level === 'pro' ? 'pro' : 'standard'
  return {
    level: key,
    badge: key === 'pro' ? 'PRO' : null,
    title: key === 'pro' ? 'Signalisation française (niveau pro)' : 'Signalisation',
    tools: signalSubModesFor(key).map((mode) => ({ mode, ...TOOL_DEFS[key][mode] })),
  }
}
