import { test } from 'vitest'
import { readFileSync } from 'node:fs'
import { verifyNetworkRevisions } from '@domain/models/networkWatch'
import { readDatasetIndex, type BBox, type LineId } from '@domain/dataset/datasetIndex'
import { resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'
import { EditorStore } from '@application/state/editorStore'

/**
 * Lot V2 of `tasks/plan-vue-reseau.md`: what adding and dropping one piece of the « LGV France »
 * dataset costs, as the network grows. The pieces are taken nearest first from Paris (a sweep of
 * the map), added one at a time, then dropped one at a time. Run by hand:
 *
 *   PROFILE=1 npx vitest run tools/perf/measure-dataset-pieces.test.ts --silent=false
 *   PROFILE=1 PIECES=40 npx vitest run tools/perf/measure-dataset-pieces.test.ts --silent=false
 */

verifyNetworkRevisions(false)

const out = (line: string): void => {
  process.stderr.write(line + '\n')
}
const dir = 'public/data/lgv/'
const centre = (b: BBox): { x: number; y: number } => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 })

test.runIf(process.env.PROFILE)('add and drop the pieces of the dataset one by one', { timeout: 600_000 }, () => {
  const index = readDatasetIndex(JSON.parse(readFileSync(dir + 'index.json', 'utf8')))
  const paris = index.stations.find((s) => s.name.startsWith('Paris')) ?? index.stations[0]
  const count = Number(process.env.PIECES ?? 30)
  const order = [...index.lines]
    .sort((a, b) => {
      const ca = centre(a.bbox)
      const cb = centre(b.bbox)
      return Math.hypot(ca.x - paris.x, ca.y - paris.y) - Math.hypot(cb.x - paris.x, cb.y - paris.y)
    })
    .slice(0, count)
  const file = (id: LineId): SerializedProject => JSON.parse(readFileSync(dir + index.lines.find((l) => l.id === id)!.file, 'utf8'))
  resetMemoryStorage()
  const store = new EditorStore()
  const first = order[0].id
  const firstFile = file(first)
  store.loadDataset({ version: 1, dataDate: index.dataDate, lines: [first], stations: [] }, firstFile, new Map([[first, firstFile]]), index, null)
  const adds: number[] = []
  const wholeAdds: number[] = []
  for (const line of order.slice(1)) {
    const project = file(line.id)
    const t0 = performance.now()
    store.addDatasetLines(new Map([[line.id, project]]))
    const whole = performance.now() - t0
    adds.push(store.datasetLastAddMs)
    wholeAdds.push(whole)
    out(`+ ${line.id.padEnd(34)} ${String(project.segments.length).padStart(5)} rails  ${store.datasetLastAddMs.toFixed(1).padStart(7)} ms, with notify ${whole.toFixed(1).padStart(7)} ms   (network ${store.network.segments.size} rails)`)
  }
  const removes: number[] = []
  const wholeRemoves: number[] = []
  for (const line of order.slice(1).reverse()) {
    const t0 = performance.now()
    store.removeDatasetLines([line.id])
    const whole = performance.now() - t0
    removes.push(store.datasetLastRemoveMs)
    wholeRemoves.push(whole)
    out(`- ${line.id.padEnd(34)} ${store.datasetLastRemoveMs.toFixed(1).padStart(7)} ms, with notify ${whole.toFixed(1).padStart(7)} ms   (network ${store.network.segments.size} rails)`)
  }
  const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0)
  out(`add: total ${sum(adds).toFixed(0)} ms, mean ${(sum(adds) / adds.length).toFixed(1)} ms, max ${Math.max(...adds).toFixed(1)} ms`)
  out(`add with notify: total ${sum(wholeAdds).toFixed(0)} ms, mean ${(sum(wholeAdds) / wholeAdds.length).toFixed(1)} ms, max ${Math.max(...wholeAdds).toFixed(1)} ms`)
  out(`drop with notify: total ${sum(wholeRemoves).toFixed(0)} ms, mean ${(sum(wholeRemoves) / wholeRemoves.length).toFixed(1)} ms, max ${Math.max(...wholeRemoves).toFixed(1)} ms`)
  out(`drop: total ${sum(removes).toFixed(0)} ms, mean ${(sum(removes) / removes.length).toFixed(1)} ms, max ${Math.max(...removes).toFixed(1)} ms`)
})
