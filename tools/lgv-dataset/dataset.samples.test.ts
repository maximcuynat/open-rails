import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deserializeNetwork, type SerializedProject } from '@infrastructure/persistence/persistence'
import { unionProjects } from '@infrastructure/persistence/projectSlices'
import type { DatasetIndex } from './datasetIndex'

// The dataset as it is published under `public/data/lgv/`: skipped when it has not been generated
// (a fresh checkout without the data still passes `npm test`).

const DIR = fileURLToPath(new URL('../../public/data/lgv/', import.meta.url))
const INDEX = `${DIR}index.json`
const present = existsSync(INDEX)

const read = <T>(name: string): T => JSON.parse(readFileSync(`${DIR}${name}`, 'utf8')) as T

describe.runIf(present)('the published « LGV France » dataset', () => {
  const index = present ? read<DatasetIndex>('index.json') : (null as unknown as DatasetIndex)

  it('names its lines, each with a file that loads as the index says', () => {
    expect(index.version).toBe(1)
    expect(index.frame).toBe('lambert93')
    expect(index.lines.length).toBeGreaterThan(3)
    for (const line of index.lines) {
      const project = read<SerializedProject>(line.file)
      expect(project.segments.length, line.id).toBe(line.rails)
      expect(project.osmSource?.frame, line.id).toBe('lambert93')
      const loaded = deserializeNetwork(project)
      expect(loaded.network.segments.size, line.id).toBe(line.rails)
      for (const stationId of line.stations) expect(project.stations!.some((s) => s.id === stationId), `${line.id} ${stationId}`).toBe(true)
    }
  })

  it('has every connection on a node both lines hold, and every station in the files of its lines', () => {
    const files = new Map(index.lines.map((line) => [line.id, read<SerializedProject>(line.file)]))
    for (const connection of index.connections) {
      expect(connection.lines.length).toBeGreaterThan(1)
      for (const id of connection.lines) expect(files.get(id)!.nodes.some((n) => n.id === connection.nodeId), `${connection.nodeId} in ${id}`).toBe(true)
    }
    for (const station of index.stations) {
      expect(station.lines.length).toBeGreaterThan(0)
      for (const id of station.lines) expect(files.get(id)!.stations!.some((s) => s.id === station.id), `${station.name} in ${id}`).toBe(true)
    }
  })

  it('knows the stations of the Marseille – Lyon journey, and their lines put together make one network', () => {
    const wanted = ['Marseille Saint-Charles', 'Aix-en-Provence TGV', 'Avignon TGV', 'Lyon Part Dieu']
    const found = wanted.map((name) => index.stations.find((s) => s.name === name))
    for (const [i, station] of found.entries()) expect(station, wanted[i]).toBeDefined()
    const lines = new Set(found.flatMap((s) => s!.lines))
    const union = unionProjects([...lines].map((id) => read<SerializedProject>(index.lines.find((l) => l.id === id)!.file)))
    const loaded = deserializeNetwork(union)
    expect(loaded.network.segments.size).toBe(union.segments.length)
    for (const station of found) expect(loaded.network.stations.has(station!.id)).toBe(true)
  })
})
