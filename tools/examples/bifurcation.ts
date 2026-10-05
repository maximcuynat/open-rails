import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { ExampleBuilder, EAST, WEST, heading } from './builder'

const LINE = { lineSpeed: 160, lineType: 'classic' } as const
/** Half the distance between the two tracks of a line */
const HALF_SPACING = 1.9
/** The branch leaves the main line on an arc of this radius (m, its outer track), turning north by this angle */
const BRANCH_RADIUS = 800
const BRANCH_TURN = 25
const BRANCH_LENGTH = 1500
const LINE_END = 3000

/**
 * « Bifurcation »: a double-track branch leaves a double-track line on the level. Trains keep to
 * the left, so the track coming back from the branch crosses the eastbound main track on a diamond
 * before it joins the westbound one. A path signal stands before the points and the diamond on
 * each of the three tracks that lead to them.
 */
export function build(): SerializedProject {
  const b = new ExampleBuilder()
  const [, upFork] = b.track([[-LINE_END, -HALF_SPACING], [0, -HALF_SPACING], [LINE_END, -HALF_SPACING]])
  const [, downFork] = b.track([[-LINE_END, HALF_SPACING], [0, HALF_SPACING], [LINE_END, HALF_SPACING]])

  // The two tracks of the branch: concentric arcs out of the two main tracks, then straight
  const arcs = ([[upFork, BRANCH_RADIUS], [downFork, BRANCH_RADIUS + 2 * HALF_SPACING]] as const).map(([fork, radius]) => {
    const curve = b.arc(fork, EAST, radius, -BRANCH_TURN)
    const end = b.node(curve.end.pos.x + curve.direction.x * BRANCH_LENGTH, curve.end.pos.y + curve.direction.y * BRANCH_LENGTH)
    b.straight(curve.end, end)
    return { fork, end: curve.end }
  })
  b.settle()

  // Each arc of the branch is run at the speed of the points it leaves the main line by
  for (const arc of arcs) {
    const points = b.junctionAt(arc.fork.pos.x, arc.fork.pos.y)
    b.zone(b.divergingRail(points), [arc.end.pos.x, arc.end.pos.y], b.divergingSpeed(points, LINE))
  }

  // Eastbound: a block signal on the line, then the path signal before the points
  b.signal(-1500, -HALF_SPACING, EAST, 'spacing')
  b.signal(-20, -HALF_SPACING, EAST, 'protection')
  // Westbound on the main line: a block signal, then the path signal before the points the branch joins by
  b.signal(1600, HALF_SPACING, WEST, 'spacing')
  b.signal(30, HALF_SPACING, WEST, 'protection')
  // Coming back from the branch: the path signal before the diamond, on the inner arc
  const inner = BRANCH_RADIUS + 2 * HALF_SPACING
  const centreY = -HALF_SPACING - BRANCH_RADIUS
  const at = heading(-10)
  b.signal(inner * -at.y, centreY + inner * at.x, heading(170), 'protection')

  // The driven train runs east towards the points
  b.trainset(-700, -HALF_SPACING, EAST)

  return b.finish({ name: 'Bifurcation', line: LINE, camera: { x: -798, y: -2, scale: 4 } })
}
