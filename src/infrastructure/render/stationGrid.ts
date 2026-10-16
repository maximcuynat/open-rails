import { createNetwork, addNode, addSegment, addCurveSegment } from '@domain/models/network'
import { syncJunctions } from '@domain/models/junction'
import type { Network } from '@domain/models/types'
import type { SerializedProject } from '@infrastructure/persistence/persistence'

/**
 * `copies` × `copies` copies of one station side by side, `pitch` metres apart: the same track,
 * turnouts included, at the size of a whole region. Speed zones are left out. The benches build
 * it in Node (`benchNetworks.ts`), the frame bench in the page (`presentation/dev/frameBench.ts`).
 */
export function stationGrid(station: Pick<SerializedProject, 'nodes' | 'segments'>, copies: number, pitch: number): Network {
  const net = createNetwork()
  for (let row = 0; row < copies; row++) {
    for (let col = 0; col < copies; col++) {
      const ids = new Map<string, string>()
      for (const node of station.nodes) {
        ids.set(node.id, addNode(net, { x: node.x + col * pitch, y: node.y + row * pitch }).id)
      }
      for (const seg of station.segments) {
        const from = ids.get(seg.from)!
        const to = ids.get(seg.to)!
        if (seg.via) addCurveSegment(net, from, to, { x: seg.via.x + col * pitch, y: seg.via.y + row * pitch })
        else addSegment(net, from, to)
      }
    }
  }
  syncJunctions(net)
  return net
}
