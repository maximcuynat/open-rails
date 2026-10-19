import { beforeEach, describe, expect, it } from 'vitest'
import type { Network, PathPiece } from './types'
import { addNode, addSegment, createNetwork, dissolveNode, resetIdCounter } from './network'
import { splitSegment } from './junction'
import { runningCarriesOn, runsAgainst, setRunning } from './running'
import { mergeIntoLongRails, type PathFitter } from '../services/longRails'
import { deserializeNetwork, serializeNetwork } from '@infrastructure/persistence/persistence'

const lineFit: PathFitter = (points) => {
  const a = points[0]
  const b = points[points.length - 1]
  const piece: PathPiece = { x: a.x, y: a.y, heading: Math.atan2(b.y - a.y, b.x - a.x), curvature: 0, length: Math.hypot(b.x - a.x, b.y - a.y) }
  return [piece]
}

/** The normal direction of the rail under x on a track along y = 0, as seen going towards +x */
function eastwardAt(net: Network, x: number): 'with' | 'against' | 'none' {
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)!.pos
    const b = net.nodes.get(seg.to)!.pos
    if (Math.min(a.x, b.x) <= x && x <= Math.max(a.x, b.x)) {
      if (!seg.running) return 'none'
      const forwardIsEast = b.x > a.x
      return runsAgainst(seg, forwardIsEast) ? 'against' : 'with'
    }
  }
  throw new Error(`no rail at ${x}`)
}

describe('normal direction of running on a rail', () => {
  beforeEach(() => resetIdCounter())

  it('is read the way the rail runs', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    expect(runsAgainst(seg, true)).toBe(false)
    setRunning(net, seg, 'forward')
    expect(runsAgainst(seg, true)).toBe(false)
    expect(runsAgainst(seg, false)).toBe(true)
    setRunning(net, seg, 'backward')
    expect(runsAgainst(seg, true)).toBe(true)
  })

  it('goes with both halves of a rail cut in two', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    setRunning(net, seg, 'backward')
    const cut = splitSegment(net, seg.id, { x: 40, y: 0 })!
    expect(cut.seg1.running).toBeDefined()
    expect(cut.seg2.running).toBeDefined()
    expect(eastwardAt(net, 20)).toBe('against')
    expect(eastwardAt(net, 70)).toBe('against')
  })

  it('is flipped on a merged rail laid the other way, and carried by a merge', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const m = addNode(net, { x: 50, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    // Laid towards the west: its `forward` runs west, so `backward` is eastward
    const s1 = addSegment(net, m.id, a.id)!
    const s2 = addSegment(net, m.id, b.id)!
    setRunning(net, s1, 'backward')
    setRunning(net, s2, 'forward')
    expect(runningCarriesOn(s1, s2, m.id)).toBe(true)
    const merged = dissolveNode(net, m.id)!
    expect(merged).toBeTruthy()
    expect(eastwardAt(net, 50)).toBe('with')
  })

  it('keeps apart, in long rails, two runs of opposite directions', () => {
    const net = createNetwork()
    const nodes = [0, 40, 100, 140, 200].map((x) => addNode(net, { x, y: 0 }))
    const rails = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
    setRunning(net, rails[0], 'forward')
    setRunning(net, rails[1], 'forward')
    setRunning(net, rails[2], 'backward')
    setRunning(net, rails[3], 'backward')
    mergeIntoLongRails(net, { fit: lineFit, tolerance: 0.3, cutStraightsOver: 0 })
    expect(net.segments.size).toBe(2)
    expect(eastwardAt(net, 50)).toBe('with')
    expect(eastwardAt(net, 150)).toBe('against')
  })

  it('is saved and read back', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 200, y: 0 })
    const s1 = addSegment(net, a.id, b.id)!
    addSegment(net, b.id, c.id)
    setRunning(net, s1, 'backward')
    const data = serializeNetwork(net)
    expect(data.segments.find((s) => s.id === s1.id)?.running).toBe('backward')
    expect(data.segments.filter((s) => s.running).length).toBe(1)
    const back = deserializeNetwork(data).network
    expect(back.segments.get(s1.id)?.running).toBe('backward')
    // A value that is not a direction is not read
    const odd = { ...data, segments: data.segments.map((s) => (s.id === s1.id ? { ...s, running: 'sideways' as never } : s)) }
    expect(deserializeNetwork(odd).network.segments.get(s1.id)?.running).toBeUndefined()
  })
})
