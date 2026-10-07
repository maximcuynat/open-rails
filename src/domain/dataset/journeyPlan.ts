import type { DatasetIndex } from './datasetIndex'
import { recipeName } from './datasetRecipe'
import { routeThroughStations, type JourneyRoute } from './lineRoute'

// What the « Ligne entre gares… » window works on: the stations chosen, in order, and what the
// index says of the journey through them. Pure functions, so that the window is only a view.

export interface JourneyPlan {
  /** Ids of the stations of the index, in the order they are to be passed */
  stops: string[]
}

export const EMPTY_PLAN: JourneyPlan = { stops: [] }

/** Add a station at the end; a station already in the plan is not added twice */
export function addStop(plan: JourneyPlan, id: string): JourneyPlan {
  if (plan.stops.includes(id)) return plan
  return { stops: [...plan.stops, id] }
}

export function removeStop(plan: JourneyPlan, index: number): JourneyPlan {
  if (index < 0 || index >= plan.stops.length) return plan
  return { stops: plan.stops.filter((_, i) => i !== index) }
}

/** Move a station one place up (-1) or down (+1) */
export function moveStop(plan: JourneyPlan, index: number, direction: -1 | 1): JourneyPlan {
  const target = index + direction
  if (index < 0 || index >= plan.stops.length || target < 0 || target >= plan.stops.length) return plan
  const stops = [...plan.stops]
  ;[stops[index], stops[target]] = [stops[target], stops[index]]
  return { stops }
}

export interface JourneyPreview {
  route: JourneyRoute | null
  /** Why there is no route, in French; null when there is one */
  problem: string | null
  /** The lines crossed, in order */
  lineNames: string[]
  lengthLabel: string
  sizeLabel: string
  attribution: string[]
  /** The name the project will take */
  name: string
}

/** A length of track in km, French style */
export function formatTrackKm(km: number): string {
  return `${Math.round(km).toLocaleString('fr-FR')} km de voie`
}

/** A size to download, French style */
export function formatDownloadSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o à télécharger`
  if (bytes < 1048576) return `${Math.round(bytes / 1024).toLocaleString('fr-FR')} ko à télécharger`
  return `${(bytes / 1048576).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mio à télécharger`
}

/** What the journey through the plan's stations amounts to; null while fewer than two stations are chosen */
export function previewJourney(index: DatasetIndex, plan: JourneyPlan): JourneyPreview | null {
  if (plan.stops.length < 2) return null
  const nameOf = (id: string): string => index.stations.find((s) => s.id === id)?.name ?? id
  const result = routeThroughStations(index, plan.stops)
  const name = recipeName(index, { version: 1, dataDate: index.dataDate, lines: [], stations: plan.stops })
  if ('error' in result) {
    const problem =
      result.error === 'unknown-station'
        ? `La gare « ${nameOf(plan.stops[result.at])} » n’est pas dans le jeu de données.`
        : `Aucun itinéraire sur les lignes à grande vitesse entre ${nameOf(plan.stops[result.at - 1])} et ${nameOf(plan.stops[result.at])}.`
    return { route: null, problem, lineNames: [], lengthLabel: '', sizeLabel: '', attribution: index.attribution, name }
  }
  const linesById = new Map(index.lines.map((line) => [line.id, line]))
  return {
    route: result,
    problem: null,
    lineNames: result.lines.map((id) => linesById.get(id)?.name ?? id),
    lengthLabel: formatTrackKm(result.lengthKm),
    sizeLabel: formatDownloadSize(result.bytes),
    attribution: index.attribution,
    name,
  }
}
