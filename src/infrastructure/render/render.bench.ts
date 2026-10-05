import { bench, describe } from 'vitest'
import { createCamera } from '@infrastructure/render/camera'
import { createNetwork, addNode, addSegment, addCurveSegment } from '@domain/models/network'
import { renderNetworkWithTrains } from '@infrastructure/render/renderer'
import type { Network } from '@domain/models/types'

/**
 * Time of one frame of the network at several zooms. Run with `npm run bench`; not part of
 * `npm test`. Only the JavaScript side is measured (the canvas is a stub): what the browser
 * spends rasterising comes on top, roughly in proportion to the number of strokes.
 */

/** A canvas that accepts every call and records nothing */
function stubCtx(): CanvasRenderingContext2D {
  const noop = (): void => {}
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop === 'canvas') return undefined
      if (prop === 'measureText') return () => ({ width: 40 })
      return prop in target ? target[prop] : noop
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

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

const VW = 1920
const VH = 1080
/** Camera scales in px/m: detailed, edge of the line drawing, line, edge of the schematic, schematic */
const ZOOMS = [8, 2.5, 1, 0.4, 0.1]
const selection = { nodes: new Set<string>(), segments: new Set<string>() }
const options = { gauge: 1.435, gradient: { levelHeight: 6, maxGradient: 0.035 } }

for (const [lines, perLine] of [[20, 50], [40, 100]] as const) {
  const net = buildYard(lines, perLine)
  const ctx = stubCtx()
  describe(`${net.segments.size} rails`, () => {
    for (const scale of ZOOMS) {
      const cam = createCamera((perLine * 30) / 2, (lines * 6) / 2, scale)
      bench(`${scale} px/m`, () => {
        renderNetworkWithTrains(ctx, cam, VW, VH, net, selection, undefined, options, () => {})
      })
    }
  })
}
