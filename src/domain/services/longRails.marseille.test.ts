import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deserializeNetwork, serializeNetwork, type SerializedProject } from '@infrastructure/persistence/persistence'
import { positionOnSegment, segmentArcLength } from '../models/locomotive'
import { addSignal } from '../models/signals'
import { syncJunctions } from '../models/junction'
import { reconcileNetworkIntersections } from '../geometry/reconcile'
import { analyzeKinematics } from './kinematicDiagnostics'
import { mergeIntoLongRails } from './longRails'
import { fitPath } from '../geometry/arcFit'
import type { Network } from '../models/types'

const marseille: SerializedProject = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../examples/marseille-saint-charles.json', import.meta.url)), 'utf8'),
)
const TOLERANCE = 0.3

const totalLength = (net: Network): number => [...net.segments.keys()].reduce((sum, id) => sum + segmentArcLength(net, id), 0)
const kinds = (net: Network): Record<string, number> => {
  const count: Record<string, number> = {}
  for (const junction of net.junctions.values()) count[junction.kind] = (count[junction.kind] ?? 0) + 1
  return count
}

describe('Marseille Saint-Charles in long rails', () => {
  const net = deserializeNetwork(marseille).network
  syncJunctions(net)
  const before = { rails: net.segments.size, nodes: net.nodes.size, length: totalLength(net), junctions: kinds(net) }

  // A signal every few rails, to see where the places of the track end up
  const places: { id: string; x: number; y: number }[] = []
  let k = 0
  for (const seg of [...net.segments.values()]) {
    if (k++ % 7 !== 0) continue
    const placed = addSignal(net, { segId: seg.id, t: 0.37 }, true, 'spacing')
    if (!placed.ok) continue
    const at = positionOnSegment(net, seg.id, 0.37)!
    places.push({ id: placed.signal.id, x: at.x, y: at.y })
  }

  const result = mergeIntoLongRails(net, { fit: fitPath, tolerance: TOLERANCE, cutStraightsOver: 0 })
  syncJunctions(net)

  it('has several times fewer rails and nodes, for the same track', () => {
    expect(before.rails).toBe(1503)
    expect(result.after).toBeLessThan(before.rails / 3)
    expect(net.nodes.size).toBeLessThan(before.nodes / 3)
    expect(Math.abs(totalLength(net) - before.length) / before.length).toBeLessThan(0.001)
    // eslint-disable-next-line no-console
    console.log(`Marseille: ${before.rails} rails → ${result.after}, ${before.nodes} nodes → ${net.nodes.size}`)
  })

  it('keeps every set of points as it was read', () => {
    expect(kinds(net)).toEqual(before.junctions)
  })

  it('leaves every place of the track where it was, within the tolerance of the fit', () => {
    expect(places.length).toBeGreaterThan(100)
    let worst = 0
    for (const place of places) {
      const signal = net.signals.get(place.id)!
      const at = positionOnSegment(net, signal.segId, signal.t)!
      worst = Math.max(worst, Math.hypot(at.x - place.x, at.y - place.y))
    }
    // Off the old track by the tolerance at most, and along it by what the lengths differ
    expect(worst).toBeLessThan(2 * TOLERANCE + 0.5)
  })

  it('is still a track trains can run: no kink, nothing to weld or cut', () => {
    expect(analyzeKinematics(net).filter((issue) => issue.severity === 'error')).toEqual([])
    const rails = net.segments.size
    expect(reconcileNetworkIntersections(net, 0.1)).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(net.segments.size).toBe(rails)
  })

  it('is saved and read back the same', () => {
    const back = deserializeNetwork(JSON.parse(JSON.stringify(serializeNetwork(net, 'Marseille')))).network
    expect(back.segments.size).toBe(net.segments.size)
    expect(totalLength(back)).toBeCloseTo(totalLength(net), 3)
  })
})
