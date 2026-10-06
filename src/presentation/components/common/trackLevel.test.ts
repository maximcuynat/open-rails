import { describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork } from '@domain/models/network'
import { nodeLevelRange, rampSummary } from './trackLevel'

/** A 200 m rail along y = 0 between two nodes at the given heights */
function rail(fromLevel: number, toLevel: number) {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 }, fromLevel)
  const b = addNode(net, { x: 200, y: 0 }, toLevel)
  return { net, a, b, seg: addSegment(net, a.id, b.id)! }
}

const REAL = { levelHeight: 6, maxGradient: 35, unit: 'm' } as const

describe('rampSummary', () => {
  it('a flat rail has none: on the ground, on a bridge or in a tunnel', () => {
    for (const level of [0, 1, -2, 0.5]) {
      const { net, seg } = rail(level, level)
      expect(rampSummary(net, seg, REAL)).toBeNull()
    }
  })

  it('a ramp: the level of each end, the height climbed and the slope, rounded', () => {
    // 6 m over 200 m: 30 ‰
    const up = rail(0, 1)
    expect(rampSummary(up.net, up.seg, REAL)).toEqual({
      from: 'Sol',
      to: 'Pont +1',
      rise: '6.00 m',
      gradient: '30 ‰ en montée',
      tooSteep: false,
    })
    // The same rail laid the other way round goes down
    const down = rail(1, 0)
    expect(rampSummary(down.net, down.seg, REAL)).toMatchObject({ from: 'Pont +1', to: 'Sol', rise: '6.00 m', gradient: '30 ‰ en descente' })
    // Half a level into a tunnel: 3 m over 200 m
    const tunnel = rail(-0.5, -1)
    expect(rampSummary(tunnel.net, tunnel.seg, REAL)).toMatchObject({ from: 'Tunnel −0,5', to: 'Tunnel −1', rise: '3.00 m', gradient: '15 ‰ en descente' })
  })

  it('too steep above the maximum slope of the project, not at it', () => {
    const { net, seg } = rail(0, 1) // 30 ‰
    expect(rampSummary(net, seg, { ...REAL, maxGradient: 29 })!.tooSteep).toBe(true)
    expect(rampSummary(net, seg, { ...REAL, maxGradient: 30 })!.tooSteep).toBe(false)
    // Two levels on the same rail: 60 ‰
    const steep = rail(-1, 1)
    expect(rampSummary(steep.net, steep.seg, REAL)).toMatchObject({ gradient: '60 ‰ en montée', tooSteep: true })
  })

  it('levels without relief (a level height of 0): the two levels, no height and no slope', () => {
    const { net, seg } = rail(0, 1)
    expect(rampSummary(net, seg, { ...REAL, levelHeight: 0 })).toEqual({ from: 'Sol', to: 'Pont +1', rise: null, gradient: null, tooSteep: false })
  })

  it('the height climbed follows the height of a level and the display unit', () => {
    const { net, seg } = rail(0, 1)
    expect(rampSummary(net, seg, { levelHeight: 0.069, maxGradient: 35, unit: 'cm' })!.rise).toBe('6.90 cm')
  })
})

describe('nodeLevelRange', () => {
  it('lowest and highest height of the given nodes, null when none exists', () => {
    const { net, a, b } = rail(-1, 2)
    expect(nodeLevelRange(net, [a.id])).toEqual({ min: -1, max: -1 })
    expect(nodeLevelRange(net, [a.id, b.id, 'gone'])).toEqual({ min: -1, max: 2 })
    expect(nodeLevelRange(net, ['gone'])).toBeNull()
  })
})
