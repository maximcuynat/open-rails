import { describe, expect, it } from 'vitest'
import { formatRouteDistance, formatRouteDuration, routeStatusNote, stationChoices } from './itineraryModel'

describe('the itinerary panel', () => {
  it('writes a distance in metres, then in kilometres, marked when estimated', () => {
    expect(formatRouteDistance(null, true)).toBe('—')
    expect(formatRouteDistance(847, true)).toBe('850 m')
    expect(formatRouteDistance(12_430, true)).toBe('12,4 km')
    expect(formatRouteDistance(662_300, false)).toBe('≈ 662 km')
    expect(formatRouteDistance(-3, true)).toBe('0 m')
  })

  it('writes a time left in minutes, then in hours, always as an estimate', () => {
    expect(formatRouteDuration(null)).toBe('—')
    expect(formatRouteDuration(20)).toBe('< 1 min')
    expect(formatRouteDuration(840)).toBe('≈ 14 min')
    expect(formatRouteDuration(3900)).toBe('≈ 1 h 05')
    expect(formatRouteDuration(-5)).toBe('< 1 min')
  })

  it('has a word for a way that is not ahead', () => {
    expect(routeStatusNote('ok')).toBeNull()
    expect(routeStatusNote('arrived')).toBeNull()
    expect(routeStatusNote('behind')).toMatch(/cabine/)
    expect(routeStatusNote('no-path')).toMatch(/Aucun chemin/)
  })

  it('finds stations by name on a project without a dataset, those taken left out', () => {
    const refs = new Map([
      ['a', { id: 'a', name: 'Lyon Part Dieu', x: 0, y: 0 }],
      ['b', { id: 'b', name: 'Lyon Perrache', x: 0, y: 0 }],
      ['c', { id: 'c', name: 'Mâcon', x: 0, y: 0 }],
    ])
    expect(stationChoices(null, refs, 'lyon', new Set(['a']))).toEqual([{ id: 'b', name: 'Lyon Perrache' }])
    expect(stationChoices(null, refs, 'macon', new Set())).toEqual([{ id: 'c', name: 'Mâcon' }])
    expect(stationChoices(null, refs, '  ', new Set())).toEqual([])
  })
})
