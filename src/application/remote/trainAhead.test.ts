import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { trainAheadState } from '@application/console/consoleState'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { extrapolateAhead } from '@presentation/remote/deskView'
import { createLossyRoom } from './lossyRoom.testkit'
import { createRemoteDesk } from './remoteDesk'
import { createRemoteSession } from './remoteSession'

/** A 40 km straight with a train 2 km behind another */
function line() {
  const store = new EditorStore()
  const a = addNode(store.network, { x: 0, y: 0 })
  const b = addNode(store.network, { x: 40_000, y: 0 })
  addSegment(store.network, a.id, b.id)
  expect(store.placeTrainLoco({ x: 1000, y: 0 })).toBe(true)
  expect(store.placeTrainLoco({ x: 3000, y: 0 })).toBe(true)
  return store
}

describe('the train ahead', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is found on the route of a train, with its distance, its speed and its driver', () => {
    const store = line()
    const [follower, leader] = store.trains
    store.selectTrainById(leader.id)
    store.togglePlayMode()
    store.seatDesk(2, 'Léa')
    expect(store.takeTrain(follower.id, 2)).toBe(true)
    const ahead = trainAheadState(store, follower)!
    // Nose of the follower to tail of the leader: two kilometres less what the two trains cover
    expect(ahead.distance).toBeGreaterThan(1900)
    expect(ahead.distance).toBeLessThan(2000)
    expect(ahead).toMatchObject({ speed: 0, driver: 'PC' })
    // Nothing ahead of the leader on its 37 km of track: the look stops at ten
    expect(trainAheadState(store, leader)).toBeNull()
    // The leader runs away: a positive speed
    leader.currentSpeed = 50
    expect(trainAheadState(store, follower)!.speed).toBe(50)
    // Turned round, it comes this way: the same speed, negative
    leader.direction = -1
    expect(trainAheadState(store, follower)!.speed).toBe(-50)
  })

  it('is carried forward on the desk through 200 ms of latency and 5 % of loss, within 2 m at 300 km/h', () => {
    const store = line()
    const room = createLossyRoom({ latencyMs: 100, loss: 0.05, seed: 7 })
    const session = createRemoteSession({ store, createLink: room.link, generateRoom: () => 'ABC234' })
    session.open()
    const desk = createRemoteDesk({ link: room.link(), room: 'ABC234', name: 'Léa' })
    let receivedAt = 0
    let lastState = desk.getSnapshot().state
    desk.subscribe(() => {
      const next = desk.getSnapshot().state
      if (next !== lastState) {
        lastState = next
        receivedAt = Date.now()
      }
    })
    vi.advanceTimersByTime(1000)
    expect(desk.getSnapshot()).toMatchObject({ joined: true, desk: 1 })
    expect(session.getSnapshot()!.desks).toEqual([{ desk: 1, name: 'Léa' }])

    const [follower, leader] = store.trains
    desk.send({ type: 'selectTrain', trainId: follower.id })
    vi.advanceTimersByTime(1000)
    expect(store.deskTrain(1)).toBe(follower)
    expect(store.isPlayMode).toBe(true)

    // 300 km/h behind 280 km/h: the gap closes at 5.6 m/s
    follower.currentSpeed = 300 / 3.6
    leader.currentSpeed = 280 / 3.6
    let worst = 0
    let compared = 0
    for (let step = 0; step < 400; step++) {
      store.tickAllTrains(0.05)
      vi.advanceTimersByTime(50)
      const state = desk.getSnapshot().state
      if (step < 40 || !state?.ahead) continue
      const shown = extrapolateAhead(state.ahead, state.speed, (Date.now() - receivedAt) / 1000)
      const truth = trainAheadState(store, follower)!.distance
      worst = Math.max(worst, Math.abs(shown - truth))
      compared++
    }
    expect(compared).toBeGreaterThan(300)
    expect(room.counts.lost).toBeGreaterThan(5)
    expect(worst).toBeLessThan(2)
    // The gap did close meanwhile: the figure is not a constant
    expect(trainAheadState(store, follower)!.distance).toBeLessThan(1950)

    // The desk falls silent with the brake released: the PC puts the handle back by itself
    desk.send({ type: 'brake', command: 'release' })
    vi.advanceTimersByTime(400)
    expect(follower.brakeCommand).toBe('release')
    room.relay.closeAll()
    vi.advanceTimersByTime(1000)
    expect(follower.brakeCommand).toBe('hold')
    session.close()
  })
})
