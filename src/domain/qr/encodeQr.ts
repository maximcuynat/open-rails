/**
 * QR code encoder (ISO/IEC 18004), written for one job: the pairing address of the phone desk.
 * Byte mode, error correction level L, versions 1 to 9 (up to 230 bytes) — the smallest version
 * that fits is chosen, and the mask is the one with the lowest penalty score.
 *
 * `encodeQr` returns the modules as rows: `matrix[y][x]` is true for a dark module. The quiet
 * zone (4 light modules all around) is not included: whoever draws the code adds it.
 */

export const QR_MIN_VERSION = 1
export const QR_MAX_VERSION = 9

interface VersionSpec {
  /** Error correction codewords per block */
  ecPerBlock: number
  /** Number of blocks (all of the same size up to version 9 at level L) */
  blocks: number
  /** Total data codewords */
  dataCodewords: number
  /** Centres of the alignment patterns, on both axes */
  alignment: number[]
}

/** Level L, index = version */
const VERSIONS: readonly (VersionSpec | null)[] = [
  null,
  { ecPerBlock: 7, blocks: 1, dataCodewords: 19, alignment: [] },
  { ecPerBlock: 10, blocks: 1, dataCodewords: 34, alignment: [6, 18] },
  { ecPerBlock: 15, blocks: 1, dataCodewords: 55, alignment: [6, 22] },
  { ecPerBlock: 20, blocks: 1, dataCodewords: 80, alignment: [6, 26] },
  { ecPerBlock: 26, blocks: 1, dataCodewords: 108, alignment: [6, 30] },
  { ecPerBlock: 18, blocks: 2, dataCodewords: 136, alignment: [6, 34] },
  { ecPerBlock: 20, blocks: 2, dataCodewords: 156, alignment: [6, 22, 38] },
  { ecPerBlock: 24, blocks: 2, dataCodewords: 194, alignment: [6, 24, 42] },
  { ecPerBlock: 30, blocks: 2, dataCodewords: 232, alignment: [6, 26, 46] },
]

/** Side of the symbol in modules */
export function qrSize(version: number): number {
  return 17 + 4 * version
}

/** Bytes of payload a version holds: its data codewords less the mode and length header */
export function qrByteCapacity(version: number): number {
  const spec = VERSIONS[version]
  if (!spec) throw new RangeError(`QR version ${version} is not supported`)
  // 4 bits of mode + 8 bits of length (byte mode, versions 1 to 9) = 12 bits, so 2 codewords
  return spec.dataCodewords - 2
}

/** Smallest version that holds `byteLength` bytes, or null when even the largest is too small */
export function qrVersionFor(byteLength: number): number | null {
  for (let version = QR_MIN_VERSION; version <= QR_MAX_VERSION; version++) {
    if (byteLength <= qrByteCapacity(version)) return version
  }
  return null
}

// ─── Reed-Solomon over GF(256), polynomial x⁸ + x⁴ + x³ + x² + 1 ─────────────

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

function gfMultiply(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]
}

/** Coefficients of ∏ (x − αⁱ), i = 0 … degree − 1, highest power first, leading 1 dropped */
function generatorPolynomial(degree: number): Uint8Array {
  const poly = new Uint8Array(degree)
  poly[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      poly[j] = gfMultiply(poly[j], root)
      if (j + 1 < degree) poly[j] ^= poly[j + 1]
    }
    root = gfMultiply(root, 2)
  }
  return poly
}

function errorCorrection(data: Uint8Array, generator: Uint8Array): Uint8Array {
  const degree = generator.length
  const remainder = new Uint8Array(degree)
  for (const byte of data) {
    const factor = byte ^ remainder[0]
    remainder.copyWithin(0, 1)
    remainder[degree - 1] = 0
    for (let i = 0; i < degree; i++) remainder[i] ^= gfMultiply(generator[i], factor)
  }
  return remainder
}

// ─── Codewords ───────────────────────────────────────────────────────────────

/** Mode, length, payload, terminator and padding: exactly `dataCodewords` bytes */
function dataCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const out = new Uint8Array(spec.dataCodewords)
  let bitCount = 0
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) {
      if ((value >>> i) & 1) out[bitCount >>> 3] |= 0x80 >>> (bitCount & 7)
      bitCount++
    }
  }
  push(0b0100, 4)
  push(bytes.length, 8)
  for (const byte of bytes) push(byte, 8)
  // The terminator (up to four zero bits) and the bits up to the byte boundary are already zero
  const used = Math.min(spec.dataCodewords, Math.ceil((bitCount + 4) / 8))
  for (let i = used, pad = 0xec; i < spec.dataCodewords; i++, pad ^= 0xec ^ 0x11) out[i] = pad
  return out
}

/** Splits the data into blocks, appends their error correction and interleaves the lot */
function interleavedCodewords(data: Uint8Array, spec: VersionSpec): Uint8Array {
  const blockLength = spec.dataCodewords / spec.blocks
  const generator = generatorPolynomial(spec.ecPerBlock)
  const dataBlocks: Uint8Array[] = []
  const ecBlocks: Uint8Array[] = []
  for (let b = 0; b < spec.blocks; b++) {
    const block = data.subarray(b * blockLength, (b + 1) * blockLength)
    dataBlocks.push(block)
    ecBlocks.push(errorCorrection(block, generator))
  }
  const out = new Uint8Array(spec.dataCodewords + spec.ecPerBlock * spec.blocks)
  let k = 0
  for (let i = 0; i < blockLength; i++) for (const block of dataBlocks) out[k++] = block[i]
  for (let i = 0; i < spec.ecPerBlock; i++) for (const block of ecBlocks) out[k++] = block[i]
  return out
}

// ─── Matrix ──────────────────────────────────────────────────────────────────

interface Grid {
  size: number
  /** Dark modules */
  dark: boolean[][]
  /** Modules that belong to a function pattern: never data, never masked */
  reserved: boolean[][]
}

function createGrid(size: number): Grid {
  const blank = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  return { size, dark: blank(), reserved: blank() }
}

function setFunction(grid: Grid, x: number, y: number, dark: boolean): void {
  grid.dark[y][x] = dark
  grid.reserved[y][x] = true
}

/** A finder pattern with its light separator, centred on (cx, cy) */
function drawFinder(grid: Grid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue
      const ring = Math.max(Math.abs(dx), Math.abs(dy))
      setFunction(grid, x, y, ring !== 2 && ring !== 4)
    }
  }
}

function drawAlignment(grid: Grid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunction(grid, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
}

/** Remainder of `value`·x^(bits of generator − 1) divided by `generator`, over GF(2) */
function bchRemainder(value: number, generator: number, generatorBits: number): number {
  let remainder = value << (generatorBits - 1)
  for (let bit = 31 - Math.clz32(remainder); bit >= generatorBits - 1; bit--) {
    if ((remainder >>> bit) & 1) remainder ^= generator << (bit - (generatorBits - 1))
  }
  return remainder
}

/** The 15 format bits (level L + mask), BCH(15,5) protected and XOR-masked */
export function qrFormatBits(mask: number): number {
  // Level L is 0b01
  const data = (0b01 << 3) | mask
  return ((data << 10) | bchRemainder(data, 0x537, 11)) ^ 0x5412
}

function drawFormat(grid: Grid, mask: number): void {
  const bits = qrFormatBits(mask)
  const bit = (i: number) => ((bits >>> i) & 1) === 1
  const size = grid.size
  // First copy, around the top-left finder
  for (let i = 0; i <= 5; i++) setFunction(grid, 8, i, bit(i))
  setFunction(grid, 8, 7, bit(6))
  setFunction(grid, 8, 8, bit(7))
  setFunction(grid, 7, 8, bit(8))
  for (let i = 9; i < 15; i++) setFunction(grid, 14 - i, 8, bit(i))
  // Second copy, split between the two other finders
  for (let i = 0; i < 8; i++) setFunction(grid, size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) setFunction(grid, 8, size - 15 + i, bit(i))
  // The module that is always dark
  setFunction(grid, 8, size - 8, true)
}

/** The 18 version bits, BCH(18,6) protected; only from version 7 */
function drawVersion(grid: Grid, version: number): void {
  if (version < 7) return
  const bits = (version << 12) | bchRemainder(version, 0x1f25, 13)
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1
    const a = grid.size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    setFunction(grid, a, b, dark)
    setFunction(grid, b, a, dark)
  }
}

function drawFunctionPatterns(grid: Grid, version: number, spec: VersionSpec): void {
  const size = grid.size
  // Timing patterns first: finders and alignment patterns are drawn over them
  for (let i = 0; i < size; i++) {
    setFunction(grid, 6, i, i % 2 === 0)
    setFunction(grid, i, 6, i % 2 === 0)
  }
  drawFinder(grid, 3, 3)
  drawFinder(grid, size - 4, 3)
  drawFinder(grid, 3, size - 4)
  const last = spec.alignment.length - 1
  spec.alignment.forEach((cy, row) => {
    spec.alignment.forEach((cx, column) => {
      // The three corners that hold a finder have no alignment pattern
      const onFinder =
        (row === 0 && column === 0) || (row === 0 && column === last) || (row === last && column === 0)
      if (!onFinder) drawAlignment(grid, cx, cy)
    })
  })
  // Reserves the format area; the real bits come with the mask
  drawFormat(grid, 0)
  drawVersion(grid, version)
}

/** Lays the codewords in the two-module-wide zigzag that starts at the bottom-right corner */
function drawCodewords(grid: Grid, codewords: Uint8Array): void {
  const size = grid.size
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    // The vertical timing pattern takes a whole column out of the pairing
    if (right === 6) right = 5
    const upward = ((right + 1) & 2) === 0
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step
      for (let j = 0; j < 2; j++) {
        const x = right - j
        if (grid.reserved[y][x]) continue
        if (index < codewords.length * 8) {
          grid.dark[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1
          index++
        }
        // Past the last codeword: the remainder bits stay light
      }
    }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/** XORs a mask over the data modules. Applying it twice undoes it. */
function applyMask(grid: Grid, mask: number): void {
  const test = MASKS[mask]
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.reserved[y][x] && test(x, y)) grid.dark[y][x] = !grid.dark[y][x]
    }
  }
}

/** 1 : 1 : 3 : 1 : 1 dark-light-dark-light-dark with four light modules on one side */
const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
]

/** Penalty score of a masked symbol (ISO/IEC 18004 §7.8.3): the lower, the easier to read */
export function qrPenalty(matrix: readonly (readonly boolean[])[]): number {
  const size = matrix.length
  let penalty = 0
  let darkCount = 0
  for (let pass = 0; pass < 2; pass++) {
    const at = (line: number, i: number) => (pass === 0 ? matrix[line][i] : matrix[i][line])
    for (let line = 0; line < size; line++) {
      // Rule 1: runs of five or more modules of one colour
      let run = 1
      for (let i = 1; i <= size; i++) {
        if (i < size && at(line, i) === at(line, i - 1)) {
          run++
          continue
        }
        if (run >= 5) penalty += run - 2
        run = 1
      }
      // Rule 3: anything that looks like a finder pattern
      for (let i = 0; i + 11 <= size; i++) {
        for (const pattern of FINDER_LIKE) {
          if (pattern.every((dark, k) => at(line, i + k) === dark)) penalty += 40
        }
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix[y][x]) darkCount++
      // Rule 2: 2 × 2 blocks of one colour
      if (x + 1 < size && y + 1 < size) {
        const colour = matrix[y][x]
        if (matrix[y][x + 1] === colour && matrix[y + 1][x] === colour && matrix[y + 1][x + 1] === colour) {
          penalty += 3
        }
      }
    }
  }
  // Rule 4: distance of the dark share from 50 %, in steps of 5 %
  const total = size * size
  penalty += Math.floor(Math.abs(darkCount * 20 - total * 10) / total) * 10
  return penalty
}

export interface QrOptions {
  /** Forces a mask (0 … 7) instead of the lowest-penalty one. For tests against reference symbols. */
  mask?: number
}

/**
 * Encodes a text (as UTF-8 bytes) into a QR code. Returns the modules as rows of booleans, true
 * for dark, without quiet zone. Throws a `RangeError` when the text does not fit in version 9
 * (more than 230 bytes).
 */
export function encodeQr(text: string, options: QrOptions = {}): boolean[][] {
  const bytes = new TextEncoder().encode(text)
  const version = qrVersionFor(bytes.length)
  if (version === null) {
    throw new RangeError(
      `Text too long for a QR code: ${bytes.length} bytes, ${qrByteCapacity(QR_MAX_VERSION)} at most`,
    )
  }
  const spec = VERSIONS[version] as VersionSpec
  const grid = createGrid(qrSize(version))
  drawFunctionPatterns(grid, version, spec)
  drawCodewords(grid, interleavedCodewords(dataCodewords(bytes, spec), spec))

  let mask = options.mask
  if (mask === undefined) {
    let best = Infinity
    mask = 0
    for (let candidate = 0; candidate < MASKS.length; candidate++) {
      applyMask(grid, candidate)
      drawFormat(grid, candidate)
      const penalty = qrPenalty(grid.dark)
      if (penalty < best) {
        best = penalty
        mask = candidate
      }
      applyMask(grid, candidate)
    }
  } else if (!Number.isInteger(mask) || mask < 0 || mask >= MASKS.length) {
    throw new RangeError(`QR mask ${mask} is out of range`)
  }
  applyMask(grid, mask)
  drawFormat(grid, mask)
  return grid.dark
}
