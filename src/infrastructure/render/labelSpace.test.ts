import { describe, expect, it } from 'vitest'
import { LabelSpace, crowdedPoints } from './labelSpace'

describe('LabelSpace', () => {
  it('gives a free rectangle once: the next label that would cover it is refused', () => {
    const space = new LabelSpace()
    expect(space.claim({ x: 100, y: 100, w: 80, h: 18 })).toBe(true)
    // Covers the right end of the first one
    expect(space.claim({ x: 170, y: 110, w: 80, h: 18 })).toBe(false)
    // A refused label takes no room: what only it would have covered is still free
    expect(space.claim({ x: 200, y: 110, w: 80, h: 18 })).toBe(true)
  })

  it('lets rectangles that only touch stand side by side', () => {
    const space = new LabelSpace()
    space.reserve({ x: 0, y: 0, w: 50, h: 18 })
    expect(space.isFree({ x: 50, y: 0, w: 50, h: 18 })).toBe(true)
    expect(space.isFree({ x: 0, y: 18, w: 50, h: 18 })).toBe(true)
    expect(space.isFree({ x: 49, y: 17, w: 50, h: 18 })).toBe(false)
  })

  it('a marker takes its room whatever stands there, and a label then gives way to it', () => {
    const space = new LabelSpace()
    space.reserve({ x: 10, y: 10, w: 16, h: 16 })
    space.reserve({ x: 14, y: 14, w: 16, h: 16 })
    expect(space.claim({ x: 0, y: 20, w: 60, h: 15 })).toBe(false)
    expect(space.claim({ x: 0, y: 40, w: 60, h: 15 })).toBe(true)
  })

  it('sees a rectangle from every bucket of the grid it lies over', () => {
    const space = new LabelSpace()
    // Much wider than a bucket
    space.reserve({ x: 0, y: 300, w: 1000, h: 10 })
    for (const x of [5, 130, 515, 990]) expect(space.isFree({ x, y: 305, w: 2, h: 2 })).toBe(false)
    expect(space.isFree({ x: 515, y: 320, w: 2, h: 2 })).toBe(true)
  })

  it('still tells apart what lies far outside the screen', () => {
    const space = new LabelSpace()
    space.reserve({ x: -1e6, y: -1e6, w: 10, h: 10 })
    expect(space.isFree({ x: -1e6 + 5, y: -1e6 + 5, w: 10, h: 10 })).toBe(false)
    // Same clamped bucket, another place
    expect(space.isFree({ x: -2e6, y: -2e6, w: 10, h: 10 })).toBe(true)
  })

  it('costs little: ten thousand labels asked for in a few milliseconds', () => {
    const space = new LabelSpace()
    let kept = 0
    const started = performance.now()
    for (let i = 0; i < 10000; i++) {
      if (space.claim({ x: (i * 37) % 1900, y: (i * 91) % 1060, w: 80, h: 18 })) kept++
    }
    const elapsed = performance.now() - started
    // A screen of 1920 × 1080 holds a few hundred of them at most
    expect(kept).toBeGreaterThan(100)
    expect(kept).toBeLessThan(1500)
    expect(elapsed).toBeLessThan(200)
  })
})

describe('crowdedPoints', () => {
  it('tells the points that have more than `limit` others around', () => {
    // Five tracks 20 px apart, and one alone further down
    const points = [0, 20, 40, 60, 80].map((y) => ({ x: 400, y }))
    points.push({ x: 400, y: 400 })
    expect(crowdedPoints(points, 100, 50, 2)).toEqual([false, true, true, true, false, false])
    expect(crowdedPoints(points, 100, 100, 2)).toEqual([true, true, true, true, true, false])
  })

  it('reaches as far as told across and up, and no further', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 50 }, { x: 101, y: 51 }]
    // The first one has the second (100 across) and the third (50 down) within reach, not the fourth
    expect(crowdedPoints(points, 100, 50, 1)[0]).toBe(true)
    expect(crowdedPoints(points, 100, 50, 2)[0]).toBe(false)
    expect(crowdedPoints(points, 99, 49, 0)[0]).toBe(false)
  })

  it('two tracks side by side are no crowd, nor is nothing', () => {
    expect(crowdedPoints([{ x: 0, y: 0 }, { x: 0, y: 15 }], 240, 100, 2)).toEqual([false, false])
    expect(crowdedPoints([], 240, 100, 2)).toEqual([])
  })
})
