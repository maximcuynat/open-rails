import { JUNCTION_OCCUPIED_REFUSED, type EditorStore } from '@application/state/editorStore'
import { findJunctionAtNode } from '@domain/models/junction'
import { MAX_LEVEL, MIN_LEVEL } from '@domain/models/network'
import { performTrackCut } from '@domain/geometry/constructionTemplates'
import { formatDistance, formatAngle } from '@domain/models/units'
import { showToast } from '../common/Toast'
import { levelLabel, levelRange } from '../common/trackLevel'
import { getGizmoAnchor } from '../canvas/gizmo'
import {
  describeCurve,
  placementCursor,
  resolveCurveTool,
  resolvePlaceTool,
  resolveTurnoutTool,
} from '../canvas/placementPreview'

/**
 * Content of the contextual bar (bottom centre of the canvas) for the current tool and state.
 * Pure description: the React component only renders it, the tests read it directly.
 */

export type ContextBarTone = 'default' | 'accent' | 'danger'

export type ContextBarItem =
  /** What the bar is about: the tool, its step, or the kind of selection */
  | { kind: 'label'; text: string }
  /** A live value (length, radius, typed number, refusal reason…) */
  | { kind: 'value'; id: string; text: string; caption?: string; tone?: ContextBarTone }
  /** A button. `title` is its tooltip: the action and its shortcut */
  | {
      kind: 'action'
      id: string
      label: string
      title: string
      run: () => void
      tone?: ContextBarTone
      /** Toggle currently on */
      active?: boolean
      disabled?: boolean
    }

const VEHICLE_LABEL = { tgv_loco: 'Motrice TGV', tgv_wagon: 'Voiture' } as const

/** Angle of a world vector in degrees, 0–360 (the convention of the measure tool). */
function headingDeg(dx: number, dy: number): number {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI
  return deg < 0 ? deg + 360 : deg
}

function parallelToggle(store: EditorStore): ContextBarItem {
  const spacing = formatDistance(store.parallelOffset, store.unit)
  return {
    kind: 'action',
    id: 'parallel',
    label: `Voie double (${spacing})`,
    title: store.isParallelActive
      ? 'Revenir à la voie simple'
      : `Poser une voie double, entraxe ${spacing} (Maj+clic)`,
    active: store.isParallelActive,
    run: () => store.toggleParallelMode(),
  }
}

/** Typed number, or what to type when nothing is typed yet. */
function numericEntry(store: EditorStore, caption: string, unit: string): ContextBarItem {
  return store.isNumericInputActive
    ? { kind: 'value', id: 'numeric', caption, text: `${store.numericInput} ${unit} ↵`, tone: 'accent' }
    : { kind: 'value', id: 'numeric', caption, text: 'chiffres puis Entrée' }
}

function finish(store: EditorStore, label: string, title: string): ContextBarItem {
  return { kind: 'action', id: 'finish', label, title, run: () => store.cancelInteraction() }
}

function selectionBar(store: EditorStore): ContextBarItem[] | null {
  const { nodes, segments } = store.selection

  if (nodes.size === 0 && segments.size === 0) {
    // Legacy locomotive picked with the select tool: same actions as a train selection
    if (store.isTrainSelected && (store.selectedTrain || store.locomotive)) {
      return [{ kind: 'label', text: 'Train' }, ...trainSelectionActions(store)]
    }
    return null
  }

  const items: ContextBarItem[] = []
  const remove: ContextBarItem = {
    kind: 'action',
    id: 'delete',
    label: 'Supprimer',
    title: 'Supprimer la sélection (Suppr ou Retour arrière)',
    tone: 'danger',
    run: () => store.deleteSelection(),
  }
  const parallel: ContextBarItem = {
    kind: 'action',
    id: 'parallel',
    label: 'Voie double',
    title: `Créer une voie parallèle à la sélection${store.shortcutHint('edit.parallelTrack')}`,
    run: () => { store.createParallelTrackFromSelection() },
  }

  // Track level (bridge / tunnel). Each rail moves from its own level, so a whole bridge (several
  // rails) goes up in one click; the level itself is shown as soon as a rail has left the ground.
  const range = levelRange(store.network, segments) ?? { min: 0, max: 0 }
  const levelValue: ContextBarItem[] =
    range.min !== 0 || range.max !== 0
      ? [{
          kind: 'value',
          id: 'level',
          caption: 'Niveau',
          text: range.min === range.max ? levelLabel(range.min) : `${levelLabel(range.min)} à ${levelLabel(range.max)}`,
        }]
      : []
  const levelActions: ContextBarItem[] = [
    {
      kind: 'action',
      id: 'level-up',
      label: 'Monter',
      title: 'Monter la sélection d’un niveau : elle passe au-dessus des autres voies (pont)',
      disabled: range.min >= MAX_LEVEL,
      run: () => { store.shiftSelectionLevel(1) },
    },
    {
      kind: 'action',
      id: 'level-down',
      label: 'Descendre',
      title: 'Descendre la sélection d’un niveau : elle passe sous les autres voies (tunnel)',
      disabled: range.max <= MIN_LEVEL,
      run: () => { store.shiftSelectionLevel(-1) },
    },
  ]

  if (nodes.size > 0) {
    const single = nodes.size === 1 && segments.size === 0
    items.push({ kind: 'label', text: single ? 'Nœud' : nodes.size === 1 ? 'Sélection' : `${nodes.size} nœuds` })
    if (nodes.size === 1) {
      const nodeId = [...nodes][0]
      items.push({
        kind: 'action',
        id: 'extend',
        label: 'Prolonger',
        title: 'Prolonger la voie à partir de ce nœud',
        tone: 'accent',
        run: () => {
          store.setTool('place')
          store.lastNodeId = nodeId
          store.notify()
        },
      })
      const junction = findJunctionAtNode(store.network, nodeId)
      if (junction) {
        const junctionId = junction.id
        items.push(
          {
            kind: 'action',
            id: 'toggle-junction',
            label: 'Aiguiller',
            title: `Basculer la voie active de l’aiguillage${store.shortcutHint('edit.toggleJunction')}`,
            run: () => {
              if (!store.toggleActiveJunction(junctionId)) showToast(JUNCTION_OCCUPIED_REFUSED, 'warning')
            },
          },
          {
            kind: 'action',
            id: 'flip-junction',
            label: 'Inverser D/G',
            title: 'Inverser le côté de déviation de l’aiguillage (droite / gauche)',
            run: () => {
              if (!store.toggleTurnoutHandAtSelection(junctionId)) showToast(JUNCTION_OCCUPIED_REFUSED, 'warning')
            },
          },
        )
      }
    }
    // A click on a track selects its nodes along with its rails: the level applies to those rails
    if (segments.size > 0) items.push(...levelValue, ...levelActions)
    if (store.canCreateParallelTrack) items.push(parallel)
    items.push(remove)
    return items
  }

  items.push({ kind: 'label', text: segments.size === 1 ? 'Voie' : `${segments.size} voies` })
  items.push(...levelValue)
  items.push({
    kind: 'action',
    id: 'split',
    label: 'Scinder',
    title: 'Scinder la voie au centre de la sélection (outil Ciseaux : K)',
    run: () => {
      const anchor = getGizmoAnchor(store.network, store.selection)
      if (!anchor) return
      const cut = performTrackCut(store.network, anchor.worldPos, 18 / store.camera.scale, store.getPlacementThresholds().detachGap)
      if (cut) {
        store.reconcileNetwork()
        store.markDirty()
      }
    },
  })
  items.push(...levelActions)
  items.push(parallel, remove)
  return items
}

function trainSelectionActions(store: EditorStore): ContextBarItem[] {
  return [
    {
      kind: 'action',
      id: 'drive',
      label: 'Conduire',
      title: `Prendre les commandes du train${store.shortcutHint('sim.togglePlay')}`,
      tone: 'accent',
      run: () => store.togglePlayMode(),
    },
    {
      kind: 'action',
      id: 'delete',
      label: 'Supprimer',
      title: 'Supprimer le véhicule sélectionné (Suppr ou Retour arrière)',
      tone: 'danger',
      run: () => store.deleteSelection(),
    },
  ]
}

function trainBar(store: EditorStore): ContextBarItem[] {
  if (store.tool === 'coupling') return [{ kind: 'label', text: 'Attelage' }]
  if (store.trainToolSubMode === 'delete') return [{ kind: 'label', text: 'Suppression de véhicules' }]

  if (store.trainToolSubMode === 'place') {
    const snap = store.couplerSnapTarget
    return [
      { kind: 'label', text: VEHICLE_LABEL[store.trainPlacementKind] },
      snap
        ? {
            kind: 'value',
            id: 'train-target',
            text: `Attelé au train T${store.trains.indexOf(snap.train) + 1} · ${snap.train.vehicles.length + 1} véhicules`,
            tone: 'accent',
          }
        : { kind: 'value', id: 'train-target', text: `Nouveau train T${store.trains.length + 1}` },
      {
        kind: 'action',
        id: 'flip-direction',
        label: 'Inverser le sens',
        title: 'Inverser le sens du véhicule à poser (R ou Tab)',
        run: () => store.flipTrainPlacementDirection(),
      },
      finish(store, 'Terminer', 'Terminer la pose des véhicules (Échap)'),
    ]
  }

  const vehicle = store.selectedTrain?.vehicles.find((v) => v.id === store.selectedTrainVehicleId)
  if (store.isTrainSelected && vehicle) {
    return [
      { kind: 'label', text: vehicle.kind === 'loco' ? 'Motrice sélectionnée' : 'Wagon sélectionné' },
      ...trainSelectionActions(store),
    ]
  }
  if (store.isTrainSelected && store.locomotive && store.trains.length === 0) {
    return [{ kind: 'label', text: 'Train' }, ...trainSelectionActions(store)]
  }
  return [{ kind: 'label', text: 'Sélection de train' }]
}

/** Items of the contextual bar, or null when there is no bar (nothing to act on, or driving). */
export function buildContextBar(store: EditorStore): ContextBarItem[] | null {
  if (store.isPlayMode) return null

  switch (store.tool) {
    case 'select':
      return selectionBar(store)

    case 'pan':
      return null

    case 'place': {
      const place = resolvePlaceTool(store)
      if (!place) return [{ kind: 'label', text: 'Voie droite — départ' }]
      return [
        { kind: 'label', text: 'Voie droite' },
        { kind: 'value', id: 'length', caption: 'Longueur', text: formatDistance(place.length, store.unit) },
        // The length is typed in the display unit
        numericEntry(store, 'Saisie', store.unit),
        parallelToggle(store),
        finish(store, 'Terminer', 'Terminer la pose (Échap ou clic droit)'),
      ]
    }

    case 'curve': {
      const startId = store.curveState.phase === 1 ? store.curveState.startId : null
      const res = startId ? resolveCurveTool(store, startId, placementCursor(store)) : null
      if (!startId || !res) return [{ kind: 'label', text: 'Courbe 1/2 — départ' }]
      const readout = describeCurve(store, startId, res)
      return [
        { kind: 'label', text: 'Courbe 2/2' },
        readout.refused
          ? { kind: 'value', id: 'curve', text: readout.text, tone: 'danger' }
          : { kind: 'value', id: 'curve', text: readout.dims },
        // The radius is typed in metres, whatever the display unit
        numericEntry(store, 'Rayon', 'm'),
        parallelToggle(store),
        finish(store, 'Terminer', 'Terminer la pose (Échap ou clic droit)'),
      ]
    }

    case 'turnout': {
      if (!store.turnoutStartId) return [{ kind: 'label', text: 'Aiguillage 1/2 — départ' }]
      const turnout = resolveTurnoutTool(store)
      const items: ContextBarItem[] = [{ kind: 'label', text: 'Aiguillage 2/2' }]
      if (turnout) {
        items.push({ kind: 'value', id: 'turnout', text: turnout.text, tone: turnout.geom.valid ? 'default' : 'danger' })
      }
      items.push(finish(store, 'Annuler', 'Annuler l’aiguillage (Échap ou clic droit)'))
      return items
    }

    case 'split':
      return [{ kind: 'label', text: 'Ciseaux' }]

    case 'measure': {
      const start = store.measureStart
      if (!start) return [{ kind: 'label', text: 'Mesure' }]
      const end = store.measureEnd ?? placementCursor(store)
      const dx = end.x - start.x
      const dy = end.y - start.y
      return [
        { kind: 'label', text: 'Mesure' },
        { kind: 'value', id: 'distance', caption: 'Distance', text: formatDistance(Math.hypot(dx, dy), store.unit) },
        { kind: 'value', id: 'angle', caption: 'Angle', text: formatAngle(headingDeg(dx, dy), 1) },
        finish(store, 'Effacer', 'Effacer la mesure (Échap ou clic droit)'),
      ]
    }

    case 'locomotive':
    case 'coupling':
      return trainBar(store)
  }
}
