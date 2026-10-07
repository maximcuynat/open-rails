import { describe, expect, it } from 'vitest'
import { DATASET_ATTRIBUTION, DATASET_INDEX_UNREADABLE, readDatasetIndex } from './datasetIndex'

/** The smallest index that reads: one line, one station on it, no connection */
export function minimalIndex(): Record<string, unknown> {
  return {
    version: 1,
    dataDate: '2026-10-07T16:59:56Z',
    generatedAt: '2026-10-07T20:00:00.000Z',
    attribution: DATASET_ATTRIBUTION,
    frame: 'lambert93',
    origin: { lat: 46.5, lon: 3 },
    lines: [
      {
        id: 'lgv-test',
        name: 'LGV Test',
        highSpeed: true,
        file: 'lgv-test.json',
        bytes: 1000,
        rails: 10,
        lengthKm: 12.5,
        bbox: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
        stations: ['st_1'],
      },
    ],
    connections: [],
    stations: [{ id: 'st_1', name: 'Gare de Test', uic: '8700001', code: 'TST', x: 10, y: 20, lines: ['lgv-test'] }],
  }
}

describe('readDatasetIndex', () => {
  it('reads a minimal index and keeps what it does not know', () => {
    const raw = { ...minimalIndex(), extra: 'kept' }
    const index = readDatasetIndex(raw)
    expect(index.lines[0].id).toBe('lgv-test')
    expect(index.stations[0].lines).toEqual(['lgv-test'])
    expect((index as unknown as Record<string, unknown>).extra).toBe('kept')
  })

  it('refuses another version, a missing list and a line without a file', () => {
    expect(() => readDatasetIndex({ ...minimalIndex(), version: 2 })).toThrow(DATASET_INDEX_UNREADABLE)
    const noLines = minimalIndex()
    delete noLines.lines
    expect(() => readDatasetIndex(noLines)).toThrow(DATASET_INDEX_UNREADABLE)
    const noFile = minimalIndex()
    delete (noFile.lines as Record<string, unknown>[])[0].file
    expect(() => readDatasetIndex(noFile)).toThrow(DATASET_INDEX_UNREADABLE)
    expect(() => readDatasetIndex(null)).toThrow(DATASET_INDEX_UNREADABLE)
    expect(() => readDatasetIndex('[]')).toThrow(DATASET_INDEX_UNREADABLE)
  })
})
