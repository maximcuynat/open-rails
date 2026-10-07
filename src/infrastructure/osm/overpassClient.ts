import type { OsmExtraTrackKind, OverpassResponse } from '@domain/import/osmTypes'
import { OSM_ERROR_MESSAGES, OsmError } from './osmError'
import { hasRailwayWay, readOverpassAnswer } from './overpassFile'

/**
 * The Overpass client: the only code, with the place search, that talks to the network.
 *
 * Privacy: a request carries the query and nothing else. No e-mail, no name, no header of our own
 * — the body is a plain form, so the browser does not even send a preflight. The browser adds its
 * usual `Referer` (the address of the page), which is what the servers ask an application for.
 *
 * The public servers are overloaded (about half of the requests of the research failed, see
 * `tasks/recherche-import-osm.md` § 8): the servers are tried in turn, then once more after a
 * pause, and the import from a file stays available when all of them give up.
 */

/** Public servers, tried in this order. Same data on all of them, to the minute. */
export const OVERPASS_SERVERS: readonly string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

/** Radius the window offers, km. Above the maximum a city weighs tens of megabytes. */
export const OSM_RADIUS_KM = { min: 0.3, max: 15, default: 2 } as const
/** From this radius the window warns that a city may be too heavy, km */
export const OSM_RADIUS_WARNING_KM = 5

/** Seconds the server is given to answer (`[timeout:…]` of the query) */
export const OVERPASS_SERVER_TIMEOUT_S = 60
/** How long one request may take before it is dropped, ms: the server time, plus the transfer */
export const OVERPASS_REQUEST_TIMEOUT_MS = 90_000
/** Pause before the servers are tried a second time, ms */
export const OVERPASS_RETRY_PAUSE_MS = 15_000
/** How many times the list of servers is gone through */
export const OVERPASS_ROUNDS = 2

/** Where to look: a disc around a point, or a box */
export type OsmArea =
  | { kind: 'around'; lat: number; lon: number; radiusKm: number }
  | { kind: 'box'; south: number; west: number; north: number; east: number }

/** Which tracks to ask for, beyond `railway=rail` */
export interface OsmQueryKinds {
  extraKinds: readonly OsmExtraTrackKind[]
  /** `railway=disused` and `railway=abandoned` */
  disused: boolean
}

export const ALL_EXTRA_KINDS: readonly OsmExtraTrackKind[] = ['tram', 'subway', 'light_rail', 'narrow_gauge']

/**
 * Everything the options of the window can keep. The window asks for all of it once, so that
 * ticking a box afterwards recounts without a second request.
 */
export const ALL_QUERY_KINDS: OsmQueryKinds = { extraKinds: ALL_EXTRA_KINDS, disused: true }

const KM_PER_DEGREE = 111.32

function validCoordinates(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

/** Width and height of an area, km (a disc: its diameter) */
export function areaSizeKm(area: OsmArea): { width: number; height: number; surface: number } {
  if (area.kind === 'around') {
    const d = 2 * area.radiusKm
    return { width: d, height: d, surface: Math.PI * area.radiusKm ** 2 }
  }
  const midLat = ((area.south + area.north) / 2) * (Math.PI / 180)
  const width = Math.abs(area.east - area.west) * KM_PER_DEGREE * Math.cos(midLat)
  const height = Math.abs(area.north - area.south) * KM_PER_DEGREE
  return { width, height, surface: width * height }
}

/**
 * Weight of the answer to expect, bytes, between open country and a dense city: measured at
 * 2 kB/km² (single track) and 150 kB/km² (Paris) on the samples of the research.
 */
export function estimateAnswerBytes(area: OsmArea): { country: number; city: number } {
  const { surface } = areaSizeKm(area)
  return { country: surface * 2_000, city: surface * 150_000 }
}

/** Why an area cannot be asked for, in French; null when it can */
export function areaProblem(area: OsmArea): string | null {
  if (area.kind === 'around') {
    if (!validCoordinates(area.lat, area.lon)) return 'Le centre de la zone n’est pas une position valide.'
    if (!Number.isFinite(area.radiusKm) || area.radiusKm < OSM_RADIUS_KM.min) {
      return `Le rayon doit être d’au moins ${formatKm(OSM_RADIUS_KM.min)}.`
    }
    if (area.radiusKm > OSM_RADIUS_KM.max) return `Le rayon ne peut pas dépasser ${formatKm(OSM_RADIUS_KM.max)}.`
    return null
  }
  if (!validCoordinates(area.south, area.west) || !validCoordinates(area.north, area.east) || area.south >= area.north || area.west >= area.east) {
    return 'La zone n’est pas un rectangle valide.'
  }
  const { width, height } = areaSizeKm(area)
  const side = 2 * OSM_RADIUS_KM.max
  if (width > side || height > side) return `La zone ne peut pas dépasser ${formatKm(side)} de côté.`
  return null
}

function formatKm(km: number): string {
  return `${km.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`
}

/** Seven decimals: the precision of OpenStreetMap itself */
function degrees(value: number): string {
  return String(Number(value.toFixed(7)))
}

/**
 * The Overpass QL query for the tracks of an area. Ways first, then their nodes by recursion, in
 * one `out body`: every node comes once, with its tags (switches, signals, buffer stops are tags
 * of the nodes of a track). No relation: a line relation runs for hundreds of kilometres.
 */
export function buildOverpassQuery(area: OsmArea, kinds: OsmQueryKinds = ALL_QUERY_KINDS): string {
  const values = ['rail', ...ALL_EXTRA_KINDS.filter((kind) => kinds.extraKinds.includes(kind))]
  if (kinds.disused) values.push('disused', 'abandoned')
  const where =
    area.kind === 'around'
      ? `(around:${Math.round(area.radiusKm * 1000)},${degrees(area.lat)},${degrees(area.lon)})`
      : `(${degrees(area.south)},${degrees(area.west)},${degrees(area.north)},${degrees(area.east)})`
  return [
    `[out:json][timeout:${OVERPASS_SERVER_TIMEOUT_S}];`,
    `way[railway~"^(${values.join('|')})$"]${where};`,
    '(._;>;);',
    'out body qt;',
  ].join('\n')
}

export interface OverpassProgress {
  /** `asking`: waiting for a server; `receiving`: the answer is coming; `waiting`: pause before a new round */
  phase: 'asking' | 'receiving' | 'waiting'
  /** Host name of the server being asked (empty while waiting) */
  server: string
  /** Request number, from 1, and how many there will be at most */
  attempt: number
  attempts: number
  /** Bytes received so far, while receiving */
  receivedBytes?: number
  /** Length of the pause, while waiting */
  waitSeconds?: number
}

export interface OverpassRequestOptions {
  signal?: AbortSignal
  onProgress?: (progress: OverpassProgress) => void
  /** Injected by the tests: no test ever reaches a real server */
  fetch?: typeof fetch
  servers?: readonly string[]
  rounds?: number
  pauseMs?: number
  timeoutMs?: number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

type Failure = 'busy' | 'too-large' | 'offline' | 'invalid'

/** A wait that a cancellation cuts short */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OsmError('aborted', OSM_ERROR_MESSAGES.aborted))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new OsmError('aborted', OSM_ERROR_MESSAGES.aborted))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** What a server means when it answers something that is not the data */
function failureOfText(text: string): Failure {
  const lower = text.toLowerCase()
  if (lower.includes('out of memory') || lower.includes('timed out')) return 'too-large'
  return 'busy'
}

async function readBody(response: Response, onBytes: (received: number) => void): Promise<string> {
  const reader = response.body?.getReader?.()
  if (!reader) return response.text()
  const decoder = new TextDecoder()
  let text = ''
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    text += decoder.decode(value, { stream: true })
    onBytes(received)
  }
  return text + decoder.decode()
}

/** One request to one server: the data, or the reason it did not come */
async function askServer(
  url: string,
  query: string,
  options: { fetch: typeof fetch; signal?: AbortSignal; timeoutMs: number; onBytes: (received: number) => void },
): Promise<OverpassResponse | Failure> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  try {
    // A plain form body: no header of ours, and no CORS preflight
    const response = await options.fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    })
    if (response.status === 400) return 'invalid'
    if (!response.ok) {
      // 429 (too many requests), 504 (« the server is probably too busy »), 502, 503…
      return 'busy'
    }
    const text = await readBody(response, options.onBytes)
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      // An error page sent with a 200 status
      return failureOfText(text)
    }
    const remark = (value as { remark?: unknown } | null)?.remark
    if (typeof remark === 'string' && /error/i.test(remark)) return failureOfText(remark)
    try {
      return readOverpassAnswer(value)
    } catch {
      return 'invalid'
    }
  } catch {
    if (options.signal?.aborted) throw new OsmError('aborted', OSM_ERROR_MESSAGES.aborted)
    // Our own time limit: the server is too slow to be of use; anything else: it cannot be reached
    return timedOut ? 'busy' : 'offline'
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Download the tracks of an area. Each server is asked in turn until one answers; when all of
 * them are busy the list is gone through once more after a pause.
 * Throws an `OsmError`: `aborted`, `too-large`, `empty`, `busy`, `offline` or `invalid`.
 */
export async function fetchOverpass(
  area: OsmArea,
  kinds: OsmQueryKinds = ALL_QUERY_KINDS,
  options: OverpassRequestOptions = {},
): Promise<OverpassResponse> {
  const problem = areaProblem(area)
  if (problem) throw new OsmError('too-large', problem)

  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const servers = options.servers ?? OVERPASS_SERVERS
  const rounds = options.rounds ?? OVERPASS_ROUNDS
  const pauseMs = options.pauseMs ?? OVERPASS_RETRY_PAUSE_MS
  const timeoutMs = options.timeoutMs ?? OVERPASS_REQUEST_TIMEOUT_MS
  const sleep = options.sleep ?? abortableSleep
  const query = buildOverpassQuery(area, kinds)
  const attempts = servers.length * rounds
  const failures: Failure[] = []
  let attempt = 0

  for (let round = 0; round < rounds; round++) {
    if (round > 0) {
      options.onProgress?.({ phase: 'waiting', server: '', attempt, attempts, waitSeconds: Math.round(pauseMs / 1000) })
      await sleep(pauseMs, options.signal)
    }
    const roundFailures: Failure[] = []
    for (const url of servers) {
      if (options.signal?.aborted) throw new OsmError('aborted', OSM_ERROR_MESSAGES.aborted)
      attempt++
      const server = hostOf(url)
      options.onProgress?.({ phase: 'asking', server, attempt, attempts })
      const answer = await askServer(url, query, {
        fetch: doFetch,
        signal: options.signal,
        timeoutMs,
        onBytes: (receivedBytes) => options.onProgress?.({ phase: 'receiving', server, attempt, attempts, receivedBytes }),
      })
      if (typeof answer !== 'string') {
        if (!hasRailwayWay(answer)) throw new OsmError('empty', OSM_ERROR_MESSAGES.empty)
        return answer
      }
      roundFailures.push(answer)
    }
    failures.push(...roundFailures)
    // Asking again only helps against a busy server
    if (!roundFailures.includes('busy') || roundFailures.includes('too-large')) break
  }

  if (failures.includes('too-large')) throw new OsmError('too-large', OSM_ERROR_MESSAGES.tooLarge)
  if (failures.includes('busy')) throw new OsmError('busy', OSM_ERROR_MESSAGES.busy)
  if (failures.every((failure) => failure === 'offline')) throw new OsmError('offline', OSM_ERROR_MESSAGES.offline)
  throw new OsmError('invalid', OSM_ERROR_MESSAGES.invalidAnswer)
}
