import type { ConsoleRouteStatus } from '@application/console/consoleContract'
import type { DatasetIndex } from '@domain/dataset/datasetIndex'
import { searchStations } from '@domain/dataset/stationSearch'
import { normalizedName } from '@domain/models/stationRegistry'
import type { StationRef } from '@domain/services/itinerary'

/** A distance left to run, French style: metres under a kilometre, then kilometres; « ≈ » when estimated */
export function formatRouteDistance(metres: number | null, exact: boolean): string {
  if (metres === null) return '—'
  const m = Math.max(0, metres)
  const text =
    m < 1000
      ? `${Math.round(m / 10) * 10} m`
      : `${(m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: m < 100_000 ? 1 : 0, maximumFractionDigits: m < 100_000 ? 1 : 0 })} km`
  return exact ? text : `≈ ${text}`
}

/** What to tell the driver when the way is not simply ahead; null when it is */
export function routeStatusNote(status: ConsoleRouteStatus): string | null {
  if (status === 'behind') return 'Le chemin part derrière la rame : changez de cabine.'
  if (status === 'no-path') return 'Aucun chemin sur la voie chargée pour l’instant.'
  return null
}

export interface StationChoice {
  id: string
  name: string
}

/**
 * The stations answering what is typed, those in `taken` left out: through the index of the
 * dataset when the project has one (its search knows trigrams and homonyms), else by name.
 */
export function stationChoices(index: DatasetIndex | null, refs: ReadonlyMap<string, StationRef>, query: string, taken: ReadonlySet<string>, limit = 6): StationChoice[] {
  if (!query.trim()) return []
  if (index) {
    return searchStations(index, query, limit + taken.size)
      .filter((match) => !taken.has(match.station.id))
      .slice(0, limit)
      .map((match) => ({ id: match.station.id, name: match.station.name }))
  }
  const wanted = normalizedName(query)
  return [...refs.values()]
    .filter((ref) => !taken.has(ref.id) && normalizedName(ref.name).includes(wanted))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .slice(0, limit)
    .map((ref) => ({ id: ref.id, name: ref.name }))
}
