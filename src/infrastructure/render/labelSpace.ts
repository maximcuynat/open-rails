/**
 * Room on the screen for what is written over the tracks during one frame: section badges, speed
 * boards, labels of the reports. Everything goes through the same space, most important first — a
 * marker that is always drawn takes its room (`reserve`), a label asks for it (`claim`) and is left
 * out when something already stands there. Pure helpers, no canvas.
 *
 * The boxes are kept in buckets of a grid, so that a claim only looks at its neighbours: the cost
 * of a frame follows the number of labels, not its square.
 */

/** Screen rectangle, by its top-left corner (px) */
export interface ScreenBox {
  x: number
  y: number
  w: number
  h: number
}

/** Side of a bucket of the grid, px: a little more than a label is high, about what one is wide */
const CELL = 64
/** Buckets are numbered from this many cells left of and above the screen: what is further out is clamped */
const OFFSET = 512
const SPAN = 4096

function cellOf(v: number): number {
  const c = Math.floor(v / CELL) + OFFSET
  return c < 0 ? 0 : c >= SPAN ? SPAN - 1 : c
}

export class LabelSpace {
  private readonly cells = new Map<number, ScreenBox[]>()

  /** Takes the room of something that is drawn whatever stands there */
  reserve(box: ScreenBox): void {
    const x1 = cellOf(box.x + box.w)
    const y1 = cellOf(box.y + box.h)
    for (let cy = cellOf(box.y); cy <= y1; cy++) {
      for (let cx = cellOf(box.x); cx <= x1; cx++) {
        const key = cy * SPAN + cx
        const list = this.cells.get(key)
        if (list) list.push(box)
        else this.cells.set(key, [box])
      }
    }
  }

  /** Whether nothing stands in this rectangle yet */
  isFree(box: ScreenBox): boolean {
    const x1 = cellOf(box.x + box.w)
    const y1 = cellOf(box.y + box.h)
    for (let cy = cellOf(box.y); cy <= y1; cy++) {
      for (let cx = cellOf(box.x); cx <= x1; cx++) {
        const list = this.cells.get(cy * SPAN + cx)
        if (!list) continue
        for (let i = 0; i < list.length; i++) {
          const o = list[i]
          if (box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h) return false
        }
      }
    }
    return true
  }

  /** Takes the room when it is free; false — and nothing taken — when something stands there */
  claim(box: ScreenBox): boolean {
    if (!this.isFree(box)) return false
    this.reserve(box)
    return true
  }
}

/**
 * For each point, whether it stands in a crowd: more than `limit` of the other points lie within
 * `rx` px of it across and `ry` px up or down. What names a thing in a crowd — the badge of one
 * track among twenty — is left for a closer look, where the same things stand further apart.
 */
export function crowdedPoints(points: readonly { x: number; y: number }[], rx: number, ry: number, limit: number): boolean[] {
  const buckets = new Map<number, number[]>()
  const col = (x: number): number => Math.floor(x / rx)
  const row = (y: number): number => Math.floor(y / ry)
  const keyOf = (cx: number, cy: number): number => (cy + 100000) * 400000 + cx + 100000
  points.forEach((p, i) => {
    const key = keyOf(col(p.x), row(p.y))
    const list = buckets.get(key)
    if (list) list.push(i)
    else buckets.set(key, [i])
  })
  return points.map((p, i) => {
    let near = 0
    const cx = col(p.x)
    const cy = row(p.y)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = buckets.get(keyOf(cx + dx, cy + dy))
        if (!list) continue
        for (const j of list) {
          if (j === i) continue
          const q = points[j]
          if (Math.abs(q.x - p.x) <= rx && Math.abs(q.y - p.y) <= ry && ++near > limit) return true
        }
      }
    }
    return false
  })
}
