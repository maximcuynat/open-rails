import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, resetIdCounter } from './network'
import type { Network } from './types'
import { addPlatform, edgeLength, platformDimensions, pointOnEdge } from './platforms'
import {
  addMarker,
  createStation,
  distanceAlongEdge,
  moveEdgeEnd,
  moveMarker,
  moveStationLabel,
  platformAt,
  platformCentre,
  platformEndAt,
  platformMarkerAt,
  platformShape,
  removeMarker,
  restorePlatformShape,
  setMarkerOptions,
  setPlatformRef,
  setPlatformStation,
  setPlatformWidth,
} from './platformEdit'
import { setStationIdentity } from './stations'

/**
 * Track a: (0, 0) → (150, 0) in three rails of 50 m, then a fork at x = 150 (a set of points) to
 * (200, 0) and (200, 20). Track b: (0, 10) → (150, 10), one rail.
 */
function station(): { net: Network; a1: string; a2: string; a3: string; b: string } {
  const net = createNetwork()
  const n = [0, 50, 100, 150].map((x) => addNode(net, { x, y: 0 }))
  const a1 = addSegment(net, n[0].id, n[1].id)!.id
  const a2 = addSegment(net, n[1].id, n[2].id)!.id
  const a3 = addSegment(net, n[2].id, n[3].id)!.id
  addSegment(net, n[3].id, addNode(net, { x: 200, y: 0 }).id)
  addSegment(net, n[3].id, addNode(net, { x: 200, y: 20 }).id)
  const b = addSegment(net, addNode(net, { x: 0, y: 10 }).id, addNode(net, { x: 150, y: 10 }).id)!.id
  return { net, a1, a2, a3, b }
}

const dims = platformDimensions()

describe('editing a platform', () => {
  beforeEach(() => resetIdCounter())

  it('is found under the cursor on its body or its edge, not on the track', () => {
    const { net, a2 } = station()
    const platform = addPlatform(net, { stationId: 'st_1', edges: [{ track: [{ segId: a2, t0: 0, t1: 1 }], side: 'right' }], width: 6, markers: [] })
    expect(platformAt(net, { x: 75, y: 4 }, dims, 0.5)?.id).toBe(platform.id)
    expect(platformAt(net, { x: 75, y: 1.4 }, dims, 0.5)?.id).toBe(platform.id)
    expect(platformAt(net, { x: 75, y: 0 }, dims, 0.5)).toBeNull()
    expect(platformAt(net, { x: 75, y: -4 }, dims, 0.5)).toBeNull()
    expect(platformAt(net, { x: 30, y: 4 }, dims, 0.5)).toBeNull()
  })

  it('has its ends and its markers found under the cursor', () => {
    const { net, a2 } = station()
    const platform = addPlatform(net, {
      stationId: 'st_1',
      edges: [{ track: [{ segId: a2, t0: 0, t1: 1 }], side: 'right' }],
      width: 6,
      markers: [{ edge: 0, at: 40, heading: 'forward' }],
    })
    expect(platformEndAt(net, { x: 50.2, y: 5 }, dims, 0.5)).toEqual({ platformId: platform.id, edge: 0, end: 'start' })
    expect(platformEndAt(net, { x: 99.8, y: 2 }, dims, 0.5)).toEqual({ platformId: platform.id, edge: 0, end: 'end' })
    expect(platformEndAt(net, { x: 75, y: 5 }, dims, 0.5)).toBeNull()
    expect(platformEndAt(net, { x: 50, y: 5 }, dims, 0.5, 'pl_other')).toBeNull()
    expect(platformMarkerAt(net, { x: 90.1, y: 1 }, dims, 0.5)).toEqual({ platformId: platform.id, index: 0 })
    expect(platformMarkerAt(net, { x: 85, y: 1 }, dims, 0.5)).toBeNull()
    expect(platformCentre(net, platform, dims)).toEqual({ x: expect.closeTo(75, 6), y: expect.closeTo(4.7, 6) })
  })

  it('is lengthened through plain joints and stops at a set of points', () => {
    const { net, a1, a2, a3 } = station()
    const platform = addPlatform(net, { stationId: 'st_1', edges: [{ track: [{ segId: a2, t0: 0.2, t1: 0.8 }], side: 'right' }], width: 6, markers: [] })
    // The end goes on past the joint at x = 100, then holds at the points at x = 150
    expect(moveEdgeEnd(net, platform.id, 0, 'end', { x: 130, y: 3 })).toBe(true)
    expect(platform.edges[0].track).toEqual([{ segId: a2, t0: 0.2, t1: 1 }, { segId: a3, t0: 0, t1: expect.closeTo(0.6, 6) }])
    expect(edgeLength(net, platform.edges[0])).toBeCloseTo(70, 6)
    moveEdgeEnd(net, platform.id, 0, 'end', { x: 190, y: 3 })
    expect(edgeLength(net, platform.edges[0])).toBeCloseTo(90, 6)
    expect(platform.edges[0].track.at(-1)).toEqual({ segId: a3, t0: 0, t1: 1 })
    // The start goes back past the joint at x = 50, to the end of the track at x = 0
    moveEdgeEnd(net, platform.id, 0, 'start', { x: -40, y: 3 })
    expect(platform.edges[0].track[0]).toEqual({ segId: a1, t0: 0, t1: 1 })
    expect(edgeLength(net, platform.edges[0])).toBeCloseTo(150, 6)
  })

  it('is shortened, never below its shortest length nor past its other end', () => {
    const { net, a2, a3 } = station()
    const platform = addPlatform(net, { stationId: 'st_1', edges: [{ track: [{ segId: a2, t0: 0, t1: 1 }, { segId: a3, t0: 0, t1: 1 }], side: 'right' }], width: 6, markers: [] })
    moveEdgeEnd(net, platform.id, 0, 'end', { x: 80, y: 3 })
    expect(platform.edges[0].track).toEqual([{ segId: a2, t0: 0, t1: expect.closeTo(0.6, 6) }])
    // Dragged beyond its start: it keeps its shortest length, its start where it was
    moveEdgeEnd(net, platform.id, 0, 'end', { x: 10, y: 3 }, 5)
    expect(platform.edges[0].track).toEqual([{ segId: a2, t0: 0, t1: expect.closeTo(0.1, 6) }])
    // Nothing moves: no change reported
    expect(moveEdgeEnd(net, platform.id, 0, 'end', { x: 10, y: 3 }, 5)).toBe(false)
  })

  it('slides along a track walked against its rails', () => {
    const { net, a2, a3 } = station()
    // From x = 140 back to x = 110
    const platform = addPlatform(net, { stationId: 'st_1', edges: [{ track: [{ segId: a3, t0: 0.8, t1: 0.2 }], side: 'left' }], width: 6, markers: [] })
    moveEdgeEnd(net, platform.id, 0, 'end', { x: 60, y: 3 })
    expect(platform.edges[0].track).toEqual([{ segId: a3, t0: 0.8, t1: 0 }, { segId: a2, t0: 1, t1: expect.closeTo(0.2, 6) }])
    expect(pointOnEdge(net, platform.edges[0], edgeLength(net, platform.edges[0]))!.point.x).toBeCloseTo(60, 6)
  })

  it('keeps its markers where they stand when its start moves, held to the platform', () => {
    const { net, a2, a3 } = station()
    const platform = addPlatform(net, {
      stationId: 'st_1',
      edges: [{ track: [{ segId: a2, t0: 0, t1: 1 }, { segId: a3, t0: 0, t1: 1 }], side: 'right' }],
      width: 6,
      markers: [{ edge: 0, at: 60, heading: 'forward' }, { edge: 0, at: 10, heading: 'backward' }, { edge: 0, at: 95, heading: 'forward' }],
    })
    // Start from x = 50 to x = 70: the marker at x = 110 stays there, the one at x = 60 is held to the new start
    moveEdgeEnd(net, platform.id, 0, 'start', { x: 70, y: 3 })
    expect(platform.markers.map((m) => m.at)).toEqual([expect.closeTo(40, 6), 0, expect.closeTo(75, 6)])
    // End from x = 150 to x = 120: the marker at x = 145 is held to the new end
    moveEdgeEnd(net, platform.id, 0, 'end', { x: 120, y: 3 })
    expect(platform.markers.map((m) => m.at)).toEqual([expect.closeTo(40, 6), 0, expect.closeTo(50, 6)])
    // Start back to x = 30: the markers stay where they stand in the world
    moveEdgeEnd(net, platform.id, 0, 'start', { x: 30, y: 3 })
    expect(platform.markers.map((m) => m.at)).toEqual([expect.closeTo(80, 6), expect.closeTo(40, 6), expect.closeTo(90, 6)])
  })

  it('moves the facing end of the other edge of an island with the dragged one', () => {
    const { net, a2, b } = station()
    // Edge 0 along a from x = 50 to x = 100; edge 1 along b walked west from x = 100 to x = 50
    const island = addPlatform(net, {
      stationId: 'st_1',
      edges: [{ track: [{ segId: a2, t0: 0, t1: 1 }], side: 'right' }, { track: [{ segId: b, t0: 100 / 150, t1: 50 / 150 }], side: 'right' }],
      width: 0,
      markers: [{ edge: 1, at: 5, heading: 'forward' }],
    })
    moveEdgeEnd(net, island.id, 0, 'end', { x: 120, y: 2 })
    const edge0 = island.edges[0]
    const edge1 = island.edges[1]!
    expect(pointOnEdge(net, edge0, edgeLength(net, edge0))!.point.x).toBeCloseTo(120, 6)
    // The start of edge 1 faced the end of edge 0: it went to x = 120 too, its marker stayed at x = 95
    expect(pointOnEdge(net, edge1, 0)!.point.x).toBeCloseTo(120, 6)
    expect(pointOnEdge(net, edge1, edgeLength(net, edge1))!.point.x).toBeCloseTo(50, 6)
    expect(pointOnEdge(net, edge1, island.markers[0].at)!.point.x).toBeCloseTo(95, 6)
    // And the other way round, from edge 1
    moveEdgeEnd(net, island.id, 1, 'end', { x: 20, y: 8 })
    expect(pointOnEdge(net, edge0, 0)!.point.x).toBeCloseTo(20, 6)
  })

  it('is put back as it was by its shape', () => {
    const { net, a2 } = station()
    const platform = addPlatform(net, { stationId: 'st_1', edges: [{ track: [{ segId: a2, t0: 0, t1: 1 }], side: 'right' }], width: 6, markers: [{ edge: 0, at: 5, heading: 'forward' }] })
    const shape = platformShape(platform)
    moveEdgeEnd(net, platform.id, 0, 'start', { x: 70, y: 3 })
    expect(restorePlatformShape(net, platform.id, shape)).toBe(true)
    expect(platform.edges[0].track).toEqual([{ segId: a2, t0: 0, t1: 1 }])
    expect(platform.markers[0].at).toBe(5)
    expect(restorePlatformShape(net, platform.id, shape)).toBe(false)
  })

  it('has its markers slid, added, set and removed, held to their edge', () => {
    const { net, a2 } = station()
    const platform = addPlatform(net, { stationId: 'st_1', edges: [{ track: [{ segId: a2, t0: 0, t1: 1 }], side: 'right' }], width: 6, markers: [{ edge: 0, at: 5, heading: 'forward' }] })
    expect(distanceAlongEdge(net, platform.edges[0], { x: 80, y: 3 })).toBeCloseTo(30, 6)
    expect(moveMarker(net, platform.id, 0, { x: 80, y: 3 })).toBe(true)
    expect(platform.markers[0].at).toBeCloseTo(30, 6)
    moveMarker(net, platform.id, 0, { x: 400, y: 3 })
    expect(platform.markers[0].at).toBeCloseTo(50, 6)
    expect(moveMarker(net, platform.id, 3, { x: 80, y: 3 })).toBe(false)

    expect(addMarker(net, platform.id, { edge: 0, at: 80, heading: 'backward', maxLength: 200 })).toBe(1)
    expect(platform.markers[1]).toEqual({ edge: 0, at: expect.closeTo(50, 6), heading: 'backward', maxLength: 200 })
    expect(addMarker(net, platform.id, { edge: 1, at: 5, heading: 'forward' })).toBeNull()
    expect(setMarkerOptions(net, platform.id, 1, { heading: 'forward', maxLength: undefined })).toBe(true)
    expect(platform.markers[1]).toEqual({ edge: 0, at: expect.closeTo(50, 6), heading: 'forward' })
    expect(setMarkerOptions(net, platform.id, 1, { heading: 'forward' })).toBe(false)
    expect(setMarkerOptions(net, platform.id, 1, { maxLength: 120 })).toBe(true)
    expect(platform.markers[1].maxLength).toBe(120)
    expect(removeMarker(net, platform.id, 0)).toBe(true)
    expect(platform.markers).toHaveLength(1)
    expect(removeMarker(net, platform.id, 4)).toBe(false)
  })

  it('has its track numbers, width and station changed', () => {
    const { net, a2 } = station()
    const st1 = createStation(net, ' Clelles ', { x: 75, y: 20 })
    const st2 = createStation(net, '', { x: 0, y: 20 })
    expect(st1.name).toBe('Clelles')
    expect(st2.name).toBe('Nouvelle gare')
    expect(st1.stops).toEqual([])
    const platform = addPlatform(net, { stationId: st1.id, edges: [{ track: [{ segId: a2, t0: 0, t1: 1 }], side: 'right' }], width: 6, markers: [] })
    expect(setPlatformRef(net, platform.id, 0, ' 2 ')).toBe(true)
    expect(platform.edges[0].ref).toBe('2')
    expect(setPlatformRef(net, platform.id, 0, '2')).toBe(false)
    expect(setPlatformRef(net, platform.id, 0, '')).toBe(true)
    expect('ref' in platform.edges[0]).toBe(false)
    expect(setPlatformRef(net, platform.id, 1, 'A')).toBe(false)
    expect(setPlatformWidth(net, platform.id, 8)).toBe(true)
    expect(platform.width).toBe(8)
    expect(setPlatformWidth(net, platform.id, 0)).toBe(false)
    expect(setPlatformWidth(net, platform.id, Number.NaN)).toBe(false)
    expect(setPlatformStation(net, platform.id, st2.id)).toBe(true)
    expect(platform.stationId).toBe(st2.id)
    expect(setPlatformStation(net, platform.id, 'st_nowhere')).toBe(false)
  })

  it('lets a station be renamed and its label moved', () => {
    const { net } = station()
    const st = createStation(net, 'Mens', { x: 10, y: 20 })
    expect(setStationIdentity(net, st.id, { name: 'Clelles-Mens', code: 'CLM' })).toBe(true)
    expect(st).toMatchObject({ name: 'Clelles-Mens', code: 'CLM' })
    expect(moveStationLabel(net, st.id, { x: 30, y: 40 })).toBe(true)
    expect(st.pos).toEqual({ x: 30, y: 40 })
    expect(moveStationLabel(net, st.id, { x: 30, y: 40 })).toBe(false)
    expect(moveStationLabel(net, 'st_nowhere', { x: 0, y: 0 })).toBe(false)
  })
})
