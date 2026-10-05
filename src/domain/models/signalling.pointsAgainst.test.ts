import { describe, it, expect } from 'vitest'
import { createSignallingState, updateSignalling, nodeReservedBy, signalStatus } from './signalling'
import { drive, halt, singleTrackLayout, trainAt } from './signalling.testkit'

/**
 * KNOWN BUG, kept as an expected failure (`it.fails`): the day the signalling is fixed this test
 * turns red and has to become a plain `it`.
 *
 * A path signal whose route ends on points set against its train is opened all the same (the route
 * is read as running « to an end of track ») and the train takes those points. On a single track
 * that locks a crossing: the train waiting at the exit of a loop takes the points the moment they
 * are thrown for the train coming in, which then never gets its route — unless it comes first in
 * the list of trains. Found with the example « Voie unique avec évitement », which is held back
 * from the menu for it (`src/examples/examples.test.ts`).
 */
describe('points set against a train waiting at a path signal', () => {
  it.fails('are left to the train they were thrown for, whatever the order of the trains', () => {
    const layout = singleTrackLayout()
    const { net } = layout
    layout.west('main')
    layout.east('main')
    // A westbound train waits on the main track of the east station, at its exit signal; an
    // eastbound one comes along the single track. The waiting train is listed first.
    const waiting = halt(drive(trainAt(net, 3300, 0, 'west'), 0))
    const incoming = drive(trainAt(net, 2500, 0, 'east'), 10)
    const trains = [waiting, incoming]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(signalStatus(state, layout.exitEastMain).state).toBe('stop')
    expect(signalStatus(state, layout.entryEast).state).toBe('stop')

    // The points are thrown to the siding for the incoming train
    layout.east('siding')
    updateSignalling(net, trains, state)

    // The exit signal of the waiting train must stay closed — the points are against it — and the
    // incoming train must be given its route into the siding
    expect(signalStatus(state, layout.exitEastMain).state).toBe('stop')
    expect(nodeReservedBy(state, layout.eastPoints.id)).toBe(incoming.id)
    expect(signalStatus(state, layout.entryEast).state).not.toBe('stop')
  })

  it('the same crossing works when the incoming train is listed first', () => {
    const layout = singleTrackLayout()
    const { net } = layout
    layout.west('main')
    layout.east('main')
    const waiting = halt(drive(trainAt(net, 3300, 0, 'west'), 0))
    const incoming = drive(trainAt(net, 2500, 0, 'east'), 10)
    const trains = [incoming, waiting]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    layout.east('siding')
    updateSignalling(net, trains, state)

    expect(signalStatus(state, layout.exitEastMain).state).toBe('stop')
    expect(nodeReservedBy(state, layout.eastPoints.id)).toBe(incoming.id)
    expect(signalStatus(state, layout.entryEast).state).not.toBe('stop')
  })
})
