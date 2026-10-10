import type { EditorStore } from '@application/state/editorStore'
import { doubleSlipView, turnoutView } from '@domain/models/junction'
import { positionOnSegment } from '@domain/models/locomotive'
import { junctionsAhead, trainRouteStart } from '@domain/models/train'
import type { Junction, Point } from '@domain/models/types'
import { TRAIN_AHEAD_REACH } from './consoleContract'

// What the dispatcher reads off the store while trains run: the points ahead of the driven
// trains for the board, and the marks the canvas draws (every set of points, the driver of every
// driven train). Read-only: throwing points stays `store.toggleActiveJunction`.

/** A set of points ahead of a driven train */
export interface PointsAhead {
  junctionId: string
  /** Rank of the train it lies ahead of */
  trainRank: number
  /** Metres from the leading end of that train */
  distance: number
  /** Which way it lies: `straight`, `diverging`, `left`, `right`; null for a table that is no turnout */
  branch: string | null
  lock: 'occupied' | 'reserved' | null
  /** Where it is, world metres */
  x: number
  y: number
}

/** The points on the route of every driven train, as far ahead as another train is looked for */
export function pointsAhead(store: EditorStore): PointsAhead[] {
  if (!store.isPlayMode) return []
  const net = store.network
  const found: PointsAhead[] = []
  store.trains.forEach((train, index) => {
    if (store.driverOf(train.id) === null) return
    for (const { junction, distance } of junctionsAhead(net, train, TRAIN_AHEAD_REACH)) {
      const node = net.nodes.get(junction.nodeId)
      if (!node) continue
      found.push({
        junctionId: junction.id,
        trainRank: index + 1,
        distance,
        branch: doubleSlipView(junction) ? null : turnoutView(net, junction)?.activeBranch ?? null,
        // Points held for the train that runs towards them are that train's to set
        lock: store.junctionLock(junction, train.id),
        x: node.pos.x,
        y: node.pos.y,
      })
    }
  })
  return found
}

/** A set of points as the canvas marks it while trains run */
export interface PointsPlace {
  junction: Junction
  x: number
  y: number
  thrown: boolean
  locked: boolean
}

/** Every set of points of the network, where it is and how it lies */
export function pointsPlaces(store: EditorStore): PointsPlace[] {
  const net = store.network
  const places: PointsPlace[] = []
  for (const junction of net.junctions.values()) {
    const node = net.nodes.get(junction.nodeId)
    if (!node || junction.positions.length < 2) continue
    places.push({ junction, x: node.pos.x, y: node.pos.y, thrown: junction.active !== 0, locked: store.junctionLock(junction) !== null })
  }
  return places
}

/** The set of points nearest to a place, within `radius` metres */
export function pointsNear(store: EditorStore, at: Point, radius: number): Junction | null {
  let best: Junction | null = null
  let bestDistance = radius
  for (const junction of store.network.junctions.values()) {
    const node = store.network.nodes.get(junction.nodeId)
    if (!node || junction.positions.length < 2) continue
    const d = Math.hypot(node.pos.x - at.x, node.pos.y - at.y)
    if (d <= bestDistance) {
      best = junction
      bestDistance = d
    }
  }
  return best
}

/** The driver of every driven train, at its leading end */
export function driverPlaces(store: EditorStore): { x: number; y: number; label: string; host: boolean }[] {
  if (!store.isPlayMode) return []
  const places: { x: number; y: number; label: string; host: boolean }[] = []
  for (const train of store.trains) {
    const driver = store.driverOf(train.id)
    const label = store.driverName(driver)
    const lead = trainRouteStart(train)
    const at = lead ? positionOnSegment(store.network, lead.segId, lead.t) : null
    if (label && at) places.push({ x: at.x, y: at.y, label, host: driver === 'host' })
  }
  return places
}
