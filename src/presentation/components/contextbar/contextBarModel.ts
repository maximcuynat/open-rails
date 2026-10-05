import type { EditorStore } from '@application/state/editorStore'
import { findJunctionAtNode } from '@domain/models/junction'
import { MAX_LEVEL, MIN_LEVEL } from '@domain/models/network'
import { performTrackCut } from '@domain/geometry/constructionTemplates'
import { formatDistance, formatAngle } from '@domain/models/units'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { findSectionBySegment, type SectionDirection } from '@domain/models/sections'
import { SPEED_ZONE_STEP } from '@domain/models/speedZones'
import { speedZoneLength } from '@domain/services/speedZoneLayout'
import { signalBlock } from '@domain/models/signalBlocks'
import { SIGNAL_ROW_SPACINGS } from '@application/state/editorStore'
import {
  SIGNAL_ONE_WAY_TITLE,
  flipSignal,
  otherSignalRole,
  signalRoleLabel,
  signalRowSpacingChoices,
  signalTypeLabel,
} from '../common/signalActions'
import { showToast } from '../common/Toast'
import { canLowerZoneSpeed, canRaiseZoneSpeed, changeZoneSpeed, zoneSpeedChoices, zoneSpeedLabel } from '../common/speedZoneActions'
import { levelRange, levelRangeLabel, nodeLevelRange } from '../common/trackLevel'
import { getGizmoAnchor } from '../canvas/gizmo'
import {
  describeCurve,
  placementCursor,
  resolveCurveTool,
  resolvePlaceTool,
  resolveSpeedZoneTool,
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
  /**
   * A value stepped down and up by two buttons that never move: the value sits between them in a
   * slot of constant width, so the same button can be clicked again and again.
   */
  | {
      kind: 'stepper'
      id: string
      caption: string
      text: string
      decrease: ContextBarStep
      increase: ContextBarStep
      /** When given, the value between the two buttons is a pick list of these choices */
      choices?: { value: number; label: string }[]
      value?: number
      pick?: (value: number) => void
    }
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

/** One of the two buttons of a stepper. `title` is its tooltip */
export interface ContextBarStep {
  title: string
  run: () => void
  disabled?: boolean
}

/** The traffic direction button steps through the settings in this order */
const DIRECTION_CYCLE: Record<SectionDirection, SectionDirection> = { two_way: 'forward', forward: 'backward', backward: 'two_way' }
const DIRECTION_ARROW: Record<SectionDirection, string> = { two_way: '↔', forward: '→', backward: '←' }
const DIRECTION_NAME: Record<SectionDirection, string> = {
  two_way: 'double sens',
  forward: 'sens unique, dans le sens de pose',
  backward: 'sens unique, à contresens de la pose',
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
    // Greyed out rather than removed: the buttons after it keep their place
    disabled: !store.canCreateParallelTrack,
    run: () => { store.createParallelTrackFromSelection() },
  }

  // Track level (bridge / tunnel): the heights of the nodes of the selected rails, or of the
  // selected nodes when no rail is selected (what `shiftSelectionLevel` acts on). Each node moves
  // from its own height, so a whole bridge (several rails) goes up in one click. Always shown,
  // « Sol » included: nothing appears or goes away between two clicks.
  const range =
    (segments.size > 0 ? levelRange(store.network, segments) : nodeLevelRange(store.network, nodes)) ?? { min: 0, max: 0 }
  const level: ContextBarItem = {
    kind: 'stepper',
    id: 'level',
    caption: 'Niveau',
    text: levelRangeLabel(range),
    decrease: {
      title: 'Descendre la sélection d’un niveau : elle passe sous les autres voies (tunnel)',
      disabled: range.max <= MIN_LEVEL,
      run: () => { store.shiftSelectionLevel(-1) },
    },
    increase: {
      title: 'Monter la sélection d’un niveau : elle passe au-dessus des autres voies (pont)',
      disabled: range.min >= MAX_LEVEL,
      run: () => { store.shiftSelectionLevel(1) },
    },
  }

  // Traffic direction of the sections the selected rails belong to. One button that steps through
  // the three settings; its label has the same width in each, so the buttons after it stay put.
  const sections = segments.size > 0 ? networkDerived(store.network, store.sectionMeta).sections : []
  const selectedSections = [
    ...new Set([...segments].map((sid) => findSectionBySegment(sections, sid)).filter((sec) => sec !== null)),
  ]
  const directions = new Set(selectedSections.map((sec) => sec.direction))
  const currentDirection = directions.size === 1 ? [...directions][0] : null
  const nextDirection = currentDirection ? DIRECTION_CYCLE[currentDirection] : 'two_way'
  const direction: ContextBarItem = {
    kind: 'action',
    id: 'direction',
    label: `Sens ${currentDirection ? DIRECTION_ARROW[currentDirection] : '…'}`,
    title: `Sens de circulation : ${currentDirection ? DIRECTION_NAME[currentDirection] : 'différent selon les voies'}. Cliquer pour passer en ${DIRECTION_NAME[nextDirection]}`,
    active: currentDirection !== null && currentDirection !== 'two_way',
    disabled: selectedSections.length === 0,
    run: () => { store.setSectionsMeta(selectedSections.map((sec) => sec.id), { direction: nextDirection }) },
  }

  // Even out the slope along a run of rails. Always there when rails are selected, greyed out
  // when there is nothing to even out: the buttons after it keep their place
  const spread: ContextBarItem = {
    kind: 'action',
    id: 'spread-gradient',
    label: 'Lisser la pente',
    title: 'Répartir le dénivelé sur les voies sélectionnées : la même pente d’un bout à l’autre',
    disabled: !store.canSpreadSelectionGradient,
    run: () => { store.spreadSelectionGradient() },
  }

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
        items.push({
          kind: 'action',
          id: 'toggle-junction',
          label: 'Aiguiller',
          title: `Basculer la voie active de l’aiguillage${store.shortcutHint('edit.toggleJunction')}`,
          run: () => {
            if (!store.toggleActiveJunction(junctionId)) showToast(store.junctionRefusalMessage, 'warning')
          },
        })
        // Only a plain turnout has a diverging branch to mirror
        if (junction.kind === 'turnout') {
          items.push({
            kind: 'action',
            id: 'flip-junction',
            label: 'Inverser D/G',
            title: 'Inverser le côté de déviation de l’aiguillage (droite / gauche)',
            run: () => {
              if (!store.toggleTurnoutHandAtSelection(junctionId)) showToast(store.junctionRefusalMessage, 'warning')
            },
          })
        }
      }
    }
    // A click on a track selects its nodes along with its rails: the level applies to those rails.
    // Nodes alone: to the nodes themselves
    items.push(level)
    if (segments.size > 0) items.push(direction, spread)
    items.push(parallel, remove)
    return items
  }

  items.push({ kind: 'label', text: segments.size === 1 ? 'Voie' : `${segments.size} voies` })
  items.push(level, direction, spread)
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

/**
 * Speed of a zone: picked in the list of multiples of 10 km/h, or stepped by 10 with the two buttons,
 * which stay where they are whatever the value.
 */
function zoneSpeedStepper(speed: number, subject: string, set: (speed: number) => void): ContextBarItem {
  return {
    kind: 'stepper',
    id: 'zone-speed',
    caption: 'Vitesse',
    text: zoneSpeedLabel(speed),
    choices: zoneSpeedChoices().map((value) => ({ value, label: zoneSpeedLabel(value) })),
    value: speed,
    pick: set,
    decrease: {
      title: `Baisser la vitesse ${subject} de ${SPEED_ZONE_STEP} km/h`,
      disabled: !canLowerZoneSpeed(speed),
      run: () => set(speed - SPEED_ZONE_STEP),
    },
    increase: {
      title: `Relever la vitesse ${subject} de ${SPEED_ZONE_STEP} km/h`,
      disabled: !canRaiseZoneSpeed(speed),
      run: () => set(speed + SPEED_ZONE_STEP),
    },
  }
}

/** Spacing of a row of signals: picked in the list, or stepped through it with the two buttons */
function rowSpacingStepper(store: EditorStore): ContextBarItem {
  const choices = signalRowSpacingChoices(store)
  const index = SIGNAL_ROW_SPACINGS.findIndex((value) => value === store.signalToolSpacing)
  const step = (by: number) => () => store.setSignalToolSpacing(SIGNAL_ROW_SPACINGS[index + by])
  return {
    kind: 'stepper',
    id: 'row-spacing',
    caption: 'Espacement',
    text: choices[index]?.label ?? '',
    choices,
    value: store.signalToolSpacing,
    pick: (value) => store.setSignalToolSpacing(value),
    decrease: { title: 'Resserrer les signaux d’une série', disabled: index <= 0, run: step(-1) },
    increase: { title: 'Espacer les signaux d’une série', disabled: index < 0 || index >= SIGNAL_ROW_SPACINGS.length - 1, run: step(1) },
  }
}

/** A signal tool in hand: the same items whatever the gesture, so nothing moves under the pointer */
function signalToolBar(store: EditorStore, spec: { role: 'spacing' | 'protection'; cabMarker: boolean }): ContextBarItem[] {
  const level = store.signallingLevel
  const items: ContextBarItem[] = [
    { kind: 'label', text: spec.cabMarker ? 'Repère de LGV' : signalRoleLabel(spec.role, level) },
    {
      kind: 'action',
      id: 'flip',
      label: 'Inverser le sens',
      title: 'Le signal s’adresse à l’autre sens de marche : il se pose de l’autre côté de la voie (R ou Tab)',
      active: store.signalToolFlipped,
      run: () => store.flipSignalTool(),
    },
    {
      kind: 'action',
      id: 'both-ways',
      label: 'Double sens',
      title: 'Poser deux signaux dos à dos, un pour chaque sens de marche (voie parcourue dans les deux sens)',
      active: store.signalToolBothWays,
      run: () => store.setSignalToolBothWays(!store.signalToolBothWays),
    },
  ]
  if (spec.cabMarker) {
    const passable = spec.role === 'spacing'
    items.push({
      kind: 'action',
      id: 'cab-role',
      label: passable ? 'Plaque F' : 'Plaque Nf',
      title: passable
        ? 'Repère franchissable (F). Cliquer pour poser des repères non franchissables (Nf)'
        : 'Repère non franchissable (Nf). Cliquer pour poser des repères franchissables (F)',
      active: !passable,
      run: () => store.setSignalToolCabRole(otherSignalRole(spec.role)),
    })
  }
  items.push(rowSpacingStepper(store))
  // Always there: what the drag along the track would lay, or how to lay a row
  const row = store.signalRowPreview
  const start = store.signalRowStart
  const end = store.signalRowEnd
  if (start && end) {
    const count = row.length * (store.signalToolBothWays ? 2 : 1)
    items.push(
      count > 0
        ? { kind: 'value', id: 'signal-row', caption: 'Série', text: `${count} signaux`, tone: 'accent' }
        : { kind: 'value', id: 'signal-row', caption: 'Série', text: 'aucun chemin', tone: 'danger' },
    )
  } else {
    items.push({ kind: 'value', id: 'signal-row', caption: 'Série', text: 'glisser le long de la voie' })
  }
  return items
}

/** Signalling mode: its selection, the signal tools, the speed limit tool and its two clicks, the deletion */
function signalBar(store: EditorStore): ContextBarItem[] {
  if (store.signalToolSubMode === 'delete') return [{ kind: 'label', text: 'Suppression de signaux et de limites' }]

  const spec = store.signalToolSpec
  if (spec) return signalToolBar(store, spec)

  if (store.signalToolSubMode === 'speedZone') {
    const speed = zoneSpeedStepper(store.speedZoneToolSpeed, 'de la zone à poser', (v) => store.setSpeedZoneToolSpeed(v))
    const preview = resolveSpeedZoneTool(store)
    if (!preview) return [{ kind: 'label', text: 'Limite de vitesse 1/2 — départ' }, speed]
    return [
      { kind: 'label', text: 'Limite de vitesse 2/2' },
      speed,
      // Always there once the start is set: the length, or why the click would be refused
      preview.path
        ? { kind: 'value', id: 'zone-length', caption: 'Longueur', text: formatDistance(preview.path.length, store.unit) }
        : { kind: 'value', id: 'zone-length', text: preview.end ? 'aucun chemin' : 'hors voie', tone: 'danger' },
      finish(store, 'Annuler', 'Annuler la zone en cours (Échap ou clic droit)'),
    ]
  }

  const signal = store.selectedSignal
  if (signal) {
    const level = store.signallingLevel
    const block = signalBlock(store.network, signal.id)
    const other = otherSignalRole(signal.role)
    return [
      { kind: 'label', text: signalTypeLabel(signal, level) },
      {
        kind: 'action',
        id: 'flip',
        label: 'Inverser le sens',
        title: 'Retourner le signal : il s’adresse à l’autre sens de marche et passe de l’autre côté de la voie (R)',
        run: () => flipSignal(store, signal.id),
      },
      {
        kind: 'action',
        id: 'role',
        label: `En ${signalRoleLabel(other, level).toLowerCase()}`,
        title: `Changer le type du signal : ${signalRoleLabel(other, level).toLowerCase()}`,
        run: () => { store.changeSignalRole(signal.id, other) },
      },
      // Always there, greyed out on a block signal: the option only means something on a path signal
      {
        kind: 'action',
        id: 'one-way',
        label: 'Sens unique',
        title: SIGNAL_ONE_WAY_TITLE[signal.role],
        active: signal.role === 'protection' && !!signal.oneWay,
        disabled: signal.role !== 'protection',
        run: () => { store.setSignalOneWay(signal.id, !signal.oneWay) },
      },
      {
        kind: 'value',
        id: 'block-length',
        caption: 'Canton',
        text: block ? formatDistance(block.length, store.unit) : '—',
      },
      {
        kind: 'action',
        id: 'delete',
        label: 'Supprimer',
        title: 'Supprimer le signal (Suppr ou Retour arrière)',
        tone: 'danger',
        run: () => { store.deleteSignal(signal.id) },
      },
    ]
  }

  const zone = store.selectedSpeedZone
  if (!zone) return [{ kind: 'label', text: 'Signalisation' }]
  return [
    { kind: 'label', text: 'Limite de vitesse' },
    zoneSpeedStepper(zone.speed, 'de la zone', (v) => changeZoneSpeed(store, zone.id, v)),
    { kind: 'value', id: 'zone-length', caption: 'Longueur', text: formatDistance(speedZoneLength(store.network, zone), store.unit) },
    {
      kind: 'action',
      id: 'delete',
      label: 'Supprimer',
      title: 'Supprimer la limite de vitesse (Suppr ou Retour arrière)',
      tone: 'danger',
      run: () => { store.deleteSpeedZone(zone.id) },
    },
  ]
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

    case 'signal':
      return signalBar(store)
  }
}
