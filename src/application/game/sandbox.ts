import type { DatasetIndex } from '@domain/dataset/datasetIndex'
import type { RollingStockModel } from '@domain/models/rollingStock'
import type { StationStop } from '@domain/models/types'
import type { EditorStore } from '@application/state/editorStore'
import { datasetErrorMessage, fetchLineFiles } from '@application/dataset/datasetClient'
import { loadStation, type JourneyLoadOptions } from '@application/dataset/journeyLoader'

// The sandbox, first game mode: a station to start from and a train, nothing else asked. The
// lines of the station are loaded as a locked project, a complete rake is set down at one of its
// platforms, and the player takes the controls — on a phone or at a console of this screen.

export interface SandboxTrain {
  id: string
  name: string
  detail: string
  /** The rake it is; absent for a train announced and not yet playable (none at the moment) */
  model?: RollingStockModel
}

/** The trains the sandbox offers, the ones to come last */
export const SANDBOX_TRAINS: readonly SandboxTrain[] = [
  { id: 'tgv-duplex', name: 'TGV Duplex', detail: '320 km/h · 200 m', model: 'duplex' },
  { id: 'tgv-m', name: 'TGV M', detail: '320 km/h · 202 m', model: 'tgvm' },
  { id: 'ter-regiolis', name: 'TER Régiolis', detail: '160 km/h · 72 m', model: 'regiolis' },
]

/** A start that failed once the station was loaded: the message is for the user */
export class SandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxError'
  }
}

export const sandboxErrorMessage = (error: unknown): string => (error instanceof SandboxError ? error.message : datasetErrorMessage(error))

export interface SandboxStart {
  stationName: string
  /** The stop the rake stands at (its platform number when the data has one) */
  stop: StationStop
}

/**
 * Load the lines of a station and set a rake of `model` down at one of its platforms, selected
 * and in view. The driving itself starts with `store.togglePlayMode()`, once the player has
 * chosen a console. Rejects with a `DatasetError` (the store is then as it was) or, when the
 * station is loaded but holds no rake, a `SandboxError`.
 */
export async function prepareSandbox(store: EditorStore, index: DatasetIndex, stationId: string, model: RollingStockModel, options: JourneyLoadOptions = {}): Promise<SandboxStart> {
  if (store.isPlayMode) store.togglePlayMode()
  await loadStation(store, index, stationId, options)
  const stationName = index.stations.find((s) => s.id === stationId)?.name ?? stationId
  const stop = store.placeRakeAtStation(stationId, model)
  if (!stop) throw new SandboxError(`Aucun quai de ${stationName} n’est assez long pour la rame. La gare est chargée : posez un train à la main.`)
  return { stationName, stop }
}

/** True when a sandbox game is under way: a dataset project with a train on it, to which another train can be added */
export function canAddSandboxTrain(store: EditorStore): boolean {
  return store.dataset !== null && store.trains.length > 0
}

/**
 * Add a train to the game under way: the lines of its station are fetched and added to what is
 * loaded (nothing is replaced, the other trains go on), a rake of `model` is set down at one of
 * its platforms and this screen moves to it. The trains left behind keep running under their
 * automatic pilot if they have one. Rejects like `prepareSandbox`.
 */
export async function addSandboxTrain(store: EditorStore, index: DatasetIndex, stationId: string, model: RollingStockModel, options: JourneyLoadOptions = {}): Promise<SandboxStart> {
  const station = index.stations.find((s) => s.id === stationId)
  const stationName = station?.name ?? stationId
  if (!station || !store.dataset) throw new SandboxError(`La gare ${stationName} n’est pas dans le jeu de données de cette partie.`)
  const missing = station.lines.filter((id) => !store.datasetFiles.has(id))
  if (missing.length > 0) store.addDatasetLines(await fetchLineFiles(index, missing, options.onProgress, options))
  const stop = store.placeRakeAtStation(stationId, model)
  if (!stop) throw new SandboxError(`Aucun quai libre de ${stationName} n’est assez long pour la rame.`)
  return { stationName, stop }
}
