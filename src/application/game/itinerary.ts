import type { ConsoleRoute } from '@application/console/consoleContract'
import type { EditorStore } from '@application/state/editorStore'
import { gatesToward, routeThroughStations, shortestLineRoute, buildLineGraph } from '@domain/dataset/lineRoute'
import { positionOnSegment } from '@domain/models/locomotive'
import { networkCheckToken } from '@domain/models/networkWatch'
import { isTrainStopped, type TrainSet } from '@domain/models/train'
import type { Point, StationId } from '@domain/models/types'
import { afterCall, itineraryFrom, nextStop, stopsAhead, straightLengthAhead, withStop, withoutStop, type StationRef } from '@domain/services/itinerary'
import { openPassage } from '@domain/models/junction'
import { findJunctionAtNode } from '@domain/models/routing'
import { findRouteGuide, guideDurationLeft, guideDurations, guideLeft, pointsAgainstGuide, type GuidePoints, type RouteGuide } from '@domain/services/routeGuide'
import { aidReach } from './drivingAid'
import { trackSpansEnds } from '@domain/services/trackPath'

// The itinerary of a train as the game runs it: the stations come from the index of the dataset
// (those of lines not loaded yet included) or, on any other project, from the network itself;
// the way to the next one is found on the track loaded and kept until the train leaves it, the
// track changes or the station is reached.

/** A train stopped within this of the stop it was heading for has called at the station, m */
export const ARRIVAL_DISTANCE = 60

/** What is kept per train between two looks at its itinerary */
export interface RouteGuideState {
  /** The station the guide leads to */
  station: StationId
  /** `networkCheckToken` of the track the guide was found on */
  token: unknown
  /** Where the lead bogie was when no way was found: not searched again from the same rail */
  failedOn: string | null
  guide: RouteGuide | null
  /** Metres left on the guide at the last look */
  left: number | null
  /** Seconds each stretch of `guide` is from its end (`guideDurations`), worked out when the time is first asked */
  durations?: { guide: RouteGuide; seconds: number[] }
  /** The nearest points ahead that lead off the way and were left as they are (aid `guide`, or held by another train) */
  against: GuidePoints | null
}

/** The stations an itinerary can name, by id */
export function stationRefs(store: EditorStore): Map<StationId, StationRef> {
  const refs = new Map<StationId, StationRef>()
  for (const station of store.network.stations.values()) refs.set(station.id, { id: station.id, name: station.name, x: station.pos.x, y: station.pos.y })
  // The index knows the stations of lines not loaded too, and names them the same
  for (const station of store.datasetIndex?.stations ?? []) refs.set(station.id, { id: station.id, name: station.name, x: station.x, y: station.y })
  return refs
}

function leadPoint(store: EditorStore, train: TrainSet): Point | null {
  const lead = train.vehicles[0]
  return lead ? positionOnSegment(store.network, lead.front.segId, lead.front.t) : null
}

/**
 * Add a station to the itinerary of a train, where it lengthens the journey least. Returns why
 * not, in French, when the lines of the dataset do not join it to its neighbours; null when done.
 */
export function addItineraryStop(store: EditorStore, train: TrainSet, stationId: StationId): string | null {
  const refs = stationRefs(store)
  const added = refs.get(stationId)
  const from = leadPoint(store, train)
  if (!added || !from) return 'Gare inconnue.'
  const place = (id: StationId): Point | undefined => refs.get(id)
  const itinerary = withStop(train.itinerary, stationId, from, place)
  if (itinerary === train.itinerary) return null
  const index = store.datasetIndex
  if (index && store.dataset) {
    const known = (id: StationId): boolean => index.stations.some((s) => s.id === id)
    const ahead = stopsAhead(itinerary).filter(known)
    // From what is loaded to the first station ahead, then from station to station
    const first = index.stations.find((s) => s.id === ahead[0])
    if (first && !shortestLineRoute(buildLineGraph(index), new Set(store.dataset.lines), new Set(first.lines))) {
      return `Aucune ligne du jeu de données ne mène d’ici à ${first.name}.`
    }
    if (ahead.length >= 2) {
      const route = routeThroughStations(index, ahead)
      if ('error' in route) return `Aucune ligne ne relie ${refs.get(ahead[route.at - 1])?.name ?? '?'} à ${refs.get(ahead[route.at])?.name ?? '?'}.`
    }
  }
  train.itinerary = itinerary
  store.itineraryChanged(train)
  faceTheWay(store, train)
  return null
}

/**
 * A train at rest whose way starts behind it is driven from its other cab, under the full aid:
 * set down at a through station it faces one way or the other, and the station it is sent to
 * may be the other way.
 */
function faceTheWay(store: EditorStore, train: TrainSet): void {
  if (store.drivingAid !== 'full' || !isTrainStopped(train) || !store.routeGuides.get(train.id)?.guide?.behind) return
  if (!store.switchTrainCab(train)) return
  const turned = store.trains.find((t) => t.id === train.id)
  if (turned) store.itineraryChanged(turned)
}

/** Take a station ahead out of the itinerary of a train (`index` in its list of stations) */
export function removeItineraryStop(store: EditorStore, train: TrainSet, index: number): void {
  if (!train.itinerary) return
  const itinerary = withoutStop(train.itinerary, index)
  if (itinerary === train.itinerary) return
  train.itinerary = itinerary
  store.itineraryChanged(train)
}

/** A train set down at a station starts its itinerary there */
export function startItineraryAt(train: TrainSet, stationId: StationId): void {
  train.itinerary = itineraryFrom(stationId)
}

/**
 * Bring the guide of a train up to date: measured along the one it has, found again when the
 * train left it, the track changed or the station is another. A train stopped at the platform it
 * was heading for has called there: its itinerary moves on. Returns true when the itinerary did.
 */
export function refreshRouteGuide(store: EditorStore, train: TrainSet): boolean {
  const guides = store.routeGuides
  const station = nextStop(train.itinerary)
  const lead = train.vehicles[0]?.front
  if (!station || !lead) {
    guides.delete(train.id)
    return false
  }
  const net = store.network
  const token = networkCheckToken(net)
  let state = guides.get(train.id)
  if (!state || state.station !== station || state.token !== token) {
    state = { station, token, failedOn: null, guide: null, left: null, against: null }
    guides.set(train.id, state)
  }
  state.left = state.guide ? guideLeft(net, state.guide, lead) : null
  if (state.left === null && state.failedOn !== lead.segId) {
    const index = store.datasetIndex
    const indexed = index?.stations.find((s) => s.id === station)
    const gates = index && indexed && store.dataset ? gatesToward(index, new Set(store.dataset.lines), indexed.lines) : []
    // A call on the way to somewhere else: a platform the train can go on from
    const after = train.itinerary?.stations[train.itinerary.next + 1]
    const afterIndexed = after === undefined ? undefined : index?.stations.find((s) => s.id === after)
    const beyond = after === undefined ? undefined : { station: net.stations.get(after), gates: index && afterIndexed && store.dataset ? gatesToward(index, new Set(store.dataset.lines), afterIndexed.lines) : [] }
    state.guide = findRouteGuide(net, lead, net.stations.get(station), gates, beyond)
    state.left = state.guide ? state.guide.path.length : null
    state.failedOn = state.guide ? null : lead.segId
  }
  if (state.guide?.target === 'platform' && state.left !== null && state.left <= ARRIVAL_DISTANCE && isTrainStopped(train)) {
    train.itinerary = afterCall(train.itinerary!)
    guides.delete(train.id)
    refreshRouteGuide(store, train)
    return true
  }
  state.against = applyDrivingAid(store, train, state.guide)
  return false
}

/**
 * The points ahead of a train on its way: set for it under the full aid, unless a train stands on
 * them or they are held for another. Returns the nearest ones left leading off the way (what the
 * driver has to see to), null when there are none or no aid is wanted.
 */
function applyDrivingAid(store: EditorStore, train: TrainSet, guide: RouteGuide | null): GuidePoints | null {
  const lead = train.vehicles[0]?.front
  if (!guide || guide.behind || !lead || store.drivingAid === 'none') return null
  const against = pointsAgainstGuide(store.network, guide, lead, aidReach(train.currentSpeed))
  if (store.drivingAid !== 'full') return against[0] ?? null
  let left: GuidePoints | null = null
  let thrown = false
  for (const points of against) {
    const junction = findJunctionAtNode(store.network, points.nodeId)
    if (junction && store.junctionLock(junction, train.id) === null && openPassage(junction, points.inSeg, points.outSeg)) thrown = true
    else left ??= points
  }
  if (thrown) store.pointsThrownByAid()
  return left
}

export interface ItineraryStopView {
  /** Index in the list of stations of the itinerary: what `removeItineraryStop` takes */
  index: number
  id: StationId
  name: string
}

export interface ItineraryView extends ConsoleRoute {
  /**
   * Seconds to the next station and to the destination, run at the limits of the track; where the
   * way is only known as the crow flies, at the speed of the line. Null when the distance is not known
   */
  duration: number | null
  totalDuration: number | null
  /** Metres to the nearest points ahead that lead off the way; null when the way is set, or not watched */
  pointsAgainst: number | null
  /** The station called at last, if any */
  origin: string | null
  /** The stations ahead, the next one first */
  stops: ItineraryStopView[]
  /** Platform of the next station the way leads to, when the data names it */
  platform: string | null
}

/** The itinerary of a train as a panel shows it; null when the train has none */
export function buildItineraryView(store: EditorStore, train: TrainSet): ItineraryView | null {
  const itinerary = train.itinerary
  if (!itinerary) return null
  const refs = stationRefs(store)
  const name = (id: StationId | undefined): string | null => (id === undefined ? null : (refs.get(id)?.name ?? id))
  const place = (id: StationId): Point | undefined => refs.get(id)
  const stops = itinerary.stations.map((id, index) => ({ index, id, name: name(id)! })).slice(itinerary.next)
  const origin = name(itinerary.stations[itinerary.next - 1])
  const next = stops[0]
  if (!next) {
    return { origin, stops, platform: null, pointsAgainst: null, duration: null, totalDuration: null, next: null, distance: null, exact: true, destination: null, total: null, status: itinerary.stations.length > 1 ? 'arrived' : 'ok' }
  }
  const state = store.routeGuides.get(train.id)
  const guide = state?.station === next.id ? state.guide : null
  const target = refs.get(next.id)
  let distance: number | null = null
  let duration: number | null = null
  let exact = false
  // What is only known as the crow flies is run at the speed of the line, or of the rake
  const cruise = Math.min(store.lineSettings.lineSpeed / 3.6, train.maxSpeed)
  const flown = (metres: number): number => (cruise > 0 ? metres / cruise : 0)
  if (guide && state?.left != null) {
    if (state.durations?.guide !== guide) {
      state.durations = { guide, seconds: guideDurations(store.network, guide, store.lineSettings, train.maxSpeed) }
    }
    const onTrack = guideDurationLeft(guide, state.durations.seconds, state.left)
    if (guide.target === 'platform') {
      distance = state.left
      duration = onTrack
      exact = true
    } else {
      // To the gate along the track, then as the crow flies to the station
      const end = trackSpansEnds(store.network, guide.path.spans)?.b ?? leadPoint(store, train)
      const rest = end && target ? Math.hypot(target.x - end.x, target.y - end.y) : 0
      distance = state.left + rest
      duration = onTrack + flown(rest)
    }
  } else {
    const from = leadPoint(store, train)
    if (from && target) {
      distance = Math.hypot(target.x - from.x, target.y - from.y)
      duration = flown(distance)
    }
  }
  const beyond = target ? straightLengthAhead({ stations: itinerary.stations, next: itinerary.next + 1 }, target, place) : 0
  return {
    origin,
    stops,
    platform: guide?.stop?.ref ?? null,
    pointsAgainst: guide && state?.against ? state.against.distance : null,
    duration,
    totalDuration: duration === null ? null : duration + flown(beyond),
    next: next.name,
    distance,
    exact,
    destination: stops[stops.length - 1].name,
    total: distance === null ? null : distance + beyond,
    status: !guide ? 'no-path' : guide.behind ? 'behind' : 'ok',
  }
}

/** What a console is told of the itinerary of its train; undefined when it has none ahead nor behind */
export function consoleRoute(store: EditorStore, train: TrainSet): ConsoleRoute | undefined {
  const view = buildItineraryView(store, train)
  if (!view || (view.next === null && view.status !== 'arrived')) return undefined
  const { next, distance, exact, destination, total, status } = view
  return { next, distance, exact, destination, total, status }
}
