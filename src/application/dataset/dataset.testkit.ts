import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
import { DATASET_ATTRIBUTION, type DatasetIndex } from '@domain/dataset/datasetIndex'
import { resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'
import { sliceProject } from '@infrastructure/persistence/projectSlices'

// A small dataset built in a store, for the tests of the loaders and of the locked project.

export interface FakeDataset {
  index: DatasetIndex
  /** The line files by file name, as the server would give them */
  files: Record<string, SerializedProject>
  /** Rails of lines a and b together */
  rails: number
}

/**
 * Two lines end to end along x, a and b, meeting at x = 1000 where a branch of a leaves (a
 * junction, so the meeting node is a connection); « Gare Un » on a, « Gare Deux » on b, and a
 * third line d apart with « Gare Isolée ». Cut into one file per line, as the generator does.
 */
export function fakeDataset(): FakeDataset {
  const builder = new EditorStore()
  const net = builder.network
  const n = (x: number, y = 0) => addNode(net, { x, y })
  const [n0, n500, n1000, n1500, n2000] = [0, 500, 1000, 1500, 2000].map((x) => n(x))
  const a1 = addSegment(net, n0.id, n500.id)!.id
  const a2 = addSegment(net, n500.id, n1000.id)!.id
  const a3 = addSegment(net, n1000.id, n(1500, 60).id)!.id
  const b1 = addSegment(net, n1000.id, n1500.id)!.id
  const b2 = addSegment(net, n1500.id, n2000.id)!.id
  const d1 = addSegment(net, n(0, 50_000).id, n(500, 50_000).id)!.id
  addStation(net, { id: 's1', name: 'Gare Un', uic: '8700001', pos: { x: 250, y: 0 }, stops: [{ segId: a1, t: 0.5 }] })
  addStation(net, { id: 's2', name: 'Gare Deux', uic: '8700002', pos: { x: 1750, y: 0 }, stops: [{ segId: b2, t: 0.5 }] })
  addStation(net, { id: 's3', name: 'Gare Isolée', uic: '8700003', pos: { x: 250, y: 50_000 }, stops: [{ segId: d1, t: 0.5 }] })
  builder.markDirty()
  builder.notify()
  const whole = builder.exportProject()
  delete whole.camera
  whole.osmSource = { lat: 46.5, lon: 3, frame: 'lambert93', dataDate: '2026-10-07T16:59:56Z', importedAt: '2026-10-07T20:00:00.000Z' }
  const of = (ids: string[]) => sliceProject(whole, (id) => ids.includes(id))
  const files = { 'a.json': of([a1, a2, a3]), 'b.json': of([b1, b2]), 'd.json': of([d1]) }
  const line = (id: string, lengthKm: number, box: [number, number, number, number], stations: string[]) => ({
    id,
    name: `LGV ${id.toUpperCase()}`,
    highSpeed: true,
    file: `${id}.json`,
    bytes: JSON.stringify(files[`${id}.json` as keyof typeof files]).length,
    rails: 2,
    lengthKm,
    bbox: { minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] },
    stations,
  })
  const index: DatasetIndex = {
    version: 1,
    dataDate: '2026-10-07T16:59:56Z',
    generatedAt: '2026-10-07T20:00:00.000Z',
    attribution: DATASET_ATTRIBUTION,
    frame: 'lambert93',
    origin: { lat: 46.5, lon: 3 },
    lines: [line('a', 1.5, [0, 0, 1500, 60], ['s1']), line('b', 1, [1000, 0, 2000, 0], ['s2']), line('d', 0.5, [0, 50_000, 500, 50_000], ['s3'])],
    connections: [{ nodeId: n1000.id, x: 1000, y: 0, lines: ['a', 'b'] }],
    stations: [
      { id: 's1', name: 'Gare Un', uic: '8700001', x: 250, y: 0, lines: ['a'] },
      { id: 's2', name: 'Gare Deux', uic: '8700002', x: 1750, y: 0, lines: ['b'] },
      { id: 's3', name: 'Gare Isolée', uic: '8700003', x: 250, y: 50_000, lines: ['d'] },
    ],
  }
  // The builder's own autosave must not become the next store's project
  resetMemoryStorage()
  return { index, files, rails: whole.segments.length - 1 }
}

