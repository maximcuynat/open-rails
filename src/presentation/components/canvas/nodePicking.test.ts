import { describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork } from '@domain/models/network'
import type { Selection } from '@domain/models/types'
import { trackLod } from '@infrastructure/render/lod'
import { GAUGE } from '@infrastructure/render/renderer'
import { hitShownNode } from './nodePicking'

/** end ── joint ── end, 100 m apart */
function line() {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const joint = addNode(net, { x: 100, y: 0 })
  const b = addNode(net, { x: 200, y: 0 })
  addSegment(net, a.id, joint.id)
  addSegment(net, joint.id, b.id)
  return { net, a, joint, b }
}

const none: Selection = { nodes: new Set(), segments: new Set() }
const DETAIL = 8
const LINE = 1
const SCHEMATIC = 0.2

describe('hitShownNode — only a node whose marker is drawn can be grabbed', () => {
  it('the test scales fall in the three tiers', () => {
    expect([DETAIL, LINE, SCHEMATIC].map(s => trackLod(s, GAUGE))).toEqual(['detail', 'line', 'schematic'])
  })

  it('detail: every node', () => {
    const { net, a, joint } = line()
    expect(hitShownNode(net, none, { x: 100, y: 1 }, 5, DETAIL)).toBe(joint.id)
    expect(hitShownNode(net, none, { x: 0, y: 1 }, 5, DETAIL)).toBe(a.id)
    expect(hitShownNode(net, none, { x: 50, y: 1 }, 5, DETAIL)).toBeNull()
  })

  it('line: the ends of track, not the joints', () => {
    const { net, a, joint } = line()
    expect(hitShownNode(net, none, { x: 100, y: 1 }, 5, LINE)).toBeNull()
    expect(hitShownNode(net, none, { x: 0, y: 1 }, 5, LINE)).toBe(a.id)
    // A selected joint is drawn, so it can be grabbed again
    const selected: Selection = { nodes: new Set([joint.id]), segments: new Set() }
    expect(hitShownNode(net, selected, { x: 100, y: 1 }, 5, LINE)).toBe(joint.id)
  })

  it('schematic: the selected nodes only', () => {
    const { net, a } = line()
    expect(hitShownNode(net, none, { x: 0, y: 1 }, 5, SCHEMATIC)).toBeNull()
    expect(hitShownNode(net, none, { x: 100, y: 1 }, 5, SCHEMATIC)).toBeNull()
    const selected: Selection = { nodes: new Set([a.id]), segments: new Set() }
    expect(hitShownNode(net, selected, { x: 0, y: 1 }, 5, SCHEMATIC)).toBe(a.id)
    expect(hitShownNode(net, selected, { x: 100, y: 1 }, 5, SCHEMATIC)).toBeNull()
  })

  it('a hidden node does not mask a shown one further away within reach', () => {
    const { net, b } = line()
    // Nearer to the joint (hidden in the line tier) than to the end of track
    expect(hitShownNode(net, none, { x: 140, y: 0 }, 70, LINE)).toBe(b.id)
  })
})
