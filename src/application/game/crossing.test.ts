import { describe, expect, it } from 'vitest'
import type { EditorStore } from '@application/state/editorStore'
import { addItineraryStop } from './itinerary'
import { LOOP_OFFSET, allArrived, bogiePoints, closestBogies, singleTrackLine, type LineSignals } from './singleTrack.testkit'

// Trains under the automatic pilot on a single track: 6 km, a loop at each end and one in the
// middle, the signals an import lays (a path signal before each set of points).

const LOOPS = { ouest: 400, milieu: 3000, est: 5600 }

/** Set a rake down at the first station of each journey, give it the rest as its itinerary, and hand it to the pilot */
function start(signals: LineSignals, journeys: string[][], railLength?: number): EditorStore {
  const store = singleTrackLine(LOOPS, 6000, signals, 400, railLength)
  for (const [from] of journeys) expect(store.placeRakeAtStation(from, 'duplex')).not.toBeNull()
  store.togglePlayMode()
  store.trains.forEach((train, i) => {
    for (const station of journeys[i].slice(1)) expect(addItineraryStop(store, train, station)).toBeNull()
    store.setAutopilot(train.id, true)
  })
  return store
}

/** Run until every train has arrived; says how near two trains came and which tracks each was seen on in the middle loop */
function run(store: EditorStore, seconds: number) {
  let closest = Infinity
  const middle = store.trains.map(() => new Set<'direct' | 'loop'>())
  for (let i = 0; i < seconds * 20 && !allArrived(store); i++) {
    store.tickAllTrains(0.05)
    closest = Math.min(closest, closestBogies(store))
    store.trains.forEach((train, t) => {
      const head = bogiePoints(store, train)[0]
      if (Math.abs(head.x - LOOPS.milieu) < 100) middle[t].add(head.y > LOOP_OFFSET / 2 ? 'loop' : 'direct')
    })
  }
  return { closest, middle: middle.map((tracks) => [...tracks]) }
}

describe('trains under the pilot on a single track', () => {
  it('a train alone keeps to the direct track', { timeout: 30_000 }, () => {
    const store = start('auto', [['ouest', 'est']])
    const seen = run(store, 900)
    expect(allArrived(store)).toBe(true)
    expect(seen.middle).toEqual([['direct']])
  })

  it('two trains running towards each other each take a track of the loop and both arrive', { timeout: 30_000 }, () => {
    const store = start('auto', [['ouest', 'est'], ['est', 'ouest']])
    const seen = run(store, 1200)
    expect(allArrived(store)).toBe(true)
    // The first to look for its way keeps the direct track, the other goes round it
    expect(seen.middle).toEqual([['direct'], ['loop']])
    // Never nearer than side by side in the loop
    expect(seen.closest).toBeGreaterThan(3)
    expect(store.trains.some((train) => train.emergencyBrake || train.derailed)).toBe(false)
  })

  it('they cross the same on a track laid in short rails, as an import lays it: the points are not thrown back and forth', { timeout: 30_000 }, () => {
    const store = start('auto', [['ouest', 'est'], ['est', 'ouest']], 60)
    const seen = run(store, 1200)
    expect(allArrived(store)).toBe(true)
    expect(seen.middle).toEqual([['direct'], ['loop']])
    expect(seen.closest).toBeGreaterThan(3)
  })

  it('goes to the free platform when a train has come to stand at the one it was heading for', { timeout: 30_000 }, () => {
    const store = start('auto', [['ouest', 'est']])
    const [arriving] = store.trains
    const arrived = () => arriving.itinerary!.next >= arriving.itinerary!.stations.length && arriving.currentSpeed === 0
    const platform = (train: (typeof store.trains)[number]) => (bogiePoints(store, train)[0].y > LOOP_OFFSET / 2 ? 'loop' : 'direct')
    for (let i = 0; i < 20 * 60; i++) store.tickAllTrains(0.05)
    // Under way for a minute, heading for the direct track: a train is set down there, waiting to leave the other way
    expect(store.placeRakeAtStation('est', 'duplex')).not.toBeNull()
    const waiting = store.trains[1]
    expect(addItineraryStop(store, waiting, 'ouest')).toBeNull()
    expect(platform(waiting)).toBe('direct')
    let stood = false
    for (let i = 0; i < 20 * 900 && !arrived(); i++) {
      store.tickAllTrains(0.05)
      if (arriving.currentSpeed === 0 && bogiePoints(store, arriving)[0].x < LOOPS.est - 150) stood = true
    }
    expect(arrived()).toBe(true)
    expect(platform(arriving)).toBe('loop')
    // Its way was changed in time: it never had to stop before a signal on the way in
    expect(stood).toBe(false)
    expect(arriving.emergencyBrake).toBe(false)
  })

  it('two trains that follow each other and one coming the other way all arrive: the points are left to the train that can use them, the second finds a free platform', { timeout: 60_000 }, () => {
    const store = start('auto', [['ouest', 'est'], ['ouest', 'est'], ['est', 'ouest']])
    const seen = run(store, 1800)
    expect(allArrived(store)).toBe(true)
    expect(seen.closest).toBeGreaterThan(3)
    expect(store.trains.some((train) => train.emergencyBrake || train.derailed)).toBe(false)
  })
})
