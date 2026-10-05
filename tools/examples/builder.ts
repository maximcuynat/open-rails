/**
 * What the example generators share: a store to build a network in, with the gestures of the editor
 * as functions (lay a straight rail, an arc, a turnout, a signal, a speed zone, a trainset), and the
 * project written out through the store's own export.
 *
 * Everything goes through the domain functions the tools of the editor call, so an example is a
 * network a user could have drawn.
 */
import { EditorStore } from '@application/state/editorStore'
import { resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'
import { createCamera } from '@infrastructure/render/camera'
import {
  applyCrossover,
  applyFreeformParallelTurnout,
  computeCrossoverPreview,
  computeFreeformParallelTurnout,
} from '@domain/geometry/constructionTemplates'
import { reconcileNetworkIntersections } from '@domain/geometry/reconcile'
import { findJunctionAtNode, setJunctionBranch, type TurnoutBranch } from '@domain/models/junction'
import { segmentTangentAt } from '@domain/geometry/tangent'
import { snapToNearestTrack } from '@domain/models/locomotive'
import { addArcCurve, addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { referenceConsist, type RollingStockModel } from '@domain/models/rollingStock'
import { computeTrackSections, type SectionType } from '@domain/models/sections'
import { addSignal, SIGNAL_REFUSAL_TEXT } from '@domain/models/signals'
import { addSpeedZone } from '@domain/models/speedZones'
import type { LineSettings } from '@domain/models/speedLimits'
import { turnoutDivergingSpeed } from '@domain/models/trackSpeed'
import { vehicleRearEndPos, type TrainSet } from '@domain/models/train'
import type { Junction, Network, Point, RailNode, Segment, Signal, SignalRole, SpeedZone } from '@domain/models/types'
import { signalForwardFor } from '@domain/services/signalLayout'
import { findTrackPath, type TrackPoint } from '@domain/services/trackPath'

/** Unit vector at `degrees` from the x axis (the y axis points down the screen: positive turns clockwise) */
export function heading(degrees: number): Point {
  const rad = (degrees * Math.PI) / 180
  return { x: Math.cos(rad), y: Math.sin(rad) }
}

export const EAST: Point = { x: 1, y: 0 }
export const WEST: Point = { x: -1, y: 0 }

export interface ExampleSettings {
  name: string
  line: Pick<LineSettings, 'lineSpeed' | 'lineType'>
  /**
   * What the example opens on: the centre of the view (world metres) and the zoom (pixels per
   * metre). The train to drive, whole: 4 px/m shows a 200 m trainset in a window 1 000 px wide.
   */
  camera: { x: number; y: number; scale: number }
}

export class ExampleBuilder {
  readonly store: EditorStore

  constructor() {
    resetMemoryStorage()
    resetIdCounter()
    this.store = new EditorStore()
  }

  get net(): Network {
    return this.store.network
  }

  private get tolerance(): number {
    return this.store.getPlacementThresholds().reconcileTolerance
  }

  // ─────────────────── Track ───────────────────

  node(x: number, y: number, level = 0): RailNode {
    return addNode(this.net, { x, y }, level)
  }

  straight(from: RailNode, to: RailNode): Segment {
    const seg = addSegment(this.net, from.id, to.id)
    if (!seg) throw new Error(`No rail laid between ${from.id} and ${to.id}`)
    return seg
  }

  /** A run of straight rails through the given places, one node at each: `[x, y]` or `[x, y, level]` */
  track(places: readonly (readonly [number, number, number?])[]): RailNode[] {
    const nodes = places.map(([x, y, level]) => this.node(x, y, level ?? 0))
    for (let i = 1; i < nodes.length; i++) this.straight(nodes[i - 1], nodes[i])
    return nodes
  }

  /**
   * A circular arc leaving `from` along `direction`, of `radius` metres, turning by `degrees`
   * (positive: clockwise on screen), at the height of `from`. Returns its end node and the
   * direction the track has there.
   */
  arc(from: RailNode, direction: Point, radius: number, degrees: number): { end: RailNode; direction: Point } {
    const turn = (degrees * Math.PI) / 180
    const side = Math.sign(turn)
    // Centre on the side the arc turns to; the control point is where the two end tangents meet
    const normal = { x: -direction.y * side, y: direction.x * side }
    const centre = { x: from.pos.x + normal.x * radius, y: from.pos.y + normal.y * radius }
    const cos = Math.cos(turn)
    const sin = Math.sin(turn)
    const spoke = { x: from.pos.x - centre.x, y: from.pos.y - centre.y }
    const endPos = { x: centre.x + spoke.x * cos - spoke.y * sin, y: centre.y + spoke.x * sin + spoke.y * cos }
    const reach = radius * Math.tan(Math.abs(turn) / 2)
    const via = { x: from.pos.x + direction.x * reach, y: from.pos.y + direction.y * reach }
    const end = addNode(this.net, endPos, from.level ?? 0)
    if (!addArcCurve(this.net, from.id, end.id, via)) throw new Error(`No arc laid from ${from.id}`)
    return { end, direction: { x: direction.x * cos - direction.y * sin, y: direction.x * sin + direction.y * cos } }
  }

  /**
   * The turnout tool: from a node of a through track, a branch that leaves along `direction` and
   * ends parallel to it `advance` metres further and `offset` metres to the side (positive: down
   * the screen for a track heading east). Returns the end of the branch and the declared turnout.
   */
  turnout(from: RailNode, direction: Point, advance: number, offset: number): { end: RailNode; junction: Junction } {
    const normal = { x: -direction.y, y: direction.x }
    const target = {
      x: from.pos.x + direction.x * advance + normal.x * offset,
      y: from.pos.y + direction.y * advance + normal.y * offset,
    }
    const geom = computeFreeformParallelTurnout(from.pos, direction, target, this.store.getPlacementThresholds())
    if (!geom || !geom.valid) throw new Error(`No turnout can be laid from ${from.id}`)
    const laid = applyFreeformParallelTurnout(this.net, from.id, geom, this.tolerance)
    if (!laid.junction) throw new Error(`The branch laid from ${from.id} declared no turnout`)
    return { end: laid.endNode, junction: laid.junction }
  }

  /** The crossover tool between two parallel straight rails, centred on `x`, `y` */
  crossover(a: Segment, b: Segment, x: number, y: number, angleDeg: number): void {
    const preview = computeCrossoverPreview(this.net, a.id, b.id, { x, y }, angleDeg)
    if (!preview || !applyCrossover(this.net, preview, this.tolerance)) throw new Error(`No crossover laid at ${x}, ${y}`)
  }

  /**
   * What the editor does after each edit: tracks that meet are joined, and every fork gets its
   * route table. Call it once the track is laid, before anything is put on it.
   */
  settle(): void {
    reconcileNetworkIntersections(this.net, this.tolerance)
    this.store.notify()
  }

  /** The route table at a place, which must hold one */
  junctionAt(x: number, y: number): Junction {
    for (const node of this.net.nodes.values()) {
      if (Math.hypot(node.pos.x - x, node.pos.y - y) > 0.5) continue
      const junction = findJunctionAtNode(this.net, node.id)
      if (junction) return junction
    }
    throw new Error(`No points at ${x}, ${y}`)
  }

  setPoints(junction: Junction, branch: TurnoutBranch): void {
    setJunctionBranch(junction, branch)
  }

  /** Speed (km/h) of the diverging route of a turnout on the line of the example */
  divergingSpeed(junction: Junction, line: Pick<LineSettings, 'lineSpeed' | 'lineType'>): number {
    return turnoutDivergingSpeed(this.net, junction, { ...line, gauge: this.store.gauge, realScale: true })
  }

  // ─────────────────── What stands on the track ───────────────────

  /** The place of the track under a point; the point must be on a rail (within a metre) */
  at(x: number, y: number): TrackPoint {
    const snap = snapToNearestTrack(this.net, { x, y }, 1)
    if (!snap) throw new Error(`No rail at ${x}, ${y}`)
    return { segId: snap.segId, t: snap.t }
  }

  /** A signal at a place of the track, speaking to the trains that run along `direction` */
  signal(x: number, y: number, direction: Point, role: SignalRole): Signal {
    const place = this.at(x, y)
    const laid = addSignal(this.net, place, signalForwardFor(this.net, place, direction), role, { gauge: this.store.gauge })
    if (!laid.ok) throw new Error(`Signal refused at ${x}, ${y}: ${SIGNAL_REFUSAL_TEXT[laid.reason]}`)
    return laid.signal
  }

  /** The diverging rail of a turnout, at its points: where the speed zone of a branch starts */
  divergingRail(junction: Junction): TrackPoint {
    const rail = this.net.segments.get(junction.passages[1].b)!
    return { segId: rail.id, t: rail.from === junction.nodeId ? 0 : 1 }
  }

  /**
   * A speed zone along the shortest way between two places of the track (`[x, y]`, or a place in
   * hand) — by way of `through` when given, where two ways are about as long (a loop and the track
   * it doubles).
   */
  zone(
    from: readonly [number, number] | TrackPoint,
    to: readonly [number, number] | TrackPoint,
    speed: number,
    through?: readonly [number, number],
  ): SpeedZone {
    const place = (p: readonly [number, number] | TrackPoint): TrackPoint => ('segId' in p ? p : this.at(p[0], p[1]))
    const stops = [place(from), ...(through ? [place(through)] : []), place(to)]
    const spans = stops.slice(1).flatMap((stop, i) => {
      const path = findTrackPath(this.net, stops[i], stop)
      if (!path) throw new Error('No speed zone laid: no way joins its two ends')
      return path.spans
    })
    const zone = addSpeedZone(this.net, spans, speed)
    if (!zone) throw new Error('No speed zone laid: its two ends are the same place')
    return zone
  }

  /** Name the stretch of track through a place and say what it is (a platform track, a siding…) */
  nameTrack(x: number, y: number, name: string, type: SectionType): void {
    const { segId } = this.at(x, y)
    const section = computeTrackSections(this.net).find((candidate) => candidate.segmentIds.includes(segId))
    if (!section) throw new Error(`No stretch of track at ${x}, ${y}`)
    this.store.setSectionMeta(section.id, { name, type, isCustomName: true })
  }

  /**
   * A complete trainset laid with the train tool, vehicle after vehicle: the leading power car at
   * `x`, `y` heading along `direction`, its trailers behind it, then the rear power car turned
   * nose outwards. The place must leave room for the whole rake behind the leading car.
   */
  trainset(x: number, y: number, direction: Point, model: RollingStockModel = 'duplex'): TrainSet {
    const store = this.store
    const place = this.at(x, y)
    const seg = this.net.segments.get(place.segId)!
    const tangent = segmentTangentAt(this.net, seg, seg.from) ?? EAST
    const along = tangent.x * direction.x + tangent.y * direction.y >= 0 ? 1 : -1
    const face = (wanted: 1 | -1): void => {
      if (store.trainPlacementDirection !== wanted) store.flipTrainPlacementDirection()
    }
    const before = store.trains.length
    store.cancelInteraction()
    store.setTool('locomotive')
    store.setTrainPlacementModel(model)

    const consist = referenceConsist(model)
    face(along)
    if (!store.placeTrainItem({ x, y }, 'tgv_loco')) throw new Error(`No train placed at ${x}, ${y}`)
    const train = store.trains[store.trains.length - 1]
    for (const next of consist.slice(1)) {
      // Coupled to the train in progress: the heading only says whether the body is turned around
      face(next.flipped ? -1 : 1)
      const tail = vehicleRearEndPos(this.net, train.vehicles[train.vehicles.length - 1])
      if (!tail || !store.placeTrainItem(tail, next.kind === 'loco' ? 'tgv_loco' : 'tgv_wagon')) {
        throw new Error(`The trainset at ${x}, ${y} could not be completed: not enough track behind it`)
      }
    }
    face(1)
    // The train tool is left as a user leaves it: nothing in progress, nothing selected
    store.cancelInteraction()
    store.cancelInteraction()
    store.setTool('select')

    const built = store.trains[store.trains.length - 1]
    if (store.trains.length !== before + 1 || built.vehicles.length !== consist.length) {
      throw new Error(`The trainset at ${x}, ${y} came out as ${store.trains.length - before} trains`)
    }
    return built
  }

  // ─────────────────── Out ───────────────────

  /** The project file of the example: the settings that make it ready to drive, then the store's own export */
  finish(settings: ExampleSettings): SerializedProject {
    const store = this.store
    store.setProjectName(settings.name)
    store.setLineSettings(settings.line)
    store.camera = createCamera(settings.camera.x, settings.camera.y, settings.camera.scale)
    store.clearSelection()
    store.notify()
    return store.exportProject()
  }
}
