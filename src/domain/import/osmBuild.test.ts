import { describe, it, expect, vi } from 'vitest'
import { convertOsm } from './osmImport'
import { options, osmNode, osmWay, answer, readFixture } from './osmImport.testkit'
import { readOsm } from './osmRead'
import { createProjection } from './osmProjection'
import { buildChains, buildGraph } from './osmGraph'
import { designSpeed } from './osmBuild'
import { resetIdCounter } from '../models/network'
import { speedZonesOnRail } from '../models/speedZones'
import { trackProfile } from '../models/trackSpeed'

vi.setConfig({ testTimeout: 60_000 })

describe('the speed a chain is built for', () => {
  /** One track of three ways: 100 m at 160 km/h, 100 m without a speed, 100 m at 55 km/h */
  const chainOf = (speeds: (string | undefined)[]) => {
    const data = answer(
      speeds.flatMap((_, i) => [osmNode(i + 1, i * 100, 0)]),
      osmNode(speeds.length + 1, speeds.length * 100, 0),
      speeds.map((maxspeed, i) => osmWay(100 + i, [i + 1, i + 2], maxspeed ? { maxspeed } : {})),
    )
    const graph = buildGraph(readOsm(data, options()), createProjection(47, 5))
    return buildChains(graph)[0]
  }

  it('is the zone of each stretch, the lowest of those a piece of track lies over, and none where OSM gives none', () => {
    const chain = chainOf(['160', undefined, '55'])
    expect(chain.length).toBeCloseTo(300, -1)
    const design = designSpeed(chain, false)!
    expect(design.lineType).toBe('classic')
    const at = (s0: number, s1: number): number | null => design.over((s0 / 300) * chain.length, (s1 / 300) * chain.length)
    expect(at(10, 90)).toBe(160)
    expect(at(110, 190)).toBeNull()
    // 55 km/h is laid as a zone of 50
    expect(at(210, 290)).toBe(50)
    expect(at(10, 290)).toBe(50)
    expect(at(10, 190)).toBe(160)
    expect(designSpeed(chain, true)!.lineType).toBe('highSpeed')
  })

  it('is unknown for a chain that carries no speed at all', () => {
    expect(designSpeed(chainOf([undefined, undefined]), false)).toBeUndefined()
  })
})

describe('curves of the sample areas next to the speed of their zone', () => {
  /** The curved rails of a converted area on which the editor allows less than the zone OSM gives them */
  function slowCurves(name: string): { radius: number; allowed: number; zone: number }[] {
    resetIdCounter()
    // Only the zones read from `maxspeed`: a service track without one is given no speed here
    const result = convertOsm(readFixture(name), options({ defaultServiceSpeed: 0 }))
    const net = result.network
    const profile = trackProfile(net, { lineSpeed: result.lineSpeed!, lineType: result.highSpeed ? 'highSpeed' : 'classic' })
    const slow: { radius: number; allowed: number; zone: number }[] = []
    for (const rail of profile.rails.values()) {
      const zones = speedZonesOnRail(net, rail.segId).map((stretch) => stretch.zone.speed)
      if (zones.length > 0 && rail.maxSpeed < Math.min(...zones)) slow.push({ radius: rail.radius, allowed: rail.maxSpeed, zone: Math.min(...zones) })
    }
    return slow
  }

  it('LGV at Pasilly: every curve can be run at the speed of its zone, 300 km/h included', () => {
    // Fitted without the speed: 40 rails, two of them joints of 65 m of radius on the 300 km/h line
    expect(slowCurves('lgv-pasilly')).toEqual([])
  })

  it('Clelles-Mens: no bend of a broken line left on the single track', () => {
    // Fitted without the speed: 52 rails, 20 to 40 km/h allowed under the zone of 70
    const slow = slowCurves('clelles-mens')
    expect(slow.length).toBeLessThanOrEqual(12)
    // What is left is the curves of the line themselves, 5 to 15 km/h under their zone
    for (const rail of slow) {
      expect(rail.radius).toBeGreaterThan(130)
      expect(rail.zone - rail.allowed).toBeLessThanOrEqual(15)
    }
  })

  it('Dijon-Ville: the running lines are no longer held to the speed of a joint', () => {
    // Fitted without the speed: 81 rails, the lines at 160 km/h held to 50 by joints of 200 m of radius
    const slow = slowCurves('dijon-ville')
    expect(slow.length).toBeLessThanOrEqual(30)
    const fast = slow.filter((rail) => rail.zone >= 120)
    expect(Math.min(...fast.map((rail) => rail.allowed))).toBeGreaterThanOrEqual(100)
  })
})
