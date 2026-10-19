import { beforeEach, describe, expect, it } from 'vitest'
import { convertOsm } from './osmImport'
import { along, answer, options, osmTrack, placeIn } from './osmImport.testkit'
import type { OsmImportResult } from './osmTypes'
import { resetIdCounter } from '../models/network'
import { runsAgainst } from '../models/running'
import { pointOnShape, segmentEnds } from '../geometry/segmentGeometry'

beforeEach(() => resetIdCounter(0))

/** Which way the rails of a track along y (kit metres, x growing east) are normally run: east, west, none, or mixed */
function runningAlong(result: OsmImportResult, y: number, x = 0): string {
  const net = result.network
  const at = placeIn(result, x, y)
  const seen = new Set<string>()
  for (const seg of net.segments.values()) {
    const ends = segmentEnds(net, seg)!
    const mid = pointOnShape(ends, 0.5)
    if (Math.abs(mid.y - at.y) > 1) continue
    if (!seg.running) {
      seen.add('none')
      continue
    }
    const eastward = ends.b.x > ends.a.x
    seen.add(runsAgainst(seg, eastward) ? 'west' : 'east')
  }
  return [...seen].sort().join('+')
}

describe('the normal direction of running at import', () => {
  it('reads railway:preferred_direction of the way, drawn either way', () => {
    // North track drawn east, run forward (east); south track drawn west, run forward (west)
    const north = osmTrack(1, 100, along([0, 0], [3000, 0], 100), { 'railway:preferred_direction': 'forward' })
    const south = osmTrack(2, 200, along([3000, 4.5], [0, 4.5], 100), { 'railway:preferred_direction': 'forward' })
    const result = convertOsm(answer(north.elements, south.elements), options({ keepLeft: false }))
    expect(runningAlong(result, 0)).toBe('east')
    expect(runningAlong(result, 4.5)).toBe('west')
    expect(result.report.running!.taggedKm).toBeCloseTo(6, 1)
    expect(result.report.running!.inferredKm).toBe(0)
  })

  it('reads backward the other way, and both as none', () => {
    const north = osmTrack(1, 100, along([0, 0], [3000, 0], 100), { 'railway:preferred_direction': 'backward' })
    const south = osmTrack(2, 200, along([0, 4.5], [3000, 4.5], 100), { 'railway:preferred_direction': 'both' })
    const result = convertOsm(answer(north.elements, south.elements), options())
    expect(runningAlong(result, 0)).toBe('west')
    // Run both ways by its tag: the rule of keeping left leaves it alone
    expect(runningAlong(result, 4.5)).toBe('none')
  })

  it('keeps left on a double line OSM says nothing about, unless asked not to', () => {
    const data = answer(osmTrack(1, 100, along([0, 0], [3000, 0], 100)).elements, osmTrack(2, 200, along([0, 4.5], [3000, 4.5], 100)).elements)
    const kept = convertOsm(data, options())
    // y grows southwards in the kit as in the world: going east, the south track is on the right
    expect(runningAlong(kept, 0)).toBe('east')
    expect(runningAlong(kept, 4.5)).toBe('west')
    expect(kept.report.running!.inferredKm).toBeCloseTo(6, 1)
    resetIdCounter(0)
    const plain = convertOsm(data, options({ keepLeft: false }))
    expect(runningAlong(plain, 0)).toBe('none')
    expect(plain.report.running!.noneKm).toBeCloseTo(6, 1)
  })

  it('gives a single track no direction', () => {
    const result = convertOsm(answer(osmTrack(1, 100, along([0, 0], [3000, 0], 100)).elements), options())
    expect(runningAlong(result, 0)).toBe('none')
  })
})

describe('right-hand running in Alsace-Moselle', () => {
  // The kit is at (47° N, 5° E): 48.5° N, 7.5° E is between Strasbourg and Sélestat
  const EAST = 2.5 * 111_320 * Math.cos((47 * Math.PI) / 180)
  const SOUTH = -1.5 * 111_170

  it('keeps right on a classic double line there, left on a high-speed one', () => {
    const classic = convertOsm(
      answer(
        osmTrack(1, 100, along([EAST, SOUTH], [EAST + 3000, SOUTH], 100)).elements,
        osmTrack(2, 200, along([EAST, SOUTH + 4.5], [EAST + 3000, SOUTH + 4.5], 100)).elements,
      ),
      options(),
    )
    expect(runningAlong(classic, SOUTH, EAST + 1500)).toBe('west')
    expect(runningAlong(classic, SOUTH + 4.5, EAST + 1500)).toBe('east')
    resetIdCounter(0)
    const lgv = convertOsm(
      answer(
        osmTrack(1, 100, along([EAST, SOUTH], [EAST + 3000, SOUTH], 100), { highspeed: 'yes' }).elements,
        osmTrack(2, 200, along([EAST, SOUTH + 4.5], [EAST + 3000, SOUTH + 4.5], 100), { highspeed: 'yes' }).elements,
      ),
      options(),
    )
    expect(runningAlong(lgv, SOUTH, EAST + 1500)).toBe('east')
    expect(runningAlong(lgv, SOUTH + 4.5, EAST + 1500)).toBe('west')
  })
})
