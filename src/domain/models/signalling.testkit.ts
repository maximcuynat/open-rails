// Shared by the signalling tests: small layouts, trains and a way to run them by hand.

import { addNode, addSegment, createNetwork } from './network'
import { snapToNearestTrack } from './locomotive'
import { syncJunctions } from './junction'
import { findJunctionAtNode } from './routing'
import { addSignal, type SignallingSettings } from './signals'
import type { Junction, Network, Point, RailNode, Segment, Signal, SignalRole } from './types'
import { advanceTrainSet, createVehicle, makeTrainSet, type TrainSet } from './train'
import { type SignalPassing, type SignallingState } from './signalling'
import { tickSignalling, type TickSignallingOptions } from './trainSignalling'

/** Lay rails through `points`, from `start` when given (the first point is then the next node) */
export function chain(net: Network, points: Point[], start?: RailNode): { nodes: RailNode[]; rails: Segment[] } {
  const nodes: RailNode[] = start ? [start] : []
  const rails: Segment[] = []
  for (const point of points) {
    const node = addNode(net, point)
    const prev = nodes[nodes.length - 1]
    if (prev) rails.push(addSegment(net, prev.id, node.id)!)
    nodes.push(node)
  }
  return { nodes, rails }
}

/** A straight line along y = 0 from x = 0, in `count` rails of `length` m, laid west to east */
export function line(count: number, length: number): { net: Network; nodes: RailNode[]; rails: Segment[] } {
  const net = createNetwork()
  const points = Array.from({ length: count + 1 }, (_, i) => ({ x: i * length, y: 0 }))
  return { net, ...chain(net, points) }
}

/** The place of the track nearest to a point of the world */
export function at(net: Network, x: number, y = 0): { segId: string; t: number } {
  const hit = snapToNearestTrack(net, { x, y }, 1)
  if (!hit) throw new Error(`no track at ${x}, ${y}`)
  return { segId: hit.segId, t: hit.t }
}

/**
 * A signal at a point of the world for trains running `towards` east (growing x) or west. The
 * layouts of the tests are laid so that x never decreases along a rail from `from` to `to`… except
 * where a test says otherwise: the direction is read from the rail.
 */
export function signalAt(net: Network, x: number, y: number, towards: 'east' | 'west', role: SignalRole = 'spacing'): Signal {
  const place = at(net, x, y)
  const seg = net.segments.get(place.segId)!
  const eastward = net.nodes.get(seg.to)!.pos.x >= net.nodes.get(seg.from)!.pos.x
  const laid = addSignal(net, place, towards === 'east' ? eastward : !eastward, role)
  if (!laid.ok) throw new Error(`signal refused at ${x}, ${y}: ${laid.reason}`)
  return laid.signal
}

let trainCount = 0

/** A power car with its leading bogie at a point of the world, facing east or west, parked */
export function trainAt(net: Network, x: number, y: number, towards: 'east' | 'west', id?: string): TrainSet {
  const place = at(net, x, y)
  const seg = net.segments.get(place.segId)!
  const eastward = net.nodes.get(seg.to)!.pos.x >= net.nodes.get(seg.from)!.pos.x
  const vehicle = createVehicle(net, place.segId, place.t, 'loco', (towards === 'east') === eastward ? 1 : -1)
  if (!vehicle) throw new Error(`no room for a train at ${x}, ${y}`)
  return makeTrainSet(id ?? `train_test_${++trainCount}`, [vehicle])
}

/** Put a train in motion as far as the signalling is concerned: reverser forward, running at `speed` m/s */
export function drive(train: TrainSet, speed: number): TrainSet {
  train.reverser = 'forward'
  train.direction = 1
  train.currentSpeed = speed
  return train
}

/** Bring a train to a stand, reverser still forward */
export function halt(train: TrainSet): TrainSet {
  train.currentSpeed = 0
  return train
}

/**
 * Move `train` by `metres` in steps of at most `step` m, running the signalling after each one as
 * the simulation does. Stops early when the train cannot go on, or once its emergency brake is on.
 * Returns the signals passed on the way. `options` goes to `tickSignalling` (the line settings, for
 * what the pro level reads from them).
 */
export function run(
  net: Network,
  trains: TrainSet[],
  state: SignallingState,
  train: TrainSet,
  metres: number,
  settings?: SignallingSettings,
  step = 5,
  options?: TickSignallingOptions,
): SignalPassing[] {
  const passings: SignalPassing[] = []
  let left = metres
  while (left > 1e-9) {
    const move = Math.min(step, left)
    left -= move
    const moved = advanceTrainSet(net, train, move, trains)
    passings.push(...tickSignalling(net, trains, state, settings, undefined, options))
    if (!moved || train.emergencyBrake) break
  }
  return passings
}

/** x of the leading bogie of a train */
export function headX(net: Network, train: TrainSet): number {
  const lead = train.direction === 1 ? train.vehicles[0].front : train.vehicles[train.vehicles.length - 1].rear
  const seg = net.segments.get(lead.segId)!
  const a = net.nodes.get(seg.from)!.pos
  const b = net.nodes.get(seg.to)!.pos
  return a.x + (b.x - a.x) * lead.t
}

/** The route table the track has at a node, read from its geometry when it has none yet */
export function junctionAt(net: Network, node: RailNode): Junction {
  syncJunctions(net)
  const junction = findJunctionAtNode(net, node.id)
  if (!junction) throw new Error(`no junction at ${node.id}`)
  return junction
}

/** Set the points at `node` so that a train can pass between rails `a` and `b` */
export function setPoints(net: Network, node: RailNode, a: Segment, b: Segment): void {
  const junction = junctionAt(net, node)
  const index = junction.passages.findIndex((p) => (p.a === a.id && p.b === b.id) || (p.a === b.id && p.b === a.id))
  if (index < 0) throw new Error(`no passage between ${a.id} and ${b.id}`)
  const position = junction.positions.findIndex((open) => open.includes(index))
  junction.active = position
}

/**
 * Two parallel tracks laid west to east, A along y = 0 and B along y = 20, both 3 000 m long, with
 * a crossover leaving A at x = 1000 and joining B at x = 1400. A path signal for eastbound trains
 * stands on each at x = 900, and a block signal at x = 2500.
 */
export function crossoverLayout() {
  const net = createNetwork()
  const a = chain(net, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 3000, y: 0 }])
  const b = chain(net, [{ x: 0, y: 20 }, { x: 1400, y: 20 }, { x: 3000, y: 20 }])
  const crossover = addSegment(net, a.nodes[1].id, b.nodes[1].id)!
  syncJunctions(net)
  const pa = signalAt(net, 900, 0, 'east', 'protection')
  const pb = signalAt(net, 900, 20, 'east', 'protection')
  const sa = signalAt(net, 2500, 0, 'east')
  const sb = signalAt(net, 2500, 20, 'east')
  return {
    net,
    a,
    b,
    crossover,
    /** The points on A (facing for eastbound trains) and on B (trailing) */
    forkA: a.nodes[1],
    forkB: b.nodes[1],
    pa,
    pb,
    sa,
    sb,
    /** Set the points on A along A (`straight`) or to the crossover (`diverging`) */
    route(to: 'straight' | 'diverging') {
      setPoints(net, a.nodes[1], a.rails[0], to === 'straight' ? a.rails[1] : crossover)
      // The points on B are trailing for eastbound trains: set them the way the train comes
      setPoints(net, b.nodes[1], to === 'straight' ? b.rails[0] : crossover, b.rails[1])
    },
  }
}

/**
 * A single track between two passing loops, laid west to east along y = 0: a west station with two
 * tracks (the main one along y = 0, a siding along y = 20) joining at x = 1000, the single track to
 * x = 3000, and an east station with two tracks to x = 4000. Path signals stand at the exit of each
 * station track towards the single track, and at each end of the single track before the points.
 */
export function singleTrackLayout() {
  const net = createNetwork()
  const main = chain(net, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 3000, y: 0 }, { x: 4000, y: 0 }])
  const [westPoints, eastPoints] = [main.nodes[1], main.nodes[2]]
  const westSiding = chain(net, [{ x: 0, y: 20 }, { x: 600, y: 20 }])
  const westJoin = addSegment(net, westSiding.nodes[1].id, westPoints.id)!
  const eastSiding = chain(net, [{ x: 3400, y: 20 }, { x: 4000, y: 20 }])
  const eastJoin = addSegment(net, eastPoints.id, eastSiding.nodes[0].id)!
  syncJunctions(net)
  return {
    net,
    main,
    westPoints,
    eastPoints,
    westJoin,
    eastJoin,
    single: main.rails[1],
    /** Exits of the west station towards the single track */
    exitWestMain: signalAt(net, 900, 0, 'east', 'protection'),
    exitWestSiding: signalAt(net, 500, 20, 'east', 'protection'),
    /** Exits of the east station towards the single track */
    exitEastMain: signalAt(net, 3100, 0, 'west', 'protection'),
    exitEastSiding: signalAt(net, 3500, 20, 'west', 'protection'),
    /** Entries of the two stations, at the ends of the single track */
    entryEast: signalAt(net, 2900, 0, 'east', 'protection'),
    entryWest: signalAt(net, 1100, 0, 'west', 'protection'),
    /** Set the points of the west station to its main track or to its siding */
    west(to: 'main' | 'siding') {
      setPoints(net, westPoints, to === 'main' ? main.rails[0] : westJoin, main.rails[1])
    },
    east(to: 'main' | 'siding') {
      setPoints(net, eastPoints, main.rails[1], to === 'main' ? main.rails[2] : eastJoin)
    },
  }
}
