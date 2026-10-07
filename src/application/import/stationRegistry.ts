import { readStationRegistry, type StationRegistryEntry } from '@domain/models/stationRegistry'
import registryUrl from '../../data/stations-fr.json?url'

/** The official stations, fetched once (the file is served beside the application, like the examples) */
let registry: Promise<StationRegistryEntry[]> | null = null

export function loadStationRegistry(): Promise<StationRegistryEntry[]> {
  registry ??= fetch(registryUrl)
    .then(async (response) => {
      if (!response.ok) throw new Error(`stations-fr.json: HTTP ${response.status}`)
      return readStationRegistry(await response.json())
    })
    .catch((error) => {
      // Without the registry the stations keep the names of the data: no reason to fail the import
      registry = null
      console.warn('Liste des gares SNCF non chargée', error)
      return []
    })
  return registry
}
