import { describe, expect, it } from 'vitest'
import {
  QR_MAX_VERSION,
  encodeQr,
  qrByteCapacity,
  qrFormatBits,
  qrPenalty,
  qrSize,
  qrVersionFor,
} from './encodeQr'

/**
 * Reference symbols produced by an independent encoder (the `qrcode` npm package, version 1.5,
 * byte mode, level L, its own choice of mask) — version 1, version 3, and version 7, which has
 * two blocks and the version information areas. They are compared module for module.
 */
const REFERENCES: { text: string; version: number; mask: number; rows: string[] }[] = [
  {
    text: 'ABC123',
    version: 1,
    mask: 2,
    rows: [
      '#######..#..#.#######',
      '#.....#.#..#..#.....#',
      '#.###.#..#....#.###.#',
      '#.###.#.#..#..#.###.#',
      '#.###.#...###.#.###.#',
      '#.....#.###.#.#.....#',
      '#######.#.#.#.#######',
      '..........###........',
      '#####.####..##.#.#.#.',
      '######...##.#..#..#..',
      '#..#.##.#..#.#..#..#.',
      '.##.#...###....#####.',
      '...#..#.#..#.#..#.#..',
      '........##.#####..#..',
      '#######.###.#.##.#.#.',
      '#.....#..#.####.#.#.#',
      '#.###.#.##..#..#.#.#.',
      '#.###.#.#...#...#.#..',
      '#.###.#.#.##.#.#.##..',
      '#.....#.#.#....##.#..',
      '#######.#.##.#.#.#.#.',
    ],
  },
  {
    text: 'http://192.168.1.42:8900/open-rails/?pupitre=ABC123',
    version: 3,
    mask: 5,
    rows: [
      '#######..#..#...##..#.#######',
      '#.....#..#..###.#.#.#.#.....#',
      '#.###.#..####.#.#.#...#.###.#',
      '#.###.#.#.#..#.#####..#.###.#',
      '#.###.#.#..##.#....#..#.###.#',
      '#.....#..##.....#.#...#.....#',
      '#######.#.#.#.#.#.#.#.#######',
      '.........#..#..#..#..........',
      '##...###.##..########...##...',
      '.#####....###..#.#####..#.##.',
      '#.###.#.##....##.#.....##....',
      '....#..##.###.#.#..#..#.#....',
      '#.##.###.####...#....##.....#',
      '#..##.....#...######.##.#.###',
      '.#..###.#.#.#..###...##...#..',
      '..##.#.....##.#.#..##.##..#.#',
      '###...#..##.###..#..##....#..',
      '#..#.....#...#.##..#..#.#####',
      '###.#.####.#.###.####..#....#',
      '#........#..#.#...#.#.#.#....',
      '#.#.#######.####.#..#####.###',
      '........###....#..###...##...',
      '#######.##....##...##.#.###..',
      '#.....#.##.....#....#...#..##',
      '#.###.#...#....#...######..##',
      '#.###.#...###.#####.#..#...##',
      '#.###.#...#..#.###.##.#.##.#.',
      '#.....#.#.#...#...#...###.#.#',
      '#######.###.###..##......##..',
    ],
  },
  {
    text: 'http://10.0.0.1:8900/open-rails/?pupitre=K7MQ2X#'.padEnd(154, 'abcdefghij0123456789'),
    version: 7,
    mask: 2,
    rows: [
      '#######..#######...#.##......###.#..#.#######',
      '#.....#.###.....#..###.####.....##.#..#.....#',
      '#.###.#...##.#.....#.#.##.###..###.#..#.###.#',
      '#.###.#.#.##.#.##.#.#.#.#.#...#....##.#.###.#',
      '#.###.#..#.#..#..#.######.....###.###.#.###.#',
      '#.....#.#.###.#.....#...######.#.#....#.....#',
      '#######.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#######',
      '.........#.#...##.###...######..##...........',
      '#####.###..#....###.######....##.#.#.#.#.#.#.',
      '.##....##.######....##.#.#.#####.#..#..#..###',
      '.##..##.#.##...##.#.###.#..#.#....###.##...#.',
      '##.#.#.######.#...##...#...##..####....##.#..',
      '##..####..#..#..#.#.#####....##......#...#.#.',
      '##...#.###..#.##.#.#.##....#.##.#..###....###',
      '#.##..#..##.#.##....#..######..#.###..###.#..',
      '..#....#.#...#.#####...#..#.#.#.##.####.#.##.',
      '##.#.###..##.#..###..##.###..#.#.#.#..##.#...',
      '#.###..#.#....##....##.#...#..#.##..#..##.###',
      '...####.#.........#.#.#.###......##.###.##.#.',
      '.#...#...##..##..###.......##.#####.....#.#..',
      '#...######...#..#.########...##..##.######.#.',
      '...##...#.....##.#..#...#...####.#.##...#..##',
      '.#..#.#.####....#..##.#.###....#..###.#.#....',
      '..#.#...#...##......#...##..##.##.#.#...#.#..',
      '###.#######.##..#.#.#######..#.#..#.#####....',
      '##..#..#.#..#.##.#.#######....##...#..##.####',
      '#.#.#.####...#.#..#.##.....###.####..#.#..##.',
      '###..#...####......##...#..##.####.##.###.#..',
      '.###..##.#...#..#.#.....#.#......#..#..###..#',
      '##.##..##.###.##.#.####....####..#.##..#.#.##',
      '##.#.##.#.#.#..##.#....#.##....#..###..#.#...',
      '###.##...##...#...#.##..######..#.##..##..#.#',
      '#....##.#.#..#..#.#....###...#....#.....#...#',
      '#.###...#..##.##.#.#######.#.##.#....###.##.#',
      '....#.#.#..###..#.#..#.###.#.#.##.#..#..####.',
      '.####..##..###.#.#.######..##.####.##.#...#.#',
      '#..##.#####..#..#.#.#######..#......######..#',
      '........#.###.##.#..#...#....#####.##...##..#',
      '#######.####......###.#.###.......#.#.#.##.#.',
      '#.....#..#.####..####...#...#.#.##..#...#.##.',
      '#.###.#.##...#..#.#.######....##.#..######..#',
      '#.###.#.#..##.##.#.##........###.....##.####.',
      '#.###.#.#...##.####..##.###..#.#.####.##....#',
      '#.....#.#####.##..#.#..#.#.#######..#.....#..',
      '#######.###..#..#.##....#.....#..#######.#.#.',
    ],
  },
]

const toRows = (matrix: boolean[][]) => matrix.map((row) => row.map((d) => (d ? '#' : '.')).join(''))

/** Reads the 15 format bits back from their first copy, around the top-left finder */
function readFormat(matrix: boolean[][]): number {
  const cells: [number, number][] = []
  for (let i = 0; i <= 5; i++) cells.push([8, i])
  cells.push([8, 7], [8, 8], [7, 8])
  for (let i = 9; i < 15; i++) cells.push([14 - i, 8])
  return cells.reduce((bits, [x, y], i) => bits | (Number(matrix[y][x]) << i), 0)
}

/** Reads the second copy, split between the top-right and bottom-left finders */
function readFormatCopy(matrix: boolean[][]): number {
  const size = matrix.length
  let bits = 0
  for (let i = 0; i < 8; i++) bits |= Number(matrix[8][size - 1 - i]) << i
  for (let i = 8; i < 15; i++) bits |= Number(matrix[size - 15 + i][8]) << i
  return bits
}

const FINDER = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######']

describe('encodeQr', () => {
  it('matches reference symbols module for module', () => {
    for (const reference of REFERENCES) {
      expect(new TextEncoder().encode(reference.text).length).toBeLessThanOrEqual(
        qrByteCapacity(reference.version),
      )
      expect(toRows(encodeQr(reference.text))).toEqual(reference.rows)
      // Same symbol when the mask is imposed: the automatic choice is the reference's
      expect(toRows(encodeQr(reference.text, { mask: reference.mask }))).toEqual(reference.rows)
    }
  })

  it('picks the smallest version that holds the text', () => {
    // Byte capacities at level L (ISO/IEC 18004, table 7)
    const capacities = [17, 32, 53, 78, 106, 134, 154, 192, 230]
    capacities.forEach((capacity, index) => {
      const version = index + 1
      expect(qrByteCapacity(version)).toBe(capacity)
      expect(qrVersionFor(capacity)).toBe(version)
      const full = encodeQr('a'.repeat(capacity))
      expect(full.length).toBe(qrSize(version))
      expect(full.length).toBe(17 + 4 * version)
      expect(full.every((row) => row.length === full.length)).toBe(true)
      if (version < QR_MAX_VERSION) {
        expect(encodeQr('a'.repeat(capacity + 1)).length).toBe(qrSize(version + 1))
      }
    })
    expect(encodeQr('').length).toBe(21)
  })

  it('counts bytes, not characters', () => {
    // 9 characters, 18 bytes in UTF-8: one more than version 1 holds
    expect(encodeQr('é'.repeat(9)).length).toBe(qrSize(2))
  })

  it('refuses a text that does not fit in the largest version', () => {
    expect(qrVersionFor(231)).toBeNull()
    expect(() => encodeQr('a'.repeat(231))).toThrow(RangeError)
    expect(() => encodeQr('a', { mask: 8 })).toThrow(RangeError)
  })

  it('draws the three finder patterns and their separators', () => {
    for (const length of [3, 51, 100, 200]) {
      const rows = toRows(encodeQr('x'.repeat(length)))
      const size = rows.length
      const block = (x: number, y: number) => rows.slice(y, y + 7).map((row) => row.slice(x, x + 7))
      expect(block(0, 0)).toEqual(FINDER)
      expect(block(size - 7, 0)).toEqual(FINDER)
      expect(block(0, size - 7)).toEqual(FINDER)
      // Separators: a light line along the inner sides of each finder
      expect(rows[7].slice(0, 8)).toBe('........')
      expect(rows[7].slice(size - 8)).toBe('........')
      expect(rows[size - 8].slice(0, 8)).toBe('........')
      for (let i = 0; i < 8; i++) {
        expect(rows[i][7]).toBe('.')
        expect(rows[i][size - 8]).toBe('.')
        expect(rows[size - 1 - i][7]).toBe('.')
      }
      // No finder in the fourth corner
      expect(block(size - 7, size - 7)).not.toEqual(FINDER)
    }
  })

  it('draws the timing patterns and the dark module', () => {
    for (const length of [3, 51, 100, 200]) {
      const matrix = encodeQr('x'.repeat(length))
      const size = matrix.length
      for (let i = 8; i < size - 8; i++) {
        expect(matrix[6][i]).toBe(i % 2 === 0)
        expect(matrix[i][6]).toBe(i % 2 === 0)
      }
      expect(matrix[size - 8][8]).toBe(true)
    }
  })

  it('draws the alignment patterns from version 2', () => {
    const rows = toRows(encodeQr('x'.repeat(150)))
    expect(rows.length).toBe(qrSize(7))
    const pattern = ['#####', '#...#', '#.#.#', '#...#', '#####']
    // Version 7: centres at 6, 22 and 38, less the three finder corners
    for (const [cx, cy] of [[22, 6], [6, 22], [22, 22], [38, 22], [22, 38], [38, 38]]) {
      expect(rows.slice(cy - 2, cy + 3).map((row) => row.slice(cx - 2, cx + 3))).toEqual(pattern)
    }
  })

  it('writes valid format information twice, for level L and the mask used', () => {
    for (let mask = 0; mask < 8; mask++) {
      const matrix = encodeQr('http://192.168.1.42:8900/open-rails/?pupitre=ABC123', { mask })
      const bits = readFormat(matrix)
      expect(bits).toBe(qrFormatBits(mask))
      expect(readFormatCopy(matrix)).toBe(bits)
      const plain = bits ^ 0x5412
      // Level L is 01, then the three mask bits
      expect(plain >>> 10).toBe((0b01 << 3) | mask)
    }
    // Known values (ISO/IEC 18004, annex C): L with mask 0 and mask 7
    expect(qrFormatBits(0)).toBe(0b111011111000100)
    expect(qrFormatBits(7)).toBe(0b110100101110110)
  })

  it('chooses the mask with the lowest penalty', () => {
    const text = 'http://192.168.1.42:8900/open-rails/?pupitre=ABC123'
    const chosen = qrPenalty(encodeQr(text))
    for (let mask = 0; mask < 8; mask++) {
      expect(qrPenalty(encodeQr(text, { mask }))).toBeGreaterThanOrEqual(chosen)
    }
  })

  it('scores the penalty rules', () => {
    const light = (size: number) => Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
    // All light, 6 × 6: 12 runs of six (4 each), 25 blocks (3 each), 50 % off balance (100)
    expect(qrPenalty(light(6))).toBe(12 * 4 + 25 * 3 + 100)
    // A checkerboard has no run, no block, and is balanced
    const checker = light(6).map((row, y) => row.map((_, x) => (x + y) % 2 === 0))
    expect(qrPenalty(checker)).toBe(0)
  })
})
