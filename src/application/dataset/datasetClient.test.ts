import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeIndex } from '@domain/dataset/datasetIndex.testkit'
import { DatasetError, datasetErrorMessage, datasetUrl, fetchLineFiles, loadDatasetIndex, resetDatasetIndexCache } from './datasetClient'

/** A `fetch` that answers from a table of bodies by file name */
function fakeFetch(bodies: Record<string, unknown | (() => unknown)>): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const file = url.slice(url.lastIndexOf('/') + 1)
    calls.push(file)
    const body = bodies[file]
    if (body === undefined) return new Response('not here', { status: 404 })
    const value = typeof body === 'function' ? (body as () => unknown)() : body
    if (value instanceof Error) throw value
    if (typeof value === 'string') return new Response(value, { status: 200 })
    return new Response(JSON.stringify(value), { status: 200 })
  }) as typeof fetch
  return { fetch: fetchFn, calls }
}

const project = (name: string) => ({ version: 4, name, nodes: [], segments: [] })

describe('the dataset client', () => {
  beforeEach(() => resetDatasetIndexCache())

  it('builds the address of a file beside the application', () => {
    expect(datasetUrl('x.json', '/open-rails/')).toBe('/open-rails/data/lgv/x.json')
    expect(datasetUrl('x.json', '/open-rails')).toBe('/open-rails/data/lgv/x.json')
    expect(datasetUrl('index.json', '/')).toBe('/data/lgv/index.json')
  })

  it('fetches the index once, and again after a failure', async () => {
    const good = fakeFetch({ 'index.json': fakeIndex() })
    const first = await loadDatasetIndex({ fetch: good.fetch, baseUrl: '/' })
    const second = await loadDatasetIndex({ fetch: good.fetch, baseUrl: '/' })
    expect(first).toBe(second)
    expect(good.calls).toEqual(['index.json'])

    resetDatasetIndexCache()
    const bad = fakeFetch({})
    await expect(loadDatasetIndex({ fetch: bad.fetch, baseUrl: '/' })).rejects.toMatchObject({ kind: 'http' })
    const again = await loadDatasetIndex({ fetch: good.fetch, baseUrl: '/' })
    expect(again.lines.length).toBe(5)
  })

  it('refuses an index it cannot read', async () => {
    const broken = fakeFetch({ 'index.json': { version: 2 } })
    await expect(loadDatasetIndex({ fetch: broken.fetch, baseUrl: '/' })).rejects.toMatchObject({ kind: 'invalid', message: /index\.json/ })
  })

  it('fetches the files of the lines asked, in that order, and reports its progress', async () => {
    const f = fakeFetch({ 'a.json': project('LGV A'), 'c.json': project('LGV C') })
    const progress = vi.fn()
    const files = await fetchLineFiles(fakeIndex(), ['a', 'c'], progress, { fetch: f.fetch, baseUrl: '/' })
    expect([...files.keys()]).toEqual(['a', 'c'])
    expect(files.get('c')!.name).toBe('LGV C')
    expect(progress.mock.calls.map((c) => c[0])).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })

  it('names each failure in French', async () => {
    const index = fakeIndex()
    const offline = fakeFetch({ 'a.json': () => new TypeError('Failed to fetch') })
    await expect(fetchLineFiles(index, ['a'], undefined, { fetch: offline.fetch, baseUrl: '/' })).rejects.toMatchObject({ kind: 'offline', message: /connexion/ })

    const missing = fakeFetch({})
    await expect(fetchLineFiles(index, ['a'], undefined, { fetch: missing.fetch, baseUrl: '/' })).rejects.toMatchObject({ kind: 'http', message: /a\.json.*HTTP 404/ })

    const garbage = fakeFetch({ 'a.json': 'not json' })
    await expect(fetchLineFiles(index, ['a'], undefined, { fetch: garbage.fetch, baseUrl: '/' })).rejects.toMatchObject({ kind: 'invalid', message: /a\.json/ })

    const notAProject = fakeFetch({ 'a.json': { hello: 1 } })
    await expect(fetchLineFiles(index, ['a'], undefined, { fetch: notAProject.fetch, baseUrl: '/' })).rejects.toMatchObject({ kind: 'invalid' })

    const aborted = fakeFetch({ 'a.json': () => Object.assign(new Error('aborted'), { name: 'AbortError' }) })
    await expect(fetchLineFiles(index, ['a'], undefined, { fetch: aborted.fetch, baseUrl: '/' })).rejects.toMatchObject({ kind: 'aborted' })

    const unknown = fakeFetch({ 'a.json': project('A') })
    await expect(fetchLineFiles(index, ['a', 'zz'], undefined, { fetch: unknown.fetch, baseUrl: '/' })).rejects.toMatchObject({ kind: 'missing-line', message: /« zz »/ })
    expect(unknown.calls).toEqual([])

    expect(datasetErrorMessage(new DatasetError('offline', 'x'))).toBe('x')
    expect(datasetErrorMessage(new Error('boom'))).toMatch(/inattendue/)
  })
})
