import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { withChord } from '@application/keybindings/keybindings'
import { NOTCH_REPEAT_MS, handleKeyDown, handleKeyUp, handleWindowBlur, newNotchHold, notchKeyMoves } from './useKeyboardShortcuts'

function keyEvent(code: string, key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    code,
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    timeStamp: 0,
    target: null,
    preventDefault: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent
}

/** Store with a locomotive on a straight track */
function storeWithTrain(): EditorStore {
  const store = new EditorStore()
  const a = addNode(store.network, { x: 0, y: 0 })
  const b = addNode(store.network, { x: 1000, y: 0 })
  addSegment(store.network, a.id, b.id)
  store.camera.scale = 3
  store.markDirty()
  store.setTrainPlacementKind('tgv_loco')
  store.placeTrainItem({ x: 100, y: 0 })
  return store
}

function drivingStore(): EditorStore {
  const store = storeWithTrain()
  store.togglePlayMode()
  expect(store.selectedTrain).not.toBeNull()
  return store
}

describe('keyboard shortcuts', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  it('drives with WASD: reverser on W/S, one notch per press on A/D', () => {
    const store = drivingStore()
    const train = store.selectedTrain!

    handleKeyDown(store, keyEvent('KeyW', 'w'))
    expect(train.reverser).toBe('forward')
    handleKeyDown(store, keyEvent('KeyA', 'a'))
    handleKeyDown(store, keyEvent('KeyA', 'a'))
    expect(train.notch).toBe(2)
    // The keyboard's own repeat does not set the pace
    handleKeyDown(store, keyEvent('KeyA', 'a', { repeat: true, timeStamp: 30 }))
    expect(train.notch).toBe(2)
    handleKeyDown(store, keyEvent('KeyD', 'd'))
    expect(train.notch).toBe(1)
  })

  it('keeps the handle between B10 and P10: electric brake notches under N', () => {
    const store = drivingStore()
    const train = store.selectedTrain!

    for (let i = 0; i < 3; i++) handleKeyDown(store, keyEvent('KeyD', 'd'))
    expect(train.notch).toBe(-3)
    handleKeyDown(store, keyEvent('ArrowDown', 'ArrowDown'))
    expect(train.notch).toBe(-4)
    for (let i = 0; i < 9; i++) handleKeyDown(store, keyEvent('KeyD', 'd'))
    expect(train.notch).toBe(-10)

    for (let i = 0; i < 23; i++) handleKeyDown(store, keyEvent('KeyA', 'a'))
    expect(train.notch).toBe(10)
  })

  it('sweeps the handle while a key is held, at its own pace, and waits at N', () => {
    const store = drivingStore()
    const train = store.selectedTrain!
    const hold = (code: string, key: string, from: number, ms: number) => {
      // The keyboard repeats every 30 ms
      for (let t = from + 30; t <= from + ms; t += 30) handleKeyDown(store, keyEvent(code, key, { repeat: true, timeStamp: t }))
    }

    handleKeyDown(store, keyEvent('KeyA', 'a', { timeStamp: 1000 }))
    hold('KeyA', 'a', 1000, 4 * NOTCH_REPEAT_MS)
    expect(train.notch).toBe(5)
    handleKeyUp(store, keyEvent('KeyA', 'a'))

    // Down from P5: it stops at N however long the key is held
    handleKeyDown(store, keyEvent('KeyD', 'd', { timeStamp: 3000 }))
    hold('KeyD', 'd', 3000, 3000)
    expect(train.notch).toBe(0)
    handleKeyUp(store, keyEvent('KeyD', 'd'))

    // Pressed again, it goes on under N as far as B10
    handleKeyDown(store, keyEvent('KeyD', 'd', { timeStamp: 7000 }))
    hold('KeyD', 'd', 7000, 3000)
    expect(train.notch).toBe(-10)
  })

  it('paces a held handle key', () => {
    const hold = newNotchHold()
    expect(notchKeyMoves(hold, false, 2, 1, 0)).toBe(true)
    expect(notchKeyMoves(hold, true, 3, 1, NOTCH_REPEAT_MS - 1)).toBe(false)
    expect(notchKeyMoves(hold, true, 3, 1, NOTCH_REPEAT_MS)).toBe(true)
    // Reaching N parks it, a new press frees it
    expect(notchKeyMoves(hold, true, 1, -1, 2 * NOTCH_REPEAT_MS)).toBe(true)
    expect(notchKeyMoves(hold, true, 0, -1, 9 * NOTCH_REPEAT_MS)).toBe(false)
    expect(notchKeyMoves(hold, false, 0, -1, 9 * NOTCH_REPEAT_MS)).toBe(true)
    expect(hold.parked).toBe(false)
  })

  it('applies the brake while E is held and releases it while Q is held', () => {
    const store = drivingStore()
    const train = store.selectedTrain!
    expect(train.brakeCommand).toBe('hold')

    handleKeyDown(store, keyEvent('KeyE', 'e'))
    expect(train.brakeCommand).toBe('apply')
    // Auto-repeat of the held key keeps the handle where it is
    handleKeyDown(store, keyEvent('KeyE', 'e', { repeat: true }))
    expect(train.brakeCommand).toBe('apply')
    handleKeyUp(store, keyEvent('KeyE', 'e'))
    expect(train.brakeCommand).toBe('hold')

    // By key position: Q on QWERTY is the key that prints A on AZERTY
    handleKeyDown(store, keyEvent('KeyQ', 'a'))
    expect(train.brakeCommand).toBe('release')
    expect(train.notch).toBe(0)
    handleKeyUp(store, keyEvent('KeyQ', 'a'))
    expect(train.brakeCommand).toBe('hold')
  })

  it('the brake key pressed last wins, and releasing the other one changes nothing', () => {
    const store = drivingStore()
    const train = store.selectedTrain!

    handleKeyDown(store, keyEvent('KeyQ', 'q'))
    handleKeyDown(store, keyEvent('KeyE', 'e'))
    expect(train.brakeCommand).toBe('apply')
    handleKeyUp(store, keyEvent('KeyQ', 'q'))
    expect(train.brakeCommand).toBe('apply')
    handleKeyUp(store, keyEvent('KeyE', 'e'))
    expect(train.brakeCommand).toBe('hold')
  })

  it('lets go of the brake handle when the window loses the focus', () => {
    const store = drivingStore()
    const train = store.selectedTrain!

    handleKeyDown(store, keyEvent('KeyQ', 'q'))
    expect(train.brakeCommand).toBe('release')
    // The key release will never be seen
    handleWindowBlur(store)
    expect(train.brakeCommand).toBe('hold')
  })

  it('brake keys do nothing outside play mode or with Ctrl held', () => {
    const store = drivingStore()
    const train = store.selectedTrain!

    handleKeyDown(store, keyEvent('KeyE', 'e', { ctrlKey: true }))
    expect(train.brakeCommand).toBe('hold')

    store.togglePlayMode()
    handleKeyDown(store, keyEvent('KeyE', 'e'))
    expect(store.trains[0].brakeCommand).toBe('hold')
  })

  it('keeps the arrows working as secondary keys', () => {
    const store = drivingStore()
    const train = store.selectedTrain!

    handleKeyDown(store, keyEvent('ArrowUp', 'ArrowUp', { shiftKey: true }))
    expect(train.reverser).toBe('forward')
    handleKeyDown(store, keyEvent('ArrowUp', 'ArrowUp'))
    expect(train.notch).toBe(1)
  })

  it('toggles the debug skeleton on F3 and no longer on D', () => {
    const store = drivingStore()

    handleKeyDown(store, keyEvent('KeyD', 'd'))
    expect(store.showTrainDebug).toBe(false)
    handleKeyDown(store, keyEvent('F3', 'F3'))
    expect(store.showTrainDebug).toBe(true)

    store.togglePlayMode()
    handleKeyDown(store, keyEvent('F3', 'F3'))
    expect(store.showTrainDebug).toBe(false)
  })

  it('leaves play mode on Space and Escape, and enters it on F5', () => {
    const store = drivingStore()
    handleKeyDown(store, keyEvent('Space', ' '))
    expect(store.isPlayMode).toBe(false)
    handleKeyDown(store, keyEvent('F5', 'F5'))
    expect(store.isPlayMode).toBe(true)
    handleKeyDown(store, keyEvent('Escape', 'Escape'))
    expect(store.isPlayMode).toBe(false)
  })

  it('ignores driving keys pressed with Ctrl and editing keys while driving', () => {
    const store = drivingStore()
    const tool = store.tool

    handleKeyDown(store, keyEvent('KeyA', 'a', { ctrlKey: true }))
    expect(store.selectedTrain!.notch).toBe(0)
    handleKeyDown(store, keyEvent('KeyN', 'n'))
    expect(store.tool).toBe(tool)
  })

  it('selects tools by letter in edit mode', () => {
    const store = new EditorStore()
    handleKeyDown(store, keyEvent('KeyN', 'n'))
    expect(store.tool).toBe('place')
    handleKeyDown(store, keyEvent('KeyV', 'V', { shiftKey: true }))
    expect(store.tool).toBe('select')
    // With Ctrl held the plain shortcut stays off
    handleKeyDown(store, keyEvent('KeyN', 'n', { altKey: true }))
    expect(store.tool).toBe('select')
  })

  it('a rebound key triggers its action and the old key no longer does', () => {
    const store = drivingStore()
    const train = store.selectedTrain!
    // KeyT is free while driving (KeyE now applies the brake)
    store.setKeybindings(withChord(store.keybindings, 'drive.reverserForward', 0, { code: 'KeyT' }))

    handleKeyDown(store, keyEvent('KeyW', 'w'))
    expect(train.reverser).toBe('neutral')
    handleKeyDown(store, keyEvent('KeyT', 't'))
    expect(train.reverser).toBe('forward')
  })

  it('a rebound brake key is held and let go like the default one', () => {
    const store = drivingStore()
    const train = store.selectedTrain!
    store.setKeybindings(withChord(store.keybindings, 'drive.brakeApply', 0, { code: 'KeyB' }))

    handleKeyDown(store, keyEvent('KeyE', 'e'))
    expect(train.brakeCommand).toBe('hold')
    handleKeyDown(store, keyEvent('KeyB', 'b'))
    expect(train.brakeCommand).toBe('apply')
    handleKeyUp(store, keyEvent('KeyB', 'b'))
    expect(train.brakeCommand).toBe('hold')
  })

  it('keeps rebound keys and learned key labels across a reload', () => {
    const store = new EditorStore()
    store.setKeybindings(withChord(store.keybindings, 'tool.select', 0, { key: 'b' }))
    store.setKeyLabels({ KeyW: 'z' })

    const reloaded = new EditorStore()
    expect(reloaded.keybindings['tool.select']).toEqual([{ key: 'b' }, null])
    expect(reloaded.shortcutLabel('tool.select')).toBe('B')
    expect(reloaded.shortcutLabel('drive.reverserForward')).toBe('Z')
    expect(reloaded.shortcutHint('drive.reverserForward')).toBe(' (Z)')

    reloaded.resetKeybindings()
    expect(new EditorStore().shortcutLabel('tool.select')).toBe('V')
  })

  it('S opens the signalling mode on the speed limit tool, and never while driving', () => {
    const store = storeWithTrain()
    store.setTool('select')
    handleKeyDown(store, keyEvent('KeyS', 's'))
    expect(store.tool).toBe('signal')
    expect(store.isSpeedZoneTool).toBe(true)
    expect(store.shortcutLabel('tool.speedZone')).toBe('S')

    // Driving: S is the reverser, the tool stays out of reach
    const driving = drivingStore()
    handleKeyDown(driving, keyEvent('KeyS', 's'))
    expect(driving.tool).not.toBe('signal')
  })

  it('in the signalling mode, Delete removes the picked zone and Escape climbs back one level at a time', () => {
    const store = storeWithTrain()
    handleKeyDown(store, keyEvent('KeyS', 's'))
    store.clickSpeedZoneTool(store.trackPointAt({ x: 300, y: 0 }))
    store.clickSpeedZoneTool(store.trackPointAt({ x: 700, y: 0 }))
    expect(store.network.speedZones.size).toBe(1)

    store.clickSpeedZoneTool(store.trackPointAt({ x: 800, y: 0 }))
    vi.stubGlobal('document', { querySelector: () => null })
    try {
      handleKeyDown(store, keyEvent('Escape', 'Escape'))
      expect(store.speedZoneStart).toBeNull()
      expect(store.isSpeedZoneTool).toBe(true)
      handleKeyDown(store, keyEvent('Escape', 'Escape'))
      expect(store.tool).toBe('signal')
      expect(store.signalToolSubMode).toBe('select')

      handleKeyDown(store, keyEvent('Delete', 'Delete'))
      expect(store.network.speedZones.size).toBe(0)
      expect(store.network.segments.size).toBe(1)

      handleKeyDown(store, keyEvent('Escape', 'Escape'))
      expect(store.tool).toBe('select')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
