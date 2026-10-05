import { nodeLevel, segmentEndLevels, segmentGradient } from '@domain/models/network'
import type { Network, NodeId, Segment, SegmentId } from '@domain/models/types'
import { formatDistance, type Unit } from '@domain/models/units'

/** A height as shown to the user: no sign, a decimal comma, two decimals at most. */
function formatLevel(level: number): string {
  return String(Math.round(Math.abs(level) * 100) / 100).replace('.', ',')
}

/** Name of a track level as shown to the user: « Sol », « Pont +1 », « Tunnel −2 ». */
export function levelLabel(level: number): string {
  if (level > 0) return `Pont +${formatLevel(level)}`
  if (level < 0) return `Tunnel −${formatLevel(level)}`
  return 'Sol'
}

/**
 * Height of a selection, short enough for a slot of constant width: the name of the level when
 * all its nodes share one, « 0 à +1 » on a ramp or when they span several.
 */
export function levelRangeLabel(range: { min: number; max: number }): string {
  if (range.min === range.max) return levelLabel(range.min)
  const signed = (level: number) => (level > 0 ? `+${formatLevel(level)}` : level < 0 ? `−${formatLevel(level)}` : '0')
  return `${signed(range.min)} à ${signed(range.max)}`
}

/** Lowest and highest height among the given nodes, or null when none of them exists. */
export function nodeLevelRange(net: Network, nodeIds: Iterable<NodeId>): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const id of nodeIds) {
    const node = net.nodes.get(id)
    if (!node) continue
    const level = nodeLevel(node)
    if (level < min) min = level
    if (level > max) max = level
  }
  return min <= max ? { min, max } : null
}

/** Lowest and highest height among the nodes of the given rails, or null when none of them exists. */
export function levelRange(net: Network, segmentIds: Iterable<SegmentId>): { min: number; max: number } | null {
  const nodeIds = new Set<NodeId>()
  for (const id of segmentIds) {
    const seg = net.segments.get(id)
    if (!seg) continue
    nodeIds.add(seg.from)
    nodeIds.add(seg.to)
  }
  return nodeLevelRange(net, nodeIds)
}

/** What the inspector says about the slope of a rail */
export interface RampSummary {
  /** Level at the `from` end and at the `to` end, as `levelLabel` names them */
  from: string
  to: string
  /** Height climbed (always positive), in the display unit */
  rise: string
  /** Slope in ‰, rounded, with the way it goes from `from` to `to`: « 35 ‰ en montée » */
  gradient: string
  /** Steeper than the maximum slope of the project */
  tooSteep: boolean
}

/**
 * Slope of a rail for the inspector, or null when it is flat (on the ground, a bridge or in a
 * tunnel): a flat rail shows nothing more than its level.
 */
export function rampSummary(
  net: Network,
  seg: Segment,
  settings: { levelHeight: number; maxGradient: number; unit: Unit },
): RampSummary | null {
  const ends = segmentEndLevels(net, seg)
  if (ends.from === ends.to) return null
  const permille = segmentGradient(net, seg, settings.levelHeight)
  return {
    from: levelLabel(ends.from),
    to: levelLabel(ends.to),
    rise: formatDistance(Math.abs(ends.to - ends.from) * settings.levelHeight, settings.unit),
    gradient: `${Math.round(Math.abs(permille))} ‰ ${permille > 0 ? 'en montée' : 'en descente'}`,
    // Same tolerance as the diagnostic (`analyzeKinematics`): both agree on what is too steep
    tooSteep: Math.abs(permille) > settings.maxGradient + 1e-6,
  }
}
