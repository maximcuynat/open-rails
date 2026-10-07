import { describe, expect, it } from 'vitest'
import { DATASET_INDEX_UNREADABLE, readDatasetIndex } from './datasetIndex'
import { minimalIndex } from './datasetIndex.testkit'

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
