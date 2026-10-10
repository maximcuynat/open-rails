import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { addNode, addSegment, createNetwork } from './network'
import { addStation } from './stations'
import { createLambert93Projection, createProjection } from '../import/osmProjection'
import { matchStationRegistry, readStationRegistry, type StationRegistryEntry } from './stationRegistry'

/** The file the application ships */
const FILE = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/stations-fr.json', import.meta.url)), 'utf8'))

const clelles: StationRegistryEntry = { name: 'Clelles - Mens', trigram: 'CMS', uicCodes: ['87747626'], lat: 44.827244, lon: 5.605062, segment: 'C' }
const marseille: StationRegistryEntry = { name: 'Marseille Saint-Charles', trigram: 'MSC', uicCodes: ['87751008'], lat: 43.302666, lon: 5.380407, segment: 'A' }

describe('the registry of the official stations', () => {
  it('reads the shipped file: every passenger station of France, with its codes', () => {
    const entries = readStationRegistry(FILE)
    expect(entries.length).toBeGreaterThan(2700)
    expect(entries.find((e) => e.trigram === 'MSC')).toEqual(marseille)
    expect(entries.find((e) => e.trigram === 'CMS')).toEqual(clelles)
    // Several codes on one station, as the file writes them
    expect(entries.find((e) => e.name === 'Avignon TGV')!.uicCodes).toEqual(['87318964', '87981902'])
    expect(entries.every((e) => e.uicCodes.every((c) => /^\d{8}$/.test(c)))).toBe(true)
  })

  it('leaves out what does not hold together', () => {
    const entries = readStationRegistry({
      stations: [
        ['Bonne', 'BON', ['87000001'], 45, 5, 'B'],
        ['Sans code ni classe', '', [], 45.1, 5.1, ''],
        ['Code faux', 'bo', ['8700', 'x'], 45.2, 5.2, 'Z'],
        ['', 'VID', [], 45, 5, 'A'],
        ['Mal placée', 'MAL', [], 'nord', 5, 'A'],
        'pas une ligne',
        null,
      ],
    })
    expect(entries).toEqual([
      { name: 'Bonne', trigram: 'BON', uicCodes: ['87000001'], lat: 45, lon: 5, segment: 'B' },
      { name: 'Sans code ni classe', uicCodes: [], lat: 45.1, lon: 5.1 },
      { name: 'Code faux', uicCodes: [], lat: 45.2, lon: 5.2 },
    ])
    expect(readStationRegistry(null)).toEqual([])
    expect(readStationRegistry({ stations: 'none' })).toEqual([])
  })

  it('matches a station by its UIC code first, whatever its place or name', () => {
    const net = createNetwork()
    const station = addStation(net, { name: 'Clelles', pos: { x: 0, y: 0 }, uic: '8774762', stops: [] })
    const project = createProjection(44.8, 5.6)
    expect(matchStationRegistry(net, [marseille, clelles], project)).toBe(1)
    expect(station).toMatchObject({ name: 'Clelles - Mens', code: 'CMS', uic: '8774762' })
  })

  it('matches a station without code to the nearest official one within 300 m, in the frame of the network', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    addSegment(net, a.id, addNode(net, { x: 100, y: 0 }).id)
    for (const project of [createLambert93Projection(), createProjection(43.3, 5.38)]) {
      const at = project(marseille.lat, marseille.lon)
      const near = addStation(net, { name: 'Marseille-St-Charles', pos: { x: at.x + 120, y: at.y - 80 }, stops: [] })
      const far = addStation(net, { name: 'Ailleurs', pos: { x: at.x + 2000, y: at.y }, stops: [] })
      expect(matchStationRegistry(net, [clelles, marseille], project)).toBe(1)
      expect(near).toMatchObject({ name: 'Marseille Saint-Charles', code: 'MSC', uic: '8775100' })
      expect(far).toMatchObject({ name: 'Ailleurs' })
      expect(far.code).toBeUndefined()
      net.stations.clear()
    }
  })

  it('does nothing without stations or without registry', () => {
    const net = createNetwork()
    expect(matchStationRegistry(net, [clelles], createProjection(44.8, 5.6))).toBe(0)
    const station = addStation(net, { name: 'X', pos: { x: 0, y: 0 }, uic: '8774762', stops: [] })
    expect(matchStationRegistry(net, [], createProjection(44.8, 5.6))).toBe(0)
    expect(station.name).toBe('X')
  })
})
