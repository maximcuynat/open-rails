import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { ExampleBuilder, EAST, WEST } from './builder'
import type { Point } from '@domain/models/types'

/** A high-speed line run at 300 km/h */
const LINE = { lineSpeed: 300, lineType: 'highSpeed' } as const
/** Half the distance between the two through tracks (4.5 m apart, as on a high-speed line) */
const HALF_SPACING = 2.25
/** A platform track lies this far outside its through track: the station reads as four tracks from afar */
const LOOP_OFFSET = 10
/** The points of the platform tracks are at ±POINTS; each branch reaches its platform track ADVANCE metres further in */
const POINTS = 650
const ADVANCE = 350
/** The exit signals stand at ±EXIT, before the points that lead back to the through tracks */
const EXIT = 290
/**
 * Where the signals of the open line stand, in the direction of travel with the station at 0. A
 * train braking from 300 km/h at 0.7 m/s² needs 4 960 m: every block is at least that long, so the
 * signal that protects the points of the station is far ahead of them.
 */
const ENTRY = -4700
const BLOCK_BEFORE = -9800
const BLOCK_AFTER = 5800
const LINE_END = 11000

/**
 * « Gare de passage (type Aix-en-Provence TGV) »: a through station on a high-speed double track —
 * two centre tracks without platform, and a platform track on each side reached by points. Trains
 * keep to the left: the northern through track runs east, the southern one west.
 */
export function build(): SerializedProject {
  const b = new ExampleBuilder()

  // One direction of travel: its through track, its platform track on the outside, its signals
  const direction = (along: Point, y: number, outside: number) => {
    const s = along.x
    const [, entry, exit] = b.track([[-s * LINE_END, y], [-s * POINTS, y], [s * POINTS, y], [s * LINE_END, y]])
    const inPoints = b.turnout(entry, along, ADVANCE, s * outside)
    const outPoints = b.turnout(exit, { x: -along.x, y: 0 }, ADVANCE, -s * outside)
    b.straight(inPoints.end, outPoints.end)
    return { y, platformY: y + outside, along, inPoints, outPoints }
  }
  const eastbound = direction(EAST, -HALF_SPACING, -LOOP_OFFSET)
  const westbound = direction(WEST, HALF_SPACING, LOOP_OFFSET)
  b.settle()

  for (const way of [eastbound, westbound]) {
    const s = way.along.x
    // The platform track is run at the speed of its points
    const speed = Math.min(b.divergingSpeed(way.inPoints.junction, LINE), b.divergingSpeed(way.outPoints.junction, LINE))
    b.zone(b.divergingRail(way.inPoints.junction), b.divergingRail(way.outPoints.junction), speed, [0, way.platformY])

    // Block signals on the open line, path signals before the points: the entry far ahead, an exit on each track
    b.signal(s * BLOCK_BEFORE, way.y, way.along, 'spacing')
    b.signal(s * ENTRY, way.y, way.along, 'protection')
    b.signal(s * EXIT, way.y, way.along, 'protection')
    b.signal(s * EXIT, way.platformY, way.along, 'protection')
    b.signal(s * BLOCK_AFTER, way.y, way.along, 'spacing')
  }
  b.nameTrack(0, eastbound.y, 'Voie 1', 'circulation')
  b.nameTrack(0, westbound.y, 'Voie 2', 'circulation')
  b.nameTrack(0, eastbound.platformY, 'Voie A', 'station_stop')
  b.nameTrack(0, westbound.platformY, 'Voie B', 'station_stop')

  // The driven train stands at the eastbound platform, its points set for it to leave; a second
  // one waits on the through track, west of the station
  b.setPoints(eastbound.outPoints.junction, 'diverging')
  b.trainset(EXIT - 40, eastbound.platformY, EAST)
  b.trainset(-POINTS - 500, eastbound.y, EAST)

  return b.finish({
    name: 'Gare de passage (type Aix-en-Provence TGV)',
    line: LINE,
    camera: { x: EXIT - 138, y: -6, scale: 4 },
  })
}
