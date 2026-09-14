import { describe, it, expect } from 'vitest'
import { computeParallelCurve } from './curve'

describe('computeParallelCurve', () => {
  it('computes concentric parallel curve with exact normal offset at start and end', () => {
    // 90-degree bend from (0,0) with tangent (1,0) to (100,100) with tangent (0,1)
    const start = { x: 0, y: 0 }
    const via = { x: 100, y: 0 }
    const end = { x: 100, y: 100 }
    const offset = 3.3

    const par = computeParallelCurve(start, via, end, offset)

    // At start: tangent is (1, 0), normal is (0, 1)
    // newStart should be (0, 0 + 3.3)
    expect(par.start.x).toBeCloseTo(0, 2)
    expect(par.start.y).toBeCloseTo(3.3, 2)

    // At end: tangent is (0, 1), normal is (-1, 0)
    // newEnd should be (100 - 3.3, 100) = (96.7, 100)
    expect(par.end.x).toBeCloseTo(96.7, 2)
    expect(par.end.y).toBeCloseTo(100, 2)

    // Via point lies along the new start tangent: y = 3.3
    expect(par.via.y).toBeCloseTo(3.3, 2)
    // and along the new end tangent: x = 96.7
    expect(par.via.x).toBeCloseTo(96.7, 2)
  })
})
