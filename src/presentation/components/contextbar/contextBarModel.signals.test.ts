import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { SIGNAL_REFUSAL_TEXT } from '@domain/models/signals'
import { formatDistance } from '@domain/models/units'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
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
const label = (items: ContextBarItem[]) => items.find((i) => i.kind === 'label')?.text
const kinds = (items: ContextBarItem[]): string[] => items.map((i) => (i.kind === 'label' ? 'label' : `${i.kind}:${i.id}`))
const action = (items: ContextBarItem[], id: string): Action => {
  const found = items.find((i): i is Action => i.kind === 'action' && i.id === id)
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

/** A store with a committed straight track along y = 0 from x = 0 to x = 5000 */
function storeWithTrack(): EditorStore {
  const store = new EditorStore()
  const a = addNode(store.network, { x: 0, y: 0 })
  const b = addNode(store.network, { x: 5000, y: 0 })
  addSegment(store.network, a.id, b.id)
  store.camera.scale = 3
  store.markDirty()
  return store
}

const undoSteps = (store: EditorStore) => (store as unknown as { history: unknown[] }).history.length

function click(store: EditorStore, x: number, y: number): void {
  store.beginSignalGesture({ x, y })
  store.commitSignalGesture()
}

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
  vi.mocked(showToast).mockClear()
})

describe('context bar: signal tools', () => {
  const TOOL_SHAPE = ['label', 'action:flip', 'action:both-ways', 'stepper:row-spacing', 'value:signal-row']

  it('names the signal the tool lays, at each level', () => {
    const store = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    expect(label(bar(store))).toBe('Signal de block')
    store.setSignalToolSubMode('pathSignal')
    expect(label(bar(store))).toBe('Signal de trajectoire')
    store.setSignallingSettings({ level: 'pro' })
    expect(label(bar(store))).toBe('Carré')
    store.setSignalToolSubMode('blockSignal')
    expect(label(bar(store))).toBe('Sémaphore')
    store.setSignalToolSubMode('cabMarker')
    expect(label(bar(store))).toBe('Repère de LGV')
  })

  it('keeps the same items in the same order before, during and after a drag', () => {
    const store = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    expect(kinds(bar(store))).toEqual(TOOL_SHAPE)
    store.beginSignalGesture({ x: 500, y: -3 })
    expect(kinds(bar(store))).toEqual(TOOL_SHAPE)
    store.updateSignalGesture({ x: 3600, y: -3 })
    expect(kinds(bar(store))).toEqual(TOOL_SHAPE)
    store.commitSignalGesture()
    expect(kinds(bar(store))).toEqual(TOOL_SHAPE)
    store.setSignalToolBothWays(true)
    store.flipSignalTool()
    expect(kinds(bar(store))).toEqual(TOOL_SHAPE)
  })

  it('toggles the direction and « double sens »', () => {
    const store = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    expect(action(bar(store), 'flip').active).toBe(false)
    expect(action(bar(store), 'flip').title).toContain('R ou Tab')
    action(bar(store), 'flip').run()
    expect(store.signalToolFlipped).toBe(true)
    expect(action(bar(store), 'flip').active).toBe(true)

    expect(action(bar(store), 'both-ways').active).toBe(false)
    action(bar(store), 'both-ways').run()
    expect(store.signalToolBothWays).toBe(true)
    expect(action(bar(store), 'both-ways').active).toBe(true)
    action(bar(store), 'both-ways').run()
    expect(store.signalToolBothWays).toBe(false)
  })

  it('sets the spacing of a row from a list, or one step at a time', () => {
    const store = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    const spacing = () => stepper(bar(store), 'row-spacing')
    expect(spacing().value).toBe(1500)
    expect(spacing().text).toBe(formatDistance(1500, store.unit))
    expect(spacing().choices!.map((c) => c.value)).toEqual([250, 500, 1000, 1500, 2000, 2500])
    spacing().increase.run()
    expect(store.signalToolSpacing).toBe(2000)
    spacing().increase.run()
    expect(spacing().increase.disabled).toBe(true)
    spacing().pick!(500)
    expect(store.signalToolSpacing).toBe(500)
    spacing().decrease.run()
    expect(store.signalToolSpacing).toBe(250)
    expect(spacing().decrease.disabled).toBe(true)
  })

  it('counts the signals of the row being drawn', () => {
    const store = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.setSignalToolSpacing(1000)
    expect(value(bar(store), 'signal-row').text).toBe('glisser le long de la voie')
    store.beginSignalGesture({ x: 500, y: -3 })
    store.updateSignalGesture({ x: 3600, y: -3 })
    expect(value(bar(store), 'signal-row')).toMatchObject({ text: '4 signaux', tone: 'accent' })
    store.setSignalToolBothWays(true)
    expect(value(bar(store), 'signal-row').text).toBe('8 signaux')
    // A drag shorter than the spacing lays one signal, written in the singular
    store.setSignalToolBothWays(false)
    store.updateSignalGesture({ x: 900, y: -3 })
    expect(value(bar(store), 'signal-row').text).toBe('1 signal')
  })

  it('marker board tool: one more button for its plate, F or Nf', () => {
    const store = storeWithTrack()
    store.setSignallingSettings({ level: 'pro' })
    store.setSignalToolSubMode('cabMarker')
    expect(kinds(bar(store))).toEqual(['label', 'action:flip', 'action:both-ways', 'action:cab-role', 'stepper:row-spacing', 'value:signal-row'])
    expect(action(bar(store), 'cab-role').label).toBe('Plaque F')
    action(bar(store), 'cab-role').run()
    expect(store.signalToolCabRole).toBe('protection')
    expect(action(bar(store), 'cab-role').label).toBe('Plaque Nf')
    expect(kinds(bar(store))).toHaveLength(6)
  })
})

describe('context bar: a picked signal', () => {
  const SIGNAL_SHAPE = ['label', 'action:flip', 'action:role', 'action:one-way', 'value:block-length', 'action:delete']

  function withPickedSignal() {
    const store = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    click(store, 1000, -3)
    click(store, 3000, -3)
    store.setSignalToolSubMode('select')
    const signal = [...store.network.signals.values()][0]
    store.selectSignal(signal.id)
    return { store, signal }
  }

  it('offers to turn it round, to change its type and to remove it, with the length of its block', () => {
    const { store } = withPickedSignal()
    const items = bar(store)
    expect(kinds(items)).toEqual(SIGNAL_SHAPE)
    expect(label(items)).toBe('Signal de block')
    expect(value(items, 'block-length')).toMatchObject({ caption: 'Canton', text: formatDistance(2000, store.unit) })
    expect(action(items, 'role').label).toBe('En signal de trajectoire')
    expect(action(items, 'delete').tone).toBe('danger')
  })

  it('names it the French way at the pro level', () => {
    const { store, signal } = withPickedSignal()
    store.setSignallingSettings({ level: 'pro' })
    expect(label(bar(store))).toBe('Sémaphore')
    expect(action(bar(store), 'role').label).toBe('En carré')
    store.setSignalCabMarker(signal.id, true)
    expect(label(bar(store))).toBe('Repère de LGV (F)')
  })

  it('keeps its shape through every action, one undo step each', () => {
    const { store, signal } = withPickedSignal()
    const steps = undoSteps(store)
    action(bar(store), 'role').run()
    expect(store.network.signals.get(signal.id)!.role).toBe('protection')
    expect(label(bar(store))).toBe('Signal de trajectoire')
    expect(action(bar(store), 'role').label).toBe('En signal de block')
    expect(kinds(bar(store))).toEqual(SIGNAL_SHAPE)

    action(bar(store), 'flip').run()
    expect(store.network.signals.get(signal.id)!.forward).toBe(false)
    expect(kinds(bar(store))).toEqual(SIGNAL_SHAPE)
    expect(undoSteps(store)).toBe(steps + 2)
    expect(showToast).not.toHaveBeenCalled()

    action(bar(store), 'delete').run()
    expect(store.network.signals.has(signal.id)).toBe(false)
    expect(undoSteps(store)).toBe(steps + 3)
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Signalisation' }])
  })

  it('one-way: always there, greyed out on a block signal, a switch on a path signal (one undo step each)', () => {
    const { store, signal } = withPickedSignal()
    // A block signal: the button is there and cannot be used; running it anyway changes nothing
    expect(action(bar(store), 'one-way')).toMatchObject({ label: 'Sens unique', disabled: true, active: false })
    const steps = undoSteps(store)
    action(bar(store), 'one-way').run()
    expect(store.network.signals.get(signal.id)!.oneWay).toBeUndefined()
    expect(undoSteps(store)).toBe(steps)

    action(bar(store), 'role').run()
    expect(action(bar(store), 'one-way')).toMatchObject({ disabled: false, active: false })
    action(bar(store), 'one-way').run()
    expect(store.network.signals.get(signal.id)!.oneWay).toBe(true)
    expect(action(bar(store), 'one-way')).toMatchObject({ disabled: false, active: true })
    expect(kinds(bar(store))).toEqual(SIGNAL_SHAPE)
    expect(undoSteps(store)).toBe(steps + 2)
    action(bar(store), 'one-way').run()
    expect(store.network.signals.get(signal.id)!.oneWay).toBeUndefined()
    expect(undoSteps(store)).toBe(steps + 3)

    // Back to a block signal with the option on: it is kept but shows off, greyed out
    action(bar(store), 'one-way').run()
    action(bar(store), 'role').run()
    expect(store.network.signals.get(signal.id)).toMatchObject({ role: 'spacing', oneWay: true })
    expect(action(bar(store), 'one-way')).toMatchObject({ disabled: true, active: false })
    // The same at the pro level
    store.setSignallingSettings({ level: 'pro' })
    expect(kinds(bar(store))).toEqual(SIGNAL_SHAPE)
    expect(action(bar(store), 'one-way')).toMatchObject({ label: 'Sens unique', disabled: true })
  })

  it('says why a signal cannot be turned round', () => {
    const store = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.setSignalToolBothWays(true)
    click(store, 1000, -3)
    store.setSignalToolSubMode('select')
    store.selectSignal([...store.network.signals.keys()][0])
    action(bar(store), 'flip').run()
    expect(showToast).toHaveBeenCalledWith(SIGNAL_REFUSAL_TEXT.duplicate, 'warning')
  })

  it('names the deletion sub-mode for what it removes', () => {
    const { store } = withPickedSignal()
    store.setSignalToolSubMode('delete')
    expect(bar(store)).toEqual([{ kind: 'label', text: 'Suppression de signaux et de limites' }])
  })
})
