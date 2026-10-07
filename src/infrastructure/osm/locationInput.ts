/**
 * What the user may paste instead of searching for a place: a pair of coordinates, or a link to
 * a map. Read on the spot, without any request.
 */

export interface GeoPoint {
  lat: number
  lon: number
}

function point(lat: number, lon: number): GeoPoint | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

const NUMBER = String.raw`[-+]?\d{1,3}(?:\.\d+)?`
const COMMA_NUMBER = String.raw`[-+]?\d{1,3}(?:,\d+)?`

/** `#map=15/48.84/2.37` of openstreetmap.org (zoom, latitude, longitude) */
const OSM_HASH = new RegExp(String.raw`[#&]map=\d+(?:\.\d+)?/(${NUMBER})/(${NUMBER})`)
/** `@48.84,2.37` of other map sites, and `geo:48.84,2.37` */
const AT_PAIR = new RegExp(String.raw`(?:@|geo:)(${NUMBER}),(${NUMBER})`)
/** `48.8443, 2.3744`, `48.8443 2.3744`, `48.8443;2.3744` */
const DOT_PAIR = new RegExp(String.raw`^\(?\s*(${NUMBER})\s*(?:[,;]\s*|\s+)(${NUMBER})\s*\)?$`)
/** `48,8443 ; 2,3744` and `48,8443 2,3744`: decimal commas, as typed on a French keyboard */
const COMMA_PAIR = new RegExp(String.raw`^\(?\s*(${COMMA_NUMBER})\s*(?:;\s*|\s+)(${COMMA_NUMBER})\s*\)?$`)

function queryParam(text: string, name: string): number | null {
  const match = new RegExp(String.raw`[?&#]${name}=(${NUMBER})(?:&|#|$)`).exec(text)
  return match ? Number(match[1]) : null
}

/**
 * The position a pasted text stands for, null when it is not one (a place name, then).
 * Latitude comes first, as on every map site.
 */
export function parseLocation(input: string): GeoPoint | null {
  const text = input.trim()
  if (!text) return null

  // A marker placed on the map wins over the centre of the view
  const mlat = queryParam(text, 'mlat')
  const mlon = queryParam(text, 'mlon')
  if (mlat !== null && mlon !== null) return point(mlat, mlon)

  const hash = OSM_HASH.exec(text)
  if (hash) return point(Number(hash[1]), Number(hash[2]))

  const lat = queryParam(text, 'lat')
  const lon = queryParam(text, 'lon')
  if (lat !== null && lon !== null) return point(lat, lon)

  const at = AT_PAIR.exec(text)
  if (at) return point(Number(at[1]), Number(at[2]))

  const dots = DOT_PAIR.exec(text)
  if (dots) return point(Number(dots[1]), Number(dots[2]))

  const commas = COMMA_PAIR.exec(text)
  if (commas) return point(Number(commas[1].replace(',', '.')), Number(commas[2].replace(',', '.')))

  return null
}

/** True when the text is a link: one we could not read is not a place name to search for */
export function looksLikeLink(input: string): boolean {
  return /^(https?:\/\/|www\.)/i.test(input.trim())
}

/** `48,8443° N, 2,3744° E` */
export function formatGeoPoint(p: GeoPoint): string {
  const f = (value: number) => Math.abs(value).toLocaleString('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  return `${f(p.lat)}° ${p.lat >= 0 ? 'N' : 'S'}, ${f(p.lon)}° ${p.lon >= 0 ? 'E' : 'O'}`
}
