import { describe, it, expect } from 'vitest'
import { readOsm, readSpeed, readWayLevel, readWaySpeed, zoneSpeedUnder } from './osmRead'
import type { OverpassResponse } from './osmTypes'
import { answer, options, osmNode, osmWay } from './osmImport.testkit'

describe('level of an OSM way', () => {
  it('is its layer when it is a whole number, whatever else the way says', () => {
    expect(readWayLevel({ layer: '2', bridge: 'yes' }).level).toBe(2)
    expect(readWayLevel({ layer: '-3', tunnel: 'yes' }).level).toBe(-3)
    // A track in a cutting carries a layer without being a tunnel
    expect(readWayLevel({ layer: '-1' }).level).toBe(-1)
    expect(readWayLevel({ layer: '0', bridge: 'yes' }).level).toBe(0)
    expect(readWayLevel({ layer: '+1' }).level).toBe(1)
  })

  it('is +1 on a bridge and −1 in a tunnel that carry no layer', () => {
    expect(readWayLevel({ bridge: 'yes' }).level).toBe(1)
    expect(readWayLevel({ bridge: 'viaduct' }).level).toBe(1)
    expect(readWayLevel({ tunnel: 'yes' }).level).toBe(-1)
    expect(readWayLevel({ tunnel: 'covered' }).level).toBe(-1)
  })

  it('is the ground for a passage under a building, a covered track, a bridge or tunnel set to no, and anything else', () => {
    expect(readWayLevel({ tunnel: 'building_passage' }).level).toBe(0)
    expect(readWayLevel({ covered: 'yes' }).level).toBe(0)
    expect(readWayLevel({ bridge: 'no' }).level).toBe(0)
    expect(readWayLevel({ tunnel: 'no' }).level).toBe(0)
    expect(readWayLevel({}).level).toBe(0)
    expect(readWayLevel({ layer: 'underground' }).level).toBe(0)
    expect(readWayLevel({ layer: 'x', tunnel: 'yes' }).level).toBe(-1)
  })

  it('takes of a list of layers the one closest to the ground, and says so', () => {
    expect(readWayLevel({ layer: '-1;-2', tunnel: 'yes' })).toMatchObject({ level: -1, multiple: true, clamped: false, layer: '-1;-2' })
    expect(readWayLevel({ layer: '-2;-3;-4;-5;-6;-7;-8' })).toMatchObject({ level: -2, multiple: true })
    expect(readWayLevel({ layer: '-4; -5' })).toMatchObject({ level: -4, multiple: true })
    expect(readWayLevel({ layer: '1;1' })).toMatchObject({ level: 1, multiple: false })
  })

  it('brings a layer out of the range of the app back into it, and says so', () => {
    expect(readWayLevel({ layer: '-8', tunnel: 'yes' })).toMatchObject({ level: -5, clamped: true })
    expect(readWayLevel({ layer: '7' })).toMatchObject({ level: 5, clamped: true })
    expect(readWayLevel({ layer: '-5' })).toMatchObject({ level: -5, clamped: false })
  })

  it('tells a bridge and a tunnel from a track on the ground', () => {
    expect(readWayLevel({ bridge: 'yes', layer: '1' }).structure).toBe('bridge')
    expect(readWayLevel({ tunnel: 'yes' }).structure).toBe('tunnel')
    expect(readWayLevel({ tunnel: 'building_passage' }).structure).toBeNull()
    expect(readWayLevel({ layer: '-1' }).structure).toBeNull()
  })
})

describe('speed of an OSM way', () => {
  it('reads kilometres per hour, with or without the unit, and miles per hour', () => {
    expect(readSpeed('60')).toBe(60)
    expect(readSpeed(' 120 km/h ')).toBe(120)
    expect(readSpeed('40 mph')).toBeCloseTo(64.37, 2)
    expect(readSpeed('87.5')).toBe(87.5)
  })

  it('reads nothing in what is not a speed', () => {
    for (const value of [undefined, '', 'none', 'signals', 'walk', '60;80', '-30', '0']) expect(readSpeed(value), String(value)).toBeNull()
  })

  it('takes the lower of the two directions, since a zone holds for both', () => {
    expect(readWaySpeed({ 'maxspeed:forward': '120', 'maxspeed:backward': '60' })).toBe(60)
    expect(readWaySpeed({ maxspeed: '100', 'maxspeed:backward': '140' })).toBe(100)
    expect(readWaySpeed({ maxspeed: 'none' })).toBeNull()
  })

  it('never raises a limit when it brings it to a zone speed', () => {
    expect(zoneSpeedUnder(55)).toBe(50)
    expect(zoneSpeedUnder(115)).toBe(110)
    expect(zoneSpeedUnder(300)).toBe(300)
    expect(zoneSpeedUnder(64.37)).toBe(60)
    expect(zoneSpeedUnder(5)).toBe(10)
  })
})

describe('reading an Overpass answer', () => {
  const track = [osmNode(1, 0, 0), osmNode(2, 100, 0), osmNode(3, 200, 0)]

  it('keeps the tags of a node listed twice, once with its tags and once bare', () => {
    for (const elements of [
      [osmNode(1, 0, 0, { railway: 'switch' }), osmNode(1, 0, 0), osmNode(2, 100, 0), osmWay(10, [1, 2])],
      [osmNode(1, 0, 0), osmNode(1, 0, 0, { railway: 'switch' }), osmNode(2, 100, 0), osmWay(10, [1, 2])],
    ]) {
      const read = readOsm(answer(elements), options())
      expect(read.nodes.size).toBe(2)
      expect(read.nodes.get(1)?.tags).toEqual({ railway: 'switch' })
      expect(read.nodes.get(2)?.tags).toBeUndefined()
    }
  })

  it('reads plain tracks always, service tracks, disused tracks and other kinds by the options', () => {
    const data = answer(
      track,
      osmWay(10, [1, 2]),
      osmWay(11, [2, 3], { service: 'yard' }),
      osmWay(12, [1, 3], { railway: 'disused' }),
      osmWay(13, [1, 3], { railway: 'abandoned' }),
      osmWay(14, [1, 3], { railway: 'tram' }),
      osmWay(15, [1, 3], { railway: 'subway' }),
    )
    const ids = (over: Parameters<typeof options>[0]): number[] => readOsm(data, options(over)).tracks.map((t) => t.id)
    expect(ids({})).toEqual([10, 11])
    expect(ids({ serviceTracks: false })).toEqual([10])
    expect(ids({ disusedTracks: true })).toEqual([10, 11, 12, 13])
    expect(ids({ extraKinds: ['tram'] })).toEqual([10, 11, 14])
    expect(ids({ extraKinds: ['subway', 'tram'], serviceTracks: false })).toEqual([10, 14, 15])
    // Every kind is listed whatever the options, for the count shown before the import
    expect(readOsm(data, options()).allTracks).toHaveLength(6)
  })

  it('never reads a track under construction, proposed or razed, nor what is not a track', () => {
    const data = answer(
      track,
      osmWay(10, [1, 2], { railway: 'construction' }),
      osmWay(11, [1, 2], { railway: 'proposed' }),
      osmWay(12, [1, 2], { railway: 'razed' }),
      osmWay(13, [1, 2], { railway: 'platform' }),
      osmWay(14, [1, 2, 3, 1], { railway: 'rail', area: 'yes' }),
      { type: 'way', id: 15, nodes: [1, 2] },
    )
    expect(readOsm(data, options({ disusedTracks: true, extraKinds: ['tram', 'subway', 'light_rail', 'narrow_gauge'] })).allTracks).toEqual([])
  })

  it('cuts a way at the nodes the answer does not hold, and remembers that the area ends there', () => {
    const read = readOsm(answer(track, osmWay(10, [9, 1, 2, 8, 3, 7])), options())
    expect(read.tracks.map((t) => [t.nodes, t.cutAtStart, t.cutAtEnd])).toEqual([[[1, 2], true, true]])
    // …and a way that is whole is not cut
    expect(readOsm(answer(track, osmWay(10, [1, 2, 3])), options()).tracks[0]).toMatchObject({ nodes: [1, 2, 3], cutAtStart: false, cutAtEnd: false })
  })

  it('puts every track on the ground when levels are not read', () => {
    const data = answer(track, osmWay(10, [1, 2], { bridge: 'yes', layer: '2' }))
    expect(readOsm(data, options()).tracks[0].level.level).toBe(2)
    expect(readOsm(data, options({ levels: false })).tracks[0].level).toEqual({ level: 0, multiple: false, clamped: false, structure: null })
  })

  it('reads the speed, the service and the high-speed marks of a track', () => {
    const data = answer(
      track,
      osmWay(10, [1, 2], { maxspeed: '300', highspeed: 'yes' }),
      osmWay(11, [2, 3], { maxspeed: '55', 'railway:tvm': 'no', service: 'siding' }),
      osmWay(12, [1, 3], { 'railway:tvm': '300' }),
    )
    const [fast, slow, cab] = readOsm(data, options()).tracks
    expect(fast).toMatchObject({ speed: 300, rawSpeed: 300, highSpeed: true, service: false })
    expect(slow).toMatchObject({ speed: 50, rawSpeed: 55, highSpeed: false, service: true })
    expect(cab).toMatchObject({ speed: null, highSpeed: true })
  })

  it('reads nothing, and throws nothing, in an answer that is not one', () => {
    for (const data of [null, undefined, 42, 'osm', {}, { elements: null }, { elements: 'x' }, { elements: [null, 3, 'a', {}, { type: 'node' }, { type: 'node', id: 1 }, { type: 'way', id: 2 }, { type: 'way', id: 3, nodes: 'x', tags: { railway: 'rail' } }, { type: 'node', id: 4, lat: 'a', lon: 2 }] }]) {
      const read = readOsm(data as unknown as OverpassResponse, options())
      expect(read.tracks).toEqual([])
      expect(read.nodes.size).toBe(0)
    }
  })

  it('reads a way whose tags or nodes are partly broken', () => {
    const data = { elements: [...track, { type: 'way', id: 10, nodes: [1, 'x', 2, 2, null, 3], tags: { railway: 'rail', layer: 3, maxspeed: 80, bridge: null } }] }
    const read = readOsm(data as unknown as OverpassResponse, options())
    expect(read.tracks).toHaveLength(1)
    expect(read.tracks[0]).toMatchObject({ nodes: [1, 2, 3], speed: 80 })
    expect(read.tracks[0].level.level).toBe(3)
  })
})
