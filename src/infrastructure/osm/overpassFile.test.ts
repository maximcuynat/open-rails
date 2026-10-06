import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OsmError } from './osmError'
import { hasRailwayWay, readOverpassAnswer, readOverpassFile } from './overpassFile'

const file = (name: string, content: string) => ({ name, text: async () => content })

const answer = {
  version: 0.6,
  osm3s: { timestamp_osm_base: '2026-10-06T07:12:00Z', copyright: '…' },
  elements: [
    { type: 'node', id: 1, lat: 48.84, lon: 2.37, tags: { railway: 'switch' } },
    { type: 'node', id: 2, lat: 48.85, lon: 2.38 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { railway: 'rail' } },
  ],
}

async function failure(promise: Promise<unknown>): Promise<OsmError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof OsmError) return error
    throw error
  }
  throw new Error('expected a failure')
}

describe('reading an Overpass file', () => {
  it('gives the elements and the date of the data', async () => {
    const data = await readOverpassFile(file('zone.json', JSON.stringify(answer)))
    expect(data.elements).toHaveLength(3)
    expect(data.osm3s?.timestamp_osm_base).toBe('2026-10-06T07:12:00Z')
    expect(hasRailwayWay(data)).toBe(true)
  })

  it('leaves out the elements it cannot read rather than refusing the file', () => {
    const data = readOverpassAnswer({
      elements: [...answer.elements, { type: 'node', id: 3 }, { type: 'way', id: 11 }, { type: 'area', id: 12 }, null, 'x'],
    })
    expect(data.elements.map((el) => el.id)).toEqual([1, 2, 10])
    expect(data.osm3s).toBeUndefined()
  })

  it('says so when the file is not JSON', async () => {
    const error = await failure(readOverpassFile(file('zone.osm', '<osm version="0.6">')))
    expect(error.kind).toBe('invalid')
    expect(error.message).toBe('« zone.osm » n’est pas un fichier JSON lisible.')
  })

  it('names a project file for what it is', async () => {
    const error = await failure(readOverpassFile(file('gare.json', JSON.stringify({ version: 2, nodes: [], segments: [] }))))
    expect(error.kind).toBe('invalid')
    expect(error.message).toContain('est un projet Open Rails')
    expect(error.message).toContain('Importer JSON…')
  })

  it('names a GeoJSON file for what it is', async () => {
    const error = await failure(readOverpassFile(file('export.geojson', JSON.stringify({ type: 'FeatureCollection', features: [] }))))
    expect(error.message).toContain('GeoJSON')
  })

  it('refuses any other JSON', async () => {
    const error = await failure(readOverpassFile(file('autre.json', '[1, 2]')))
    expect(error.kind).toBe('invalid')
    expect(error.message).toContain('n’est pas une réponse d’Overpass')
  })

  it('says so when the file holds no track', async () => {
    const roads = { elements: [{ type: 'way', id: 1, nodes: [1, 2], tags: { highway: 'residential' } }] }
    const error = await failure(readOverpassFile(file('routes.json', JSON.stringify(roads))))
    expect(error.kind).toBe('empty')
    expect(error.message).toBe('« routes.json » ne contient aucune voie ferrée.')
  })

  it('reads the smallest sample of the research', async () => {
    const path = fileURLToPath(new URL('../../../tasks/import-osm-echantillons/zone-b-clelles-mens-voie-unique-ligne-des-alpes.json', import.meta.url))
    const data = await readOverpassFile(file('zone-b.json', readFileSync(path, 'utf8')))
    expect(data.elements.filter((el) => el.type === 'way' && el.tags?.railway === 'rail')).toHaveLength(33)
    expect(data.osm3s?.timestamp_osm_base).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
