import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { ExampleBuilder, EAST } from './builder'

const LINE = { lineSpeed: 160, lineType: 'classic' } as const
const HALF_SPACING = 1.9
/** The flyover track runs this far north of the eastbound track while it climbs */
const RAMP_OFFSET = 28
/** Length of each ramp (m): one level — 6 m — at 25 ‰ */
const RAMP_LENGTH = 240
/** Radius (m) and angle (degrees) of the curve that takes the track over the line, and of the one that brings it back */
const CURVE_RADIUS = 500
const CURVE_TURN = 35

/**
 * « Saut-de-mouton »: a track leaves the eastbound track of a double-track line to the north,
 * climbs one level, crosses both tracks on a bridge and comes back down to the south — a branch
 * to the right that never meets the westbound trains.
 */
export function build(): SerializedProject {
  const b = new ExampleBuilder()
  const [, fork] = b.track([[-1500, -HALF_SPACING], [0, -HALF_SPACING], [2500, -HALF_SPACING]])
  b.track([[-1500, HALF_SPACING], [2500, HALF_SPACING]])

  const points = b.turnout(fork, EAST, 250, -RAMP_OFFSET)
  const foot = points.end
  const top = b.node(foot.pos.x + RAMP_LENGTH, foot.pos.y, 1)
  const bridgeStart = b.node(top.pos.x + 30, top.pos.y, 1)
  b.straight(foot, top)
  b.straight(top, bridgeStart)
  // The whole curve over the line is on the bridge, one level up
  const over = b.arc(bridgeStart, EAST, CURVE_RADIUS, CURVE_TURN)
  const bottom = b.node(
    over.end.pos.x + over.direction.x * RAMP_LENGTH,
    over.end.pos.y + over.direction.y * RAMP_LENGTH,
  )
  b.straight(over.end, bottom)
  const back = b.arc(bottom, over.direction, CURVE_RADIUS, -CURVE_TURN)
  b.straight(back.end, b.node(back.end.pos.x + 600, back.end.pos.y))
  b.settle()

  // The branch is run at the speed of its points as far as the foot of the ramp. They are set for
  // the flyover: the train before them takes it
  b.zone(b.divergingRail(points.junction), [foot.pos.x, foot.pos.y], b.divergingSpeed(points.junction, LINE))
  b.setPoints(points.junction, 'diverging')
  b.trainset(-30, -HALF_SPACING, EAST)

  return b.finish({ name: 'Saut-de-mouton', line: LINE, camera: { x: -128, y: -2, scale: 4 } })
}
