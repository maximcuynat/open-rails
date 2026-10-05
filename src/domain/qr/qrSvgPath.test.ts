import { describe, expect, it } from 'vitest'
import { encodeQr } from './encodeQr'
import { QR_QUIET_ZONE, qrSvgPath } from './qrSvgPath'

describe('qrSvgPath', () => {
  it('draws one rectangle per run of dark modules, inside the quiet zone', () => {
    const path = qrSvgPath([
      [true, true, false],
      [false, false, false],
      [true, false, true],
    ])
    expect(QR_QUIET_ZONE).toBe(4)
    expect(path.size).toBe(11)
    expect(path.d).toBe('M4 4h2v1h-2zM4 6h1v1h-1zM6 6h1v1h-1z')
    expect(qrSvgPath([[true]], 0)).toEqual({ size: 1, d: 'M0 0h1v1h-1z' })
  })

  it('covers exactly the dark modules of a real symbol', () => {
    const matrix = encodeQr('http://192.168.1.42:8900/open-rails/?pupitre=ABC234')
    const { size, d } = qrSvgPath(matrix)
    expect(size).toBe(matrix.length + 8)
    const painted = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
    for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1/g)) {
      for (let i = 0; i < Number(w); i++) painted[Number(y)][Number(x) + i] = true
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        expect(painted[y][x]).toBe(matrix[y - 4]?.[x - 4] ?? false)
      }
    }
  })
})
