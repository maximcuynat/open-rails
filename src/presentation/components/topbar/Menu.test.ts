import { describe, expect, it } from 'vitest'
import { nextEnabled, type MenuItem } from './Menu'

const items = (...disabled: boolean[]): MenuItem[] => disabled.map((d, i) => ({ id: `i${i}`, label: `Item ${i}`, disabled: d }))

describe('nextEnabled', () => {
  it('starts on the first entry going down and on the last going up', () => {
    const list = items(false, false, false)
    expect(nextEnabled(list, -1, 1)).toBe(0)
    expect(nextEnabled(list, -1, -1)).toBe(2)
  })

  it('wraps around both ends', () => {
    const list = items(false, false, false)
    expect(nextEnabled(list, 2, 1)).toBe(0)
    expect(nextEnabled(list, 0, -1)).toBe(2)
  })

  it('skips disabled entries', () => {
    const list = items(true, false, true, false)
    expect(nextEnabled(list, -1, 1)).toBe(1)
    expect(nextEnabled(list, 1, 1)).toBe(3)
    expect(nextEnabled(list, 1, -1)).toBe(3)
  })

  it('returns -1 when nothing can be selected', () => {
    expect(nextEnabled(items(true, true), -1, 1)).toBe(-1)
    expect(nextEnabled([], -1, 1)).toBe(-1)
  })
})
