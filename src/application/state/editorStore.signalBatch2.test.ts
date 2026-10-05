import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, resetIdCounter, setNodesLevel } from '@domain/models/network'
import { syncJunctions } from '@domain/models/junction'
import { SIGNAL_SWITCH_CLEARANCE, setSignalOptions } from '@domain/models/signals'
import { signalReport } from '@domain/models/signalReport'
import type { Signal } from '@domain/models/types'
import { chain, drive, signalAt, trainAt } from '@domain/models/signalling.testkit'
import { signalWorldPosition } from '@domain/services/signalLayout'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { signalHeadWorld } from '@infrastructure/render/signalRender'
import { buildConsoleState } from '@application/console/consoleState'
import { decodeMessage, encodeMessage } from '@application/remote/protocol'
import type { CabOverspeed } from '@domain/models/trainSignalling'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

/** A store with a committed track along y = 0: two rails joined at x = 1000, from x = 0 to x = 5000 */
function storeWithTrack() {
  const store = new EditorStore()
  const { nodes, rails } = chain(store.network, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 5000, y: 0 }])
  store.camera.scale = 3
  store.markDirty()
  return { store, nodes, rails }
}

const undoSteps = (store: EditorStore) => (store as unknown as { history: unknown[] }).history.length
const xOf = (store: EditorStore, signal: Signal) => signalWorldPosition(store.network, signal)!.x
const overTheWire = (state: unknown) => {
  const decoded = decodeMessage(encodeMessage({ t: 'state', state: state as never, ack: 1 }))
  if (!decoded.ok || decoded.message.t !== 'state') throw new Error('state refused by the protocol')
  return decoded.message.state
}

describe('one-way option of a path signal', () => {
  it('is set and cleared on a path signal only, one undo step each, never while driving', () => {
    const { store } = storeWithTrack()
    const block = signalAt(store.network, 2000, 0, 'east')
    const path = signalAt(store.network, 3000, 0, 'east', 'protection')
    store.markDirty()
    const steps = undoSteps(store)
    expect(store.setSignalOneWay(block.id, true)).toBe(false)
    expect(store.setSignalOneWay('nobody', true)).toBe(false)
    expect(store.setSignalOneWay(path.id, false)).toBe(false)
    expect(undoSteps(store)).toBe(steps)

    expect(store.setSignalOneWay(path.id, true)).toBe(true)
    expect(store.network.signals.get(path.id)!.oneWay).toBe(true)
    expect(store.setSignalOneWay(path.id, true)).toBe(false)
    expect(undoSteps(store)).toBe(steps + 1)
    store.undo()
    expect(store.network.signals.get(path.id)!.oneWay).toBeUndefined()
    store.redo()
    expect(store.network.signals.get(path.id)!.oneWay).toBe(true)
    // Saved with the project and read back
    const reloaded = new EditorStore()
    reloaded.loadFromData(store.exportProject())
    expect(reloaded.network.signals.get(path.id)).toMatchObject({ role: 'protection', oneWay: true })

    store.trains = [trainAt(store.network, 300, 0, 'east')]
    store.selectTrainById(store.trains[0].id)
    store.togglePlayMode()
    expect(store.isPlayMode).toBe(true)
    expect(store.setSignalOneWay(path.id, false)).toBe(false)
    expect(store.network.signals.get(path.id)!.oneWay).toBe(true)
  })

  it('the driver of a train that meets it from behind sees a closed signal he may not pass', () => {
    const { store } = storeWithTrack()
    const wall = signalAt(store.network, 3000, 0, 'west', 'protection')
    setSignalOptions(store.network, wall.id, { oneWay: true })
    store.trains = [trainAt(store.network, 2900, 0, 'east')]
    store.markDirty()
    const train = store.trains[0]
    store.selectTrainById(train.id)
    store.togglePlayMode()
    drive(train, 5)
    store.tickAllTrains(0.05)
    for (const level of ['standard', 'pro'] as const) {
      store.setSignallingSettings({ level })
      train.currentSpeed = 5
      store.tickAllTrains(0.05)
      const state = buildConsoleState(store)!
      expect(state.signals!.next).toMatchObject({ color: 'red', label: 'Sens interdit', plate: level === 'pro' ? 'Nf' : null })
      expect(state.signals!.closedDistance).toBeNull()
      expect(state.signals!.waiting).toBe(false)
      expect(overTheWire(state)).toEqual(state)
    }
    // Running past it: the fault is reported once and the emergency brake comes on
    let faults = 0
    store.onSignalPassed = () => faults++
    for (let i = 0; i < 600 && !train.emergencyBrake; i++) {
      train.currentSpeed = 5
      store.tickAllTrains(0.05)
    }
    expect(faults).toBe(1)
    expect(train.emergencyBrake).toBe(true)
    expect(buildConsoleState(store)!.signals!.passed).toEqual({ braked: true })
  })
})

describe('picking one of two signals back to back', () => {
  function pair() {
    const { store } = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.setSignalToolBothWays(true)
    expect(store.beginSignalGesture({ x: 2000, y: -3 })).toBe(true)
    store.commitSignalGesture()
    store.setSignalToolSubMode('select')
    const [east, west] = [...store.network.signals.values()]
    expect(east.forward).toBe(true)
    expect(west.forward).toBe(false)
    return { store, east, west }
  }

  it('off the axis, the signal on the side of the cursor', () => {
    const { store, east, west } = pair()
    const headEast = signalHeadWorld(store.network, east, store.camera.scale, store.gauge)!
    const headWest = signalHeadWorld(store.network, west, store.camera.scale, store.gauge)!
    expect(Math.sign(headEast.y)).toBe(-Math.sign(headWest.y))
    expect(store.signalAt(headEast)?.id).toBe(east.id)
    expect(store.signalAt(headWest)?.id).toBe(west.id)
    // Just off the axis, on either side: the side decides, whichever signal is picked already
    for (const selected of [null, east.id, west.id]) {
      store.selectSignal(selected)
      expect(store.signalAt({ x: 2000, y: Math.sign(headEast.y) * 1.5 })?.id).toBe(east.id)
      expect(store.signalAt({ x: 2000, y: Math.sign(headWest.y) * 1.5 })?.id).toBe(west.id)
    }
  })

  it('right on the axis: the one for the direction of the rail first, then each click goes to the other', () => {
    const { store, east, west } = pair()
    const onAxis = { x: 2000, y: 0 }
    // The same answer however often it is asked: nothing depends on the order of the signals
    expect(store.signalAt(onAxis)?.id).toBe(east.id)
    expect(store.signalAt(onAxis)?.id).toBe(east.id)
    store.selectSignal(store.signalAt(onAxis)!.id)
    expect(store.signalAt(onAxis)?.id).toBe(west.id)
    store.selectSignal(store.signalAt(onAxis)!.id)
    expect(store.selectedSignal?.id).toBe(west.id)
    expect(store.signalAt(onAxis)?.id).toBe(east.id)
    // Within a pixel of the axis is still the axis
    expect(store.signalAt({ x: 2000, y: 0.1 })?.id).toBe(east.id)
    expect(store.signalAt({ x: 2000, y: -0.1 })?.id).toBe(east.id)
    // Far from any signal: none
    expect(store.signalAt({ x: 2600, y: 0 })).toBeNull()
  })

  it('a lone signal is picked as before', () => {
    const { store } = storeWithTrack()
    const only = signalAt(store.network, 2000, 0, 'east')
    store.setSignalToolSubMode('select')
    expect(store.signalAt({ x: 2000, y: 0 })?.id).toBe(only.id)
    store.selectSignal(only.id)
    expect(store.signalAt({ x: 2000, y: 0 })?.id).toBe(only.id)
  })
})

describe('displays of the signalling', () => {
  it('the blocks show while a signal is laid, and the box really hides them then', () => {
    const { store } = storeWithTrack()
    expect(store.signalBlocksVisible).toBe(false)
    store.setSignalToolSubMode('blockSignal')
    expect(store.signalBlocksVisible).toBe(true)
    store.toggleSignalBlocks()
    expect(store.signalBlocksVisible).toBe(false)
    // Hiding them during the placement does not tick the display of the project
    expect(store.showSignalBlocks).toBe(false)
    store.setSignalToolSubMode('pathSignal')
    expect(store.signalBlocksVisible).toBe(false)
    store.toggleSignalBlocks()
    expect(store.signalBlocksVisible).toBe(true)
    // Out of the placement, the box is the display of the project again
    store.setSignalToolSubMode('select')
    expect(store.signalBlocksVisible).toBe(false)
    store.toggleSignalBlocks()
    expect(store.showSignalBlocks).toBe(true)
    expect(store.signalBlocksVisible).toBe(true)
  })

  it('are saved with the project only when ticked, and come back when it is loaded', () => {
    const { store } = storeWithTrack()
    const plain = store.exportProject()
    expect('showSignalBlocks' in JSON.parse(JSON.stringify(plain))).toBe(false)
    expect('showSignalReservations' in JSON.parse(JSON.stringify(plain))).toBe(false)

    const steps = undoSteps(store)
    store.toggleSignalBlocks()
    store.toggleSignalReservations()
    // A display setting: no undo step
    expect(undoSteps(store)).toBe(steps)
    const saved = JSON.parse(JSON.stringify(store.exportProject()))
    expect(saved).toMatchObject({ showSignalBlocks: true, showSignalReservations: true })

    const other = new EditorStore()
    other.loadFromData(saved)
    expect(other.showSignalBlocks).toBe(true)
    expect(other.showSignalReservations).toBe(true)
    // A project that says nothing of them: both off, whatever the store showed before
    other.loadFromData(JSON.parse(JSON.stringify(plain)))
    expect(other.showSignalBlocks).toBe(false)
    expect(other.showSignalReservations).toBe(false)
    // One ticked, one not
    store.toggleSignalBlocks()
    expect(JSON.parse(JSON.stringify(store.exportProject()))).not.toHaveProperty('showSignalBlocks')
    expect(JSON.parse(JSON.stringify(store.exportProject()))).toHaveProperty('showSignalReservations', true)
  })

  it('are restored from the autosave, and left alone by undo', () => {
    const { store } = storeWithTrack()
    store.toggleSignalBlocks()
    const reopened = new EditorStore()
    reopened.loadPersistedState()
    expect(reopened.showSignalBlocks).toBe(true)
    expect(reopened.showSignalReservations).toBe(false)

    // An edit, then undo: the display stays as the user set it
    signalAt(store.network, 2000, 0, 'east')
    store.markDirty()
    store.toggleSignalReservations()
    store.undo()
    expect(store.network.signals.size).toBe(0)
    expect(store.showSignalBlocks).toBe(true)
    expect(store.showSignalReservations).toBe(true)
    store.newProject()
    expect(store.showSignalBlocks).toBe(false)
    expect(store.showSignalReservations).toBe(false)
  })
})

describe('points built where a signal stands', () => {
  it('the signal is pushed back along its approach, in the same undo step as the points', () => {
    const { store, nodes } = storeWithTrack()
    const signal = signalAt(store.network, 999, 0, 'east')
    store.markDirty()
    const steps = undoSteps(store)
    // A branch is laid from the joint at x = 1000
    const end = addNode(store.network, { x: 2000, y: 150 })
    addSegment(store.network, nodes[1].id, end.id)
    store.markDirty()
    expect(undoSteps(store)).toBe(steps + 1)
    const moved = store.network.signals.get(signal.id)!
    expect(xOf(store, moved)).toBeCloseTo(1000 - SIGNAL_SWITCH_CLEARANCE, 2)
    expect(moved.forward).toBe(true)
    expect(signalReport(store.network).some((entry) => entry.type === 'signal-on-switch')).toBe(false)

    store.undo()
    expect(store.network.segments.size).toBe(2)
    expect(xOf(store, store.network.signals.get(signal.id)!)).toBeCloseTo(999, 6)
    store.redo()
    expect(xOf(store, store.network.signals.get(signal.id)!)).toBeCloseTo(1000 - SIGNAL_SWITCH_CLEARANCE, 2)
  })

  it('a signal that cannot be pushed back stays, and the report names it', () => {
    const { store, nodes } = storeWithTrack()
    // Eastbound, 1 m past the joint; a branch then joins from the west: its trains come by either rail
    const signal = signalAt(store.network, 1001, 0, 'east')
    store.markDirty()
    const start = addNode(store.network, { x: 0, y: 150 })
    addSegment(store.network, start.id, nodes[1].id)
    store.markDirty()
    expect(xOf(store, store.network.signals.get(signal.id)!)).toBeCloseTo(1001, 6)
    expect(signalReport(store.network).find((entry) => entry.type === 'signal-on-switch')).toMatchObject({ signalId: signal.id })
  })

  it('a project is loaded as it was saved: a signal standing too near points is not moved', () => {
    const source = new EditorStore()
    const { nodes } = chain(source.network, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 5000, y: 0 }])
    const signal = signalAt(source.network, 999, 0, 'east')
    chain(source.network, [{ x: 2000, y: 150 }], nodes[1])
    syncJunctions(source.network)
    // Saved without going through an edit of the store: as a project of the first batch could be
    const data = JSON.parse(JSON.stringify(source.exportProject()))

    const store = new EditorStore()
    store.loadFromData(data)
    expect(xOf(store, store.network.signals.get(signal.id)!)).toBeCloseTo(999, 6)
    expect(JSON.parse(JSON.stringify(store.exportProject())).signals).toEqual(data.signals)
    expect(signalReport(store.network).some((entry) => entry.type === 'signal-on-switch')).toBe(true)
  })
})

describe('trains nobody drives hold the track for the slope they are on', () => {
  /** Farthest x held ahead of a train rolling east at 30 m/s that is not the driven one, on a line falling by `drop` levels */
  function heldAhead(drop: number): number {
    resetMemoryStorage()
    const store = new EditorStore()
    // Rails of 100 m: the track is held rail by rail
    const { nodes } = chain(store.network, Array.from({ length: 61 }, (_, i) => ({ x: i * 100, y: 0 })))
    // An even slope from `drop` levels at x = 0 to the ground at x = 1500: the train stands on it
    if (drop !== 0) nodes.forEach((node, i) => setNodesLevel(store.network, [node.id], drop * Math.max(0, 1 - i / 15)))
    signalAt(store.network, 5550, 0, 'east')
    store.trains = [trainAt(store.network, 300, 0, 'east', 'rolling'), trainAt(store.network, 5800, 0, 'east', 'driven')]
    store.markDirty()
    store.selectTrainById('driven')
    store.togglePlayMode()
    const rolling = store.trains[0]
    drive(rolling, 30)
    store.tickAllTrains(0.02)
    const spans = store.signalling.trains.get('rolling')!.reservation.spans
    const xAt = (segId: string, t: number): number => {
      const seg = store.network.segments.get(segId)!
      const a = store.network.nodes.get(seg.from)!.pos.x
      return a + (store.network.nodes.get(seg.to)!.pos.x - a) * t
    }
    return Math.max(...spans.map((span) => Math.max(xAt(span.segId, span.t0), xAt(span.segId, span.t1))))
  }

  it('further downhill than on the level', () => {
    const level = heldAhead(0)
    // 30 m/s: 643 + 60 m to stop on the level, × 1.5 + 50 = 1 105 m held ahead of the nose
    expect(level).toBeGreaterThanOrEqual(1400)
    expect(level).toBeLessThanOrEqual(1600)
    // 5 levels of 6 m over 1 500 m: 20 ‰ downhill, the deceleration counted on falls from 0.7 to 0.5 m/s²
    // — 893 + 60 m to stop, 1 480 m held
    const downhill = heldAhead(5)
    expect(downhill).toBeGreaterThanOrEqual(level + 300)
    // Uphill the distance on the level is kept: never less than before
    expect(heldAhead(-5)).toBe(level)
  })
})

describe('cab signalling in the store', () => {
  function lgvStore() {
    const store = new EditorStore()
    chain(store.network, [{ x: 0, y: 0 }, { x: 15_000, y: 0 }])
    for (let x = 1500; x < 15_000; x += 1500) {
      setSignalOptions(store.network, signalAt(store.network, x, 0, 'east').id, { cabMarker: true })
    }
    store.trains = [trainAt(store.network, 200, 0, 'east')]
    store.markDirty()
    store.setSignallingSettings({ level: 'pro' })
    store.setLineSettings({ lineType: 'highSpeed', lineSpeed: 300 })
    const train = store.trains[0]
    store.selectTrainById(train.id)
    store.togglePlayMode()
    return { store, train }
  }

  it('catches an overspeed: emergency brake, a trace on the train, the driver told once, the console says it', () => {
    const { store, train } = lgvStore()
    const caught: CabOverspeed[] = []
    store.onOverspeed = (_, overspeed) => caught.push(overspeed)
    drive(train, 310 / 3.6)
    store.tickAllTrains(0.02)
    expect(caught).toEqual([])
    expect(buildConsoleState(store)!.signals!.cab).toMatchObject({ kind: 'line', speed: 300 })
    expect('overspeed' in buildConsoleState(store)!.signals!).toBe(false)

    train.currentSpeed = 320 / 3.6
    store.tickAllTrains(0.02)
    store.tickAllTrains(0.02)
    expect(caught).toHaveLength(1)
    expect(caught[0]).toMatchObject({ limit: 300, braked: true })
    expect(train.emergencyBrake).toBe(true)
    const state = buildConsoleState(store)!
    expect(state.signals!.overspeed).toEqual({ braked: true })
    expect(overTheWire(state)).toEqual(state)
  })

  it('obeys the setting of the emergency brake on a closed signal: off, the driver is only told', () => {
    const { store, train } = lgvStore()
    store.setSignallingSettings({ stopEnforced: false })
    const caught: CabOverspeed[] = []
    store.onOverspeed = (_, overspeed) => caught.push(overspeed)
    drive(train, 320 / 3.6)
    store.tickAllTrains(0.02)
    expect(caught).toHaveLength(1)
    expect(caught[0].braked).toBe(false)
    expect(train.emergencyBrake).toBe(false)
    expect(buildConsoleState(store)!.signals!.overspeed).toEqual({ braked: false })
  })

  it('does nothing at the standard level nor on a conventional line', () => {
    for (const change of [
      (store: EditorStore) => store.setSignallingSettings({ level: 'standard' }),
      (store: EditorStore) => store.setLineSettings({ lineType: 'classic', lineSpeed: 300 }),
    ]) {
      resetIdCounter(0)
      resetMemoryStorage()
      const { store, train } = lgvStore()
      change(store)
      let caught = 0
      store.onOverspeed = () => caught++
      drive(train, 340 / 3.6)
      store.tickAllTrains(0.02)
      expect(caught).toBe(0)
      expect(train.emergencyBrake).toBe(false)
      expect(train.overspeed ?? null).toBeNull()
    }
  })
})
