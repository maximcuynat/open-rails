/** Axis-aligned box, world units */
export interface Box {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** A box covering more cells than this is kept aside and answered to every query: a very long rail */
const OVERSIZE_CELLS = 1024
/** Cells are numbered from −`HALF_SIDE` to `HALF_SIDE` − 1 along each axis; what lies further shares the last one */
const HALF_SIDE = 1 << 20

/**
 * Size of the cells for a grid over these boxes: twice the size of an ordinary box (the median: a
 * few very long rails do not count), whatever the emptiness around the tracks. Boxes without size
 * (points) get about one cell each.
 */
export function gridCellSize(boxes: Iterable<Box | null>): number {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const extents: number[] = []
  for (const box of boxes) {
    if (!box) continue
    extents.push(Math.max(box.maxX - box.minX, box.maxY - box.minY))
    if (box.minX < minX) minX = box.minX
    if (box.minY < minY) minY = box.minY
    if (box.maxX > maxX) maxX = box.maxX
    if (box.maxY > maxY) maxY = box.maxY
  }
  const count = extents.length
  if (count === 0) return 1
  const width = maxX - minX
  const height = maxY - minY
  const median = Float64Array.from(extents).sort()[count >> 1]
  const sized = median > 0 ? 2 * median : Math.max(Math.sqrt((width * height) / count), Math.max(width, height) / count)
  // Never more cells along a side than the grid numbers
  return Math.max(sized, Math.max(width, height) / HALF_SIDE, 1e-6)
}

/**
 * Uniform grid of boxes, each under a key: which of them may touch a point or a box, without
 * looking at all of them. The answer is a superset — every box that touches is in it, some that do
 * not are too — each key once, in no particular order. Boxes are put in, moved and taken out one
 * at a time: the grid follows a network that changes a little between two questions.
 */
export class SpatialGrid<K> {
  /** Keys of each cell that holds any: most cells of a rail network are empty */
  private readonly cells = new Map<number, K[]>()
  /** Cells each key is in; `null` for a key kept aside */
  private readonly placed = new Map<K, number[] | null>()
  private readonly oversize = new Set<K>()

  constructor(private readonly cell: number) {}

  get size(): number {
    return this.placed.size
  }

  private index(v: number): number {
    const i = Math.floor(v / this.cell)
    return i < -HALF_SIDE ? -HALF_SIDE : i >= HALF_SIDE ? HALF_SIDE - 1 : i
  }

  /** Put a box in under `key`, in place of the one already there under that key */
  insert(key: K, minX: number, minY: number, maxX: number, maxY: number): void {
    if (this.placed.has(key)) this.remove(key)
    const x0 = this.index(minX)
    const x1 = this.index(maxX)
    const y0 = this.index(minY)
    const y1 = this.index(maxY)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > OVERSIZE_CELLS) {
      this.oversize.add(key)
      this.placed.set(key, null)
      return
    }
    const cells: number[] = []
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const id = (y + HALF_SIDE) * (2 * HALF_SIDE) + (x + HALF_SIDE)
        cells.push(id)
        const list = this.cells.get(id)
        if (list) list.push(key)
        else this.cells.set(id, [key])
      }
    }
    this.placed.set(key, cells)
  }

  remove(key: K): void {
    const cells = this.placed.get(key)
    if (cells === undefined) return
    this.placed.delete(key)
    if (cells === null) {
      this.oversize.delete(key)
      return
    }
    for (const id of cells) {
      const list = this.cells.get(id)!
      if (list.length === 1) {
        this.cells.delete(id)
        continue
      }
      const at = list.indexOf(key)
      list[at] = list[list.length - 1]
      list.pop()
    }
  }

  /**
   * Like `inBox`, without the care of naming each key once: a box that lies over several cells of
   * the question comes as many times. For whoever sorts the answer anyway.
   */
  inBoxRepeated(minX: number, minY: number, maxX: number, maxY: number): K[] {
    const x0 = this.index(minX)
    const x1 = this.index(maxX)
    const y0 = this.index(minY)
    const y1 = this.index(maxY)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) return [...this.placed.keys()]
    const found: K[] = [...this.oversize]
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const list = this.cells.get((y + HALF_SIDE) * (2 * HALF_SIDE) + (x + HALF_SIDE))
        if (list) for (const key of list) found.push(key)
      }
    }
    return found
  }

  /** Keys of the boxes that may hold the point (x, y) */
  atPoint(x: number, y: number): K[] {
    return this.inBox(x, y, x, y)
  }

  /** Keys of the boxes that may touch the box given by its corners */
  inBox(minX: number, minY: number, maxX: number, maxY: number): K[] {
    const x0 = this.index(minX)
    const x1 = this.index(maxX)
    const y0 = this.index(minY)
    const y1 = this.index(maxY)
    // A question wider than the grid is full: every key, rather than a walk over empty cells
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) return [...this.placed.keys()]
    const found: K[] = [...this.oversize]
    if (x0 === x1 && y0 === y1) {
      const list = this.cells.get((y0 + HALF_SIDE) * (2 * HALF_SIDE) + (x0 + HALF_SIDE))
      if (list) for (const key of list) found.push(key)
      return found
    }
    const seen = new Set<K>()
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const list = this.cells.get((y + HALF_SIDE) * (2 * HALF_SIDE) + (x + HALF_SIDE))
        if (!list) continue
        for (const key of list) {
          if (seen.has(key)) continue
          seen.add(key)
          found.push(key)
        }
      }
    }
    return found
  }
}

/**
 * For each box of a list, the boxes after it that may touch it (within `margin`), in ascending
 * order: the pairs a double loop over the list would have to test, without looking at the others.
 * Returns a function of the index of the first box of the pair.
 */
export function touchingLater(boxes: readonly (Box | null)[], margin = 0): (i: number) => number[] {
  const grid = new SpatialGrid<number>(gridCellSize(boxes) + 2 * margin)
  boxes.forEach((box, i) => {
    if (box) grid.insert(i, box.minX, box.minY, box.maxX, box.maxY)
  })
  return (i) => {
    const box = boxes[i]
    if (!box) return []
    const later = grid.inBox(box.minX - margin, box.minY - margin, box.maxX + margin, box.maxY + margin).filter((j) => j > i)
    return later.sort((a, b) => a - b)
  }
}
