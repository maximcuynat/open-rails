import { describe, expect, it, vi } from 'vitest'
import { OSM_ERROR_MESSAGES, OsmError } from './osmError'
import {
  ALL_QUERY_KINDS,
  OVERPASS_SERVERS,
  areaProblem,
  areaSizeKm,
  buildOverpassQuery,
  estimateAnswerBytes,
  fetchOverpass,
  type OsmArea,
  type OverpassProgress,
} from './overpassClient'

const AREA: OsmArea = { kind: 'around', lat: 48.8443, lon: 2.3744, radiusKm: 2 }
const SERVERS = ['https://one.example/api/interpreter', 'https://two.example/api/interpreter', 'https://three.example/api/interpreter']

const tracks = {
  osm3s: { timestamp_osm_base: '2026-10-06T07:12:00Z' },
  elements: [
    { type: 'node', id: 1, lat: 48.84, lon: 2.37 },
    { type: 'node', id: 2, lat: 48.85, lon: 2.38 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { railway: 'rail' } },
  ],
}

const ok = (value: unknown = tracks) => new Response(JSON.stringify(value), { status: 200 })
const status = (code: number) => new Response('The server is probably too busy to handle your request.', { status: code })
const unreachable = () => {
  throw new TypeError('Failed to fetch')
}

/** A fetch that answers with the next of `answers` at each call, and remembers what it was asked */
function scripted(...answers: (() => Response)[]) {
  let call = 0
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    const answer = answers[Math.min(call, answers.length - 1)]
    call++
    return answer()
  })
}

const noWait = vi.fn(async () => {})

async function failure(promise: Promise<unknown>): Promise<OsmError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof OsmError) return error
    throw error
  }
  throw new Error('expected a failure')
}

describe('the Overpass query', () => {
  it('asks for the tracks around a point, then their nodes, in one output', () => {
    expect(buildOverpassQuery(AREA, { extraKinds: [], disused: false })).toBe(
      ['[out:json][timeout:60];', 'way[railway~"^(rail)$"](around:2000,48.8443,2.3744);', '(._;>;);', 'out body qt;'].join('\n'),
    )
  })

  it('adds the kinds selected, in a fixed order', () => {
    const query = buildOverpassQuery(AREA, { extraKinds: ['narrow_gauge', 'tram'], disused: true })
    expect(query).toContain('way[railway~"^(rail|tram|narrow_gauge|disused|abandoned)$"]')
  })

  it('asks for everything the options can keep by default, so that ticking a box needs no new request', () => {
    expect(buildOverpassQuery(AREA)).toContain('"^(rail|tram|subway|light_rail|narrow_gauge|disused|abandoned)$"')
    expect(buildOverpassQuery(AREA)).toBe(buildOverpassQuery(AREA, ALL_QUERY_KINDS))
  })

  it('takes a box as south, west, north, east', () => {
    const query = buildOverpassQuery({ kind: 'box', south: 44.79, west: 5.59, north: 44.86, east: 5.67 }, { extraKinds: [], disused: false })
    expect(query).toContain('way[railway~"^(rail)$"](44.79,5.59,44.86,5.67);')
  })

  it('never asks for tracks under construction, nor for relations', () => {
    const query = buildOverpassQuery(AREA)
    expect(query).not.toMatch(/construction|proposed|razed|rel/)
  })

  it('rounds the radius to the metre and the position to the precision of the data', () => {
    const query = buildOverpassQuery({ kind: 'around', lat: 48.844312345678, lon: 2.3, radiusKm: 0.3333 }, { extraKinds: [], disused: false })
    expect(query).toContain('(around:333,48.8443123,2.3)')
  })
})

describe('the size of an area', () => {
  it('measures a disc by its diameter and its surface', () => {
    const size = areaSizeKm(AREA)
    expect(size.width).toBe(4)
    expect(size.surface).toBeCloseTo(12.57, 2)
  })

  it('measures a box at its latitude', () => {
    // Zone (d) of the research: 3,9 × 4,4 km
    const size = areaSizeKm({ kind: 'box', south: 48.815, west: 2.365, north: 48.85, east: 2.425 })
    expect(size.height).toBeCloseTo(3.9, 1)
    expect(size.width).toBeCloseTo(4.4, 1)
  })

  it('estimates the answer between open country and a dense city', () => {
    const weight = estimateAnswerBytes(AREA)
    expect(weight.country).toBeCloseTo(25_000, -3)
    expect(weight.city).toBeCloseTo(1_900_000, -5)
  })

  it('accepts the radii of the window and refuses the others', () => {
    expect(areaProblem(AREA)).toBeNull()
    expect(areaProblem({ ...AREA, radiusKm: 0.3 })).toBeNull()
    expect(areaProblem({ ...AREA, radiusKm: 15 })).toBeNull()
    expect(areaProblem({ ...AREA, radiusKm: 0.1 })).toBe('Le rayon doit être d’au moins 0,3 km.')
    expect(areaProblem({ ...AREA, radiusKm: 20 })).toBe('Le rayon ne peut pas dépasser 15 km.')
    expect(areaProblem({ ...AREA, radiusKm: Number.NaN })).toBe('Le rayon doit être d’au moins 0,3 km.')
    expect(areaProblem({ ...AREA, lat: 120 })).toBe('Le centre de la zone n’est pas une position valide.')
    expect(areaProblem({ kind: 'box', south: 44, west: 5, north: 45, east: 6 })).toBe('La zone ne peut pas dépasser 30 km de côté.')
    expect(areaProblem({ kind: 'box', south: 45, west: 5, north: 44, east: 6 })).toBe('La zone n’est pas un rectangle valide.')
  })
})

describe('downloading from Overpass', () => {
  it('posts the query as a plain form, with no header of its own', async () => {
    const fetch = scripted(ok)
    const data = await fetchOverpass(AREA, undefined, { fetch, servers: SERVERS })
    expect(data.elements).toHaveLength(3)
    expect(data.osm3s?.timestamp_osm_base).toBe('2026-10-06T07:12:00Z')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(SERVERS[0])
    expect(init?.method).toBe('POST')
    expect(init?.headers).toBeUndefined()
    expect(init?.body).toBeInstanceOf(URLSearchParams)
    const body = init?.body as URLSearchParams
    expect([...body.keys()]).toEqual(['data'])
    expect(body.get('data')).toBe(buildOverpassQuery(AREA))
  })

  it('sends nothing that identifies the user', async () => {
    const fetch = scripted(ok)
    await fetchOverpass(AREA, undefined, { fetch, servers: SERVERS })
    const [url, init] = fetch.mock.calls[0]
    expect(Object.keys(init ?? {}).sort()).toEqual(['body', 'method', 'signal'])
    expect(`${String(url)} ${String(init?.body)}`).not.toMatch(/@|mail|user|contact/i)
  })

  it('goes to the public servers in their order when none is given', async () => {
    const fetch = scripted(() => status(504), ok)
    await fetchOverpass(AREA, undefined, { fetch })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(OVERPASS_SERVERS.slice(0, 2))
  })

  it('moves to the next server when one is busy or cannot be reached', async () => {
    const fetch = scripted(() => status(504), unreachable, ok)
    const seen: OverpassProgress[] = []
    const data = await fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, sleep: noWait, onProgress: (p) => seen.push(p) })
    expect(data.elements).toHaveLength(3)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(SERVERS)
    expect(seen.filter((p) => p.phase === 'asking').map((p) => [p.server, p.attempt, p.attempts])).toEqual([
      ['one.example', 1, 6],
      ['two.example', 2, 6],
      ['three.example', 3, 6],
    ])
  })

  it('goes through the servers once more after a pause when all of them are busy', async () => {
    const fetch = scripted(() => status(429), () => status(504), () => status(503), () => status(504), ok)
    const sleep = vi.fn(async () => {})
    const seen: OverpassProgress[] = []
    const data = await fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, sleep, pauseMs: 15_000, onProgress: (p) => seen.push(p) })
    expect(data.elements).toHaveLength(3)
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep.mock.calls[0]).toEqual([15_000, undefined])
    expect(seen.find((p) => p.phase === 'waiting')).toEqual({ phase: 'waiting', server: '', attempt: 3, attempts: 6, waitSeconds: 15 })
  })

  it('gives up after the second round, with a message that offers a way out', async () => {
    const fetch = scripted(() => status(504))
    const error = await failure(fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, sleep: noWait }))
    expect(error.kind).toBe('busy')
    expect(error.message).toBe(OSM_ERROR_MESSAGES.busy)
    expect(error.message).toContain('importez depuis un fichier')
    expect(fetch).toHaveBeenCalledTimes(6)
  })

  it('does not insist when no server can be reached: the user is offline', async () => {
    const fetch = scripted(unreachable)
    const sleep = vi.fn(async () => {})
    const error = await failure(fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, sleep }))
    expect(error.kind).toBe('offline')
    expect(error.message).toBe(OSM_ERROR_MESSAGES.offline)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('reads the time-out a server reports inside a 200 answer as an area too large', async () => {
    const remark = { elements: [], remark: 'runtime error: Query timed out in "query" at line 2 after 61 seconds.' }
    const fetch = scripted(() => ok(remark))
    const sleep = vi.fn(async () => {})
    const error = await failure(fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, sleep }))
    expect(error.kind).toBe('too-large')
    expect(error.message).toBe('La zone est trop grande pour le serveur : il a abandonné la requête. Réduisez le rayon.')
    // Every server is given its chance, but there is no second round
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('reads a memory failure the same way, and still takes the answer of a server that copes', async () => {
    const remark = { elements: [], remark: 'runtime error: Query ran out of memory in "recurse" at line 3.' }
    const fetch = scripted(() => ok(remark), ok)
    const data = await fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, sleep: noWait })
    expect(data.elements).toHaveLength(3)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('takes an error page sent with a 200 status for a busy server', async () => {
    const page = () => new Response('<html><body>rate_limited</body></html>', { status: 200 })
    const fetch = scripted(page, ok)
    const data = await fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, sleep: noWait })
    expect(data.elements).toHaveLength(3)
  })

  it('says that no track was found, without asking the other servers', async () => {
    const fetch = scripted(() => ok({ elements: [] }))
    const error = await failure(fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, sleep: noWait }))
    expect(error.kind).toBe('empty')
    expect(error.message).toBe('Aucune voie ferrée trouvée dans cette zone.')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refuses an area too large before asking anything', async () => {
    const fetch = scripted(ok)
    const error = await failure(fetchOverpass({ ...AREA, radiusKm: 40 }, undefined, { fetch, servers: SERVERS }))
    expect(error.kind).toBe('too-large')
    expect(error.message).toBe('Le rayon ne peut pas dépasser 15 km.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports an unreadable answer when that is all the servers give', async () => {
    const fetch = scripted(() => ok({ nothing: true }))
    const error = await failure(fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, sleep: noWait }))
    expect(error.kind).toBe('invalid')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('drops a server that does not answer in time and moves on', async () => {
    const hanging = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    let call = 0
    const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => (call++ === 0 ? hanging(url, init) : Promise.resolve(ok())))
    const data = await fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, timeoutMs: 5, sleep: noWait })
    expect(data.elements).toHaveLength(3)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops at once when the user cancels a request', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    const pending = failure(fetchOverpass(AREA, undefined, { fetch, servers: SERVERS, signal: controller.signal }))
    controller.abort()
    const error = await pending
    expect(error.kind).toBe('aborted')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stops at once when the user cancels during the pause', async () => {
    const controller = new AbortController()
    const fetch = scripted(() => status(504))
    const seen: OverpassProgress[] = []
    const pending = failure(
      fetchOverpass(AREA, undefined, {
        fetch,
        servers: SERVERS,
        signal: controller.signal,
        pauseMs: 60_000,
        onProgress: (p) => {
          seen.push(p)
          if (p.phase === 'waiting') controller.abort()
        },
      }),
    )
    const error = await pending
    expect(error.kind).toBe('aborted')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('reports how much has been received', async () => {
    const seen: OverpassProgress[] = []
    await fetchOverpass(AREA, undefined, { fetch: scripted(ok), servers: SERVERS, onProgress: (p) => seen.push(p) })
    const received = seen.filter((p) => p.phase === 'receiving')
    expect(received.length).toBeGreaterThan(0)
    expect(received[received.length - 1].receivedBytes).toBe(JSON.stringify(tracks).length)
  })
})
