import { describe, expect, it } from 'vitest'
import { afterCall, destinationOf, itineraryFrom, nextStop, stopsAhead, straightLengthAhead, withStop, withoutStation, withoutStop } from './itinerary'

// Roughly where they are, in km east and north
const PLACES: Record<string, { x: number; y: number }> = {
  marseille: { x: 890, y: 6250 },
  avignon: { x: 845, y: 6320 },
  lyon: { x: 845, y: 6520 },
  paris: { x: 650, y: 6860 },
  lille: { x: 705, y: 7060 },
}
const place = (id: string) => PLACES[id]
const add = (it: ReturnType<typeof itineraryFrom>, id: string) => withStop(it, id, PLACES.marseille, place)

describe('the itinerary of a train', () => {
  it('starts at a station with nothing ahead', () => {
    const it0 = itineraryFrom('marseille')
    expect(stopsAhead(it0)).toEqual([])
    expect(nextStop(it0)).toBeNull()
    expect(destinationOf(it0)).toBeNull()
    expect(nextStop(undefined)).toBeNull()
  })

  it('puts a station where it lengthens the journey least: between, or after the last', () => {
    let it1 = add(itineraryFrom('marseille'), 'paris')
    expect(stopsAhead(it1)).toEqual(['paris'])
    // Lyon is on the way to Paris, whatever the order they are asked in
    it1 = add(it1, 'lyon')
    expect(stopsAhead(it1)).toEqual(['lyon', 'paris'])
    it1 = add(it1, 'avignon')
    expect(stopsAhead(it1)).toEqual(['avignon', 'lyon', 'paris'])
    // Lille is beyond Paris: the new destination
    it1 = add(it1, 'lille')
    expect(stopsAhead(it1)).toEqual(['avignon', 'lyon', 'paris', 'lille'])
    expect(destinationOf(it1)).toBe('lille')
    expect(nextStop(it1)).toBe('avignon')
  })

  it('does not add a station twice, nor one without a place', () => {
    const it1 = add(itineraryFrom('marseille'), 'paris')
    expect(add(it1, 'paris')).toBe(it1)
    expect(add(it1, 'atlantis')).toBe(it1)
  })

  it('orders from where the train is, the stations behind it left alone', () => {
    // Called at Lyon already, on the way to Lille: Paris goes before Lille, Avignon would be a way back
    let it1 = { stations: ['marseille', 'lyon', 'lille'], next: 2 }
    it1 = withStop(it1, 'paris', PLACES.lyon, place)
    expect(it1.stations).toEqual(['marseille', 'lyon', 'paris', 'lille'])
    expect(it1.next).toBe(2)
  })

  it('takes out a station ahead only, and moves on at each call', () => {
    let it1 = add(add(itineraryFrom('marseille'), 'paris'), 'lyon')
    expect(withoutStop(it1, 0)).toBe(it1)
    expect(stopsAhead(withoutStop(it1, 1))).toEqual(['paris'])
    it1 = afterCall(it1)
    expect(nextStop(it1)).toBe('paris')
    it1 = afterCall(it1)
    expect(nextStop(it1)).toBeNull()
    expect(afterCall(it1)).toBe(it1)
  })

  it('measures what is left as the crow flies', () => {
    const it1 = add(add(itineraryFrom('marseille'), 'paris'), 'lyon')
    const length = straightLengthAhead(it1, PLACES.marseille, place)
    expect(length).toBeCloseTo(Math.hypot(45, 270) + Math.hypot(195, 340), 6)
    expect(straightLengthAhead(itineraryFrom('marseille'), PLACES.marseille, place)).toBe(0)
  })
})

describe('an itinerary once a station is deleted', () => {
  it('loses the station wherever it stands, and still heads for the same next station', () => {
    // Called at a and b, heading for c
    const itinerary = { stations: ['a', 'b', 'c', 'b', 'd'], next: 2 }
    expect(withoutStation(itinerary, 'b')).toEqual({ stations: ['a', 'c', 'd'], next: 1 })
    expect(withoutStation(itinerary, 'c')).toEqual({ stations: ['a', 'b', 'b', 'd'], next: 2 })
    expect(withoutStation(itinerary, 'z')).toBe(itinerary)
    // The last station gone: arrived
    expect(withoutStation({ stations: ['a', 'b'], next: 1 }, 'b')).toEqual({ stations: ['a'], next: 1 })
  })
})
