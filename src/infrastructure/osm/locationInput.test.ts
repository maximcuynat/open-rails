import { describe, expect, it } from 'vitest'
import { formatGeoPoint, looksLikeLink, parseLocation } from './locationInput'

describe('what the user pastes in place of a search', () => {
  it('reads a pair of coordinates, latitude first', () => {
    expect(parseLocation('48.8443, 2.3744')).toEqual({ lat: 48.8443, lon: 2.3744 })
    expect(parseLocation('  48.8443 2.3744 ')).toEqual({ lat: 48.8443, lon: 2.3744 })
    expect(parseLocation('48.8443;2.3744')).toEqual({ lat: 48.8443, lon: 2.3744 })
    expect(parseLocation('(44.79, -0.556)')).toEqual({ lat: 44.79, lon: -0.556 })
  })

  it('reads decimal commas when the two numbers are told apart', () => {
    expect(parseLocation('48,8443 ; 2,3744')).toEqual({ lat: 48.8443, lon: 2.3744 })
    expect(parseLocation('48,8443 2,3744')).toEqual({ lat: 48.8443, lon: 2.3744 })
  })

  it('reads the centre of an openstreetmap.org link', () => {
    expect(parseLocation('https://www.openstreetmap.org/#map=15/48.84/2.37')).toEqual({ lat: 48.84, lon: 2.37 })
    expect(parseLocation('https://www.openstreetmap.org/way/4074141#map=17/44.82581/-0.55637&layers=T')).toEqual({ lat: 44.82581, lon: -0.55637 })
  })

  it('prefers the marker of a link to the centre of its view', () => {
    expect(parseLocation('https://www.openstreetmap.org/?mlat=48.8443&mlon=2.3744#map=12/48.9/2.5')).toEqual({ lat: 48.8443, lon: 2.3744 })
  })

  it('reads the other usual forms of a position', () => {
    expect(parseLocation('https://www.example.org/maps/@48.8443,2.3744,15z')).toEqual({ lat: 48.8443, lon: 2.3744 })
    expect(parseLocation('geo:48.8443,2.3744')).toEqual({ lat: 48.8443, lon: 2.3744 })
    expect(parseLocation('https://example.org/map?lat=47.32&lon=5.02')).toEqual({ lat: 47.32, lon: 5.02 })
  })

  it('leaves a place name alone', () => {
    expect(parseLocation('Gare de Lyon, Paris')).toBeNull()
    expect(parseLocation('Dijon 21000')).toBeNull()
    expect(parseLocation('')).toBeNull()
    expect(parseLocation('https://www.openstreetmap.org/way/4074141')).toBeNull()
  })

  it('refuses a position that is not on the globe', () => {
    expect(parseLocation('95.0, 2.0')).toBeNull()
    expect(parseLocation('48.0, 190.0')).toBeNull()
  })

  it('tells a link from a name, so that an unreadable link is not searched as a place', () => {
    expect(looksLikeLink('https://www.openstreetmap.org/way/4074141')).toBe(true)
    expect(looksLikeLink('www.openstreetmap.org')).toBe(true)
    expect(looksLikeLink('Gare de Lyon')).toBe(false)
  })

  it('writes a position the French way', () => {
    expect(formatGeoPoint({ lat: 48.8443, lon: 2.3744 })).toBe('48,8443° N, 2,3744° E')
    expect(formatGeoPoint({ lat: -33.9, lon: -70.65 })).toBe('33,9000° S, 70,6500° O')
  })
})
