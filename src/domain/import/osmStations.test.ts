import { describe, it, expect, beforeEach } from 'vitest'
import { convertOsm, surveyOsm } from './osmImport'
import type { OverpassElement } from './osmTypes'
import { answer, options, osmNode, osmWay, placeIn } from './osmImport.testkit'
import { normalizedName, uicKey } from './osmStations'
import { positionOnSegment } from '../models/locomotive'
import { resetIdCounter } from '../models/network'
import type { Station } from '../models/types'

beforeEach(() => resetIdCounter(0))

/** A straight way along y = `y`, a node every 100 m from x = 0 to 400, from id `first`; `tagged[x]` tags the node at x */
function track(wayId: number, first: number, y: number, tagged: Record<number, Record<string, string>> = {}, wayTags: Record<string, string> = {}): OverpassElement[] {
  const ids = [0, 100, 200, 300, 400].map((_, i) => first + i)
  return [...ids.map((id, i) => osmNode(id, i * 100, y, tagged[i * 100])), osmWay(wayId, ids, wayTags)]
}

const STOP = { railway: 'stop', public_transport: 'stop_position', train: 'yes', name: 'Clelles-Mens', uic_ref: '8774762' }

const only = (stations: Map<string, Station>): Station => {
  expect(stations.size).toBe(1)
  return [...stations.values()][0]
}

describe('stations read from the stop positions', () => {
  it('groups the stops of one station by code, each on its platform track, in the order of the platforms', () => {
    const data = answer(track(10, 1, 0, { 200: { ...STOP, local_ref: '2' } }), track(20, 11, 6, { 200: { ...STOP, local_ref: '1' } }))
    const result = convertOsm(data, options())
    const station = only(result.network.stations)
    expect(station).toMatchObject({ name: 'Clelles-Mens', uic: '8774762' })
    expect(station.stops.map((stop) => stop.ref)).toEqual(['1', '2'])
    for (const [stop, y] of [[station.stops[0], 6], [station.stops[1], 0]] as const) {
      const place = positionOnSegment(result.network, stop.segId, stop.t)!
      const expected = placeIn(result, 200, y)
      expect(place.x).toBeCloseTo(expected.x, 1)
      expect(place.y).toBeCloseTo(expected.y, 1)
    }
    // The station stands between its platforms
    const middle = placeIn(result, 200, 3)
    expect(station.pos.x).toBeCloseTo(middle.x, 1)
    expect(station.pos.y).toBeCloseTo(middle.y, 1)
    expect(result.report.stations).toEqual({ found: 1, placed: 1, stops: 2, skipped: {} })
    expect(surveyOsm(data, options()).stations).toBe(1)
  })

  it('groups by name within a walk when there is no code, and keeps two stations of the same name apart', () => {
    const near = { railway: 'stop', name: 'Gare' }
    const data = answer(
      track(10, 1, 0, { 100: near, 300: near }),
      // The same name 5 km away: another station
      [...[0, 100, 200].map((x, i) => osmNode(100 + i, 5000 + x, 0, i === 1 ? near : undefined)), osmWay(30, [100, 101, 102])],
    )
    const stations = [...convertOsm(data, options()).network.stations.values()]
    expect(stations.map((s) => s.stops.length)).toEqual([2, 1])
    expect(stations.every((s) => s.name === 'Gare' && s.uic === undefined)).toBe(true)
  })

  it('a stop with neither name nor code makes nothing; one on a way the options leave out is left to its way', () => {
    const data = answer(
      track(10, 1, 0, { 200: { railway: 'stop' } }),
      track(20, 11, 20, { 200: { ...STOP, name: 'Métro' } }, { railway: 'subway' }),
    )
    const result = convertOsm(data, options())
    expect(result.network.stations.size).toBe(0)
    expect(result.report.stations).toEqual({ found: 0, placed: 0, stops: 0, skipped: { unnamed: 1, 'track-not-imported': 1 } })
    expect(result.report.issues.filter((issue) => issue.kind === 'station-not-placed')).toEqual([])
    // Imported with its tracks, the metro stop is a station like any other
    expect(convertOsm(data, options({ extraKinds: ['subway'] })).network.stations.size).toBe(1)
  })

  it('a station node beside the track (a building) takes the heavy-rail tracks within 80 m as its platforms, with its code', () => {
    const data = answer(
      track(10, 1, 0),
      track(20, 11, 6),
      track(30, 21, 50, {}, { railway: 'tram' }),
      osmNode(900, 200, 40, { railway: 'station', name: 'Clelles - Mens', uic_ref: '87747626', 'railway:ref': 'cms' }),
    )
    const result = convertOsm(data, options({ extraKinds: ['tram'] }))
    const station = only(result.network.stations)
    expect(station).toMatchObject({ name: 'Clelles - Mens', uic: '8774762', code: 'CMS' })
    expect(station.stops).toHaveLength(2)
    const ys = station.stops.map((stop) => positionOnSegment(result.network, stop.segId, stop.t)!.y - placeIn(result, 200, 0).y).sort((a, b) => a - b)
    expect(ys[0]).toBeCloseTo(0, 1)
    expect(ys[1]).toBeCloseTo(6, 1)
  })

  it('a station node that names the stops gives them its name and its code, and nothing more', () => {
    const data = answer(
      track(10, 1, 0, { 200: { railway: 'stop', uic_ref: '8774762' } }),
      osmNode(900, 200, 40, { railway: 'station', name: 'Clelles-Mens', uic_ref: '8774762', 'railway:ref': 'CMS' }),
    )
    const station = only(convertOsm(data, options()).network.stations)
    expect(station).toMatchObject({ name: 'Clelles-Mens', uic: '8774762', code: 'CMS' })
    expect(station.stops).toHaveLength(1)
  })

  it('a station node on the track itself is its own stop', () => {
    const data = answer(track(10, 1, 0, { 200: { railway: 'halt', name: 'Halte' } }))
    const { network } = convertOsm(data, options())
    const station = only(network.stations)
    expect(station.name).toBe('Halte')
    expect(station.stops).toHaveLength(1)
    expect(positionOnSegment(network, station.stops[0].segId, station.stops[0].t)!.x).toBeCloseTo(placeIn({ ...convertOsm(data, options()), network }, 200, 0).x, 1)
  })

  it('a station with no track within reach is not laid, and said', () => {
    const data = answer(track(10, 1, 0), osmNode(900, 200, 500, { railway: 'station', name: 'Loin' }))
    const result = convertOsm(data, options())
    expect(result.network.stations.size).toBe(0)
    expect(result.report.stations).toEqual({ found: 1, placed: 0, stops: 0, skipped: { 'no-track-nearby': 1 } })
    const issue = result.report.issues.find((i) => i.kind === 'station-not-placed')!
    expect(issue.detail).toContain('Loin')
    expect(issue.x).toBeCloseTo(placeIn(result, 200, 500).x, 1)
  })

  it('leaves the stations of the other modes alone, and lays none when not asked to', () => {
    const data = answer(
      track(10, 1, 0, { 200: { ...STOP } }),
      osmNode(900, 200, 30, { railway: 'station', station: 'subway', name: 'Métro' }),
      osmNode(901, 300, 30, { railway: 'station', tram: 'yes', name: 'Tram' }),
    )
    expect(convertOsm(data, options()).network.stations.size).toBe(1)
    expect(surveyOsm(data, options()).stations).toBe(1)
    const off = convertOsm(data, options({ stations: false }))
    expect(off.network.stations.size).toBe(0)
    expect(off.report.stations).toBeUndefined()
  })

  it('keys: seven digits of a UIC code, the SNCF check digit dropped; names without accents or punctuation', () => {
    expect(uicKey('8774762')).toBe('8774762')
    expect(uicKey('87747626')).toBe('8774762')
    expect(uicKey('87 747 626')).toBe('8774762')
    expect(uicKey('CMS')).toBeUndefined()
    expect(uicKey(undefined)).toBeUndefined()
    expect(normalizedName('Clelles - Mens')).toBe('clelles mens')
    expect(normalizedName('Aix-en-Provence TGV')).toBe('aix en provence tgv')
    expect(normalizedName('Saint-Étienne Châteaucreux')).toBe('saint etienne chateaucreux')
  })
})
