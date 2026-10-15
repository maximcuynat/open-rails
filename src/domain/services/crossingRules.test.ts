import { describe, expect, it } from 'vitest'
import { syncJunctions } from '../models/junction'
import { addNode, addSegment, createNetwork } from '../models/network'
import { OPPOSED_TOLL, crossingToll, holdRail, holdWay, type TracksHeld } from './crossingRules'
import { findTrackPathToAny } from './trackPath'

/** Two tracks side by side from A to B, the upper one a little longer; a rail before A and one after B */
function loop() {
  const net = createNetwork()
  const west = addNode(net, { x: 0, y: 0 })
  const a = addNode(net, { x: 100, y: 0 })
  const b = addNode(net, { x: 500, y: 0 })
  const east = addNode(net, { x: 600, y: 0 })
  const up = addNode(net, { x: 300, y: 4 })
  const before = addSegment(net, west.id, a.id)!
  const direct = addSegment(net, a.id, b.id)!
  const upIn = addSegment(net, a.id, up.id)!
  const upOut = addSegment(net, up.id, b.id)!
  const after = addSegment(net, b.id, east.id)!
  // A and B are points: either track can be taken
  syncJunctions(net)
  return { net, a, b, before, direct, upIn, upOut, after }
}

describe('the toll of a track another train is on', () => {
  it('is paid for a rail run against the way of another train, not for one run the same way', () => {
    const { net, a, b, before, direct } = loop()
    const held: TracksHeld = new Map()
    // Another train runs the direct track from B to A
    holdWay(held, [{ segId: direct.id, t0: 1, t1: 0.2 }])
    const toll = crossingToll(net, held)
    expect(toll(a.id, before.id, direct.id)).toBe(OPPOSED_TOLL)
    expect(toll(b.id, 'after', direct.id)).toBe(0)
    expect(toll(a.id, before.id, 'elsewhere')).toBe(0)
  })

  it('is paid either way for a rail a train stands on with nowhere to go', () => {
    const { net, a, b, before, direct } = loop()
    const held: TracksHeld = new Map()
    holdRail(held, direct.id)
    const toll = crossingToll(net, held)
    expect(toll(a.id, before.id, direct.id)).toBe(OPPOSED_TOLL)
    expect(toll(b.id, 'after', direct.id)).toBe(OPPOSED_TOLL)
  })

  it('sends a way round by the other track of a loop, and through the single track all the same', () => {
    const { net, before, direct, upIn, upOut, after } = loop()
    const from = { segId: before.id, t: 0 }
    const to = [{ segId: after.id, t: 1 }]
    const alone = findTrackPathToAny(net, from, to)!
    expect(alone.spans.map((s) => s.segId)).toEqual([before.id, direct.id, after.id])
    expect(alone.length).toBeCloseTo(600, 6)

    // A train comes the other way over the whole line by the direct track
    const held: TracksHeld = new Map()
    holdWay(held, [{ segId: after.id, t0: 1, t1: 0 }, { segId: direct.id, t0: 1, t1: 0 }, { segId: before.id, t0: 1, t1: 0 }])
    const round = findTrackPathToAny(net, from, to, { toll: crossingToll(net, held) })!
    expect(round.spans.map((s) => s.segId)).toEqual([before.id, upIn.id, upOut.id, after.id])
    // The length is the one of the track, the tolls left out
    expect(round.length).toBeCloseTo(200 + 2 * Math.hypot(200, 4), 6)
  })
})
