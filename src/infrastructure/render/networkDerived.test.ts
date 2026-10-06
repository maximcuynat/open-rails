import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment, removeSegment } from '@domain/models/network'
import { computeTrackSections } from '@domain/models/sections'
import { analyzeKinematics } from '@domain/services/kinematicDiagnostics'
import { detectConnectedComponents, detectDeadEnds, detectLoops } from '@domain/services/pathfinding'
import type { Network } from '@domain/models/types'
import { networkDerived, sectionMetaChanged, POLYLINE_MAX_CHORDS, POLYLINE_TOLERANCE } from './networkDerived'
import { networkChanged } from '@domain/models/networkWatch'

function line(): { net: Network; ids: string[]; segs: string[] } {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 30, y: 0 })
  const c = addNode(net, { x: 60, y: 0 })
  const s1 = addSegment(net, a.id, b.id)!
  const s2 = addSegment(net, b.id, c.id)!
  return { net, ids: [a.id, b.id, c.id], segs: [s1.id, s2.id] }
}

describe('networkDerived (données dérivées gardées d\'une image à l\'autre)', () => {
  it('returns the same data while the network does not change', () => {
    const { net } = line()
    const first = networkDerived(net)
    expect(networkDerived(net)).toBe(first)
    expect(first.sections).toEqual(computeTrackSections(net))
  })

  it('indexes every rail by its section', () => {
    const { net, segs } = line()
    const derived = networkDerived(net)
    for (const sid of segs) {
      expect(derived.sectionOfSegment.get(sid)?.segmentIds).toContain(sid)
    }
    expect(derived.sectionOfSegment.get('missing')).toBeUndefined()
  })

  it('recomputes when a node is moved in place', () => {
    const { net, ids } = line()
    const before = networkDerived(net)
    net.nodes.get(ids[2])!.pos.x = 90
    networkChanged()
    const after = networkDerived(net)
    expect(after).not.toBe(before)
    expect(after.sections).toEqual(computeTrackSections(net))
    expect(after.sections[0].totalLength).toBeCloseTo(90)
  })

  it('recomputes when a node changes level', () => {
    const { net, ids } = line()
    const before = networkDerived(net)
    net.nodes.get(ids[1])!.level = 1
    networkChanged()
    expect(networkDerived(net)).not.toBe(before)
  })

  it('recomputes when a rail is added, bent or removed', () => {
    const { net, ids, segs } = line()
    let last = networkDerived(net)
    const d = addNode(net, { x: 90, y: 0 })
    const curve = addCurveSegment(net, ids[2], d.id, { x: 75, y: 0 })!
    expect(networkDerived(net)).not.toBe(last)
    last = networkDerived(net)

    curve.via = { x: 75, y: 3 }
    networkChanged()
    expect(networkDerived(net)).not.toBe(last)
    last = networkDerived(net)

    removeSegment(net, segs[0])
    const after = networkDerived(net)
    expect(after).not.toBe(last)
    expect(after.sectionOfSegment.has(segs[0])).toBe(false)
    expect(after.sections).toEqual(computeTrackSections(net))
  })

  it('recomputes when a turnout is thrown', () => {
    const { net, ids, segs } = line()
    const d = addNode(net, { x: 60, y: 4 })
    const branch = addSegment(net, ids[1], d.id)!
    net.junctions.set('j_test', {
      id: 'j_test',
      nodeId: ids[1],
      kind: 'turnout',
      passages: [{ a: segs[0], b: segs[1] }, { a: segs[0], b: branch.id }],
      positions: [[0], [1]],
      active: 0,
    })
    const before = networkDerived(net)
    expect(networkDerived(net)).toBe(before)
    net.junctions.get('j_test')!.active = 1
    networkChanged()
    expect(networkDerived(net)).not.toBe(before)
  })

  it('recomputes when the section settings change, and only then', () => {
    const { net } = line()
    const id = networkDerived(net).sections[0].id
    const meta = { [id]: { name: 'Voie A' } }
    const named = networkDerived(net, meta)
    expect(named.sections[0].name).toBe('Voie A')
    expect(networkDerived(net, meta)).toBe(named)
    meta[id].name = 'Voie B'
    sectionMetaChanged(meta)
    expect(networkDerived(net, meta).sections[0].name).toBe('Voie B')
  })

  it('a change of the section settings made without a word is caught by the tests', () => {
    const { net } = line()
    const id = networkDerived(net).sections[0].id
    const meta = { [id]: { name: 'Voie A' } }
    networkDerived(net, meta)
    meta[id].name = 'Voie B'
    expect(() => networkDerived(net, meta)).toThrow(/without sectionMetaChanged/)
  })

  it('a network without revision tells the section settings apart by their content', () => {
    const { net: made } = line()
    const net = { ...made }
    const id = networkDerived(net).sections[0].id
    const meta = { [id]: { name: 'Voie A' } }
    const named = networkDerived(net, meta)
    expect(networkDerived(net, { ...meta })).toBe(named)
    meta[id].name = 'Voie B'
    expect(networkDerived(net, meta).sections[0].name).toBe('Voie B')
  })

  it('keeps the diagnostics per gauge and slope settings', () => {
    const { net, ids } = line()
    net.nodes.get(ids[2])!.level = 1
    networkChanged()
    const derived = networkDerived(net)
    const gradient = { levelHeight: 6, maxGradient: 0.035 }
    const issues = derived.kinematicIssues(1.435, gradient)
    expect(derived.kinematicIssues(1.435, { ...gradient })).toBe(issues)
    expect(issues).toEqual(analyzeKinematics(net, 1.435, gradient))
    expect(derived.kinematicIssues(1.435)).toEqual(analyzeKinematics(net, 1.435))
    expect(derived.kinematicIssues(1.435)).not.toBe(issues)
  })

  it('gives the graph analyses of the inspector, worked out once', () => {
    const { net, ids } = line()
    // A triangle on the first rail, and a rail apart from the rest
    const top = addNode(net, { x: 15, y: 20 })
    addSegment(net, ids[0], top.id)
    addSegment(net, top.id, ids[1])
    const e = addNode(net, { x: 0, y: 100 })
    const f = addNode(net, { x: 30, y: 100 })
    addSegment(net, e.id, f.id)

    const derived = networkDerived(net)
    expect(derived.deadEnds()).toEqual(detectDeadEnds(net))
    expect(derived.loops()).toEqual(detectLoops(net))
    expect(derived.components()).toEqual(detectConnectedComponents(net))
    expect(derived.loops()).toHaveLength(1)
    expect(derived.components()).toHaveLength(2)

    expect(networkDerived(net).deadEnds()).toBe(derived.deadEnds())
    expect(networkDerived(net).loops()).toBe(derived.loops())
    expect(networkDerived(net).components()).toBe(derived.components())
  })

  it('works the graph analyses out again when the track changes', () => {
    const { net, ids, segs } = line()
    const first = networkDerived(net)
    const deadEnds = first.deadEnds()
    const loops = first.loops()
    const components = first.components()
    expect(deadEnds).toHaveLength(2)
    expect(loops).toHaveLength(0)
    expect(components).toHaveLength(1)

    // A rail added closes a loop
    const top = addNode(net, { x: 30, y: 30 })
    addSegment(net, ids[0], top.id)
    const closing = addSegment(net, top.id, ids[2])!
    let derived = networkDerived(net)
    expect(derived.loops()).not.toBe(loops)
    expect(derived.loops()).toEqual(detectLoops(net))
    expect(derived.loops()).toHaveLength(1)
    expect(derived.deadEnds()).toHaveLength(0)

    // A rail removed opens it again
    removeSegment(net, closing.id)
    derived = networkDerived(net)
    expect(derived.loops()).toHaveLength(0)
    expect(derived.deadEnds()).toEqual(detectDeadEnds(net))

    // A node moved: the same graph, but nothing is kept across a change of the network
    const kept = derived.components()
    net.nodes.get(ids[1])!.pos.y = 2
    networkChanged()
    expect(networkDerived(net).components()).not.toBe(kept)
    expect(networkDerived(net).components()).toEqual(detectConnectedComponents(net))

    // A rail cut off from the rest makes a second part
    removeSegment(net, segs[1])
    expect(networkDerived(net).components()).toEqual(detectConnectedComponents(net))
  })

  it('works the graph analyses out again when a table changes', () => {
    const { net, ids, segs } = line()
    const d = addNode(net, { x: 60, y: 4 })
    const branch = addSegment(net, ids[1], d.id)!
    const before = networkDerived(net)
    const loops = before.loops()
    net.junctions.set('j_test', {
      id: 'j_test',
      nodeId: ids[1],
      kind: 'turnout',
      passages: [{ a: segs[0], b: segs[1] }, { a: segs[0], b: branch.id }],
      positions: [[0], [1]],
      active: 0,
    })
    const after = networkDerived(net)
    expect(after).not.toBe(before)
    expect(after.loops()).not.toBe(loops)
    expect(after.loops()).toEqual(detectLoops(net))
    expect(after.sections).toEqual(computeTrackSections(net))
  })

  it('keeps separate data for separate networks', () => {
    const one = line().net
    const two = line().net
    expect(networkDerived(one)).not.toBe(networkDerived(two))
    expect(networkDerived(one)).toBe(networkDerived(one))
  })

  describe('section polylines', () => {
    it('one line per section, through its nodes in order, with its bounding box', () => {
      const { net } = line()
      const lines = networkDerived(net).sectionPolylines()
      expect(lines).toHaveLength(1)
      expect(lines[0].section).toBe(networkDerived(net).sections[0])
      const pts = [...lines[0].points]
      // Either way round, but in order along the track
      expect([pts, [...pts].reverse().flatMap((_, i, all) => (i % 2 ? [] : [all[i + 1], all[i]]))]).toContainEqual([0, 0, 30, 0, 60, 0])
      expect(lines[0]).toMatchObject({ minX: 0, maxX: 60, minY: 0, maxY: 0, tunnel: false })
    })

    it('a rail laid against the direction of the section is walked backwards', () => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const b = addNode(net, { x: 30, y: 0 })
      const c = addNode(net, { x: 60, y: 0 })
      addSegment(net, a.id, b.id)
      addCurveSegment(net, c.id, b.id, { x: 45, y: 0 })
      const [only] = networkDerived(net).sectionPolylines()
      const xs = [...only.points].filter((_, i) => i % 2 === 0)
      expect(xs.length).toBe(3)
      expect([[0, 30, 60], [60, 30, 0]]).toContainEqual(xs)
    })

    it('a flat curve is one chord, a bent one a few points that stay within the tolerance', () => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const b = addNode(net, { x: 100, y: 0 })
      const curve = addCurveSegment(net, a.id, b.id, { x: 50, y: 0.5 })!
      expect(networkDerived(net).sectionPolylines()[0].points.length).toBe(4)

      curve.via = { x: 50, y: 40 }
      networkChanged()
      const bent = networkDerived(net).sectionPolylines()[0]
      const count = bent.points.length / 2
      expect(count).toBeGreaterThan(3)
      expect(count).toBeLessThanOrEqual(POLYLINE_MAX_CHORDS + 1)
      // The top of the curve (y = 20 at mid-length) is not cut off by more than the tolerance
      expect(bent.maxY).toBeGreaterThan(20 - POLYLINE_TOLERANCE)
      expect(bent.maxY).toBeLessThanOrEqual(20)
    })

    it('a section wholly below ground is flagged as a tunnel', () => {
      const { net, ids } = line()
      for (const id of ids) net.nodes.get(id)!.level = -1
      networkChanged()
      expect(networkDerived(net).sectionPolylines()[0].tunnel).toBe(true)
      net.nodes.get(ids[0])!.level = 0
      networkChanged()
      expect(networkDerived(net).sectionPolylines()[0].tunnel).toBe(false)
    })

    it('are built once and rebuilt when the network changes', () => {
      const { net, ids } = line()
      const first = networkDerived(net).sectionPolylines()
      expect(networkDerived(net).sectionPolylines()).toBe(first)
      net.nodes.get(ids[2])!.pos.x = 90
      networkChanged()
      const moved = networkDerived(net).sectionPolylines()
      expect(moved).not.toBe(first)
      expect(moved[0].maxX).toBe(90)

      const d = addNode(net, { x: 120, y: 0 })
      addSegment(net, ids[2], d.id)
      expect(networkDerived(net).sectionPolylines()[0].maxX).toBe(120)
    })
  })
})
