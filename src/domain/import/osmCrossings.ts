import type { Point } from '../models/types'
import type { Chain } from './osmGraph'

// Where the tracks cross each other in the OSM data without sharing a node: a bridge, a tunnel, or
// two tracks the data does not tell apart.

/** Side (m) of the cells the stretches of track are sorted into before they are compared */
const CELL = 25

/** A place where a chain is crossed by another stretch of track it shares no node with */
export interface ChainCrossing {
  /** Distance along the chain */
  station: number
  point: Point
  other: Chain
  otherStation: number
}

const NOTHING: readonly never[] = []

/** A grid of square cells holding whatever lies in a box */
export class Grid<T> {
  private readonly cells = new Map<number, T[]>()

  constructor(private readonly cell: number) {}

  private key(cx: number, cy: number): number {
    // Cells are at most a few thousand each way: one number holds both
    return (cx + 1_000_000) * 4_000_000 + (cy + 1_000_000)
  }

  insert(minX: number, minY: number, maxX: number, maxY: number, item: T): void {
    for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
      for (let cy = Math.floor(minY / this.cell); cy <= Math.floor(maxY / this.cell); cy++) {
        const key = this.key(cx, cy)
        const list = this.cells.get(key)
        // An item entered piece by piece comes to the same cell several times in a row
        if (!list) this.cells.set(key, [item])
        else if (list[list.length - 1] !== item) list.push(item)
      }
    }
  }

  /** The items of the cell a point lies in */
  at(x: number, y: number): readonly T[] {
    return this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(y / this.cell))) ?? NOTHING
  }

  /** Every item whose box shares a cell with the given box, each once */
  query(minX: number, minY: number, maxX: number, maxY: number): Set<T> {
    const found = new Set<T>()
    for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
      for (let cy = Math.floor(minY / this.cell); cy <= Math.floor(maxY / this.cell); cy++) {
        for (const item of this.cells.get(this.key(cx, cy)) ?? []) found.add(item)
      }
    }
    return found
  }
}

interface Stretch {
  chain: Chain
  /** Index of its first node in the chain */
  k: number
  /** OSM ids of its two nodes */
  n1: number
  n2: number
  a: Point
  b: Point
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * For each chain, the places where it is crossed by a stretch of track that has neither of its two
 * nodes in common with the stretch crossed, in order along the chain.
 */
export function findChainCrossings(chains: Chain[]): ChainCrossing[][] {
  const grid = new Grid<Stretch>(CELL)
  const stretches: Stretch[] = []
  for (const chain of chains) {
    for (let k = 0; k + 1 < chain.pts.length; k++) {
      const a = chain.pts[k]
      const b = chain.pts[k + 1]
      const stretch: Stretch = {
        chain,
        k,
        n1: chain.nodes[k],
        n2: chain.nodes[k + 1],
        a,
        b,
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
      }
      stretches.push(stretch)
      // A long stretch is entered piece by piece, so that it does not fill the cells of its whole box
      const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / CELL))
      for (let i = 0; i < pieces; i++) {
        const x0 = a.x + ((b.x - a.x) * i) / pieces
        const y0 = a.y + ((b.y - a.y) * i) / pieces
        const x1 = a.x + ((b.x - a.x) * (i + 1)) / pieces
        const y1 = a.y + ((b.y - a.y) * (i + 1)) / pieces
        grid.insert(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), stretch)
      }
    }
  }

  const found: ChainCrossing[][] = chains.map(() => [])
  for (const one of stretches) {
    for (const two of grid.query(one.minX, one.minY, one.maxX, one.maxY)) {
      // Each pair once
      if (two.chain.index < one.chain.index || (two.chain === one.chain && two.k <= one.k)) continue
      if (one.maxX < two.minX || one.minX > two.maxX || one.maxY < two.minY || one.minY > two.maxY) continue
      if (one.n1 === two.n1 || one.n1 === two.n2 || one.n2 === two.n1 || one.n2 === two.n2) continue
      const d1x = one.b.x - one.a.x
      const d1y = one.b.y - one.a.y
      const d2x = two.b.x - two.a.x
      const d2y = two.b.y - two.a.y
      const det = d1x * d2y - d1y * d2x
      if (Math.abs(det) < 1e-12) continue
      const ox = two.a.x - one.a.x
      const oy = two.a.y - one.a.y
      const t = (ox * d2y - oy * d2x) / det
      const u = (ox * d1y - oy * d1x) / det
      if (t < 0 || t > 1 || u < 0 || u > 1) continue
      const point = { x: one.a.x + d1x * t, y: one.a.y + d1y * t }
      const s1 = one.chain.stations[one.k] + t * (one.chain.stations[one.k + 1] - one.chain.stations[one.k])
      const s2 = two.chain.stations[two.k] + u * (two.chain.stations[two.k + 1] - two.chain.stations[two.k])
      found[one.chain.index].push({ station: s1, point, other: two.chain, otherStation: s2 })
      found[two.chain.index].push({ station: s2, point, other: one.chain, otherStation: s1 })
    }
  }
  for (const list of found) list.sort((p, q) => p.station - q.station)
  return found
}
