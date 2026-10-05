import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore, JUNCTION_OCCUPIED_REFUSED } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter, MAX_LEVEL, MIN_LEVEL } from '@domain/models/network'
import { findJunctionAtNode } from '@domain/models/junction'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { showToast } from '../common/Toast'
import { buildContextBar, type ContextBarItem } from './contextBarModel'

vi.mock('../common/Toast', () => ({ showToast: vi.fn() }))

type Action = Extract<ContextBarItem, { kind: 'action' }>
type Value = Extract<ContextBarItem, { kind: 'value' }>

const bar = (store: EditorStore): ContextBarItem[] => {
  const items = buildContextBar(store)
  if (!items) throw new Error('no contextual bar in this state')
  return items
}
const label = (items: ContextBarItem[]): string | undefined =>
  items.find((i) => i.kind === 'label')?.text
const actions = (items: ContextBarItem[]): Action[] => items.filter((i): i is Action => i.kind === 'action')
const actionLabels = (items: ContextBarItem[]): string[] => actions(items).map((a) => a.label)
const action = (items: ContextBarItem[], id: string): Action => {
  const found = actions(items).find((a) => a.id === id)
  if (!found) throw new Error(`no action "${id}" in the bar`)
  return found
}
const value = (items: ContextBarItem[], id: string): Value => {
  const found = items.find((i): i is Value => i.kind === 'value' && i.id === id)
  if (!found) throw new Error(`no value "${id}" in the bar`)
  return found
}

/** Store with one straight track from x=0 to x=`length` */
function storeWithTrack(length = 200) {
  const store = new EditorStore()
  const a = addNode(store.network, { x: 0, y: 0 })
  const b = addNode(store.network, { x: length, y: 0 })
  const seg = addSegment(store.network, a.id, b.id)!
  store.camera.scale = 3
  store.markDirty()
  return { store, a, b, seg }
}

/** Store with a turnout: stem, straight branch and diverging branch meeting at `apex` */
function storeWithTurnout() {
  const store = new EditorStore()
  const stem = addNode(store.network, { x: -100, y: 0 })
  const apex = addNode(store.network, { x: 0, y: 0 })
  const straight = addNode(store.network, { x: 100, y: 0 })
  const diverging = addNode(store.network, { x: 100, y: 12 })
  addSegment(store.network, stem.id, apex.id)
  addSegment(store.network, apex.id, straight.id)
  addSegment(store.network, apex.id, diverging.id)
  store.notify() // junctions are derived from the topology
  return { store, apex }
}

function moveCursor(store: EditorStore, x: number, y: number): void {
  store.cursorWorld = { x, y }
  store.snappedCursor = { x, y }
}

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
  vi.mocked(showToast).mockClear()
})

describe('contextual bar — select tool', () => {
  it('is absent when nothing is selected', () => {
    const { store } = storeWithTrack()
    expect(buildContextBar(store)).toBeNull()
  })

  it('one node: « Nœud », Prolonger and Supprimer; Prolonger starts a rail from that node', () => {
    const { store, b } = storeWithTrack()
    store.setSelection({ nodes: new Set([b.id]), segments: new Set() })

    const items = bar(store)
    expect(label(items)).toBe('Nœud')
    expect(actionLabels(items)).toEqual(['Prolonger', 'Supprimer'])
    expect(action(items, 'delete').tone).toBe('danger')

    action(items, 'extend').run()
    expect(store.tool).toBe('place')
    expect(store.lastNodeId).toBe(b.id)
  })

  it('a turnout node adds Aiguiller and Inverser D/G, wired to the store', () => {
    const { store, apex } = storeWithTurnout()
    const junction = findJunctionAtNode(store.network, apex.id)!
    expect(junction).toBeDefined()
    store.setSelection({ nodes: new Set([apex.id]), segments: new Set() })

    const items = bar(store)
    expect(actionLabels(items)).toEqual(['Prolonger', 'Aiguiller', 'Inverser D/G', 'Supprimer'])

    const before = junction.activeBranch
    action(items, 'toggle-junction').run()
    expect(findJunctionAtNode(store.network, apex.id)!.activeBranch).not.toBe(before)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('a refused turnout manoeuvre (junction occupied) shows the refusal notification', () => {
    const { store, apex } = storeWithTurnout()
    store.setSelection({ nodes: new Set([apex.id]), segments: new Set() })
    vi.spyOn(store, 'toggleActiveJunction').mockReturnValue(false)
    vi.spyOn(store, 'toggleTurnoutHandAtSelection').mockReturnValue(false)

    const items = bar(store)
    action(items, 'toggle-junction').run()
    action(items, 'flip-junction').run()

    expect(showToast).toHaveBeenCalledTimes(2)
    expect(showToast).toHaveBeenCalledWith(JUNCTION_OCCUPIED_REFUSED, 'warning')
  })

  it('two nodes: Voie double is offered because the pair can be doubled', () => {
    const { store, a, b } = storeWithTrack()
    store.setSelection({ nodes: new Set([a.id, b.id]), segments: new Set() })

    const items = bar(store)
    expect(label(items)).toBe('2 nœuds')
    expect(actionLabels(items)).toEqual(['Voie double', 'Supprimer'])
  })

  it('a rail: « Voie », Scinder, Voie double, Supprimer — each one acts on the network', () => {
    const { store, seg } = storeWithTrack()
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })

    const items = bar(store)
    expect(label(items)).toBe('Voie')
    expect(actionLabels(items)).toEqual(['Scinder', 'Monter', 'Descendre', 'Voie double', 'Supprimer'])

    action(items, 'parallel').run()
    expect(store.network.segments.size).toBe(2)

    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    action(bar(store), 'split').run()
    expect(store.network.segments.size).toBe(3)

    store.setSelection({ nodes: new Set(), segments: new Set([...store.network.segments.keys()]) })
    expect(label(bar(store))).toBe('3 voies')
    action(bar(store), 'delete').run()
    expect(store.network.segments.size).toBe(0)
  })
})

describe('contextual bar — track levels', () => {
  it('Monter and Descendre shift the selected rails by one level, on a multiple selection too', () => {
    const { store, b, seg } = storeWithTrack()
    const c = addNode(store.network, { x: 400, y: 0 })
    const next = addSegment(store.network, b.id, c.id)!
    const shift = vi.spyOn(store, 'shiftSelectionLevel')

    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    action(bar(store), 'level-up').run()
    expect(shift).toHaveBeenLastCalledWith(1)
    action(bar(store), 'level-down').run()
    expect(shift).toHaveBeenLastCalledWith(-1)

    // A bridge is several rails: the same two actions on the whole selection
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id, next.id]) })
    const items = bar(store)
    expect(label(items)).toBe('2 voies')
    expect(actionLabels(items)).toEqual(['Scinder', 'Monter', 'Descendre', 'Voie double', 'Supprimer'])
    action(items, 'level-up').run()
    expect(shift).toHaveBeenLastCalledWith(1)
    expect(shift).toHaveBeenCalledTimes(3)
    // The selection is what the store acts on
    expect([...store.selection.segments]).toEqual([seg.id, next.id])
  })

  it('a track picked with its nodes (a click on a track) gets Monter and Descendre too; nodes alone do not', () => {
    const { store, seg } = storeWithTrack()
    const shift = vi.spyOn(store, 'shiftSelectionLevel')

    store.setSelection({ nodes: new Set([seg.from, seg.to]), segments: new Set([seg.id]) })
    const items = bar(store)
    expect(actionLabels(items)).toContain('Monter')
    expect(actionLabels(items)).toContain('Descendre')
    action(items, 'level-up').run()
    expect(shift).toHaveBeenLastCalledWith(1)

    store.setSelection({ nodes: new Set([seg.from, seg.to]), segments: new Set() })
    expect(actionLabels(bar(store))).not.toContain('Monter')
  })

  it('on the ground no level is shown; a bridge or a tunnel shows its level', () => {
    const { store, seg } = storeWithTrack()
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    expect(bar(store).some((i) => i.kind === 'value' && i.id === 'level')).toBe(false)

    seg.level = 1
    expect(value(bar(store), 'level')).toMatchObject({ caption: 'Niveau', text: 'Pont +1' })
    seg.level = -2
    expect(value(bar(store), 'level').text).toBe('Tunnel −2')
  })

  it('a selection across several levels shows the span', () => {
    const { store, b, seg } = storeWithTrack()
    const c = addNode(store.network, { x: 400, y: 0 })
    const next = addSegment(store.network, b.id, c.id)!
    next.level = 1
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id, next.id]) })
    expect(value(bar(store), 'level').text).toBe('Sol à Pont +1')
  })

  it('Monter is disabled at the top level and Descendre at the bottom one', () => {
    const { store, b, seg } = storeWithTrack()
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    expect(action(bar(store), 'level-up').disabled).toBe(false)
    expect(action(bar(store), 'level-down').disabled).toBe(false)

    seg.level = MAX_LEVEL
    expect(action(bar(store), 'level-up').disabled).toBe(true)
    expect(action(bar(store), 'level-down').disabled).toBe(false)
    seg.level = MIN_LEVEL
    expect(action(bar(store), 'level-up').disabled).toBe(false)
    expect(action(bar(store), 'level-down').disabled).toBe(true)

    // Mixed selection: an action stays available as long as one rail can still move
    const c = addNode(store.network, { x: 400, y: 0 })
    const next = addSegment(store.network, b.id, c.id)!
    seg.level = MAX_LEVEL
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id, next.id]) })
    expect(action(bar(store), 'level-up').disabled).toBe(false)
  })
})

describe('contextual bar — track tools', () => {
  it('place, before the start: only « Voie droite — départ »', () => {
    const { store } = storeWithTrack()
    store.setTool('place')
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Voie droite — départ' }])
  })

  it('place, start set: live length, numeric entry, Voie double with its spacing, Terminer', () => {
    const { store, b } = storeWithTrack()
    store.setTool('place')
    store.trackMode = 'freeform'
    store.lastNodeId = b.id
    moveCursor(store, 240, 0)

    let items = bar(store)
    expect(label(items)).toBe('Voie droite')
    expect(value(items, 'length').text).toBe('40.00 m')
    expect(value(items, 'numeric').text).toBe('chiffres puis Entrée')
    expect(actionLabels(items)).toEqual(['Voie double (3.30 m)', 'Terminer'])

    // The length follows the cursor
    moveCursor(store, 262.5, 0)
    expect(value(bar(store), 'length').text).toBe('62.50 m')

    // Typed digits show in the bar and drive the length
    store.setNumericInput('12')
    items = bar(store)
    expect(value(items, 'numeric').text).toBe('12 m ↵')
    expect(value(items, 'length').text).toBe('12.00 m')
    store.clearNumericInput()

    // Voie double is a toggle
    expect(action(items, 'parallel').active).toBe(false)
    action(items, 'parallel').run()
    expect(store.isParallelActive).toBe(true)
    expect(action(bar(store), 'parallel').active).toBe(true)
    action(bar(store), 'parallel').run()
    expect(store.isParallelActive).toBe(false)

    // Terminer ends the placement and keeps the tool
    action(bar(store), 'finish').run()
    expect(store.tool).toBe('place')
    expect(store.lastNodeId).toBeNull()
  })

  it('curve: step 1/2, then 2/2 with the live radius and angle, Voie double, Terminer', () => {
    const store = new EditorStore()
    store.camera.scale = 3
    store.setTool('curve')
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Courbe 1/2 — départ' }])

    const start = addNode(store.network, { x: 0, y: 0 })
    store.curveState = { phase: 1, startId: start.id }
    store.trackMode = 'freeform'
    moveCursor(store, 300, 80)

    const items = bar(store)
    expect(label(items)).toBe('Courbe 2/2')
    const curve = value(items, 'curve')
    expect(curve.tone).toBeUndefined()
    expect(curve.text).toMatch(/^R .+°/)
    expect(value(items, 'numeric').caption).toBe('Rayon')
    expect(actionLabels(items)).toEqual(['Voie double (3.30 m)', 'Terminer'])

    action(items, 'finish').run()
    expect(store.curveState.phase).toBe(0)
    expect(store.tool).toBe('curve')
  })

  it('curve: a refused curve shows its reason, in the danger tone, instead of the dimensions', () => {
    const { store, b } = storeWithTrack()
    store.setTool('curve')
    store.trackMode = 'freeform'
    store.curveState = { phase: 1, startId: b.id }
    // Aiming back along the existing rail: the curve would reverse on it
    moveCursor(store, 150, 0.5)

    const curve = value(bar(store), 'curve')
    expect(curve.tone).toBe('danger')
    expect(curve.text).not.toMatch(/^R /)
    expect(curve.text.length).toBeGreaterThan(10)
  })

  it('turnout: step 1/2, then 2/2 with valid dimensions or the refusal, and Annuler', () => {
    const { store, b } = storeWithTrack()
    store.setTool('turnout')
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Aiguillage 1/2 — départ' }])

    store.turnoutStartId = b.id
    moveCursor(store, 600, 4)
    let items = bar(store)
    expect(label(items)).toBe('Aiguillage 2/2')
    expect(value(items, 'turnout').tone).toBe('default')
    expect(value(items, 'turnout').text).toContain('Espacement')
    expect(actionLabels(items)).toEqual(['Annuler'])

    // Far too short for its offset: the radius falls under the minimum
    moveCursor(store, 206, 5)
    items = bar(store)
    expect(value(items, 'turnout').tone).toBe('danger')
    expect(value(items, 'turnout').text).toContain('Rayon trop serré')

    action(items, 'finish').run()
    expect(store.turnoutStartId).toBeNull()
    expect(store.tool).toBe('turnout')
  })

  it('scissors: the tool label alone', () => {
    const { store } = storeWithTrack()
    store.setTool('split')
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Ciseaux' }])
  })

  it('measure: live distance and angle, Effacer clears the measure', () => {
    const { store } = storeWithTrack()
    store.setTool('measure')
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Mesure' }])

    store.measureStart = { x: 0, y: 0 }
    moveCursor(store, 30, 40)
    let items = bar(store)
    expect(value(items, 'distance').text).toBe('50.00 m')
    expect(value(items, 'angle').text).toBe('53.1°')

    // Once fixed, the measure no longer follows the cursor
    store.measureEnd = { x: 10, y: 0 }
    moveCursor(store, 500, 500)
    items = bar(store)
    expect(value(items, 'distance').text).toBe('10.00 m')

    action(items, 'finish').run()
    expect(store.measureStart).toBeNull()
    expect(store.tool).toBe('measure')
  })

  it('pan: no bar', () => {
    const { store } = storeWithTrack()
    store.setTool('pan')
    expect(buildContextBar(store)).toBeNull()
  })
})

describe('contextual bar — trains', () => {
  it('place: chosen vehicle, « Nouveau train » or « Attelé au train », Inverser le sens, Terminer', () => {
    const { store } = storeWithTrack(1000)
    store.setTrainPlacementKind('tgv_loco')

    let items = bar(store)
    expect(label(items)).toBe('Motrice TGV')
    expect(value(items, 'train-target').text).toBe('Nouveau train T1')
    expect(actionLabels(items)).toEqual(['Inverser le sens', 'Terminer'])

    const direction = store.trainPlacementDirection
    action(items, 'flip-direction').run()
    expect(store.trainPlacementDirection).toBe(-direction)
    action(bar(store), 'flip-direction').run()

    // With a first vehicle on the track, the next one couples to it when the cursor is near
    expect(store.placeTrainItem({ x: 100, y: 0 })).toBe(true)
    store.setTrainPlacementKind('tgv_wagon')
    store.updateLocomotivePreview({ x: 60, y: 0 })
    expect(store.couplerSnapTarget).not.toBeNull()
    items = bar(store)
    expect(label(items)).toBe('Voiture')
    expect(value(items, 'train-target').text).toBe('Attelé au train T1 · 2 véhicules')
    expect(value(items, 'train-target').tone).toBe('accent')

    // Away from it, a new train would start
    store.updateLocomotivePreview({ x: 600, y: 0 })
    expect(value(bar(store), 'train-target').text).toBe('Nouveau train T2')

    action(bar(store), 'finish').run()
    expect(store.tool).toBe('locomotive')
    expect(store.trainToolSubMode).toBe('select')
  })

  it('select: the selected vehicle with Conduire and Supprimer', () => {
    const { store } = storeWithTrack(1000)
    store.setTrainPlacementKind('tgv_loco')
    store.placeTrainItem({ x: 100, y: 0 })
    store.setTrainToolSubMode('select')

    const items = bar(store)
    expect(label(items)).toBe('Motrice sélectionnée')
    expect(actionLabels(items)).toEqual(['Conduire', 'Supprimer'])

    action(items, 'delete').run()
    expect(store.trains).toHaveLength(0)
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Sélection de train' }])
  })

  it('Conduire enters driving mode, where the bar is absent', () => {
    const { store } = storeWithTrack(1000)
    store.setTrainPlacementKind('tgv_loco')
    store.placeTrainItem({ x: 100, y: 0 })
    store.setTrainToolSubMode('select')

    action(bar(store), 'drive').run()
    expect(store.isPlayMode).toBe(true)
    expect(buildContextBar(store)).toBeNull()
    store.togglePlayMode()
  })

  it('delete and coupling modes: the label of the state alone', () => {
    const { store } = storeWithTrack(1000)
    store.setTrainToolSubMode('delete')
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Suppression de véhicules' }])

    store.setTrainToolSubMode('select')
    store.toggleCouplingMode()
    expect(store.tool).toBe('coupling')
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Attelage' }])
  })
})

describe('contextual bar — tooltips', () => {
  it('every action names itself in its tooltip, with its shortcut when it has one', () => {
    const titles = new Map<string, string>()
    const collect = (store: EditorStore) => {
      for (const a of actions(buildContextBar(store) ?? [])) {
        expect(a.title.length).toBeGreaterThan(a.label.length)
        titles.set(`${store.tool}:${a.id}`, a.title)
      }
    }

    const turnout = storeWithTurnout()
    turnout.store.setSelection({ nodes: new Set([turnout.apex.id]), segments: new Set() })
    collect(turnout.store)

    const { store, b, seg } = storeWithTrack(1000)
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    collect(store)
    store.setTool('place')
    store.lastNodeId = b.id
    moveCursor(store, 1100, 0)
    collect(store)
    store.setTool('measure')
    store.measureStart = { x: 0, y: 0 }
    collect(store)
    store.setTrainPlacementKind('tgv_loco')
    collect(store)
    store.placeTrainItem({ x: 100, y: 0 })
    store.setTrainToolSubMode('select')
    collect(store)

    expect(titles.get('select:toggle-junction')).toContain('(T)')
    expect(titles.get('select:parallel')).toContain('(D)')
    expect(titles.get('select:delete')).toContain('Suppr')
    expect(titles.get('place:parallel')).toContain('Maj+clic')
    expect(titles.get('place:finish')).toContain('Échap')
    expect(titles.get('measure:finish')).toContain('Échap')
    expect(titles.get('locomotive:flip-direction')).toContain('R ou Tab')
    expect(titles.get('locomotive:drive')).toContain('F5')
    expect(titles.get('locomotive:delete')).toContain('Suppr')
  })
})
