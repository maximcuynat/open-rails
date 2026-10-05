import { segmentLevel } from '@domain/models/network'
import type { Network, SegmentId } from '@domain/models/types'

/** Name of a track level as shown to the user: « Sol », « Pont +1 », « Tunnel −2 ». */
export function levelLabel(level: number): string {
  if (level > 0) return `Pont +${level}`
  if (level < 0) return `Tunnel −${-level}`
  return 'Sol'
}

/** Lowest and highest level among the given rails, or null when none of them exists. */
export function levelRange(net: Network, segmentIds: Iterable<SegmentId>): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const id of segmentIds) {
    const seg = net.segments.get(id)
    if (!seg) continue
    const level = segmentLevel(seg)
    if (level < min) min = level
    if (level > max) max = level
  }
  return min <= max ? { min, max } : null
}
