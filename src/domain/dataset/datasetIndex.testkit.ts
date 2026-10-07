import { DATASET_ATTRIBUTION, type DatasetIndex, type IndexLine } from './datasetIndex'

// Indexes built by hand for the tests of the dataset modules.

/** The smallest index that reads: one line, one station on it, no connection */
export function minimalIndex(): Record<string, unknown> {
  return {
    version: 1,
    dataDate: '2026-10-07T16:59:56Z',
    generatedAt: '2026-10-07T20:00:00.000Z',
    attribution: DATASET_ATTRIBUTION,
    frame: 'lambert93',
    origin: { lat: 46.5, lon: 3 },
    lines: [line('lgv-test', 'LGV Test', 12.5, 1000, [0, 0, 1000, 1000], ['st_1'])],
    connections: [],
    stations: [{ id: 'st_1', name: 'Gare de Test', uic: '8700001', code: 'TST', x: 10, y: 20, lines: ['lgv-test'] }],
  }
}

function line(id: string, name: string, lengthKm: number, bytes: number, box: [number, number, number, number], stations: string[], highSpeed = true): IndexLine {
  return { id, name, highSpeed, file: `${id}.json`, bytes, rails: Math.round(lengthKm * 5), lengthKm, bbox: { minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] }, stations }
}

/**
 * Five lines: A — B — C in a chain (100, 50 and 80 km of track), E a direct link from A to C
 * that is longer (200 km), D apart from everything. Stations: « Gare Un » on A, « Gare Deux » on
 * C, « Échange » on A and B, two homonyms « Aéroport Test TGV » (one on A, one on B, two UIC
 * codes), « Gare Isolée » on D.
 */
export function fakeIndex(): DatasetIndex {
  return {
    version: 1,
    dataDate: '2026-10-07T16:59:56Z',
    generatedAt: '2026-10-07T20:00:00.000Z',
    attribution: DATASET_ATTRIBUTION,
    frame: 'lambert93',
    origin: { lat: 46.5, lon: 3 },
    lines: [
      line('a', 'LGV A', 100, 100_000, [0, 0, 10_000, 1_000], ['s1', 's3', 'h1']),
      line('b', 'LGV B', 50, 50_000, [10_000, 0, 15_000, 1_000], ['s3', 'h2']),
      line('c', 'LGV C', 80, 80_000, [15_000, 0, 23_000, 1_000], ['s2']),
      line('d', 'LGV D', 30, 30_000, [0, 50_000, 3_000, 51_000], ['d1']),
      line('e', 'Raccordement E', 200, 200_000, [0, -20_000, 23_000, 0], [], false),
    ],
    connections: [
      { nodeId: 'n_1', x: 10_000, y: 500, lines: ['a', 'b'] },
      { nodeId: 'n_2', x: 15_000, y: 500, lines: ['b', 'c'] },
      { nodeId: 'n_3', x: 0, y: 0, lines: ['a', 'e'] },
      { nodeId: 'n_4', x: 23_000, y: 0, lines: ['c', 'e'] },
    ],
    stations: [
      { id: 's1', name: 'Gare Un', uic: '8700001', code: 'GUN', x: 1_000, y: 500, lines: ['a'] },
      { id: 's2', name: 'Gare Deux', uic: '8700002', code: 'GDX', x: 22_000, y: 500, lines: ['c'] },
      { id: 's3', name: 'Échange', uic: '8700003', code: 'ECH', x: 10_000, y: 500, lines: ['a', 'b'] },
      { id: 'h1', name: 'Aéroport Test TGV', uic: '8700004', code: 'ATA', x: 5_000, y: 500, lines: ['a'] },
      { id: 'h2', name: 'Aéroport Test TGV', uic: '8700005', code: 'ATB', x: 12_000, y: 500, lines: ['b'] },
      { id: 'd1', name: 'Gare Isolée', uic: '8700006', code: 'GIS', x: 1_000, y: 50_500, lines: ['d'] },
    ],
  }
}
