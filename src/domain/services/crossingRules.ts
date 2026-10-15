import type { Network, SegmentId, TrackSpan } from '../models/types'
import type { TrackPathOptions } from './trackPath'

// What makes a train take one track rather than another as short where the track doubles — a
// passing loop of a single line, the platforms of a station — so that two trains running towards
// each other do not come face to face on the same one.
//
// The way of every other train is known: a rail one of them runs the other way, or stands on,
// costs dear (`TrackPathOptions.toll`). The single track itself has to be paid for — there is no
// other way — but not the track of the loop the other will take: the second train to look for
// its way takes the other one, and the first keeps the direct track. A toll chooses between ways,
// it never closes one.
//
// Tried and left out: keeping to the left at facing points, as trains do in France. It needs no
// knowledge of the others, but sends a train alone on the line through every loop at the speed
// of its points.

/** Metres a way is counted longer by for each rail another train runs the other way, or stands on */
export const OPPOSED_TOLL = 2500

/** Bits of `TracksHeld`: a train runs the rail `from` → `to`, or `to` → `from` */
const ASCENDING = 1
const DESCENDING = 2

/** For each rail other trains will run or stand on, the ways they do */
export type TracksHeld = Map<SegmentId, number>

/** Note the way of another train: the stretches ahead of it, in the direction it runs them */
export function holdWay(held: TracksHeld, spans: readonly TrackSpan[]): void {
  for (const span of spans) held.set(span.segId, (held.get(span.segId) ?? 0) | (span.t1 >= span.t0 ? ASCENDING : DESCENDING))
}

/** Note a rail a train stands on with nowhere to go: in the way whichever way it is run */
export function holdRail(held: TracksHeld, segId: SegmentId): void {
  held.set(segId, ASCENDING | DESCENDING)
}

/** The toll of a way for a train among others: `held` is what the others run or stand on */
export function crossingToll(net: Network, held: TracksHeld): NonNullable<TrackPathOptions['toll']> {
  return (node, _inSeg, outSeg) => {
    const ways = held.get(outSeg)
    if (ways === undefined) return 0
    const rail = net.segments.get(outSeg)
    // Entered at its `from` end the rail is run ascending: in the way of a train that runs it descending
    return rail && ways & (rail.from === node ? DESCENDING : ASCENDING) ? OPPOSED_TOLL : 0
  }
}
