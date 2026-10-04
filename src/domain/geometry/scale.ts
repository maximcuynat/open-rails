import { STANDARD_GAUGE } from '../profiles/profiles'

/**
 * World-space thresholds of the track-laying tools, in metres.
 * All of them are expressed for the 1:1 gauge and scaled by `k = gauge / STANDARD_GAUGE`,
 * so a model-scale layout (HO: k ≈ 0.0115) gets proportionally smaller limits.
 */
export interface PlacementThresholds {
  /** Scale factor: 1 at 1:1, gauge / 1.435 otherwise. */
  k: number
  /** Node/segment proximity under which reconcile welds or splits. */
  reconcileTolerance: number
  /** Manual "heal" pass (R key): looser proximity for welding stray ends. */
  healTolerance: number
  /** Gap left between the two rail ends when a node is cut apart. Must stay > reconcileTolerance. */
  detachGap: number
  /** Chord under which a freeform curve degenerates into a straight line. */
  minChord: number
  /** Smallest curve radius the tools accept. */
  minRadius: number
  /** Radius floor of the free-node tangent lock. */
  minReverseLockRadius: number
  /** Minimum distance from the start to the tangent intersection for a lock. */
  minLockAdvance: number
  /** Minimum perpendicular distance from a free start to the rail for a lock. */
  minLockPerp: number
  /** Distance along the rail beyond which the cursor decides the lock direction. */
  cursorDeadband: number
  /** Minimum longitudinal advance of a parallel turnout. */
  minTurnoutAdvance: number
  /** Minimum lateral offset of a parallel turnout. */
  minTurnoutOffset: number
  /** Margin kept free at both ends of a segment when computing step points. */
  stepMargin: number
}

/** Scale factor of a layout relative to the 1:1 standard gauge. */
export function scaleFactor(gauge: number = STANDARD_GAUGE): number {
  return gauge > 0 && Number.isFinite(gauge) ? gauge / STANDARD_GAUGE : 1
}

/** Thresholds for a given rail gauge (defaults to the 1:1 values). */
export function placementThresholds(gauge: number = STANDARD_GAUGE): PlacementThresholds {
  const k = scaleFactor(gauge)
  return {
    k,
    reconcileTolerance: 0.10 * k,
    healTolerance: 3.5 * k,
    detachGap: 0.25 * k,
    minChord: 5 * k,
    minRadius: 15 * k,
    minReverseLockRadius: 20 * k,
    minLockAdvance: 0.5 * k,
    minLockPerp: 0.2 * k,
    cursorDeadband: 1 * k,
    minTurnoutAdvance: 2 * k,
    minTurnoutOffset: 0.2 * k,
    stepMargin: 0.2 * k,
  }
}
