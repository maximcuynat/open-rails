import type { Point, StationId } from '../models/types'
import type { TrainItinerary } from '../models/train'

// ─────────────────── Where a train is going ───────────────────
//
// An itinerary is the stations a train calls at, in order, and how far along it is. The order is
// kept sensible by construction: a station is not appended, it is put where it lengthens the
// journey least — between Marseille and Paris, Lyon goes in between, Lille goes after Paris.
// Whether the track joins the stations is another matter (the line route, then the rail path).

/** A station as an itinerary needs it: the index of a dataset gives it, or the network itself */
export interface StationRef {
  id: StationId
  name: string
  x: number
  y: number
}

/** The itinerary of a train standing at a station: nothing ahead yet */
export function itineraryFrom(stationId: StationId): TrainItinerary {
  return { stations: [stationId], next: 1 }
}

/** The stations still ahead, the next one first */
export function stopsAhead(itinerary: TrainItinerary | undefined): StationId[] {
  return itinerary ? itinerary.stations.slice(itinerary.next) : []
}

/** The station the train heads for now, if any */
export function nextStop(itinerary: TrainItinerary | undefined): StationId | null {
  return itinerary?.stations[itinerary.next] ?? null
}

/** The last station of the itinerary once it lies ahead: where the journey ends */
export function destinationOf(itinerary: TrainItinerary | undefined): StationId | null {
  const ahead = stopsAhead(itinerary)
  return ahead.length > 0 ? ahead[ahead.length - 1] : null
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Length of the straight lines from `from` through the stations ahead, m; 0 with none ahead */
export function straightLengthAhead(itinerary: TrainItinerary | undefined, from: Point, place: (id: StationId) => Point | undefined): number {
  let length = 0
  let at = from
  for (const id of stopsAhead(itinerary)) {
    const next = place(id)
    if (!next) continue
    length += distance(at, next)
    at = next
  }
  return length
}

/**
 * The itinerary with `stationId` added among the stations ahead, where it lengthens the journey
 * least as the crow flies from `from` (where the train is): first of all when there is none
 * ahead, between two of them, or after the last — it is then the new destination. The same
 * itinerary when the station is already ahead or has no known place.
 */
export function withStop(itinerary: TrainItinerary | undefined, stationId: StationId, from: Point, place: (id: StationId) => Point | undefined): TrainItinerary {
  const current: TrainItinerary = itinerary ?? { stations: [], next: 0 }
  const added = place(stationId)
  if (!added || stopsAhead(current).includes(stationId)) return current
  let best = current.next
  let bestCost = Infinity
  for (let i = current.next; i <= current.stations.length; i++) {
    const before = i === current.next ? from : (place(current.stations[i - 1]) ?? from)
    const after = i < current.stations.length ? place(current.stations[i]) : undefined
    const cost = distance(before, added) + (after ? distance(added, after) - distance(before, after) : 0)
    if (cost < bestCost - 1e-6) {
      best = i
      bestCost = cost
    }
  }
  const stations = [...current.stations]
  stations.splice(best, 0, stationId)
  return { stations, next: current.next }
}

/** The itinerary without the station at `index`; only a station ahead can be taken out */
export function withoutStop(itinerary: TrainItinerary, index: number): TrainItinerary {
  if (index < itinerary.next || index >= itinerary.stations.length) return itinerary
  return { stations: itinerary.stations.filter((_, i) => i !== index), next: itinerary.next }
}

/**
 * The itinerary without a station that no longer exists, wherever it stood (it may come back more
 * than once): the train still heads for the same next station. The same itinerary when it was not there.
 */
export function withoutStation(itinerary: TrainItinerary, stationId: StationId): TrainItinerary {
  if (!itinerary.stations.includes(stationId)) return itinerary
  const before = itinerary.stations.slice(0, itinerary.next).filter((id) => id === stationId).length
  return { stations: itinerary.stations.filter((id) => id !== stationId), next: itinerary.next - before }
}

/** The itinerary once the train has called at the station it was heading for */
export function afterCall(itinerary: TrainItinerary): TrainItinerary {
  if (itinerary.next >= itinerary.stations.length) return itinerary
  return { stations: itinerary.stations, next: itinerary.next + 1 }
}
