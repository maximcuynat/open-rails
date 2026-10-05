import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment, removeSegment } from '@domain/models/network'
import { computeTrackSections } from '@domain/models/sections'
import { analyzeKinematics } from '@domain/services/kinematicDiagnostics'
import type { Network } from '@domain/models/types'
import { networkDerived } from './networkDerived'

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
    const after = networkDerived(net)
    expect(after).not.toBe(before)
    expect(after.sections).toEqual(computeTrackSections(net))
    expect(after.sections[0].totalLength).toBeCloseTo(90)
  })

  it('recomputes when a node changes level', () => {
    const { net, ids } = line()
    const before = networkDerived(net)
    net.nodes.get(ids[1])!.level = 1
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
    expect(networkDerived(net)).not.toBe(before)
  })

  it('recomputes when the section settings change, and only then', () => {
    const { net } = line()
    const id = networkDerived(net).sections[0].id
    const meta = { [id]: { name: 'Voie A' } }
    const named = networkDerived(net, meta)
    expect(named.sections[0].name).toBe('Voie A')
    expect(networkDerived(net, { [id]: { name: 'Voie A' } })).toBe(named)
    meta[id].name = 'Voie B'
    expect(networkDerived(net, meta).sections[0].name).toBe('Voie B')
  })

  it('keeps the diagnostics per gauge and slope settings', () => {
    const { net, ids } = line()
    net.nodes.get(ids[2])!.level = 1
    const derived = networkDerived(net)
    const gradient = { levelHeight: 6, maxGradient: 0.035 }
    const issues = derived.kinematicIssues(1.435, gradient)
    expect(derived.kinematicIssues(1.435, { ...gradient })).toBe(issues)
    expect(issues).toEqual(analyzeKinematics(net, 1.435, gradient))
    expect(derived.kinematicIssues(1.435)).toEqual(analyzeKinematics(net, 1.435))
    expect(derived.kinematicIssues(1.435)).not.toBe(issues)
  })

  it('keeps separate data for separate networks', () => {
    const one = line().net
    const two = line().net
    expect(networkDerived(one)).not.toBe(networkDerived(two))
    expect(networkDerived(one)).toBe(networkDerived(one))
  })
})
