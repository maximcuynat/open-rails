import { test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deserializeNetwork, type SerializedProject } from '@infrastructure/persistence/persistence'
import { unionProjects } from '@infrastructure/persistence/projectSlices'
import { readDatasetIndex } from '@domain/dataset/datasetIndex'
import { createRakeAtStation } from '@domain/models/rakePlacement'
import { verifyNetworkRevisions } from '@domain/models/networkWatch'
import { advanceTrainSet, trackLeftAhead } from '@domain/models/train'

verifyNetworkRevisions(false)

const DIR = fileURLToPath(new URL('../../public/data/lgv/', import.meta.url))
const read = <T>(name: string): T => JSON.parse(readFileSync(`${DIR}${name}`, 'utf8')) as T

// At which stations of the published dataset a complete rake can be set down for the sandbox.
// Run by hand: PROFILE=1 npx vitest run tools/perf/measure-sandbox-stations.test.ts --silent=false
test.runIf(process.env.PROFILE && existsSync(`${DIR}index.json`))('sandbox start at every station', { timeout: 600_000 }, () => {
  const index = readDatasetIndex(read<unknown>('index.json'))
  const files = new Map(index.lines.map((line) => [line.id, read<SerializedProject>(line.file)]))
  let ok = 0
  for (const station of index.stations) {
    const t0 = performance.now()
    const net = deserializeNetwork(unionProjects(station.lines.map((id) => files.get(id)!))).network
    const loaded = performance.now() - t0
    const there = net.stations.get(station.id)
    const t1 = performance.now()
    const placed = there ? createRakeAtStation(net, there, 'duplex') : null
    const ahead = placed ? (trackLeftAhead(net, placed.train, 2000) ?? 2000) : 0
    const place = performance.now() - t1
    // A start is good when the rake can leave: 300 m of track at least before the first points to set, and it moves
    const leaves = placed !== null && ahead >= 300 && advanceTrainSet(net, placed.train, 100)
    if (leaves) ok++
    process.stderr.write(
      `${leaves ? 'ok  ' : placed ? 'STUCK' : 'FAIL'} ${station.name} — ${station.lines.length} line(s), ${there?.stops.length ?? 0} stop(s), ` +
        `load ${loaded.toFixed(0)} ms, place ${place.toFixed(0)} ms, ${ahead.toFixed(0)} m ahead${placed?.stop.ref ? `, voie ${placed.stop.ref}` : ''}\n`,
    )
  }
  process.stderr.write(`${ok} / ${index.stations.length} stations\n`)
})
