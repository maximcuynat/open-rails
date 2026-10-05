import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SIGNAL_ROW_SPACING, EditorStore, signalSubModesFor } from './editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { signalBlock } from '@domain/models/signalBlocks'
import type { Signal } from '@domain/models/types'
import { signalHeading, signalWorldPosition } from '@domain/services/signalLayout'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { signalHeadWorld } from '@infrastructure/render/signalRender'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

/**
 * A store with a committed straight track along y = 0 from x = 0 to x = 5000 (laid west to east, so
 * `forward` is eastwards), and a short branch leaving it at x = 5000.
 */
function storeWithTrack() {
  const store = new EditorStore()
  const net = store.network
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 5000, y: 0 })
  const main = addSegment(net, a.id, b.id)!
  const c = addNode(net, { x: 6000, y: 0 })
  addSegment(net, b.id, c.id)
  const d = addNode(net, { x: 6000, y: 200 })
  addSegment(net, b.id, d.id)
  store.camera.scale = 3
  store.markDirty()
  return { store, main }
}

/** Number of steps the undo history holds */
const undoSteps = (store: EditorStore) => (store as unknown as { history: unknown[] }).history.length
const signals = (store: EditorStore): Signal[] => [...store.network.signals.values()]
const xOf = (store: EditorStore, signal: Signal) => signalWorldPosition(store.network, signal)!.x

/** Press and release the button of the signal tool in hand at a world position */
function click(store: EditorStore, x: number, y: number) {
  expect(store.beginSignalGesture({ x, y })).toBe(true)
  return store.commitSignalGesture()
}

/** A store in driving mode, with one signal laid beforehand */
function drivingStore() {
  const { store, main } = storeWithTrack()
  store.setSignalToolSubMode('blockSignal')
  click(store, 1000, -2)
  const signal = signals(store)[0]
  store.setTool('locomotive')
  store.setTrainPlacementKind('tgv_loco')
  store.placeTrainItem({ x: 300, y: 0 })
  store.togglePlayMode()
  expect(store.isPlayMode).toBe(true)
  return { store, main, signal }
}

describe('signal tools: what is in hand', () => {
  it('offers the marker board at the pro level only, and keeps the order of the toolbar', () => {
    expect(signalSubModesFor('standard')).toEqual(['select', 'blockSignal', 'pathSignal', 'speedZone', 'delete'])
    expect(signalSubModesFor('pro')).toEqual(['select', 'blockSignal', 'pathSignal', 'cabMarker', 'speedZone', 'delete'])
  })

  it('gives the role and options of the signal each tool lays', () => {
    const { store } = storeWithTrack()
    expect(store.signalToolSpec).toBeNull()
    store.setSignalToolSubMode('blockSignal')
    expect(store.signalToolSpec).toEqual({ role: 'spacing', cabMarker: false })
    store.setSignalToolSubMode('pathSignal')
    expect(store.signalToolSpec).toEqual({ role: 'protection', cabMarker: false })
    // The marker board is not a tool of the standard level
    store.setSignalToolSubMode('cabMarker')
    expect(store.signalPlacementMode).toBeNull()
    store.setSignallingSettings({ level: 'pro' })
    expect(store.signalToolSpec).toEqual({ role: 'spacing', cabMarker: true })
    store.setSignalToolCabRole('protection')
    expect(store.signalToolSpec).toEqual({ role: 'protection', cabMarker: true })
  })

  it('shows the blocks while a signal tool is in hand, and otherwise when the display is ticked', () => {
    const { store } = storeWithTrack()
    expect(store.signalBlocksVisible).toBe(false)
    store.setSignalToolSubMode('pathSignal')
    expect(store.signalBlocksVisible).toBe(true)
    store.setSignalToolSubMode('speedZone')
    expect(store.signalBlocksVisible).toBe(false)
    store.toggleSignalBlocks()
    expect(store.signalBlocksVisible).toBe(true)
    // Reservations only show while driving
    store.toggleSignalReservations()
    expect(store.showSignalReservations).toBe(true)
    expect(store.signalReservationsVisible).toBe(false)
  })
})

describe('signal tools: aim', () => {
  it('takes the direction of travel that has the cursor on its left', () => {
    const { store, main } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    // North of an eastward track (y grows downwards): the left of trains running east
    const north = store.signalAimAt({ x: 1000, y: -3 })!
    expect(north.place.segId).toBe(main.id)
    expect(north.place.t).toBeCloseTo(0.2)
    expect(north.forward).toBe(true)
    expect(north.refusal).toBeNull()
    // South: the left of trains running west
    expect(store.signalAimAt({ x: 1000, y: 3 })!.forward).toBe(false)
    expect(store.signalAimAt({ x: 1000, y: 400 })).toBeNull()
  })

  it('the flip key takes the other direction, until the tool is put down', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.flipSignalTool()
    expect(store.signalAimAt({ x: 1000, y: -3 })!.forward).toBe(false)
    store.setSignalToolSubMode('pathSignal')
    expect(store.signalToolFlipped).toBe(false)
    expect(store.signalAimAt({ x: 1000, y: -3 })!.forward).toBe(true)
  })

  it('says why a signal cannot stand on points', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    expect(store.signalAimAt({ x: 4999.5, y: -3 })!.refusal).toBe('on-switch')
  })
})

describe('signal tools: laying', () => {
  it('a click lays one signal, on the side of the cursor, in one undo step', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    const steps = undoSteps(store)
    const result = click(store, 1000, -3)
    expect(result).toMatchObject({ ok: true, refused: 0 })
    expect(undoSteps(store)).toBe(steps + 1)
    const [signal] = signals(store)
    expect(signal).toMatchObject({ role: 'spacing', forward: true })
    expect(xOf(store, signal)).toBeCloseTo(1000)
    // Drawn on the left of its direction of travel: the side the cursor was on
    expect(signalHeadWorld(store.network, signal, store.camera.scale, store.gauge)!.y).toBeLessThan(0)
    // The tool stays in hand, nothing is picked
    expect(store.signalPlacementMode).toBe('blockSignal')
    expect(store.selectedSignal).toBeNull()

    click(store, 2000, 3)
    const second = signals(store)[1]
    expect(second.forward).toBe(false)
    expect(signalHeadWorld(store.network, second, store.camera.scale, store.gauge)!.y).toBeGreaterThan(0)
    expect(undoSteps(store)).toBe(steps + 2)
  })

  it('the path signal tool lays a protection signal, the marker board tool a marker board', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('pathSignal')
    click(store, 1000, -3)
    expect(signals(store)[0]).toMatchObject({ role: 'protection' })
    expect(signals(store)[0].cabMarker).toBeUndefined()
    store.setSignallingSettings({ level: 'pro' })
    store.setSignalToolSubMode('cabMarker')
    store.setSignalToolCabRole('protection')
    click(store, 2000, -3)
    expect(signals(store)[1]).toMatchObject({ role: 'protection', cabMarker: true })
    // The same stored signals read at the other level without any conversion
    const before = JSON.stringify(signals(store))
    store.setSignallingSettings({ level: 'standard' })
    store.setSignallingSettings({ level: 'pro' })
    expect(JSON.stringify(signals(store))).toBe(before)
  })

  it('« double sens » lays two signals back to back in one undo step, one on each side of the track', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.setSignalToolBothWays(true)
    const steps = undoSteps(store)
    const result = click(store, 1500, 3)
    expect(result?.ok && result.signals.map((s) => s.forward)).toEqual([false, true])
    expect(signals(store)).toHaveLength(2)
    expect(undoSteps(store)).toBe(steps + 1)
    const [a, b] = signals(store)
    expect(a.t).toBe(b.t)
    expect(a.forward).not.toBe(b.forward)
    const headings = signals(store).map((s) => signalHeading(store.network, s)!.x)
    expect(headings[0]).toBeCloseTo(-headings[1])
    const sides = signals(store).map((s) => Math.sign(signalHeadWorld(store.network, s, store.camera.scale, store.gauge)!.y))
    expect(sides[0]).toBe(-sides[1])
    store.undo()
    expect(signals(store)).toHaveLength(0)
  })

  it('refuses a click on points and records nothing', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    const steps = undoSteps(store)
    expect(click(store, 4999.5, -3)).toEqual({ ok: false, reason: 'on-switch' })
    expect(signals(store)).toHaveLength(0)
    expect(undoSteps(store)).toBe(steps)
    // Off the track nothing even begins: the canvas drags the view instead
    expect(store.beginSignalGesture({ x: 1000, y: 500 })).toBe(false)
    expect(store.commitSignalGesture()).toBeNull()
  })

  it('a drag along the track lays a row at the chosen spacing, in one undo step', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    expect(store.signalToolSpacing).toBe(DEFAULT_SIGNAL_ROW_SPACING)
    store.setSignalToolSpacing(1000)
    const steps = undoSteps(store)
    store.beginSignalGesture({ x: 500, y: 3 })
    // A pointer that has barely moved is still a click
    store.updateSignalGesture({ x: 501, y: 3 })
    expect(store.signalRowEnd).toBeNull()
    expect(store.signalRowPreview).toHaveLength(0)
    store.updateSignalGesture({ x: 3600, y: 3 })
    expect(store.signalRowPreview.map((p) => Math.round(p.place.t * 5000))).toEqual([500, 1500, 2500, 3500])
    const result = store.commitSignalGesture()
    expect(result).toMatchObject({ ok: true, refused: 0 })
    expect(signals(store).map((s) => Math.round(xOf(store, s)))).toEqual([500, 1500, 2500, 3500])
    // A row speaks to trains running the way it was drawn, whatever the side of the cursor
    expect(signals(store).every((s) => s.forward && s.role === 'spacing')).toBe(true)
    expect(undoSteps(store)).toBe(steps + 1)
    expect(store.signalRowStart).toBeNull()
    store.undo()
    expect(signals(store)).toHaveLength(0)
    store.redo()
    expect(signals(store)).toHaveLength(4)
  })

  it('a row drawn westwards speaks to westbound trains, and « double sens » doubles it', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.setSignalToolSpacing(1000)
    store.setSignalToolBothWays(true)
    store.beginSignalGesture({ x: 3000, y: -3 })
    store.updateSignalGesture({ x: 900, y: -3 })
    expect(store.signalRowPreview.every((p) => !p.forward)).toBe(true)
    store.commitSignalGesture()
    expect(signals(store)).toHaveLength(6)
    expect(signals(store).filter((s) => s.forward)).toHaveLength(3)
  })

  it('snaps the spacing to the list', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSpacing(1234)
    expect(store.signalToolSpacing).toBe(1000)
    store.setSignalToolSpacing(Number.NaN)
    expect(store.signalToolSpacing).toBe(1000)
    // On a model scale the row follows the gauge
    store.gauge = 1.435 / 100
    expect(store.signalRowSpacing).toBeCloseTo(10)
  })
})

describe('signals: selection and edition', () => {
  function withSignal() {
    const { store, main } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    click(store, 1000, -3)
    click(store, 3000, -3)
    store.setSignalToolSubMode('select')
    const [signal, next] = signals(store)
    return { store, main, signal, next }
  }

  it('picks the signal under the cursor, by its head or by its place on the track', () => {
    const { store, signal } = withSignal()
    const head = signalHeadWorld(store.network, signal, store.camera.scale, store.gauge)!
    expect(store.signalAt(head)?.id).toBe(signal.id)
    expect(store.signalAt({ x: 1000, y: 0 })?.id).toBe(signal.id)
    expect(store.signalAt({ x: 2000, y: 0 })).toBeNull()
    expect(store.updateSignalHover(head)).toBe(true)
    expect(store.hoveredSignalId).toBe(signal.id)
    expect(store.selectSignal(signal.id)).toBe(true)
    expect(store.selectedSignal?.id).toBe(signal.id)
  })

  it('tells two signals back to back apart by the side of the track', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.setSignalToolBothWays(true)
    click(store, 1500, -3)
    const east = signals(store).find((s) => s.forward)!
    const west = signals(store).find((s) => !s.forward)!
    expect(store.signalAt(signalHeadWorld(store.network, east, 3, store.gauge)!)?.id).toBe(east.id)
    expect(store.signalAt(signalHeadWorld(store.network, west, 3, store.gauge)!)?.id).toBe(west.id)
  })

  it('holds one thing at a time: a signal or a speed zone', () => {
    const { store, signal } = withSignal()
    store.setSignalToolSubMode('speedZone')
    store.clickSpeedZoneTool(store.trackPointAt({ x: 1500, y: 0 }))
    store.clickSpeedZoneTool(store.trackPointAt({ x: 2500, y: 0 }))
    store.setSignalToolSubMode('select')
    const zone = store.selectedSpeedZone!
    store.selectSignal(signal.id)
    expect(store.selectedSpeedZone).toBeNull()
    store.selectSpeedZone(zone.id)
    expect(store.selectedSignal).toBeNull()
  })

  it('signals are only picked in the signalling mode', () => {
    const { store, signal } = withSignal()
    store.selectSignal(signal.id)
    store.setTool('select')
    expect(store.selectedSignal).toBeNull()
    expect(store.selectSignal(signal.id)).toBe(false)
    expect(store.updateSignalHover({ x: 1000, y: 0 })).toBe(false)
    store.setTool('signal')
    expect(store.selectedSignal).toBeNull()
  })

  it('turns a signal round in one undo step', () => {
    const { store, signal } = withSignal()
    const steps = undoSteps(store)
    expect(store.flipSignalDirection(signal.id)).toBeNull()
    expect(store.network.signals.get(signal.id)!.forward).toBe(false)
    expect(undoSteps(store)).toBe(steps + 1)
    store.undo()
    expect(store.network.signals.get(signal.id)!.forward).toBe(true)
  })

  it('refuses to turn a signal onto its back-to-back twin', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.setSignalToolBothWays(true)
    click(store, 1500, -3)
    const steps = undoSteps(store)
    expect(store.flipSignalDirection(signals(store)[0].id)).toBe('duplicate')
    expect(undoSteps(store)).toBe(steps)
  })

  it('changes the type and the marker option, one undo step each, none for no change', () => {
    const { store, signal } = withSignal()
    const steps = undoSteps(store)
    expect(store.changeSignalRole(signal.id, 'spacing')).toBe(false)
    expect(store.changeSignalRole(signal.id, 'protection')).toBe(true)
    expect(store.network.signals.get(signal.id)!.role).toBe('protection')
    expect(store.setSignalCabMarker(signal.id, true)).toBe(true)
    expect(store.setSignalCabMarker(signal.id, true)).toBe(false)
    expect(store.network.signals.get(signal.id)!.cabMarker).toBe(true)
    expect(undoSteps(store)).toBe(steps + 2)
    store.undo()
    store.undo()
    expect(store.network.signals.get(signal.id)).toMatchObject({ role: 'spacing' })
    expect(store.network.signals.get(signal.id)!.cabMarker).toBeUndefined()
  })

  it('removes the picked signal with Delete, and never a rail', () => {
    const { store, signal } = withSignal()
    const rails = store.network.segments.size
    store.selectSignal(signal.id)
    const steps = undoSteps(store)
    store.deleteSelection()
    expect(store.network.signals.has(signal.id)).toBe(false)
    expect(store.selectedSignalId).toBeNull()
    expect(store.network.segments.size).toBe(rails)
    expect(undoSteps(store)).toBe(steps + 1)
    store.undo()
    expect(store.network.signals.has(signal.id)).toBe(true)
    // Nothing picked: Delete does nothing
    store.deleteSelection()
    expect(signals(store)).toHaveLength(2)
  })

  it('slides a signal along the track: one undo step for the whole drag, the block follows', () => {
    const { store, signal } = withSignal()
    const steps = undoSteps(store)
    expect(store.beginSignalDrag(signal.id)).toBe(true)
    expect(store.signalBlocksVisible).toBe(true)
    store.dragSignalTo({ x: 1200, y: 5 })
    store.dragSignalTo({ x: 2000, y: -5 })
    expect(undoSteps(store)).toBe(steps)
    expect(xOf(store, signal)).toBeCloseTo(2000)
    // It keeps the direction of travel it speaks to, whatever the side of the pointer
    expect(store.network.signals.get(signal.id)!.forward).toBe(true)
    expect(signalBlock(store.network, signal.id)!.minLength).toBeCloseTo(1000)
    expect(store.endSignalDrag()).toBe(true)
    expect(undoSteps(store)).toBe(steps + 1)
    store.undo()
    expect(xOf(store, store.network.signals.get(signal.id)!)).toBeCloseTo(1000)
  })

  it('a press and release without a move is no undo step', () => {
    const { store, signal } = withSignal()
    const steps = undoSteps(store)
    store.beginSignalDrag(signal.id)
    expect(store.endSignalDrag()).toBe(false)
    expect(undoSteps(store)).toBe(steps)
  })

  it('a dragged signal stays where it last could stand', () => {
    const { store, signal, next } = withSignal()
    store.beginSignalDrag(signal.id)
    store.dragSignalTo({ x: 2500, y: 0 })
    // Onto the next signal of the same direction, then onto the points: refused
    store.dragSignalTo({ x: xOf(store, next), y: 0 })
    store.dragSignalTo({ x: 4999.5, y: 0 })
    expect(xOf(store, signal)).toBeCloseTo(2500)
    store.endSignalDrag()
  })
})

describe('signals and driving', () => {
  it('refuses every tool and edition while driving', () => {
    const { store, signal } = drivingStore()
    const steps = undoSteps(store)
    const before = JSON.stringify(signals(store))
    store.setSignalToolSubMode('blockSignal')
    expect(store.signalPlacementMode).toBeNull()
    expect(store.beginSignalGesture({ x: 2000, y: -3 })).toBe(false)
    expect(store.placeSignal({ segId: signal.segId, t: 0.5 }, true)).toEqual({ ok: false, reason: 'driving' })
    expect(store.placeSignalRow({ segId: signal.segId, t: 0.1 }, { segId: signal.segId, t: 0.9 })).toEqual({ ok: false, reason: 'driving' })
    expect(store.flipSignalDirection(signal.id)).toBe('driving')
    expect(store.changeSignalRole(signal.id, 'protection')).toBe(false)
    expect(store.setSignalCabMarker(signal.id, true)).toBe(false)
    expect(store.deleteSignal(signal.id)).toBe(false)
    expect(store.beginSignalDrag(signal.id)).toBe(false)
    expect(store.selectSignal(signal.id)).toBe(false)
    expect(JSON.stringify(signals(store))).toBe(before)
    expect(undoSteps(store)).toBe(steps)
  })

  it('shows the reservations while driving once the display is ticked', () => {
    const { store } = drivingStore()
    expect(store.signalReservationsVisible).toBe(false)
    store.toggleSignalReservations()
    expect(store.signalReservationsVisible).toBe(true)
  })
})

describe('Escape with signals', () => {
  it('drops the row being drawn, then the tool, then the mode', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.beginSignalGesture({ x: 500, y: 3 })
    store.updateSignalGesture({ x: 3600, y: 3 })
    const steps = undoSteps(store)

    store.cancelInteraction()
    expect(store.signalRowStart).toBeNull()
    expect(store.signalRowEnd).toBeNull()
    expect(store.signalPlacementMode).toBe('blockSignal')
    expect(signals(store)).toHaveLength(0)

    store.cancelInteraction()
    expect(store.tool).toBe('signal')
    expect(store.signalToolSubMode).toBe('select')

    store.cancelInteraction()
    expect(store.tool).toBe('select')
    expect(undoSteps(store)).toBe(steps)
  })

  it('puts a dragged signal back, then releases it, then leaves the mode', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    click(store, 1000, -3)
    store.setSignalToolSubMode('select')
    const [signal] = signals(store)
    store.selectSignal(signal.id)
    const steps = undoSteps(store)
    store.beginSignalDrag(signal.id)
    store.dragSignalTo({ x: 2400, y: 0 })

    store.cancelInteraction()
    expect(store.signalDrag).toBeNull()
    expect(xOf(store, signal)).toBeCloseTo(1000)
    expect(store.selectedSignal?.id).toBe(signal.id)
    expect(undoSteps(store)).toBe(steps)

    store.cancelInteraction()
    expect(store.tool).toBe('signal')
    expect(store.selectedSignal).toBeNull()

    store.cancelInteraction()
    expect(store.tool).toBe('select')
    expect(signals(store)).toHaveLength(1)
  })

  it('a tool taken in hand releases the picked signal', () => {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    click(store, 1000, -3)
    store.setSignalToolSubMode('select')
    store.selectSignal(signals(store)[0].id)
    store.setSignalToolSubMode('pathSignal')
    expect(store.selectedSignal).toBeNull()
  })
})
