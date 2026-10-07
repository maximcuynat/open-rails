import type { Network, Segment, SegmentId } from '../models/types'
import { networkChangesSince } from './networkFollower'
import { segmentShapeLength } from './segmentGeometry'

/**
 * Length of every rail of a network, worked out once and kept: whoever adds up or compares the
 * rails of a large network asks here instead of measuring each curve again. A rail is measured
 * again when the feed of the network says it changed (its ends, its control point, its path, or
 * a node it ends on).
 */
export interface RailMeasures {
  /** Length of the shape of a rail (`segmentShapeLength`), 0 when a node of it is missing */
  shapeLength(seg: Segment): number
}

interface MeasuresEntry {
  cursor: number | undefined
  lengths: Map<SegmentId, number>
}

const entries = new WeakMap<Network, MeasuresEntry>()

/** The measures of a network, up to date with it: take them once per computation, then ask them for each rail */
export function railMeasures(net: Network): RailMeasures {
  const entry = entries.get(net) ?? { cursor: undefined, lengths: new Map() }
  const reading = networkChangesSince(net, entry.cursor)
  if (!reading.changes) entry.lengths.clear()
  else for (const sid of reading.changes.changedRails) entry.lengths.delete(sid)
  entry.cursor = reading.cursor
  entries.set(net, entry)
  const lengths = entry.lengths
  return {
    shapeLength(seg) {
      let length = lengths.get(seg.id)
      if (length === undefined) {
        length = segmentShapeLength(net, seg)
        lengths.set(seg.id, length)
      }
      return length
    },
  }
}
