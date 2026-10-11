import { deserializeNetwork, type SerializedProject } from '@infrastructure/persistence/persistence'
import { speedZonesOnRail } from '@domain/models/speedZones'
import { trackProfile } from '@domain/models/trackSpeed'
import type { LineType } from '@domain/models/speedLimits'

/** A rail whose limit is this share, or less, of the limit of the rails on both sides is a dip */
const DIP_SHARE = 0.7

export interface SpeedDips {
  rails: number
  /** Rails much slower than the two rails they lie between, on plain track */
  dips: number
  /** …of which the rails that lie under a speed zone, and those that lie under none */
  underZone: number
  withoutZone: number
}

/**
 * The rails of a project file whose speed limit falls well under that of both their neighbours:
 * what a driver sees as a limit that drops for a few metres and comes back. Read the way the
 * editor reads a limit: line speed, zones, curve.
 */
export function speedDips(project: SerializedProject): SpeedDips {
  const net = deserializeNetwork(project).network
  const lineSpeed = project.lineSpeed ?? 160
  const profile = trackProfile(net, { lineSpeed, lineType: (project.lineType ?? 'classic') as LineType, gauge: project.gauge })
  const limits = new Map<string, { limit: number; zoned: boolean }>()
  for (const seg of net.segments.values()) {
    let limit = Math.min(lineSpeed, profile.rails.get(seg.id)?.maxSpeed ?? Infinity)
    const stretches = speedZonesOnRail(net, seg.id)
    for (const stretch of stretches) limit = Math.min(limit, stretch.zone.speed)
    limits.set(seg.id, { limit, zoned: stretches.length > 0 })
  }
  const beyond = (nodeId: string, segId: string): string | null => {
    const rails = net.adjacency.get(nodeId)
    if (!rails || rails.length !== 2) return null
    for (const id of rails) if (id !== segId) return id
    return null
  }
  const out: SpeedDips = { rails: net.segments.size, dips: 0, underZone: 0, withoutZone: 0 }
  for (const seg of net.segments.values()) {
    const a = beyond(seg.from, seg.id)
    const b = beyond(seg.to, seg.id)
    if (!a || !b) continue
    const own = limits.get(seg.id)!
    if (own.limit > DIP_SHARE * Math.min(limits.get(a)!.limit, limits.get(b)!.limit)) continue
    out.dips++
    if (own.zoned) out.underZone++
    else out.withoutZone++
  }
  return out
}
