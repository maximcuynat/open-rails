import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { ExampleBuilder, EAST, WEST } from './builder'

/** A secondary line */
const LINE = { lineSpeed: 100, lineType: 'classic' } as const
/** The loop track lies this far (m) south of the main track */
const LOOP_OFFSET = 8
/** The points of the loop are at ±POINTS on the main track; each branch reaches the loop track ADVANCE metres further in */
const POINTS = 500
const ADVANCE = 120
/** The exit signals stand at ±EXIT, where the two tracks are a full track spacing apart */
const EXIT = 370

/**
 * « Voie unique avec évitement »: a single track with one passing loop and a train on each side.
 * Signalled the French way (`tasks/recherche-voie-unique.md`): an exit signal at the end of each
 * loop track for each direction, an entry signal before each set of points, nothing in between —
 * a train is only let onto the single track when no train is on it or routed onto it.
 */
export function build(): SerializedProject {
  const b = new ExampleBuilder()
  const [, west, east] = b.track([[-2500, 0], [-POINTS, 0], [POINTS, 0], [2500, 0]])
  const westPoints = b.turnout(west, EAST, ADVANCE, LOOP_OFFSET)
  const eastPoints = b.turnout(east, WEST, ADVANCE, -LOOP_OFFSET)
  b.straight(westPoints.end, eastPoints.end)
  b.settle()

  // The loop track is run at the speed of its points
  const loopSpeed = Math.min(b.divergingSpeed(westPoints.junction, LINE), b.divergingSpeed(eastPoints.junction, LINE))
  b.zone(b.divergingRail(westPoints.junction), b.divergingRail(eastPoints.junction), loopSpeed, [0, LOOP_OFFSET])
  b.nameTrack(0, 0, 'Voie directe', 'station_stop')
  b.nameTrack(0, LOOP_OFFSET, 'Voie d’évitement', 'siding')

  // Entry signal before each set of points, exit signal at each end of each loop track
  b.signal(-POINTS - 10, 0, EAST, 'protection')
  b.signal(POINTS + 10, 0, WEST, 'protection')
  for (const y of [0, LOOP_OFFSET]) {
    b.signal(EXIT, y, EAST, 'protection')
    b.signal(-EXIT, y, WEST, 'protection')
  }

  // The driven train comes from the west; the other one waits in the east, facing it
  b.trainset(-1300, 0, EAST)
  b.trainset(1300, 0, WEST)

  return b.finish({ name: 'Voie unique avec évitement', line: LINE, camera: { x: -1398, y: 0, scale: 4 } })
}
