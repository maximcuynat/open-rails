import { OSM_ERROR_MESSAGES, OsmError } from './osmError'
import type { GeoPoint } from './locationInput'

/**
 * Place search by name, through Nominatim (the search of openstreetmap.org).
 *
 * Its usage policy asks for one request a second at most and forbids search-as-you-type: this is
 * called when the user presses « Chercher », never while typing, and an answer already received
 * is not asked again.
 *
 * Privacy: the request carries the text typed and nothing else — no e-mail parameter, no header
 * of our own.
 */

export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
export const PLACE_SEARCH_LIMIT = 6
export const PLACE_SEARCH_TIMEOUT_MS = 15_000

/** Mainland France (west, north, east, south): results inside come first, the others are kept */
const FRANCE_VIEWBOX = '-5.5,51.5,10,41'

export interface PlaceResult extends GeoPoint {
  /** Full name as Nominatim writes it: « Gare de Lyon, Paris, Île-de-France, France » */
  label: string
  /** First part of the name, to name the project after */
  name: string
  /** What the place is, in French when we know the word: « gare », « ville »… */
  kind: string
}

const KIND_LABELS: Record<string, string> = {
  station: 'gare',
  halt: 'halte',
  stop: 'arrêt',
  tram_stop: 'arrêt de tram',
  yard: 'triage',
  rail: 'voie',
  city: 'ville',
  town: 'ville',
  village: 'village',
  hamlet: 'hameau',
  suburb: 'quartier',
  neighbourhood: 'quartier',
  quarter: 'quartier',
  administrative: 'commune',
  municipality: 'commune',
}

export interface PlaceSearchOptions {
  signal?: AbortSignal
  /** Injected by the tests: no test ever reaches a real server */
  fetch?: typeof fetch
  timeoutMs?: number
}

const answered = new Map<string, PlaceResult[]>()

/** Forget the answers kept (tests) */
export function clearPlaceSearchCache(): void {
  answered.clear()
}

export function buildPlaceSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(PLACE_SEARCH_LIMIT),
    addressdetails: '1',
    'accept-language': 'fr',
    // A preference, not a limit (no `bounded`): a place abroad is still found
    viewbox: FRANCE_VIEWBOX,
  })
  return `${NOMINATIM_SEARCH_URL}?${params.toString()}`
}

function readResult(value: unknown): (PlaceResult & { french: boolean }) | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const lat = Number(raw.lat)
  const lon = Number(raw.lon)
  const label = typeof raw.display_name === 'string' ? raw.display_name : ''
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const type = typeof raw.type === 'string' ? raw.type : ''
  const ownName = typeof raw.name === 'string' && raw.name ? raw.name : label.split(',')[0].trim()
  const country = (raw.address as { country_code?: unknown } | undefined)?.country_code
  return { lat, lon, label, name: ownName, kind: KIND_LABELS[type] ?? '', french: country === 'fr' }
}

/**
 * Places matching a name, France first. Throws an `OsmError`: `not-found` when nothing matches,
 * `busy`, `offline` or `aborted` otherwise.
 */
export async function searchPlaces(query: string, options: PlaceSearchOptions = {}): Promise<PlaceResult[]> {
  const text = query.trim()
  if (!text) return []
  const kept = answered.get(text.toLowerCase())
  if (kept) return kept

  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? PLACE_SEARCH_TIMEOUT_MS)

  let value: unknown
  try {
    const response = await doFetch(buildPlaceSearchUrl(text), { signal: controller.signal })
    if (!response.ok) {
      throw new OsmError('busy', 'La recherche de lieux ne répond pas pour l’instant. Réessayez, ou collez des coordonnées ou un lien OpenStreetMap.')
    }
    value = await response.json()
  } catch (error) {
    if (error instanceof OsmError) throw error
    if (options.signal?.aborted) throw new OsmError('aborted', OSM_ERROR_MESSAGES.aborted)
    if (timedOut) {
      throw new OsmError('busy', 'La recherche de lieux n’a pas répondu à temps. Réessayez, ou collez des coordonnées ou un lien OpenStreetMap.')
    }
    throw new OsmError('offline', 'Impossible de joindre la recherche de lieux. Vérifiez la connexion à Internet, ou collez des coordonnées.')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }

  const found = (Array.isArray(value) ? value : []).map(readResult).filter((r) => r !== null)
  if (found.length === 0) throw new OsmError('not-found', `Aucun lieu trouvé pour « ${text} ».`)
  // France first, Nominatim's own order otherwise (the sort is stable)
  const results: PlaceResult[] = [...found]
    .sort((a, b) => Number(b.french) - Number(a.french))
    .map(({ lat, lon, label, name, kind }) => ({ lat, lon, label, name, kind }))
  answered.set(text.toLowerCase(), results)
  return results
}
