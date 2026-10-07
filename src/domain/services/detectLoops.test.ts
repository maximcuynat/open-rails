import { describe, expect, it } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork } from '../models/network'
import type { Network, NodeId } from '../models/types'
import { detectConnectedComponents, detectLoops } from './pathfinding'

/** The loops as they were found before: by recursion, the way copied at each step */
function detectLoopsByRecursion(net: Network): NodeId[][] {
  const visited = new Set<NodeId>()
  const parent = new Map<NodeId, NodeId | null>()
  const cycles: NodeId[][] = []

  function dfs(curr: NodeId, par: NodeId | null, path: NodeId[]) {
    visited.add(curr)
    parent.set(curr, par)
    path.push(curr)

    const segIds = net.adjacency.get(curr) ?? []
    for (const sid of segIds) {
      const seg = net.segments.get(sid)
      if (!seg) continue
      const neighbor = seg.from === curr ? seg.to : seg.from
      if (neighbor === par) continue

      if (visited.has(neighbor)) {
        // Cycle detected: neighbor is in the current path
        const cycleStartIndex = path.indexOf(neighbor)
        if (cycleStartIndex >= 0) {
          const cycle = path.slice(cycleStartIndex)
          // Avoid duplicate cycles of length 2
          if (cycle.length > 2) {
            // Normalize cycle to avoid permutations
            const minIndex = cycle.indexOf([...cycle].sort()[0])
            const normalized = [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)]
            const key = normalized.join(',')
            const exists = cycles.some((c) => {
              const cMin = c.indexOf([...c].sort()[0])
              const cNorm = [...c.slice(cMin), ...c.slice(0, cMin)]
              return cNorm.join(',') === key
            })
            if (!exists) {
              cycles.push(cycle)
            }
          }
        }
      } else {
        dfs(neighbor, curr, [...path])
      }
    }
  }

  for (const nodeId of net.nodes.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId, null, [])
    }
  }

  return cycles
}

/** Deterministic pseudo-random numbers in [0, 1) */
function randomSource(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Nodes joined at random: branches, loops inside loops, two rails between the same nodes, lone pieces */
function tangle(seed: number, nodes: number, rails: number): Network {
  const random = randomSource(seed)
  const net = createNetwork()
  const ids: NodeId[] = []
  for (let i = 0; i < nodes; i++) ids.push(addNode(net, { x: random() * 1000, y: random() * 1000 }).id)
  for (let i = 0; i < rails; i++) {
    const a = ids[Math.floor(random() * nodes)]
    const b = ids[Math.floor(random() * nodes)]
    if (a === b) continue
    addSegment(net, a, b)
    // Now and then a second rail between the same two nodes
    if (random() < 0.15) addCurveSegment(net, a, b, { x: random() * 1000, y: random() * 1000 })
  }
  return net
}

describe('detectLoops', () => {
  it('finds the same loops, in the same order, as the walk by recursion', () => {
    let loops = 0
    for (let seed = 1; seed <= 40; seed++) {
      const net = tangle(seed, 20 + (seed % 5) * 15, 15 + seed * 3)
      const found = detectLoops(net)
      expect(found).toEqual(detectLoopsByRecursion(net))
      loops += found.length
    }
    expect(loops).toBeGreaterThan(200)
  })

  it('counts once a loop closed by two rails between the same nodes', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 50, y: 80 })
    addSegment(net, a.id, b.id)
    addSegment(net, b.id, c.id)
    addSegment(net, c.id, a.id)
    addCurveSegment(net, c.id, a.id, { x: 0, y: 60 })
    expect(detectLoops(net)).toEqual([[a.id, b.id, c.id]])
    expect(detectLoops(net)).toEqual(detectLoopsByRecursion(net))
  })

  it('walks a line of 50 000 rails, and a ring of as many, without running out of stack', () => {
    const line = createNetwork()
    let prev = addNode(line, { x: 0, y: 0 })
    const first = prev
    for (let i = 1; i <= 50000; i++) {
      const next = addNode(line, { x: i * 10, y: 0 })
      addSegment(line, prev.id, next.id)
      prev = next
    }
    expect(detectLoops(line)).toEqual([])
    expect(detectConnectedComponents(line)).toHaveLength(1)

    addCurveSegment(line, prev.id, first.id, { x: 250000, y: 90000 })
    const loops = detectLoops(line)
    expect(loops).toHaveLength(1)
    expect(loops[0]).toHaveLength(50001)
  })
})
