import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { curveCant } from '@domain/models/speedLimits'
import { ExampleBuilder, EAST } from './builder'

const LINE = { lineSpeed: 120, lineType: 'classic' } as const
/** Each ramp climbs four levels — 24 m — over this length (m): 35 ‰, the steepest slope of the project */
const RAMP_LENGTH = 686
const SUMMIT_LEVEL = 4
/** The curve at the summit: a quarter turn of this radius (m) */
const CURVE_RADIUS = 250
/** The speed zone of the curve starts and ends this far (m) from it */
const ZONE_MARGIN = 50

/**
 * « Rampe et courbe »: a mountain stretch. A 35 ‰ ramp up to a summit, a tight curve on it — laid
 * with the cant the line gives it, and limited to the speed that cant allows — then the same slope
 * down the other side.
 */
export function build(): SerializedProject {
  const b = new ExampleBuilder()
  const rampFoot = 1500
  const rampTop = rampFoot + RAMP_LENGTH
  const curveStart = rampTop + 250
  const [, , , summit] = b.track([[0, 0], [rampFoot, 0], [rampTop, 0, SUMMIT_LEVEL], [curveStart, 0, SUMMIT_LEVEL]])
  const curve = b.arc(summit, EAST, CURVE_RADIUS, 90)
  const x = curve.end.pos.x
  const y = curve.end.pos.y
  const [descentTop, descentFoot, end] = [
    b.node(x, y + 150, SUMMIT_LEVEL),
    b.node(x, y + 150 + RAMP_LENGTH),
    b.node(x, y + 150 + RAMP_LENGTH + 600),
  ]
  b.straight(curve.end, descentTop)
  b.straight(descentTop, descentFoot)
  b.straight(descentFoot, end)
  b.settle()
  // The line settings decide the cant of the curve, and so its speed
  b.store.setLineSettings(LINE)

  // The curve is limited to the speed its cant allows, brought down to a zone speed (a multiple of 10)
  const curved = [...b.net.segments.values()].filter((seg) => seg.kind === 'curve')
  const allowed = Math.min(...curved.map((seg) => curveCant(b.net, seg, b.store.lineSettings)?.maxSpeed ?? Infinity))
  b.zone([curveStart - ZONE_MARGIN, 0], [x, y + ZONE_MARGIN], Math.floor(allowed / 10) * 10)

  b.trainset(260, 0, EAST)

  return b.finish({ name: 'Rampe et courbe', line: LINE, camera: { x: 160, y: 0, scale: 4 } })
}
