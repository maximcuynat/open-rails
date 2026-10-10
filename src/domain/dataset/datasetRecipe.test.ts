import { describe, expect, it } from 'vitest'
import { fakeIndex } from './datasetIndex.testkit'
import { DATASET_LOCKED_TOOLS, readDatasetRecipe, recipeName } from './datasetRecipe'

describe('the dataset recipe', () => {
  it('reads a saved recipe and nothing else', () => {
    expect(readDatasetRecipe({ version: 1, dataDate: 'd', lines: ['a', 'b'], stations: ['s1', 's2'] })).toEqual({ version: 1, dataDate: 'd', lines: ['a', 'b'], stations: ['s1', 's2'] })
    expect(readDatasetRecipe({ version: 1, dataDate: 'd', lines: ['a'] })).toEqual({ version: 1, dataDate: 'd', lines: ['a'], stations: [] })
    expect(readDatasetRecipe({ version: 2, dataDate: 'd', lines: ['a'] })).toBeUndefined()
    expect(readDatasetRecipe({ version: 1, dataDate: 'd', lines: [] })).toBeUndefined()
    expect(readDatasetRecipe({ version: 1, lines: ['a'] })).toBeUndefined()
    expect(readDatasetRecipe(undefined)).toBeUndefined()
    expect(readDatasetRecipe('x')).toBeUndefined()
  })

  it('names the project after its first and last station, else its lines', () => {
    const index = fakeIndex()
    expect(recipeName(index, { version: 1, dataDate: 'd', lines: ['a', 'b', 'c'], stations: ['s1', 's3', 's2'] })).toBe('Gare Un → Gare Deux')
    expect(recipeName(index, { version: 1, dataDate: 'd', lines: ['a'], stations: ['s1'] })).toBe('Gare Un')
    expect(recipeName(index, { version: 1, dataDate: 'd', lines: ['a', 'zz'], stations: ['gone'] })).toBe('LGV A + zz')
  })

  it('keeps the looking and train tools, not the drawing ones', () => {
    expect(DATASET_LOCKED_TOOLS.has('select')).toBe(true)
    expect(DATASET_LOCKED_TOOLS.has('locomotive')).toBe(true)
    expect(DATASET_LOCKED_TOOLS.has('place')).toBe(false)
    expect(DATASET_LOCKED_TOOLS.has('signal')).toBe(false)
  })
})
