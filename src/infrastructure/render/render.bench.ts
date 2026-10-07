import { test } from 'vitest'
import { verifyNetworkRevisions } from '@domain/models/networkWatch'
import { createCamera } from '@infrastructure/render/camera'
import { renderNetworkWithTrains } from '@infrastructure/render/renderer'
import { DEFAULT_LINE_SETTINGS } from '@domain/models/speedLimits'
import { deserializeNetwork } from '@infrastructure/persistence/persistence'
import { buildStations, buildYard, marseille, STATION_CENTRE, STATION_PITCH } from './benchNetworks'

/**
 * Time of one frame of the network at several zooms. Run with `npm run bench`; not part of
 * `npm test`. Only the JavaScript side is measured (the canvas is a stub): what the browser
 * spends rasterising comes on top, roughly in proportion to the number of strokes.
 */

// Measured as the editor runs: without the check of the revisions the tests add
verifyNetworkRevisions(false)

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

const VW = 1920
const VH = 1080
/** Camera scales in px/m: detailed, edge of the line drawing, line, edge of the schematic, schematic */
const ZOOMS = [8, 2.5, 1, 0.4, 0.1]
const selection = { nodes: new Set<string>(), segments: new Set<string>() }
/**
 * Cant and slope marks are drawn, as they are by default in the editor (the curves of the yard get
 * a cant; it has no ramp). `BENCH_NO_INCLINATION=1` leaves them out, to measure what they cost.
 */
const options = {
  gauge: 1.435,
  gradient: { levelHeight: 6, maxGradient: 0.035 },
  ...(process.env.BENCH_NO_INCLINATION ? {} : { inclination: { line: DEFAULT_LINE_SETTINGS } }),
}

for (const [lines, perLine] of [[20, 50], [40, 100]] as const) {
  const net = buildYard(lines, perLine)
  const ctx = stubCtx()
  test(`${net.segments.size} rails`, async ({ bench }) => {
    await bench.compare(
      ...ZOOMS.map((scale) => {
        const cam = createCamera((perLine * 30) / 2, (lines * 6) / 2, scale)
        return bench(`${scale} px/m`, () => {
          renderNetworkWithTrains(ctx, cam, VW, VH, net, selection, undefined, options, () => {})
        })
      }),
    )
  })
}

// ─────────────────── A real station: the Marseille Saint-Charles example ───────────────────

/** Scales of the three drawings of the station: schematic, line (fit to the window), detail with most of it in view */
const STATION_ZOOMS = [0.3, 0.7, 2.2]

{
  const net = deserializeNetwork(marseille).network
  const ctx = stubCtx()
  test(`Marseille Saint-Charles, ${net.segments.size} rails, ${net.speedZones.size} speed zones`, async ({ bench }) => {
    await bench.compare(
      ...STATION_ZOOMS.map((scale) => {
        const cam = createCamera(STATION_CENTRE.x, STATION_CENTRE.y, scale)
        return bench(`${scale} px/m`, () => {
          renderNetworkWithTrains(ctx, cam, VW, VH, net, selection, undefined, options, () => {})
        })
      }),
    )
  })
}

// 9 stations, then 81: about 122 000 rails, the size of a national network
for (const copies of [3, 9]) {
  const net = buildStations(copies)
  const ctx = stubCtx()
  const middle = ((copies - 1) * STATION_PITCH) / 2
  test(`${copies * copies} stations, ${net.segments.size} rails`, async ({ bench }) => {
    // Whole region in the window, then one station among the others at the three scales
    await bench.compare(
      ...[0.6 / copies, ...STATION_ZOOMS].map((scale) => {
        const cam = createCamera(STATION_CENTRE.x + middle, STATION_CENTRE.y + middle, scale)
        return bench(`${scale} px/m`, () => {
          renderNetworkWithTrains(ctx, cam, VW, VH, net, selection, undefined, options, () => {})
        })
      }),
    )
  })
}
