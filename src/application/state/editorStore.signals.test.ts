import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore, JUNCTION_OCCUPIED_REFUSED, JUNCTION_RESERVED_REFUSED, signalPassedMessage } from './editorStore'
import { resetIdCounter } from '@domain/models/network'
import { findJunctionAtNode } from '@domain/models/routing'
import { addSignal, setSignalOptions } from '@domain/models/signals'
import { signalHeading, signalWorldPosition } from '@domain/services/signalLayout'
import { performTrackCut } from '@domain/geometry/constructionTemplates'
import type { SignalPassing } from '@domain/models/signalling'
import type { TrainSet } from '@domain/models/train'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { chain, crossoverLayout, drive, signalAt, trainAt } from '@domain/models/signalling.testkit'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

/** A store with a committed straight track along y = 0, 0–1000–2000–3000 */
function storeWithTrack() {
  const store = new EditorStore()
  const track = chain(store.network, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }, { x: 3000, y: 0 }])
  store.markDirty()
  return { store, ...track }
}

/** A store driving on the crossover layout of the signalling tests */
function storeWithJunction(trains: (net: EditorStore['network']) => TrainSet[]) {
  const store = new EditorStore()
  const layout = crossoverLayout()
  store.network = layout.net
  store.trains = trains(layout.net)
  store.markDirty()
  store.selectTrainById(store.trains[0].id)
  store.togglePlayMode()
  expect(store.isPlayMode).toBe(true)
  return { store, layout }
}

describe('signalling settings of the project', () => {
  it('a new project is at the standard level with the emergency brake on', () => {
    const store = new EditorStore()
    expect(store.signallingSettings).toEqual({ level: 'standard', stopEnforced: true })
  })

  it('setSignallingSettings changes one or both, as one undo step each, and ignores what it cannot read', () => {
    const { store } = storeWithTrack()
    store.setSignallingSettings({ level: 'pro' })
    expect(store.signallingSettings).toEqual({ level: 'pro', stopEnforced: true })
    store.setSignallingSettings({ stopEnforced: false })
    expect(store.signallingSettings).toEqual({ level: 'pro', stopEnforced: false })

    let notified = 0
    const stop = store.subscribe(() => notified++)
    store.setSignallingSettings({ level: 'expert' as never })
    store.setSignallingSettings({ stopEnforced: 'no' as never })
    store.setSignallingSettings({ level: 'pro', stopEnforced: false })
    store.setSignallingSettings({})
    stop()
    expect(notified).toBe(0)

    store.undo()
    expect(store.signallingSettings).toEqual({ level: 'pro', stopEnforced: true })
    store.undo()
    expect(store.signallingSettings).toEqual({ level: 'standard', stopEnforced: true })
    store.redo()
    store.redo()
    expect(store.signallingSettings).toEqual({ level: 'pro', stopEnforced: false })
  })

  it('the settings and the signals are saved with the project and read back', () => {
    const { store, rails } = storeWithTrack()
    const laid = addSignal(store.network, { segId: rails[1].id, t: 0.5 }, true, 'protection', { cabMarker: true })
    if (!laid.ok) throw new Error('refused')
    store.markDirty()
    store.setSignallingSettings({ level: 'pro', stopEnforced: false })

    const exported = JSON.parse(JSON.stringify(store.exportProject()))
    expect(exported).toMatchObject({ signallingLevel: 'pro', signalStopEnforced: false })
    expect(exported.signals).toEqual([{ id: laid.signal.id, segId: rails[1].id, t: 0.5, forward: true, role: 'protection', cabMarker: true }])

    // The autosave is read by a new session
    const reopened = new EditorStore()
    expect(reopened.signallingSettings).toEqual({ level: 'pro', stopEnforced: false })
    expect([...reopened.network.signals.values()]).toEqual([laid.signal])

    // A file without the settings is on the defaults, whatever the project open before
    const { signallingLevel: _level, signalStopEnforced: _enforced, ...plain } = exported
    reopened.loadFromData(plain)
    expect(reopened.signallingSettings).toEqual({ level: 'standard', stopEnforced: true })
    expect(reopened.network.signals.size).toBe(1)
  })

  it('a new project starts again from the defaults', () => {
    const { store } = storeWithTrack()
    store.setSignallingSettings({ level: 'pro', stopEnforced: false })
    store.newProject()
    expect(store.signallingSettings).toEqual({ level: 'standard', stopEnforced: true })
    expect(store.network.signals.size).toBe(0)
  })

  it('a project without signal is saved exactly as before signals existed', () => {
    const { store } = storeWithTrack()
    const exported = store.exportProject()
    expect('signals' in JSON.parse(JSON.stringify(exported))).toBe(false)
    expect('signallingLevel' in JSON.parse(JSON.stringify(exported))).toBe(false)
    expect('signalStopEnforced' in JSON.parse(JSON.stringify(exported))).toBe(false)
  })

  it('switching the level back and forth loses nothing of the signals', () => {
    const { store, rails } = storeWithTrack()
    const laid = addSignal(store.network, { segId: rails[1].id, t: 0.5 }, false, 'protection')
    if (!laid.ok) throw new Error('refused')
    store.setSignallingSettings({ level: 'pro' })
    setSignalOptions(store.network, laid.signal.id, { cabMarker: true, oneWay: true })
    store.markDirty()
    const before = JSON.stringify([...store.network.signals.values()])

    store.setSignallingSettings({ level: 'standard' })
    expect(JSON.stringify([...store.network.signals.values()])).toBe(before)
    store.setSignallingSettings({ level: 'pro' })
    expect(JSON.stringify([...store.network.signals.values()])).toBe(before)
    // And through the undo history, which reads the project back each time
    store.undo()
    store.undo()
    expect(store.signallingLevel).toBe('pro')
    expect(JSON.stringify([...store.network.signals.values()])).toBe(before)
  })
})

describe('signals follow the editing of the track', () => {
  it('a signal survives the scissors, and the undo of the cut', () => {
    const { store, rails } = storeWithTrack()
    const laid = addSignal(store.network, { segId: rails[1].id, t: 0.25 }, true, 'spacing')
    if (!laid.ok) throw new Error('refused')
    store.markDirty()
    const id = laid.signal.id

    expect(performTrackCut(store.network, { x: 1600, y: 0 })).toBe(true)
    store.markDirty()
    const cut = store.network.signals.get(id)!
    expect(cut.segId).not.toBe(rails[1].id)
    expect(signalWorldPosition(store.network, cut)!.x).toBeCloseTo(1250, 6)
    expect(signalHeading(store.network, cut)!.x).toBeCloseTo(1, 6)

    store.undo()
    const back = store.network.signals.get(id)!
    expect(back).toEqual({ id, segId: rails[1].id, t: 0.25, forward: true, role: 'spacing' })
    store.redo()
    expect(signalWorldPosition(store.network, store.network.signals.get(id)!)!.x).toBeCloseTo(1250, 6)
  })

  it('laying and removing a signal are undone like any edit', () => {
    const { store, rails } = storeWithTrack()
    const laid = addSignal(store.network, { segId: rails[1].id, t: 0.25 }, true, 'spacing')
    if (!laid.ok) throw new Error('refused')
    store.markDirty()
    expect(store.network.signals.size).toBe(1)
    store.undo()
    expect(store.network.signals.size).toBe(0)
    store.redo()
    expect([...store.network.signals.values()]).toEqual([laid.signal])
  })

  it('a signal goes with its rail when the rail is deleted, and comes back with it', () => {
    const { store, rails } = storeWithTrack()
    const laid = addSignal(store.network, { segId: rails[1].id, t: 0.25 }, true, 'spacing')
    if (!laid.ok) throw new Error('refused')
    store.markDirty()
    store.selection = { nodes: new Set(), segments: new Set([rails[1].id]) }
    store.deleteSelection()
    expect(store.network.segments.has(rails[1].id)).toBe(false)
    expect(store.network.signals.size).toBe(0)
    store.undo()
    expect([...store.network.signals.values()]).toEqual([laid.signal])
  })
})

describe('signalling while driving', () => {
  it('is empty outside driving and on a network without signal', () => {
    const { store } = storeWithTrack()
    expect(store.signalling.signals.size).toBe(0)
    expect(store.selectedTrainSignals).toBeNull()
    store.trains = [trainAt(store.network, 500, 0, 'east')]
    store.selectTrainById(store.trains[0].id)
    store.togglePlayMode()
    store.tickAllTrains(0.1)
    expect(store.signalling.signals.size).toBe(0)
    expect(store.signalling.revision).toBe(0)
    expect(store.selectedTrainSignals).toEqual({ nextSignal: null, closedSignal: null, brakeAlert: false, waitingAt: null, onSight: false })
  })

  it('shows the state of the signals from the first frame, and forgets it when driving stops', () => {
    const { store, layout } = storeWithJunction((net) => [trainAt(net, 2800, 0, 'east')])
    expect(store.signalling.signals.get(layout.sa.id)!.state).toBe('stop')
    expect(store.signalling.signals.get(layout.pa.id)!.state).toBe('stop')
    store.togglePlayMode()
    expect(store.signalling.signals.size).toBe(0)
  })

  it('points held for the route of a train are not thrown, with their own reason', () => {
    const { store, layout } = storeWithJunction((net) => [trainAt(net, 700, 0, 'east'), trainAt(net, 100, 20, 'east')])
    const [driven, other] = store.trains
    drive(driven, 10)
    store.tickAllTrains(0.05)
    const junction = findJunctionAtNode(store.network, layout.forkA.id)!
    expect(store.signalling.nodeReservations.get(layout.forkA.id)).toBe(driven.id)
    expect(store.isJunctionOccupied(junction)).toBe(false)
    expect(store.junctionLock(junction)).toBe('reserved')

    const active = junction.active
    expect(store.toggleActiveJunction(junction.id)).toBe(false)
    expect(junction.active).toBe(active)
    expect(store.lastJunctionRefusal).toBe('reserved')
    expect(store.junctionRefusalMessage).toBe(JUNCTION_RESERVED_REFUSED)
    expect(JUNCTION_RESERVED_REFUSED).not.toBe(JUNCTION_OCCUPIED_REFUSED)

    // Another train cannot steer them either…
    store.selectTrainById(other.id)
    expect(store.junctionLock(junction, other.id)).toBe('reserved')
    // …but the driver of the train they are held for still sets his own way
    store.selectTrainById(driven.id)
    expect(store.junctionLock(junction, driven.id)).toBeNull()
    store.steerUpcomingTurnout('left')
    store.steerUpcomingTurnout('left')
    const steered = junction.active
    store.steerUpcomingTurnout('right')
    store.steerUpcomingTurnout('right')
    expect(junction.active).not.toBe(steered)
  })

  it('points with a train over them are still refused as occupied, and free points are thrown', () => {
    const { store, layout } = storeWithJunction((net) => [trainAt(net, 1005, 0, 'east')])
    const junctionA = findJunctionAtNode(store.network, layout.forkA.id)!
    const junctionB = findJunctionAtNode(store.network, layout.forkB.id)!
    expect(store.toggleActiveJunction(junctionA.id)).toBe(false)
    expect(store.lastJunctionRefusal).toBe('occupied')
    expect(store.junctionRefusalMessage).toBe(JUNCTION_OCCUPIED_REFUSED)

    const active = junctionB.active
    expect(store.toggleActiveJunction(junctionB.id)).toBe(true)
    expect(junctionB.active).not.toBe(active)
    expect(store.lastJunctionRefusal).toBeNull()
  })

  it('tells the driver what is ahead, and reports a closed signal passed, once, with the emergency brake', () => {
    const store = new EditorStore()
    chain(store.network, Array.from({ length: 9 }, (_, i) => ({ x: i * 500, y: 0 })))
    const closed = signalAt(store.network, 2000.5, 0, 'east')
    signalAt(store.network, 3000.5, 0, 'east')
    store.trains = [trainAt(store.network, 1900, 0, 'east'), trainAt(store.network, 2500, 0, 'east')]
    store.markDirty()
    const train = store.trains[0]
    store.selectTrainById(train.id)
    store.togglePlayMode()

    const reported: { train: TrainSet; passing: SignalPassing }[] = []
    store.onSignalPassed = (t, passing) => reported.push({ train: t, passing })
    drive(train, 20)
    store.tickAllTrains(0.05)
    const view = store.selectedTrainSignals!
    expect(view.nextSignal).toMatchObject({ id: closed.id, state: 'stop' })
    expect(view.closedSignal!.id).toBe(closed.id)
    expect(view.closedSignal!.distance).toBeGreaterThan(80)
    expect(view.closedSignal!.distance).toBeLessThan(100)
    // 20 m/s with the brakes on: the stopping distance is well over what is left
    expect(view.brakeAlert).toBe(true)

    for (let i = 0; i < 100 && reported.length === 0; i++) store.tickAllTrains(0.1)
    expect(reported).toHaveLength(1)
    expect(reported[0].train).toBe(train)
    expect(reported[0].passing).toMatchObject({ signalId: closed.id, closed: true, fault: true })
    expect(train.emergencyBrake).toBe(true)
    expect(train.signalPassed).toMatchObject({ signalId: closed.id, braked: true })
    expect(signalPassedMessage(true)).toMatch(/freinage d’urgence/)

    for (let i = 0; i < 50; i++) store.tickAllTrains(0.1)
    expect(reported).toHaveLength(1)
  })

  it('does not brake when the setting is off, and still reports', () => {
    const store = new EditorStore()
    chain(store.network, Array.from({ length: 9 }, (_, i) => ({ x: i * 500, y: 0 })))
    const closed = signalAt(store.network, 2000.5, 0, 'east')
    store.trains = [trainAt(store.network, 1950, 0, 'east'), trainAt(store.network, 2500, 0, 'east')]
    store.markDirty()
    store.setSignallingSettings({ stopEnforced: false })
    const train = store.trains[0]
    store.selectTrainById(train.id)
    store.togglePlayMode()
    let reported = 0
    store.onSignalPassed = () => reported++
    drive(train, 20)
    for (let i = 0; i < 100 && reported === 0; i++) store.tickAllTrains(0.1)
    expect(reported).toBe(1)
    expect(train.emergencyBrake).toBe(false)
    expect(train.signalPassed).toMatchObject({ signalId: closed.id, braked: false })
    expect(signalPassedMessage(false)).toBe('Signal fermé franchi')
  })
})
