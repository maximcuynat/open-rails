import { describe, expect, it } from 'vitest'
import { fakeIndex } from './datasetIndex.testkit'
import { searchStations, stationBadge } from './stationSearch'

describe('searchStations', () => {
  const index = fakeIndex()
  const names = (query: string, limit?: number) => searchStations(index, query, limit).map((m) => m.station.id)

  it('matches every word typed as the beginning of a word of the name, accents and case aside', () => {
    expect(names('gare')).toEqual(['s2', 'd1', 's1'])
    expect(names('GARE un')).toEqual(['s1'])
    expect(names('echange')).toEqual(['s3'])
    expect(names('aeroport')).toEqual(['h1', 'h2'])
    expect(names('deux gare')).toEqual(['s2'])
    expect(names('gar deu')).toEqual(['s2'])
  })

  it('puts the names that begin with the query first, then the stations on most lines', () => {
    // « Échange » is on two lines but does not begin with « gare »
    expect(names('gare')).toEqual(['s2', 'd1', 's1'])
    expect(names('e')).toEqual(['s3'])
  })

  it('finds a station by its trigram', () => {
    expect(names('gdx')).toEqual(['s2'])
    expect(names('GUN')).toEqual(['s1'])
  })

  it('gives nothing for an empty query and respects the limit', () => {
    expect(names('')).toEqual([])
    expect(names('   ')).toEqual([])
    expect(names('gare', 2)).toEqual(['s2', 'd1'])
    expect(names('zzz')).toEqual([])
  })

  it('flags homonyms and tells them apart by their codes in the badge', () => {
    const [first, second] = searchStations(index, 'aeroport')
    expect(first.homonym).toBe(true)
    expect(second.homonym).toBe(true)
    expect(stationBadge(first)).toBe('UIC 8700004 · ATA — LGV A')
    expect(stationBadge(second)).toBe('UIC 8700005 · ATB — LGV B')
    const [lone] = searchStations(index, 'echange')
    expect(lone.homonym).toBe(false)
    expect(lone.highSpeed).toBe(true)
    expect(stationBadge(lone)).toBe('LGV A, LGV B')
  })
})
