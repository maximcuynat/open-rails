import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { defaultKeybindings, findAction, findConflict } from '@application/keybindings/keybindings'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { handleKeyDown } from './useKeyboardShortcuts'

vi.mock('../components/common/Toast', () => ({ showToast: vi.fn() }))

function keyEvent(code: string, key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    code,
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: null,
    preventDefault: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent
}

function storeWithTrack(): EditorStore {
  const store = new EditorStore()
  const a = addNode(store.network, { x: 0, y: 0 })
  const b = addNode(store.network, { x: 5000, y: 0 })
  addSegment(store.network, a.id, b.id)
  store.camera.scale = 3
  store.markDirty()
  return store
}

const signals = (store: EditorStore) => [...store.network.signals.values()]

function click(store: EditorStore, x: number, y: number): void {
  store.beginSignalGesture({ x, y })
  store.commitSignalGesture()
}

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

describe('keyboard shortcuts: signals', () => {
  it('B and J take the two signal tools, without stealing a key from another action', () => {
    const bindings = defaultKeybindings()
    expect(bindings['tool.signalBlock']).toEqual([{ key: 'b' }, null])
    expect(bindings['tool.signalPath']).toEqual([{ key: 'j' }, null])
    for (const [code, key, action] of [['KeyB', 'b', 'tool.signalBlock'], ['KeyJ', 'j', 'tool.signalPath']] as const) {
      const press = { code, key, shiftKey: false }
      expect(findAction(bindings, 'edit', press)).toBe(action)
      expect(findConflict(bindings, action, press)).toBeNull()
    }

    const store = storeWithTrack()
    handleKeyDown(store, keyEvent('KeyB', 'b'))
    expect(store.tool).toBe('signal')
    expect(store.signalPlacementMode).toBe('blockSignal')
    handleKeyDown(store, keyEvent('KeyJ', 'j'))
    expect(store.signalPlacementMode).toBe('pathSignal')
    // Never with Ctrl held
    handleKeyDown(store, keyEvent('KeyB', 'b', { ctrlKey: true }))
    expect(store.signalPlacementMode).toBe('pathSignal')
  })

  it('R and Tab turn the signal about to be laid round, and nothing else', () => {
    const store = storeWithTrack()
    handleKeyDown(store, keyEvent('KeyB', 'b'))
    const reconcile = vi.spyOn(store, 'reconcileTopology')
    const r = keyEvent('KeyR', 'r')
    handleKeyDown(store, r)
    expect(store.signalToolFlipped).toBe(true)
    expect(r.preventDefault).toHaveBeenCalled()
    const tab = keyEvent('Tab', 'Tab')
    handleKeyDown(store, tab)
    expect(store.signalToolFlipped).toBe(false)
    expect(tab.preventDefault).toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    handleKeyDown(store, r)
    click(store, 1000, -3)
    // North of an eastward track would be eastbound; flipped, it is westbound
    expect(signals(store)[0].forward).toBe(false)
  })

  it('R turns the picked signal round, Delete removes it, Escape climbs back one level at a time', () => {
    const store = storeWithTrack()
    handleKeyDown(store, keyEvent('KeyB', 'b'))
    click(store, 1000, -3)
    vi.stubGlobal('document', { querySelector: () => null })
    try {
      handleKeyDown(store, keyEvent('Escape', 'Escape'))
      expect(store.tool).toBe('signal')
      expect(store.signalToolSubMode).toBe('select')

      const [signal] = signals(store)
      store.selectSignal(signal.id)
      const reconcile = vi.spyOn(store, 'reconcileTopology')
      handleKeyDown(store, keyEvent('KeyR', 'r'))
      expect(store.network.signals.get(signal.id)!.forward).toBe(false)
      expect(reconcile).not.toHaveBeenCalled()

      handleKeyDown(store, keyEvent('Escape', 'Escape'))
      expect(store.selectedSignal).toBeNull()
      expect(store.tool).toBe('signal')

      store.selectSignal(signal.id)
      handleKeyDown(store, keyEvent('Delete', 'Delete'))
      expect(signals(store)).toHaveLength(0)
      expect(store.network.segments.size).toBe(1)

      handleKeyDown(store, keyEvent('Escape', 'Escape'))
      expect(store.tool).toBe('select')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('leaves R to the topology check when no signal is concerned', () => {
    const store = storeWithTrack()
    store.setTool('signal')
    const reconcile = vi.spyOn(store, 'reconcileTopology')
    handleKeyDown(store, keyEvent('KeyR', 'r'))
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('the signal keys do nothing while driving', () => {
    const store = storeWithTrack()
    store.setTool('locomotive')
    store.setTrainPlacementKind('tgv_loco')
    store.placeTrainItem({ x: 300, y: 0 })
    store.togglePlayMode()
    handleKeyDown(store, keyEvent('KeyB', 'b'))
    handleKeyDown(store, keyEvent('KeyJ', 'j'))
    expect(store.tool).not.toBe('signal')
    expect(store.signalPlacementMode).toBeNull()
  })
})
