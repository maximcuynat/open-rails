import { beforeEach, describe, expect, it } from 'vitest'
import type { PathPiece } from './types'
import { addNode, addSegment, createNetwork, dissolveNode, resetIdCounter } from './network'
import { splitSegment } from './junction'
import { isRailwayKind, isSubwayRail, isUrbanRail, setRailway } from './railway'
import { mergeIntoLongRails, type PathFitter } from '../services/longRails'
import { deserializeNetwork, readSavedSegment, serializeNetwork } from '@infrastructure/persistence/persistence'
import { mergeProjects } from '@infrastructure/persistence/projectMerge'
import { sliceProject, unionProjects } from '@infrastructure/persistence/projectSlices'

const lineFit: PathFitter = (points) => {
  const a = points[0]
  const b = points[points.length - 1]
  const piece: PathPiece = { x: a.x, y: a.y, heading: Math.atan2(b.y - a.y, b.x - a.x), curvature: 0, length: Math.hypot(b.x - a.x, b.y - a.y) }
  return [piece]
}

describe('kind of railway of a rail', () => {
  beforeEach(() => resetIdCounter())

  it('is the railway when absent, and set or cleared through setRailway', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    expect(isSubwayRail(seg)).toBe(false)
    expect(setRailway(net, seg, 'subway')).toBe(true)
    expect(isSubwayRail(seg)).toBe(true)
    expect(setRailway(net, seg, 'subway')).toBe(false)
    setRailway(net, seg, undefined)
    expect('railway' in seg).toBe(false)
  })

  it('tells a tram and a light rail from a metro, and saves each as itself', () => {
    const net = createNetwork()
    const kinds = ['subway', 'tram', 'light_rail'] as const
    const segs = kinds.map((kind, i) => {
      const seg = addSegment(net, addNode(net, { x: 0, y: i * 10 }).id, addNode(net, { x: 100, y: i * 10 }).id)!
      setRailway(net, seg, kind)
      return seg
    })
    expect(segs.map(isSubwayRail)).toEqual([true, false, false])
    expect(segs.map(isUrbanRail)).toEqual([true, true, true])
    expect(isUrbanRail({})).toBe(false)
    expect(isRailwayKind('narrow_gauge')).toBe(false)
    const back = deserializeNetwork(serializeNetwork(net)).network
    expect(segs.map((seg) => back.segments.get(seg.id)!.railway)).toEqual([...kinds])
  })

  it('goes with both halves of a rail cut in two, and with a merged rail', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    setRailway(net, seg, 'subway')
    const cut = splitSegment(net, seg.id, { x: 40, y: 0 })!
    expect(isSubwayRail(cut.seg1)).toBe(true)
    expect(isSubwayRail(cut.seg2)).toBe(true)
    const merged = dissolveNode(net, cut.midNode.id)
    expect(merged).toBeTruthy()
    expect([...net.segments.values()].every(isSubwayRail)).toBe(true)
  })

  it('keeps a metro track and a railway track apart in long rails', () => {
    const net = createNetwork()
    const nodes = [0, 40, 100, 140, 200].map((x) => addNode(net, { x, y: 0 }))
    const rails = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
    setRailway(net, rails[2], 'subway')
    setRailway(net, rails[3], 'subway')
    mergeIntoLongRails(net, { fit: lineFit, tolerance: 0.3, cutStraightsOver: 0 })
    expect(net.segments.size).toBe(2)
    expect([...net.segments.values()].filter(isSubwayRail)).toHaveLength(1)
  })

  it('is saved, read back, and carried by the slices and the merge of projects', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 200, y: 0 })
    const s1 = addSegment(net, a.id, b.id)!
    const s2 = addSegment(net, b.id, c.id)!
    setRailway(net, s1, 'subway')
    const data = serializeNetwork(net)
    expect(data.segments.find((s) => s.id === s1.id)?.railway).toBe('subway')
    expect(data.segments.filter((s) => s.railway).length).toBe(1)
    expect(deserializeNetwork(data).network.segments.get(s1.id)?.railway).toBe('subway')
    // `readSavedSegment` is what a piece of the dataset added in place goes through
    expect(readSavedSegment(data.segments.find((s) => s.id === s1.id)!).railway).toBe('subway')
    // A value that is not a kind of railway is the railway
    const odd = { ...data, segments: data.segments.map((s) => (s.id === s1.id ? { ...s, railway: 'funicular' as never } : s)) }
    expect(deserializeNetwork(odd).network.segments.get(s1.id)?.railway).toBeUndefined()

    const metro = sliceProject(data, (segId) => segId === s1.id)
    const rail = sliceProject(data, (segId) => segId === s2.id)
    expect(metro.segments[0].railway).toBe('subway')
    expect(rail.segments[0].railway).toBeUndefined()
    const union = unionProjects([metro, rail])
    expect(union.segments.find((s) => s.id === s1.id)?.railway).toBe('subway')
    const { project } = mergeProjects(rail, metro, { tolerance: 0.05 })
    expect(project.segments.filter((s) => s.railway === 'subway')).toHaveLength(1)
  })
})
