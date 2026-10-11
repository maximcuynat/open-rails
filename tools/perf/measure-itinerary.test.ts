import { test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deserializeNetwork, type SerializedProject } from '@infrastructure/persistence/persistence'
import { unionProjects } from '@infrastructure/persistence/projectSlices'
import { readDatasetIndex } from '@domain/dataset/datasetIndex'
import { gatesToward, routeThroughStations } from '@domain/dataset/lineRoute'
import { createRakeAtStation } from '@domain/models/rakePlacement'
import { verifyNetworkRevisions } from '@domain/models/networkWatch'
import { findRouteGuide, guideLeft } from '@domain/services/routeGuide'

verifyNetworkRevisions(false)

const DIR = fileURLToPath(new URL('../../public/data/lgv/', import.meta.url))
const read = <T>(name: string): T => JSON.parse(readFileSync(`${DIR}${name}`, 'utf8')) as T

// The rail-by-rail way of an itinerary on the published dataset: found or not, how long, how
// long it takes to find. Run by hand:
// PROFILE=1 npx vitest run tools/perf/measure-itinerary.test.ts --silent=false
test.runIf(process.env.PROFILE && existsSync(`${DIR}index.json`))('a journey rail by rail (JOURNEY="A>B>C")', { timeout: 600_000 }, () => {
  const index = readDatasetIndex(read<unknown>('index.json'))
  const station = (name: string) => index.stations.filter((s) => s.name === name).sort((a, b) => b.lines.length - a.lines.length)[0]
  const names = (process.env.JOURNEY ?? 'Marseille Saint-Charles>Lyon Part Dieu>Paris Gare de Lyon').split('>')
  const journey = names.map(station)
  const route = routeThroughStations(index, journey.map((s) => s.id))
  if ('error' in route) throw new Error(`no line route: ${route.error} at ${route.at}`)
  process.stderr.write(`lines: ${route.lines.join(' › ')}\n`)

  // With the lines of the start only: the way leads to a gate
  const first = deserializeNetwork(unionProjects(journey[0].lines.map((id) => read<SerializedProject>(index.lines.find((l) => l.id === id)!.file)))).network
  const rake = createRakeAtStation(first, first.stations.get(journey[0].id)!, 'duplex')!
  const gates = gatesToward(index, new Set(journey[0].lines), journey[1].lines)
  let t0 = performance.now()
  const toGate = findRouteGuide(first, rake.train.vehicles[0].front, first.stations.get(journey[1].id), gates)
  process.stderr.write(`start lines only (${first.segments.size} rails): ${gates.length} gate(s), ${toGate ? `${toGate.target} at ${(toGate.path.length / 1000).toFixed(1)} km${toGate.behind ? ' BEHIND' : ''}` : 'NO WAY'} — ${(performance.now() - t0).toFixed(0)} ms\n`)

  // With every line of the journey: platform to platform
  const net = deserializeNetwork(unionProjects(route.lines.map((id) => read<SerializedProject>(index.lines.find((l) => l.id === id)!.file)))).network
  const placed = createRakeAtStation(net, net.stations.get(journey[0].id)!, 'duplex')!
  let lead = placed.train.vehicles[0].front
  for (let i = 1; i < journey.length; i++) {
    t0 = performance.now()
    const after = journey[i + 1]
    const guide = findRouteGuide(net, lead, net.stations.get(journey[i].id), [], after ? { station: net.stations.get(after.id) } : undefined)
    const found = performance.now() - t0
    if (!guide) {
      process.stderr.write(`${journey[i - 1].name} → ${journey[i].name}: NO WAY (${found.toFixed(0)} ms)\n`)
      break
    }
    t0 = performance.now()
    for (let k = 0; k < 1000; k++) guideLeft(net, guide, lead)
    process.stderr.write(
      `${journey[i - 1].name} → ${journey[i].name}: ${(guide.path.length / 1000).toFixed(1)} km over ${guide.path.spans.length} stretches, voie ${guide.stop?.ref ?? '?'}${guide.behind ? ', BEHIND' : ''} — found in ${found.toFixed(0)} ms on ${net.segments.size} rails, measured in ${((performance.now() - t0) / 1000).toFixed(3)} ms\n`,
    )
    // On from the platform reached, the way the train arrived
    const last = guide.path.spans[guide.path.spans.length - 1]
    lead = { segId: last.segId, t: last.t1, forward: last.t1 >= last.t0 }
  }
})
