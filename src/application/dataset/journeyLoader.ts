import type { DatasetIndex, LineId } from '@domain/dataset/datasetIndex'
import { recipeLines, recipeName, type DatasetRecipe } from '@domain/dataset/datasetRecipe'
import { routeBbox, routeThroughStations, type JourneyRoute } from '@domain/dataset/lineRoute'
import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { unionProjects } from '@infrastructure/persistence/projectSlices'
import type { EditorStore } from '@application/state/editorStore'
import { DATASET_ERROR_MESSAGES, DatasetError, fetchLineFiles, loadDatasetIndex, type DatasetFetch, type LineFetchProgress } from './datasetClient'

// Putting a journey of the dataset into the editor: the route over the index says which lines,
// their files are fetched and put together, the store takes the union as a locked project. The
// same path serves a project saved as a recipe (its lines fetched again at start) and the lines
// a train approaches while driving.

export interface JourneyLoadOptions extends DatasetFetch {
  onProgress?: (progress: LineFetchProgress) => void
}

/** The files put together, a disagreement between them named in French */
function unionOf(files: ReadonlyMap<LineId, SerializedProject>, lines: readonly LineId[]): SerializedProject {
  try {
    return unionProjects(lines.map((id) => files.get(id)!))
  } catch {
    throw new DatasetError('invalid', DATASET_ERROR_MESSAGES.mismatch)
  }
}

/** The store fetches through the dataset client when a train nears a line it does not have */
export function installLineStreaming(store: EditorStore, index: DatasetIndex, options: DatasetFetch = {}): void {
  store.datasetIndex = index
  store.datasetLoader = (lines) => fetchLineFiles(index, lines, undefined, options)
}

/**
 * Load the journey through some stations of the index: the route's lines are fetched and the
 * store takes them as a locked project named after the first and last station. Rejects with a
 * `DatasetError` (no route, download failed…) and leaves the store as it was.
 */
export async function loadJourney(store: EditorStore, index: DatasetIndex, stationIds: readonly string[], options: JourneyLoadOptions = {}): Promise<JourneyRoute> {
  const route = routeThroughStations(index, stationIds)
  if ('error' in route) {
    const name = (i: number): string => index.stations.find((s) => s.id === stationIds[i])?.name ?? stationIds[i] ?? '?'
    if (route.error === 'unknown-station') throw new DatasetError('missing-line', DATASET_ERROR_MESSAGES.missingLine(name(route.at)))
    throw new DatasetError('no-route', DATASET_ERROR_MESSAGES.noRoute(name(route.at - 1), name(route.at)))
  }
  const files = await fetchLineFiles(index, route.lines, options.onProgress, options)
  const union = unionOf(files, route.lines)
  const recipe: DatasetRecipe = { version: 1, dataDate: index.dataDate, lines: [...route.lines], stations: [...stationIds] }
  store.loadDataset(recipe, union, files, index, route.bbox, { name: recipeName(index, recipe) })
  installLineStreaming(store, index, options)
  return route
}

/**
 * Load the lines one station is on, as a locked project named after it: where a game starts,
 * the lines beyond come as a train nears them. Rejects like `loadJourney`.
 */
export async function loadStation(store: EditorStore, index: DatasetIndex, stationId: string, options: JourneyLoadOptions = {}): Promise<void> {
  const station = index.stations.find((s) => s.id === stationId)
  if (!station || station.lines.length === 0) throw new DatasetError('missing-line', DATASET_ERROR_MESSAGES.missingLine(station?.name ?? stationId))
  await loadLines(store, index, station.lines, [stationId], options)
}

/** Every line of the dataset at once, as one locked project: the measuring bench of the renderer */
export async function loadAllLines(store: EditorStore, index: DatasetIndex, options: JourneyLoadOptions = {}): Promise<void> {
  await loadLines(store, index, index.lines.map((line) => line.id), [], options, 'Réseau entier')
}

async function loadLines(
  store: EditorStore,
  index: DatasetIndex,
  lines: readonly LineId[],
  stations: readonly string[],
  options: JourneyLoadOptions,
  name?: string,
): Promise<void> {
  const files = await fetchLineFiles(index, lines, options.onProgress, options)
  const union = unionOf(files, lines)
  const recipe: DatasetRecipe = { version: 1, dataDate: index.dataDate, lines: [...lines], stations: [...stations] }
  store.loadDataset(recipe, union, files, index, routeBbox(index, lines), { name: name ?? recipeName(index, recipe) })
  installLineStreaming(store, index, options)
}

/**
 * Fetch again the lines of a project saved as a recipe (the store was built from the storage
 * with `datasetReloadPending`): the trains and the camera it saved come back with them.
 */
export async function reloadDataset(store: EditorStore, options: JourneyLoadOptions = {}): Promise<void> {
  const saved = store.dataset
  if (!saved) return
  const index = await loadDatasetIndex(options)
  const recipe: DatasetRecipe = { ...saved, lines: recipeLines(index, saved.lines) }
  const files = await fetchLineFiles(index, recipe.lines, options.onProgress, options)
  const union = unionOf(files, recipe.lines)
  const stored = store.datasetStoredProject
  const restore: { name?: string; trains?: SerializedProject['trains']; camera?: SerializedProject['camera'] } = { name: store.projectName }
  if (stored?.trains) restore.trains = stored.trains
  if (stored?.camera) restore.camera = stored.camera
  store.loadDataset(recipe, union, files, index, routeBbox(index, recipe.lines), restore)
  installLineStreaming(store, index, options)
}
