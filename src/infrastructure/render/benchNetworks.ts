import { createNetwork, addNode, addSegment, addCurveSegment } from '@domain/models/network'
import type { Network } from '@domain/models/types'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { syncJunctions } from '@domain/models/junction'

/** Networks of the benches (`*.bench.ts`): never imported by the application. */

/** `lines` parallel tracks 6 m apart, each of `perLine` rails of 30 m, one curve in three, one line in five on a bridge */
export function buildYard(lines: number, perLine: number): Network {
  const net = createNetwork()
  for (let l = 0; l < lines; l++) {
    const y = l * 6
    let prev = addNode(net, { x: 0, y })
    if (l % 5 === 0) prev.level = 1
    for (let i = 1; i <= perLine; i++) {
      const next = addNode(net, { x: i * 30, y: y + (i % 4 === 0 ? 0.4 : 0) })
      if (l % 5 === 0) next.level = 1
      if (i % 3 === 0) addCurveSegment(net, prev.id, next.id, { x: i * 30 - 15, y: y + 0.3 })
      else addSegment(net, prev.id, next.id)
      prev = next
    }
  }
  return net
}

/** A real station: the Marseille Saint-Charles example */
export const marseille: SerializedProject = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../examples/marseille-saint-charles.json', import.meta.url)), 'utf8'),
)

/** Distance between two copies of the station in `buildStations`, m */
export const STATION_PITCH = 1400

/** Middle of the station (m) */
export const STATION_CENTRE = { x: 500, y: -540 }

/**
 * `copies` × `copies` stations side by side, `pitch` metres apart: the same track, turnouts
 * included, at the size of a whole region. Speed zones are left out.
 */
export function buildStations(copies: number, pitch = STATION_PITCH): Network {
  const net = createNetwork()
  for (let row = 0; row < copies; row++) {
    for (let col = 0; col < copies; col++) {
      const ids = new Map<string, string>()
      for (const node of marseille.nodes) {
        ids.set(node.id, addNode(net, { x: node.x + col * pitch, y: node.y + row * pitch }).id)
      }
      for (const seg of marseille.segments) {
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
