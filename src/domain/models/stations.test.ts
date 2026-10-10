import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, removeSegment, resetIdCounter } from './network'
import { splitSegment } from './junction'
import { positionOnSegment } from './locomotive'
import { networkCheckToken } from './networkWatch'
import { addStation, cleanStations, removeStation, restoreStation, setStationIdentity, stationAt } from './stations'

beforeEach(() => resetIdCounter(0))

/** Two parallel rails along y = 0 and y = 5, 0–1000 */
function platforms() {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 1000, y: 0 })
  const c = addNode(net, { x: 0, y: 5 })
  const d = addNode(net, { x: 1000, y: 5 })
  const one = addSegment(net, a.id, b.id)!
  const two = addSegment(net, c.id, d.id)!
  return { net, one, two }
}

describe('a station of the network', () => {
  it('is added under a new id, with its stops copied, and found near its place', () => {
    const { net, one, two } = platforms()
    const stops = [{ segId: one.id, t: 0.4, ref: '1' }, { segId: two.id, t: 0.4 }]
    const station = addStation(net, { name: 'Clelles-Mens', pos: { x: 400, y: 2.5 }, uic: '8774762', stops })
    expect(station.id).toMatch(/^st_\d+$/)
    expect(net.stations.get(station.id)).toBe(station)
    expect(station.stops).toEqual(stops)
    expect(station.stops).not.toBe(stops)
    stops[0].t = 0.9
    expect(station.stops[0].t).toBe(0.4)
    expect(stationAt(net, { x: 410, y: 0 }, 20)).toBe(station)
    expect(stationAt(net, { x: 500, y: 0 }, 20)).toBeNull()
    // Its own id is kept when it brings a free one
    expect(addStation(net, { id: 'st_90', name: 'X', pos: { x: 0, y: 0 }, stops: [] }).id).toBe('st_90')
    expect(addStation(net, { id: 'st_90', name: 'Y', pos: { x: 0, y: 0 }, stops: [] }).id).not.toBe('st_90')
    expect(removeStation(net, station.id)).toBe(true)
    expect(removeStation(net, station.id)).toBe(false)
  })

  it('tells the revision of the network when its name or codes change in place', () => {
    const { net } = platforms()
    const station = addStation(net, { name: 'Clelles', pos: { x: 0, y: 0 }, stops: [] })
    const before = networkCheckToken(net)
    expect(setStationIdentity(net, station.id, { name: 'Clelles-Mens', code: 'CLM', uic: '8774762' })).toBe(true)
    expect(station).toMatchObject({ name: 'Clelles-Mens', code: 'CLM', uic: '8774762' })
    expect(networkCheckToken(net)).not.toBe(before)
    expect(setStationIdentity(net, station.id, { code: undefined })).toBe(true)
    expect('code' in station).toBe(false)
    expect(station.uic).toBe('8774762')
    expect(setStationIdentity(net, 'st_nowhere', { name: 'X' })).toBe(false)
  })

  it('keeps its stops in place when a rail is cut, and loses the one whose rail is removed', () => {
    const { net, one, two } = platforms()
    const station = addStation(net, { name: 'S', pos: { x: 700, y: 2.5 }, stops: [{ segId: one.id, t: 0.7, ref: 'A' }, { segId: two.id, t: 0.7 }] })
    expect(splitSegment(net, one.id, { x: 300, y: 0 })).not.toBeNull()
    expect(net.segments.has(one.id)).toBe(false)
    const [first, second] = station.stops
    expect(first.ref).toBe('A')
    expect(net.segments.has(first.segId)).toBe(true)
    expect(positionOnSegment(net, first.segId, first.t)!.x).toBeCloseTo(700, 6)
    expect(second).toEqual({ segId: two.id, t: 0.7 })
    networkCheckToken(net)

    removeSegment(net, two.id)
    expect(station.stops).toEqual([first])
    expect(net.stations.get(station.id)).toBe(station)
    networkCheckToken(net)
  })

  it('cleanStations drops the stops that are not on the track and nothing else', () => {
    const { net, one } = platforms()
    const station = addStation(net, { name: 'S', pos: { x: 0, y: 0 }, stops: [{ segId: one.id, t: 0.5 }, { segId: 'gone', t: 0.5 }, { segId: one.id, t: 1.5 }] })
    expect(cleanStations(net)).toBe(true)
    expect(station.stops).toEqual([{ segId: one.id, t: 0.5 }])
    expect(cleanStations(net)).toBe(false)
    networkCheckToken(net)
  })

  it('restoreStation takes a record as written and refuses one that does not hold together', () => {
    const { net, one } = platforms()
    expect(restoreStation(net, { id: 'st_3', name: 'Gare', x: 10, y: 20, uic: '8700001', stops: [{ segId: one.id, t: 0.5, ref: '2' }, null, { segId: 7 }, { segId: one.id, t: 'x' }] })).toBe(true)
    expect(net.stations.get('st_3')).toEqual({ id: 'st_3', name: 'Gare', pos: { x: 10, y: 20 }, uic: '8700001', stops: [{ segId: one.id, t: 0.5, ref: '2' }] })
    for (const bad of [null, undefined, {}, { id: 'st_4' }, { id: 'st_4', name: 'G' }, { id: 'st_4', name: 'G', x: NaN, y: 0 }, { id: 'st_3', name: 'Again', x: 0, y: 0 }, { id: 5, name: 'G', x: 0, y: 0 }]) {
      expect(restoreStation(net, bad as never)).toBe(false)
    }
    expect(net.stations.size).toBe(1)
    // Codes that are not strings, or empty, are left out
    expect(restoreStation(net, { id: 'st_5', name: 'G', x: 0, y: 0, uic: 87, code: '' })).toBe(true)
    expect(net.stations.get('st_5')).toEqual({ id: 'st_5', name: 'G', pos: { x: 0, y: 0 }, stops: [] })
  })
})
