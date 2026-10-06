import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OsmError } from './osmError'
import { buildPlaceSearchUrl, clearPlaceSearchCache, searchPlaces } from './placeSearch'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

const lyon = { lat: '48.8448057', lon: '2.3735261', display_name: 'Gare de Lyon, Paris, Île-de-France, France', name: 'Gare de Lyon', type: 'station', address: { country_code: 'fr' } }
const lyonBelgium = { lat: '50.1', lon: '4.9', display_name: 'Lyon, Namur, Belgique', name: 'Lyon', type: 'hamlet', address: { country_code: 'be' } }

async function failure(promise: Promise<unknown>): Promise<OsmError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof OsmError) return error
    throw error
  }
  throw new Error('expected a failure')
}

beforeEach(() => clearPlaceSearchCache())

describe('place search', () => {
  it('asks Nominatim for a few results in French, France preferred but not imposed', () => {
    const url = new URL(buildPlaceSearchUrl('Gare de Lyon, Paris'))
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search')
    expect(url.searchParams.get('q')).toBe('Gare de Lyon, Paris')
    expect(url.searchParams.get('format')).toBe('jsonv2')
    expect(url.searchParams.get('limit')).toBe('6')
    expect(url.searchParams.get('accept-language')).toBe('fr')
    expect(url.searchParams.get('viewbox')).toBe('-5.5,51.5,10,41')
    expect(url.searchParams.has('bounded')).toBe(false)
    expect(url.searchParams.has('countrycodes')).toBe(false)
  })

  it('sends nothing that identifies the user', async () => {
    const fetch = vi.fn(async () => json([lyon]))
    await searchPlaces('Gare de Lyon', { fetch })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url).searchParams.has('email')).toBe(false)
    expect(url).not.toContain('@')
    expect(init.headers).toBeUndefined()
    expect(init.method).toBeUndefined()
  })

  it('puts the places in France first and keeps the others', async () => {
    const fetch = vi.fn(async () => json([lyonBelgium, lyon]))
    const results = await searchPlaces('Lyon', { fetch })
    expect(results).toEqual([
      { lat: 48.8448057, lon: 2.3735261, label: 'Gare de Lyon, Paris, Île-de-France, France', name: 'Gare de Lyon', kind: 'gare' },
      { lat: 50.1, lon: 4.9, label: 'Lyon, Namur, Belgique', name: 'Lyon', kind: 'hameau' },
    ])
  })

  it('does not ask twice for the same text', async () => {
    const fetch = vi.fn(async () => json([lyon]))
    await searchPlaces('Gare de Lyon', { fetch })
    await searchPlaces('  gare de lyon ', { fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('asks nothing for an empty text', async () => {
    const fetch = vi.fn(async () => json([]))
    expect(await searchPlaces('   ', { fetch })).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('says so when nothing is found', async () => {
    const error = await failure(searchPlaces('Xyzzy', { fetch: async () => json([]) }))
    expect(error.kind).toBe('not-found')
    expect(error.message).toBe('Aucun lieu trouvé pour « Xyzzy ».')
  })

  it('says so when the service refuses, and offers the other way in', async () => {
    const error = await failure(searchPlaces('Dijon', { fetch: async () => json({}, 429) }))
    expect(error.kind).toBe('busy')
    expect(error.message).toContain('collez des coordonnées')
  })

  it('says so when the service cannot be reached', async () => {
    const error = await failure(
      searchPlaces('Dijon', {
        fetch: async () => {
          throw new TypeError('Failed to fetch')
        },
      }),
    )
    expect(error.kind).toBe('offline')
  })

  it('stops when the user cancels', async () => {
    const controller = new AbortController()
    const fetch = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    const pending = failure(searchPlaces('Dijon', { fetch, signal: controller.signal }))
    controller.abort()
    expect((await pending).kind).toBe('aborted')
  })
})
