import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { ExampleBuilder, EAST, WEST } from './builder'

const LINE = { lineSpeed: 160, lineType: 'classic' } as const
const HALF_SPACING = 1.9
/** Track 3 lies this far south of track 2: the width of a platform between them */
const TRACK_3_OFFSET = 9
const LINE_END = -2400
const BUFFERS = 450
/** The station — its throat and its platform tracks — is run at this speed at most, from here on */
const STATION_FROM = -420

/**
 * « Terminus »: a double-track line ends in three platform tracks with buffer stops. Trains keep
 * to the left: they arrive on the northern track, which a crossover in the throat joins to the
 * southern one, and leave on the southern track. A path signal stands before the throat for the
 * arrivals and at the end of each platform track for the departures.
 */
export function build(): SerializedProject {
  const b = new ExampleBuilder()
  const [arrivalStart] = b.track([[LINE_END, -HALF_SPACING], [BUFFERS, -HALF_SPACING]])
  const [departureEnd, fork] = b.track([[LINE_END, HALF_SPACING], [-150, HALF_SPACING], [BUFFERS, HALF_SPACING]])
  const arrival = b.net.segments.get(b.net.adjacency.get(arrivalStart.id)![0])!
  const departure = b.net.segments.get(b.net.adjacency.get(departureEnd.id)![0])!

  // Crossover in the throat, from the arrival track to the departure track, then the points of track 3
  b.crossover(arrival, departure, -200, -HALF_SPACING, 6)
  const track3 = b.turnout(fork, EAST, 120, TRACK_3_OFFSET)
  const track3Y = HALF_SPACING + TRACK_3_OFFSET
  b.straight(track3.end, b.node(BUFFERS, track3Y))
  b.settle()

  // The station is run at the speed of its slowest points
  const throat = [...b.net.junctions.values()]
  const speed = Math.min(60, ...throat.map((junction) => b.divergingSpeed(junction, LINE)))
  b.zone([STATION_FROM, -HALF_SPACING], [BUFFERS, -HALF_SPACING], speed)
  b.zone([STATION_FROM, HALF_SPACING], [BUFFERS, HALF_SPACING], speed)
  b.zone(b.divergingRail(track3.junction), [BUFFERS, track3Y], speed)
  const [crossoverIn, crossoverOut] = throat.filter((junction) => junction !== track3.junction)
  b.zone(b.divergingRail(crossoverIn), b.divergingRail(crossoverOut), speed)
  b.nameTrack(200, -HALF_SPACING, 'Voie 1', 'station_stop')
  b.nameTrack(200, HALF_SPACING, 'Voie 2', 'station_stop')
  b.nameTrack(200, track3Y, 'Voie 3', 'station_stop')

  // Arrivals: a block signal on the line, then the path signal before the throat
  b.signal(-1900, -HALF_SPACING, EAST, 'spacing')
  b.signal(-300, -HALF_SPACING, EAST, 'protection')
  // Departures: a path signal at the end of each platform track, then a block signal on the line
  for (const y of [-HALF_SPACING, HALF_SPACING, track3Y]) b.signal(0, y, WEST, 'protection')
  b.signal(-450, HALF_SPACING, WEST, 'spacing')

  // The train has arrived on track 3, nose at the buffer stop; the points are set for it to leave
  b.setPoints(track3.junction, 'diverging')
  b.trainset(BUFFERS - 20, track3Y, EAST)

  return b.finish({ name: 'Terminus', line: LINE, camera: { x: BUFFERS - 118, y: 4, scale: 4 } })
}
