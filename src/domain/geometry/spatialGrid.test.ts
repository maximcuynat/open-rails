import { describe, it, expect } from 'vitest'
import { SpatialGrid, gridCellSize, touchingLater, type Box } from './spatialGrid'
import { createNetwork, addNode, addSegment, addCurveSegment, removeSegment, resetIdCounter } from '../models/network'
import { isNetworkReconciled, reconcileNetworkIntersections } from './reconcile'
import { deserializeNetwork } from '../../infrastructure/persistence/persistence'
import { serializeNetwork } from '../../infrastructure/persistence/persistence'
import type { Network } from '../models/types'
import { networkChanged } from '@domain/models/networkWatch'

/** Deterministic pseudo-random numbers in [0, 1) */
function randomSource(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomBoxes(random: () => number, count: number, spread: number, size: number): Box[] {
  const boxes: Box[] = []
  for (let i = 0; i < count; i++) {
    const x = (random() - 0.5) * spread
    const y = (random() - 0.5) * spread
    boxes.push({ minX: x, maxX: x + random() * size, minY: y, maxY: y + random() * size })
  }
  return boxes
}

function gridOf(boxes: Box[]): SpatialGrid<number> {
  const grid = new SpatialGrid<number>(gridCellSize(boxes))
  boxes.forEach((box, i) => grid.insert(i, box.minX, box.minY, box.maxX, box.maxY))
  return grid
}

const touches = (box: Box, minX: number, minY: number, maxX: number, maxY: number): boolean =>
  box.maxX >= minX && box.minX <= maxX && box.maxY >= minY && box.minY <= maxY

describe('SpatialGrid', () => {
  it('answers nothing when empty', () => {
    const grid = new SpatialGrid<string>(gridCellSize([]))
    expect(grid.atPoint(0, 0)).toEqual([])
    expect(grid.inBox(-1, -1, 1, 1)).toEqual([])
  })

  it('returns every box that touches the query, each once', () => {
    const random = randomSource(7)
    const boxes = randomBoxes(random, 400, 1000, 60)
    const grid = gridOf(boxes)
    for (let q = 0; q < 200; q++) {
      const x = (random() - 0.5) * 1100
      const y = (random() - 0.5) * 1100
      const w = random() * 120
      const h = random() * 120
      const found = grid.inBox(x, y, x + w, y + h)
      expect(new Set(found).size).toBe(found.length)
      boxes.forEach((box, i) => {
        if (touches(box, x, y, x + w, y + h)) expect(found).toContain(i)
      })
    }
  })

  it('leaves most boxes out of a small query', () => {
    const boxes = randomBoxes(randomSource(3), 2000, 5000, 40)
    const grid = gridOf(boxes)
    expect(grid.atPoint(100, 100).length).toBeLessThan(40)
  })

  it('follows a box that moves and forgets one taken out', () => {
    const grid = new SpatialGrid<string>(10)
    grid.insert('a', 0, 0, 5, 5)
    grid.insert('b', 100, 100, 105, 105)
    expect(grid.atPoint(2, 2)).toEqual(['a'])
    grid.insert('a', 200, 200, 205, 205)
    expect(grid.atPoint(2, 2)).toEqual([])
    expect(grid.atPoint(202, 202)).toEqual(['a'])
    grid.remove('b')
    expect(grid.atPoint(102, 102)).toEqual([])
    expect(grid.size).toBe(1)
    grid.remove('b')
    expect(grid.size).toBe(1)
  })

  it('keeps a box much longer than the others, and boxes on one line', () => {
    const boxes: Box[] = []
    for (let i = 0; i < 3000; i++) boxes.push({ minX: i * 10, maxX: i * 10 + 10, minY: 0, maxY: 0 })
    // One rail along the whole line, and one far across it
    boxes.push({ minX: 0, maxX: 30000, minY: 0, maxY: 0 })
    boxes.push({ minX: 15000, maxX: 15000, minY: -2e6, maxY: 2e6 })
    const grid = gridOf(boxes)
    const found = grid.atPoint(12345, 0)
    expect(found).toContain(1234)
    expect(found).toContain(3000)
    expect(grid.atPoint(15000, 1.5e6)).toContain(3001)
    expect(found.length).toBeLessThan(20)
    grid.remove(3001)
    expect(grid.atPoint(15000, 1.5e6)).not.toContain(3001)
  })

  it('sizes cells for points from the area they cover', () => {
    const points: Box[] = []
    for (let i = 0; i < 100; i++) points.push({ minX: i % 10, maxX: i % 10, minY: Math.floor(i / 10), maxY: Math.floor(i / 10) })
    expect(gridCellSize(points)).toBeCloseTo(0.9, 5)
  })
})

describe('touchingLater', () => {
  it('gives, for each box, every later box within the margin of it, in ascending order', () => {
    const random = randomSource(13)
    const boxes: (Box | null)[] = randomBoxes(random, 500, 800, 30)
    boxes[17] = null
    boxes[230] = null
    for (const margin of [0, 5]) {
      const later = touchingLater(boxes, margin)
      let pairs = 0
      boxes.forEach((box, i) => {
        const found = later(i)
        expect(found).toEqual([...new Set(found)].sort((a, b) => a - b))
        expect(found.every((j) => j > i && boxes[j] !== null)).toBe(true)
        if (!box) {
          expect(found).toEqual([])
          return
        }
        for (let j = i + 1; j < boxes.length; j++) {
          const other = boxes[j]
          if (other && touches(other, box.minX - margin, box.minY - margin, box.maxX + margin, box.maxY + margin)) {
            expect(found).toContain(j)
            pairs++
          }
        }
      })
      expect(pairs).toBeGreaterThan(50)
    }
  })

  it('finds points within the margin of each other', () => {
    const points: Box[] = [[0, 0], [3, 4], [100, 100], [3, 9.5]].map(([x, y]) => ({ minX: x, maxX: x, minY: y, maxY: y }))
    const later = touchingLater(points, 6)
    expect(later(0)).toContain(1)
    expect(later(1)).toContain(3)
    expect(later(3)).toEqual([])
  })
})

/** Lays one more track across what is there: crossings, nodes on rails, nodes on nodes, on two levels */
function layRandomTrack(net: Network, random: () => number, points: { x: number; y: number }[]): void {
  const span = 300
  // One end in three starts from a place already used: stacked nodes and nodes on rails
  const reuse = points.length > 0 && random() < 0.33
  const start = reuse ? points[Math.floor(random() * points.length)] : { x: random() * span, y: random() * span }
  const end = { x: start.x + (random() - 0.5) * 160, y: start.y + (random() - 0.5) * 160 }
  const level = random() < 0.15 ? 1 : 0
  const a = addNode(net, start, level)
  const b = addNode(net, end, level)
  if (random() < 0.3) {
    addCurveSegment(net, a.id, b.id, {
      x: (start.x + end.x) / 2 + (random() - 0.5) * 30,
      y: (start.y + end.y) / 2 + (random() - 0.5) * 30,
    })
  } else {
    addSegment(net, a.id, b.id)
  }
  points.push(end, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 })
}

function tangledNetwork(seed: number, rails: number): Network {
  const random = randomSource(seed)
  const net = createNetwork()
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < rails; i++) layRandomTrack(net, random, points)
  return net
}

describe('reconcileNetworkIntersections, kept state against every pair', () => {
  it('gives the same network in one pass', () => {
    for (let seed = 1; seed <= 12; seed++) {
      resetIdCounter(0)
      const kept = tangledNetwork(seed, 30)
      const keptResult = reconcileNetworkIntersections(kept)
      resetIdCounter(0)
      const exhaustive = tangledNetwork(seed, 30)
      const exhaustiveResult = reconcileNetworkIntersections(exhaustive, undefined, true)

      expect(keptResult).toEqual(exhaustiveResult)
      expect(keptResult.splitCount + keptResult.weldedCount).toBeGreaterThan(0)
      expect(serializeNetwork(kept, 'x')).toEqual(serializeNetwork(exhaustive, 'x'))
    }
  })

  it('gives the same network edit after edit: tracks laid, nodes moved, rails removed', () => {
    /** The same story told to a network reconciled either way */
    const story = (seed: number, exhaustive: boolean): { net: Network; counts: number[] } => {
      resetIdCounter(0)
      const random = randomSource(seed)
      const net = createNetwork()
      const points: { x: number; y: number }[] = []
      const counts: number[] = []
      for (let step = 0; step < 25; step++) {
        const what = random()
        const nodes = [...net.nodes.values()]
        const segs = [...net.segments.values()]
        if (what < 0.6 || segs.length < 4) {
          layRandomTrack(net, random, points)
        } else if (what < 0.8) {
          // A node dragged: onto another node, onto a rail, or anywhere
          const node = nodes[Math.floor(random() * nodes.length)]
          const target = points[Math.floor(random() * points.length)]
          node.pos = random() < 0.7 ? { x: target.x, y: target.y } : { x: node.pos.x + (random() - 0.5) * 40, y: node.pos.y + (random() - 0.5) * 40 }
          networkChanged()
        } else if (what < 0.9) {
          removeSegment(net, segs[Math.floor(random() * segs.length)].id)
        } else {
          // A second rail between the same two nodes: a duplicate to drop
          const seg = segs[Math.floor(random() * segs.length)]
          if (seg.via) addCurveSegment(net, seg.to, seg.from, { x: seg.via.x, y: seg.via.y })
          else addCurveSegment(net, seg.from, seg.to, { x: 1, y: 1 })
        }
        const result = reconcileNetworkIntersections(net, 0.1, exhaustive)
        counts.push(result.splitCount, result.weldedCount)
      }
      return { net, counts }
    }

    for (let seed = 1; seed <= 10; seed++) {
      const kept = story(seed, false)
      const exhaustive = story(seed, true)
      expect(kept.counts).toEqual(exhaustive.counts)
      expect(kept.counts.some((c) => c > 0)).toBe(true)
      expect(serializeNetwork(kept.net, 'x')).toEqual(serializeNetwork(exhaustive.net, 'x'))
    }
  })

  it('knows when a pass would find nothing, without touching the network', () => {
    resetIdCounter(0)
    const net = tangledNetwork(4, 25)
    expect(isNetworkReconciled(net, 0.1)).toBe(false)
    reconcileNetworkIntersections(net, 0.1)
    const before = serializeNetwork(net, 'x')
    expect(isNetworkReconciled(net, 0.1)).toBe(true)
    expect(isNetworkReconciled(net, 0.2)).toBe(false)
    expect(serializeNetwork(net, 'x')).toEqual(before)

    // A node laid on a rail: something to mend, seen without being mended
    const rail = [...net.segments.values()][0]
    const a = net.nodes.get(rail.from)!.pos
    const b = net.nodes.get(rail.to)!.pos
    addNode(net, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, net.nodes.get(rail.from)!.level ?? 0)
    const dirty = serializeNetwork(net, 'x')
    expect(isNetworkReconciled(net, 0.1)).toBe(false)
    expect(serializeNetwork(net, 'x')).toEqual(dirty)
    // The pass that follows still mends it
    expect(reconcileNetworkIntersections(net, 0.1).splitCount).toBeGreaterThan(0)
    expect(isNetworkReconciled(net, 0.1)).toBe(true)
  })

  it('a reconciled network read back as such is the one a full pass gives, and is mended the same way afterwards', () => {
    for (let seed = 1; seed <= 8; seed++) {
      resetIdCounter(0)
      const net = tangledNetwork(seed, 30)
      const tolerance = 0.1
      reconcileNetworkIntersections(net, tolerance)
      const data = serializeNetwork(net, 'x')

      const checked = deserializeNetwork(data).network
      const trusted = deserializeNetwork(data, tolerance).network
      expect(serializeNetwork(trusted, 'x')).toEqual(serializeNetwork(checked, 'x'))
      expect(serializeNetwork(trusted, 'x').segments).toEqual(data.segments)

      // The same edits on both, mended with every pair looked at on one and from the kept state on the other
      const laid = (target: Network): void => {
        const random = randomSource(seed + 100)
        const points = [...target.nodes.values()].map((node) => ({ ...node.pos }))
        for (let i = 0; i < 6; i++) layRandomTrack(target, random, points)
      }
      resetIdCounter(100000)
      laid(checked)
      const exhaustive = reconcileNetworkIntersections(checked, tolerance, true)
      resetIdCounter(100000)
      laid(trusted)
      const kept = reconcileNetworkIntersections(trusted, tolerance)
      expect(kept).toEqual(exhaustive)
      expect(kept.splitCount + kept.weldedCount).toBeGreaterThan(0)
      expect(serializeNetwork(trusted, 'x')).toEqual(serializeNetwork(checked, 'x'))
    }
  })

  it('starts over when the tolerance changes', () => {
    resetIdCounter(0)
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    addSegment(net, a.id, b.id)
    const c = addNode(net, { x: 50, y: 0.5 })
    const d = addNode(net, { x: 50, y: 40 })
    addSegment(net, c.id, d.id)
    expect(reconcileNetworkIntersections(net, 0.1).splitCount).toBe(0)
    // Half a metre off the rail: within a looser tolerance only
    expect(reconcileNetworkIntersections(net, 1).splitCount).toBe(1)
  })
})
