import { computeTrackSections } from '@domain/models/sections'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore, JUNCTION_OCCUPIED_REFUSED, MAX_ZONE_SPEED, SPEED_ZONE_OVERLAP } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter, setNodesLevel, MAX_LEVEL, MIN_LEVEL } from '@domain/models/network'
import { findJunctionAtNode, activeBranchOf } from '@domain/models/junction'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { formatDistance } from '@domain/models/units'
import { showToast } from '../common/Toast'
import { buildContextBar, type ContextBarItem } from './contextBarModel'

vi.mock('../common/Toast', () => ({ showToast: vi.fn() }))

type Action = Extract<ContextBarItem, { kind: 'action' }>
type Value = Extract<ContextBarItem, { kind: 'value' }>
type Stepper = Extract<ContextBarItem, { kind: 'stepper' }>

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

const stepper = (items: ContextBarItem[], id: string): Stepper => {
  const found = items.find((i): i is Stepper => i.kind === 'stepper' && i.id === id)
  if (!found) throw new Error(`no stepper "${id}" in the bar`)
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
    // Voie double cannot double a lone node: it is greyed out, not removed, so Supprimer stays put
    expect(actionLabels(items)).toEqual(['Prolonger', 'Voie double', 'Supprimer'])
    // The level of the node, after the actions of the node itself; no slope action without a rail
    expect(items.map((i) => i.kind)).toEqual(['label', 'action', 'stepper', 'action', 'action'])
    expect(action(items, 'parallel').disabled).toBe(true)
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
    expect(actionLabels(items)).toEqual(['Prolonger', 'Aiguiller', 'Inverser D/G', 'Voie double', 'Supprimer'])

    const before = activeBranchOf(junction)
    action(items, 'toggle-junction').run()
    expect(activeBranchOf(findJunctionAtNode(store.network, apex.id)!)).not.toBe(before)
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
    expect(action(items, 'parallel').disabled).toBe(false)
  })

  it('a rail: « Voie », Scinder, Voie double, Supprimer — each one acts on the network', () => {
    const { store, seg } = storeWithTrack()
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })

    const items = bar(store)
    expect(label(items)).toBe('Voie')
    expect(items.map((i) => i.kind)).toEqual(['label', 'stepper', 'action', 'action', 'action', 'action', 'action'])
    expect(actionLabels(items)).toEqual(['Sens ↔', 'Lisser la pente', 'Scinder', 'Voie double', 'Supprimer'])

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
  it('the level stepper shifts the selected rails by one level, on a multiple selection too', () => {
    const { store, b, seg } = storeWithTrack()
    const c = addNode(store.network, { x: 400, y: 0 })
    const next = addSegment(store.network, b.id, c.id)!
    const shift = vi.spyOn(store, 'shiftSelectionLevel')

    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    stepper(bar(store), 'level').increase.run()
    expect(shift).toHaveBeenLastCalledWith(1)
    stepper(bar(store), 'level').decrease.run()
    expect(shift).toHaveBeenLastCalledWith(-1)

    // A bridge is several rails: the same stepper on the whole selection
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id, next.id]) })
    const items = bar(store)
    expect(label(items)).toBe('2 voies')
    stepper(items, 'level').increase.run()
    expect(shift).toHaveBeenLastCalledWith(1)
    expect(shift).toHaveBeenCalledTimes(3)
    // The selection is what the store acts on
    expect([...store.selection.segments]).toEqual([seg.id, next.id])
  })

  it('a track picked with its nodes (a click on a track) gets the stepper too, for its rails', () => {
    const { store, seg } = storeWithTrack()
    const shift = vi.spyOn(store, 'shiftSelectionLevel')

    store.setSelection({ nodes: new Set([seg.from, seg.to]), segments: new Set([seg.id]) })
    stepper(bar(store), 'level').increase.run()
    expect(shift).toHaveBeenLastCalledWith(1)
  })

  it('nodes alone get the stepper too: it shows their heights and shifts them', () => {
    const { store, a, b } = storeWithTrack()
    const c = addNode(store.network, { x: 400, y: 0 }, 2)
    addSegment(store.network, b.id, c.id)

    // One node: its own height, not that of the rails around it
    store.setSelection({ nodes: new Set([b.id]), segments: new Set() })
    expect(stepper(bar(store), 'level')).toMatchObject({ caption: 'Niveau', text: 'Sol' })
    store.setSelection({ nodes: new Set([c.id]), segments: new Set() })
    expect(stepper(bar(store), 'level').text).toBe('Pont +2')

    // Several nodes: the span of their heights
    store.setSelection({ nodes: new Set([a.id, c.id]), segments: new Set() })
    expect(stepper(bar(store), 'level').text).toBe('0 à +2')

    // The stepper moves the node: its two rails become ramps, the selection is kept
    store.setSelection({ nodes: new Set([b.id]), segments: new Set() })
    stepper(bar(store), 'level').increase.run()
    expect(store.network.nodes.get(b.id)!.level).toBe(1)
    expect(store.network.nodes.get(a.id)!.level).toBeUndefined()
    expect([...store.selection.nodes]).toEqual([b.id])
    expect(stepper(bar(store), 'level').text).toBe('Pont +1')
    stepper(bar(store), 'level').decrease.run()
    expect(stepper(bar(store), 'level').text).toBe('Sol')

    // Bounds, on the nodes selected
    setNodesLevel(store.network, [b.id], MAX_LEVEL)
    expect(stepper(bar(store), 'level').increase.disabled).toBe(true)
    expect(stepper(bar(store), 'level').decrease.disabled).toBe(false)
    setNodesLevel(store.network, [b.id], MIN_LEVEL)
    expect(stepper(bar(store), 'level').decrease.disabled).toBe(true)
  })

  it('the bar of a node keeps its shape while its level changes', () => {
    const { store, b } = storeWithTrack()
    store.setSelection({ nodes: new Set([b.id]), segments: new Set() })
    const shape = () => bar(store).map((i) => (i.kind === 'action' ? i.label : i.kind))
    const onTheGround = shape()
    for (const level of [1, MAX_LEVEL, -1, MIN_LEVEL, 0.5]) {
      setNodesLevel(store.network, [b.id], level)
      expect(shape()).toEqual(onTheGround)
    }
  })

  it('« Sens »: next to the level, steps the traffic direction of the selected track in one undo step', () => {
    const { store, seg } = storeWithTrack()
    store.setSelection({ nodes: new Set([seg.from, seg.to]), segments: new Set([seg.id]) })
    const shape = () => bar(store).map((i) => (i.kind === 'action' ? i.id : i.kind))
    const before = shape()
    expect(before.indexOf('direction')).toBe(before.indexOf('stepper') + 1)
    const directionOf = () => computeTrackSections(store.network, store.sectionMeta)[0].direction

    expect(action(bar(store), 'direction')).toMatchObject({ label: 'Sens ↔', active: false, disabled: false })
    action(bar(store), 'direction').run()
    expect(directionOf()).toBe('forward')
    expect(action(bar(store), 'direction')).toMatchObject({ label: 'Sens →', active: true })
    action(bar(store), 'direction').run()
    expect(directionOf()).toBe('backward')
    expect(action(bar(store), 'direction').label).toBe('Sens ←')
    // Same buttons at the same places whatever the direction
    expect(shape()).toEqual(before)

    store.undo()
    expect(directionOf()).toBe('forward')
    // Undo clears the selection
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    action(bar(store), 'direction').run()
    action(bar(store), 'direction').run()
    expect(directionOf()).toBe('two_way')

    // Nodes alone have no direction to set
    store.setSelection({ nodes: new Set([seg.from]), segments: new Set() })
    expect(shape()).not.toContain('direction')
  })

  it('« Lisser la pente »: always there for rails, greyed out when there is nothing to even out', () => {
    const { store, seg } = storeWithTrack()
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    const shape = () => bar(store).map((i) => (i.kind === 'action' ? i.label : i.kind))
    const can = vi.spyOn(store, 'canSpreadSelectionGradient', 'get')
    const spread = vi.spyOn(store, 'spreadSelectionGradient').mockReturnValue(true)

    can.mockReturnValue(false)
    const greyed = shape()
    expect(action(bar(store), 'spread-gradient')).toMatchObject({ label: 'Lisser la pente', disabled: true })

    can.mockReturnValue(true)
    expect(action(bar(store), 'spread-gradient').disabled).toBe(false)
    // Same items, same order: only the state of the button changed
    expect(shape()).toEqual(greyed)
    expect(greyed.indexOf('Lisser la pente')).toBe(greyed.indexOf('stepper') + 2)

    action(bar(store), 'spread-gradient').run()
    expect(spread).toHaveBeenCalledTimes(1)

    // With the nodes of the track in the selection as well (a click on a track)
    store.setSelection({ nodes: new Set([seg.from, seg.to]), segments: new Set([seg.id]) })
    expect(action(bar(store), 'spread-gradient').disabled).toBe(false)
    can.mockReturnValue(false)
    expect(action(bar(store), 'spread-gradient').disabled).toBe(true)

    // Nodes alone: no rail to even out, no button
    store.setSelection({ nodes: new Set([seg.from]), segments: new Set() })
    expect(actions(bar(store)).some((a) => a.id === 'spread-gradient')).toBe(false)
  })

  it('« Lisser la pente » on an uneven run of three rails: active, then greyed out once it has run', () => {
    const { store, a, b, seg } = storeWithTrack()
    const c = addNode(store.network, { x: 400, y: 0 }, 1)
    const d = addNode(store.network, { x: 600, y: 0 }, 1)
    const second = addSegment(store.network, b.id, c.id)!
    const third = addSegment(store.network, c.id, d.id)!
    // Heights 0, 0, 1, 1: the whole climb is on the middle rail
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id, second.id, third.id]) })
    const shape = () => bar(store).map((i) => (i.kind === 'action' ? i.label : i.kind))
    const before = shape()
    expect(action(bar(store), 'spread-gradient').disabled).toBe(false)

    action(bar(store), 'spread-gradient').run()
    const heights = [a, b, c, d].map((n) => store.network.nodes.get(n.id)!.level ?? 0)
    expect(heights[0]).toBe(0)
    expect(heights[1]).toBeCloseTo(1 / 3)
    expect(heights[2]).toBeCloseTo(2 / 3)
    expect(heights[3]).toBe(1)
    expect(action(bar(store), 'spread-gradient').disabled).toBe(true)
    expect(shape()).toEqual(before)
    expect(stepper(bar(store), 'level').text).toBe('0 à +1')
  })

  /** Put a rail flat at `level`: both its nodes */
  const setRailLevel = (store: EditorStore, seg: { from: string; to: string }, level: number) =>
    setNodesLevel(store.network, [seg.from, seg.to], level)

  it('the bar keeps the same items, in the same order, whatever the level: nothing moves between two clicks', () => {
    const { store, seg } = storeWithTrack()
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    const shape = () => bar(store).map((i) => (i.kind === 'action' ? i.label : i.kind))
    const onTheGround = shape()

    expect(stepper(bar(store), 'level')).toMatchObject({ caption: 'Niveau', text: 'Sol' })
    for (const level of [1, 2, MAX_LEVEL, -1, MIN_LEVEL]) {
      setRailLevel(store, seg, level)
      expect(shape()).toEqual(onTheGround)
    }
    setRailLevel(store, seg, 1)
    expect(stepper(bar(store), 'level').text).toBe('Pont +1')
    setRailLevel(store, seg, -2)
    expect(stepper(bar(store), 'level').text).toBe('Tunnel −2')
  })

  it('a ramp shows the heights of its two ends, in a short form', () => {
    const { store, a, b, seg } = storeWithTrack()
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    const shape = () => bar(store).map((i) => (i.kind === 'action' ? i.label : i.kind))
    const onTheGround = shape()

    setNodesLevel(store.network, [b.id], 1)
    expect(stepper(bar(store), 'level').text).toBe('0 à +1')
    expect(shape()).toEqual(onTheGround)
    setNodesLevel(store.network, [a.id], -1)
    expect(stepper(bar(store), 'level').text).toBe('−1 à +1')
    // A node left by a cut half-way up
    setNodesLevel(store.network, [a.id], 0.5)
    expect(stepper(bar(store), 'level').text).toBe('+0,5 à +1')
    setNodesLevel(store.network, [b.id], 0.5)
    expect(stepper(bar(store), 'level').text).toBe('Pont +0,5')
  })

  it('a selection across several levels shows the span, in a short form', () => {
    const { store, a, b, seg } = storeWithTrack()
    const c = addNode(store.network, { x: 400, y: 0 }, 1)
    const d = addNode(store.network, { x: 600, y: 0 }, 1)
    addSegment(store.network, b.id, c.id)
    const bridge = addSegment(store.network, c.id, d.id)!
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id, bridge.id]) })
    expect(stepper(bar(store), 'level').text).toBe('0 à +1')
    setNodesLevel(store.network, [a.id, b.id], MIN_LEVEL)
    setNodesLevel(store.network, [c.id, d.id], MAX_LEVEL)
    expect(stepper(bar(store), 'level').text).toBe('−5 à +5')
  })

  it('+ is disabled at the top level and − at the bottom one', () => {
    const { store, b, seg } = storeWithTrack()
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id]) })
    const disabled = () => {
      const level = stepper(bar(store), 'level')
      return { up: !!level.increase.disabled, down: !!level.decrease.disabled }
    }
    expect(disabled()).toEqual({ up: false, down: false })

    setRailLevel(store, seg, MAX_LEVEL)
    expect(disabled()).toEqual({ up: true, down: false })
    setRailLevel(store, seg, MIN_LEVEL)
    expect(disabled()).toEqual({ up: false, down: true })

    // Mixed selection: a button stays available as long as one node can still move
    const c = addNode(store.network, { x: 400, y: 0 })
    const next = addSegment(store.network, b.id, c.id)!
    setRailLevel(store, seg, MAX_LEVEL)
    setNodesLevel(store.network, [c.id], 0)
    store.setSelection({ nodes: new Set(), segments: new Set([seg.id, next.id]) })
    expect(disabled()).toEqual({ up: false, down: false })
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

/** Number of steps the undo history holds */
const undoSteps = (store: EditorStore) => (store as unknown as { history: unknown[] }).history.length

describe('context bar: signalling mode', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    vi.mocked(showToast).mockClear()
  })

  const kinds = (items: ContextBarItem[]): string[] => items.map((i) => (i.kind === 'label' ? 'label' : `${i.kind}:${i.id}`))

  it('names the mode when nothing is picked, and the deletion sub-mode', () => {
    const { store } = storeWithTrack(1000)
    store.setTool('signal')
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Signalisation' }])
    store.setSignalToolSubMode('delete')
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Suppression de limites' }])
  })

  it('speed limit tool: start step, then the live length of the way to the cursor', () => {
    const { store } = storeWithTrack(1000)
    store.setSignalToolSubMode('speedZone')
    expect(label(bar(store))).toBe('Limite de vitesse 1/2 — départ')
    expect(kinds(bar(store))).toEqual(['label', 'stepper:zone-speed'])

    store.clickSpeedZoneTool(store.trackPointAt({ x: 100, y: 0 }))
    moveCursor(store, 600, 0)
    let items = bar(store)
    expect(label(items)).toBe('Limite de vitesse 2/2')
    expect(kinds(items)).toEqual(['label', 'stepper:zone-speed', 'value:zone-length', 'action:finish'])
    expect(value(items, 'zone-length')).toMatchObject({ caption: 'Longueur', text: formatDistance(500, store.unit) })

    moveCursor(store, 850, 0)
    items = bar(store)
    expect(value(items, 'zone-length').text).toBe(formatDistance(750, store.unit))
  })

  it('speed limit tool: says why the click would be refused, in the same slot', () => {
    const { store } = storeWithTrack(1000)
    const c = addNode(store.network, { x: 0, y: 60 })
    const d = addNode(store.network, { x: 1000, y: 60 })
    addSegment(store.network, c.id, d.id)
    store.setSignalToolSubMode('speedZone')
    store.clickSpeedZoneTool(store.trackPointAt({ x: 100, y: 0 }))

    moveCursor(store, 500, 30)
    let items = bar(store)
    expect(kinds(items)).toEqual(['label', 'stepper:zone-speed', 'value:zone-length', 'action:finish'])
    expect(value(items, 'zone-length')).toMatchObject({ text: 'hors voie', tone: 'danger' })

    moveCursor(store, 500, 60)
    items = bar(store)
    expect(kinds(items)).toEqual(['label', 'stepper:zone-speed', 'value:zone-length', 'action:finish'])
    expect(value(items, 'zone-length')).toMatchObject({ text: 'aucun chemin', tone: 'danger' })
  })

  it('speed limit tool: the speed is also picked in a list of the multiples of 10 km/h', () => {
    const { store } = storeWithTrack(1000)
    store.setSignalToolSubMode('speedZone')
    store.setSpeedZoneToolSpeed(80)
    const speed = stepper(bar(store), 'zone-speed')

    const values = speed.choices!.map((choice) => choice.value)
    expect(values[0]).toBe(10)
    expect(values[values.length - 1]).toBe(MAX_ZONE_SPEED)
    expect(values.every((value, i) => value % 10 === 0 && (i === 0 || value - values[i - 1] === 10))).toBe(true)
    expect(speed.choices!.find((choice) => choice.value === 320)!.label).toBe('320 km/h')
    expect(speed.value).toBe(80)

    speed.pick!(320)
    expect(store.speedZoneToolSpeed).toBe(320)
    expect(stepper(bar(store), 'zone-speed').value).toBe(320)
  })

  it('speed limit tool: the stepper sets the speed of the next zone by 10 km/h, greyed out at its ends', () => {
    const { store } = storeWithTrack(1000)
    store.setSignalToolSubMode('speedZone')
    store.setSpeedZoneToolSpeed(80)
    let speed = stepper(bar(store), 'zone-speed')
    expect(speed).toMatchObject({ caption: 'Vitesse', text: '80 km/h' })
    speed.increase.run()
    expect(store.speedZoneToolSpeed).toBe(90)
    stepper(bar(store), 'zone-speed').decrease.run()
    stepper(bar(store), 'zone-speed').decrease.run()
    expect(store.speedZoneToolSpeed).toBe(70)

    // Same items, same order, whatever the value: the two buttons never move
    const shape = kinds(bar(store))
    store.setSpeedZoneToolSpeed(10)
    speed = stepper(bar(store), 'zone-speed')
    expect(speed.decrease.disabled).toBe(true)
    expect(speed.increase.disabled).toBe(false)
    expect(kinds(bar(store))).toEqual(shape)
    store.setSpeedZoneToolSpeed(MAX_ZONE_SPEED)
    speed = stepper(bar(store), 'zone-speed')
    expect(speed.increase.disabled).toBe(true)
    expect(kinds(bar(store))).toEqual(shape)

    // The step in progress is kept while the speed is changed
    store.clickSpeedZoneTool(store.trackPointAt({ x: 100, y: 0 }))
    moveCursor(store, 400, 0)
    stepper(bar(store), 'zone-speed').decrease.run()
    expect(store.speedZoneStart).not.toBeNull()
    expect(label(bar(store))).toBe('Limite de vitesse 2/2')
  })

  it('speed limit tool: « Annuler » drops the start and keeps the tool', () => {
    const { store } = storeWithTrack(1000)
    store.setSignalToolSubMode('speedZone')
    store.clickSpeedZoneTool(store.trackPointAt({ x: 100, y: 0 }))
    moveCursor(store, 400, 0)
    action(bar(store), 'finish').run()
    expect(store.speedZoneStart).toBeNull()
    expect(store.isSpeedZoneTool).toBe(true)
  })

  it('a picked zone: its speed stepped in place, its length, and its deletion', () => {
    const { store } = storeWithTrack(1000)
    store.setSignalToolSubMode('speedZone')
    store.setSpeedZoneToolSpeed(90)
    store.clickSpeedZoneTool(store.trackPointAt({ x: 100, y: 0 }))
    store.clickSpeedZoneTool(store.trackPointAt({ x: 600, y: 0 }))
    store.setSignalToolSubMode('select')
    const zone = store.selectedSpeedZone!

    let items = bar(store)
    expect(label(items)).toBe('Limite de vitesse')
    const shape = kinds(items)
    expect(shape).toEqual(['label', 'stepper:zone-speed', 'value:zone-length', 'action:delete'])
    expect(stepper(items, 'zone-speed').text).toBe('90 km/h')
    expect(value(items, 'zone-length').text).toBe(formatDistance(500, store.unit))

    const steps = undoSteps(store)
    stepper(items, 'zone-speed').decrease.run()
    expect(zone.speed).toBe(80)
    expect(undoSteps(store)).toBe(steps + 1)
    items = bar(store)
    expect(kinds(items)).toEqual(shape)
    expect(stepper(items, 'zone-speed').text).toBe('80 km/h')
    expect(showToast).not.toHaveBeenCalled()

    expect(action(items, 'delete')).toMatchObject({ tone: 'danger' })
    action(items, 'delete').run()
    expect(store.network.speedZones.size).toBe(0)
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Signalisation' }])
  })

  it('warns when the speed of a zone is changed while it overlaps another one', () => {
    const { store } = storeWithTrack(1000)
    store.setSignalToolSubMode('speedZone')
    store.clickSpeedZoneTool(store.trackPointAt({ x: 100, y: 0 }))
    store.clickSpeedZoneTool(store.trackPointAt({ x: 600, y: 0 }))
    store.setSignalToolSubMode('select')
    const overlaps = vi.spyOn(store, 'speedZoneOverlapsAnother').mockReturnValue(true)
    stepper(bar(store), 'zone-speed').increase.run()
    expect(overlaps).toHaveBeenCalledWith(store.selectedSpeedZone!.id)
    expect(showToast).toHaveBeenCalledWith(SPEED_ZONE_OVERLAP, 'warning', expect.any(Number))
  })

  it('has no bar while driving', () => {
    const { store } = storeWithTrack(1000)
    store.setTrainPlacementKind('tgv_loco')
    store.placeTrainItem({ x: 100, y: 0 })
    store.setTool('signal')
    store.togglePlayMode()
    expect(buildContextBar(store)).toBeNull()
  })
})
