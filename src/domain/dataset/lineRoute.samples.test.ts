import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { placementThresholds } from '../geometry/scale'
import type { Network } from '../models/types'
import { deserializeNetwork, type SerializedProject } from '../../infrastructure/persistence/persistence'
import { unionProjects } from '../../infrastructure/persistence/projectSlices'
import { readDatasetIndex, type DatasetIndex } from './datasetIndex'
import { routeThroughStations } from './lineRoute'
import { searchStations } from './stationSearch'

// On the dataset as published under `public/data/lgv/` (skipped when it has not been generated).

const DIR = fileURLToPath(new URL('../../../public/data/lgv/', import.meta.url))
const present = existsSync(`${DIR}index.json`)
const read = <T>(name: string): T => JSON.parse(readFileSync(`${DIR}${name}`, 'utf8')) as T

/** The content of a network, order aside */
function parts(net: Network): string[] {
  const out: string[] = []
  for (const n of [...net.nodes.values()].sort((a, b) => a.id.localeCompare(b.id))) out.push(`${n.id} ${n.pos.x} ${n.pos.y}`)
  for (const s of [...net.segments.values()].sort((a, b) => a.id.localeCompare(b.id))) out.push(`${s.id} ${s.from} ${s.to} ${s.kind}`)
  for (const j of [...net.junctions.values()].sort((a, b) => a.id.localeCompare(b.id))) out.push(`${j.id} ${j.nodeId} ${j.kind} ${JSON.stringify(j.passages)}`)
  return out
}

describe.runIf(present)('the route over the published index', () => {
  const index: DatasetIndex = present ? readDatasetIndex(read<unknown>('index.json')) : (null as unknown as DatasetIndex)
  const station = (query: string) => searchStations(index, query, 1)[0]?.station.id

  it('goes from Marseille Saint-Charles to Lyon Part-Dieu over the four known lines', () => {
    const route = routeThroughStations(index, [station('marseille saint charles'), station('lyon part dieu')])
    if ('error' in route) throw new Error(route.error)
    expect(route.lines[0]).toBe('racc-marseille-saint-charles')
    expect([...route.lines].sort()).toEqual(['lgv-mediterranee', 'lgv-rhone-alpes', 'racc-lyon-part-dieu-sud', 'racc-marseille-saint-charles'])
    expect(route.lengthKm).toBeGreaterThan(900)
    expect(route.bytes).toBeGreaterThan(1_500_000)
  })

  it('goes from Paris Gare de Lyon to Marseille through the LGV Sud-Est', () => {
    const route = routeThroughStations(index, [station('paris gare de lyon'), station('marseille saint charles')])
    if ('error' in route) throw new Error(route.error)
    expect(route.lines).toContain('lgv-sud-est')
    expect(route.lines).toContain('lgv-mediterranee')
  })

  it('lists the two stations of the airport of Roissy as homonyms', () => {
    const matches = searchStations(index, 'aeroport charles')
    expect(matches).toHaveLength(2)
    expect(matches.every((m) => m.homonym)).toBe(true)
    expect(new Set(matches.map((m) => m.station.uic)).size).toBe(2)
  })

  it('is already reconciled: adopting the union as it is gives the same network as reconciling it', () => {
    const route = routeThroughStations(index, [station('marseille saint charles'), station('lyon part dieu')])
    if ('error' in route) throw new Error(route.error)
    const files = new Map(index.lines.map((line) => [line.id, line.file]))
    const union = unionProjects(route.lines.map((id) => read<SerializedProject>(files.get(id)!)))
    const tolerance = placementThresholds(typeof union.gauge === 'number' ? union.gauge : undefined).reconcileTolerance
    const reconciled = deserializeNetwork(JSON.parse(JSON.stringify(union)) as SerializedProject).network
    const adopted = deserializeNetwork(union, tolerance).network
    expect(parts(adopted)).toEqual(parts(reconciled))
  })
})
