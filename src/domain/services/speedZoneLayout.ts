import type { Network, Point, SpeedZone } from '../models/types'
import { addSpeedZone } from '../models/speedZones'
import { findTrackPath, trackSpansEnds, trackSpansLength, type TrackPoint } from './trackPath'

/** Length of a zone along the track, in metres. */
export function speedZoneLength(net: Network, zone: SpeedZone): number {
  return trackSpansLength(net, zone.spans)
}

/** World positions of the two ends of a zone: A, where it was started, and B. Null for a zone off the track. */
export function speedZoneEnds(net: Network, zone: SpeedZone): { a: Point; b: Point } | null {
  return trackSpansEnds(net, zone.spans)
}

/**
 * Lay a zone at `speed` km/h along the shortest way from point `a` to point `b` of the track (see
 * `findTrackPath`). Null, and nothing is added, when no way joins them or when they are the same place.
 */
export function addSpeedZoneBetween(net: Network, a: TrackPoint, b: TrackPoint, speed: number): SpeedZone | null {
  const path = findTrackPath(net, a, b)
  return path ? addSpeedZone(net, path.spans, speed) : null
}
