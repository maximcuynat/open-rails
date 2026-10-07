import { describe, expect, it } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork, removeSegment, resetIdCounter, dissolveNode } from './network'
import { touchNetwork } from './networkWatch'
import { computeTrackSections, type SectionMetadata } from './sections'
import { trackProfile } from './trackSpeed'
import { addSpeedZone, removeSpeedZone } from './speedZones'
import { declareTurnout, toggleJunction } from './junction'
import { analyzeKinematics } from '../services/kinematicDiagnostics'
import { networkDerived, sectionMetaChanged } from '../../infrastructure/render/networkDerived'
import type { Network, Segment } from './types'

/** Deterministic pseudo-random numbers in [0, 1) */
function randomSource(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * A small yard: lines of rails, some curved, a few turnouts, some sidings. Random edits are then
 * made to it, and after each one what is kept from the edit before is checked against what the
 * whole network gives — the test setup verifies every revision, so the trackers throw on their own
 * when they differ.
 */
function yard(seed: number): { net: Network; random: () => number } {
  const random = randomSource(seed)
  resetIdCounter(0)
  const net = createNetwork()
  for (let line = 0; line < 4; line++) {
    let prev = addNode(net, { x: 0, y: line * 30 })
    for (let i = 1; i <= 12; i++) {
      const next = addNode(net, { x: i * 50, y: line * 30 + (random() < 0.3 ? 4 : 0) })
      if (random() < 0.3) addCurveSegment(net, prev.id, next.id, { x: (prev.pos.x + next.pos.x) / 2, y: prev.pos.y + 6 })
      else addSegment(net, prev.id, next.id)
      prev = next
    }
  }
  // A few forks between the lines
  const nodes = [...net.nodes.values()]
  for (let k = 0; k < 6; k++) {
    const a = nodes[Math.floor(random() * nodes.length)]
    const b = nodes[Math.floor(random() * nodes.length)]
    if (a !== b) addSegment(net, a.id, b.id)
  }
  return { net, random }
}

const LIMITS = { levelHeight: 6, maxGradient: 0.035 }

function check(net: Network, meta: Record<string, SectionMetadata>): void {
  const derived = networkDerived(net, meta)
  expect(derived.sections).toEqual(computeTrackSections(net, { ...meta }))
  expect(derived.kinematicIssues(1.435, LIMITS)).toEqual(analyzeKinematics(net, 1.435, LIMITS))
  for (const sec of derived.sections) for (const sid of sec.segmentIds) expect(derived.sectionOfSegment.get(sid)).toBe(sec)
  trackProfile(net)
}

describe('what is kept from one edit to the next, against the whole network', () => {
  for (const seed of [1, 2, 3]) {
    it(`sections, diagnostics and profile follow ${60} random edits (seed ${seed})`, () => {
      const { net, random } = yard(seed)
      const meta: Record<string, SectionMetadata> = {}
      check(net, meta)
      const zones: string[] = []
      for (let step = 0; step < 60; step++) {
        const nodes = [...net.nodes.values()]
        const rails = [...net.segments.values()]
        const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)]
        const kind = random()
        if (kind < 0.3) {
          const node = pick(nodes)
          node.pos = { x: node.pos.x + (random() - 0.5) * 10, y: node.pos.y + (random() - 0.5) * 10 }
          touchNetwork(net)
        } else if (kind < 0.42) {
          const a = pick(nodes)
          const b = pick(nodes)
          if (a !== b) {
            if (random() < 0.5) addSegment(net, a.id, b.id)
            else addCurveSegment(net, a.id, b.id, { x: (a.pos.x + b.pos.x) / 2 + 5, y: (a.pos.y + b.pos.y) / 2 + 5 })
          }
        } else if (kind < 0.54) {
          if (rails.length > 10) removeSegment(net, pick(rails).id)
        } else if (kind < 0.62) {
          const seg = pick(rails.filter((s: Segment) => s.kind === 'curve') as Segment[])
          if (seg?.via) {
            seg.via = { x: seg.via.x + (random() - 0.5) * 6, y: seg.via.y + (random() - 0.5) * 6 }
            touchNetwork(net)
          }
        } else if (kind < 0.68) {
          const node = pick(nodes)
          node.level = node.level ? 0 : 1
          touchNetwork(net)
        } else if (kind < 0.74) {
          const seg = pick(rails)
          seg.cant = seg.cant === undefined ? 40 + Math.floor(random() * 100) : undefined
          touchNetwork(net)
        } else if (kind < 0.8) {
          if (zones.length > 0 && random() < 0.5) removeSpeedZone(net, zones.pop()!)
          else {
            const zone = addSpeedZone(net, [{ segId: pick(rails).id, t0: 0, t1: 1 }], 40 + Math.floor(random() * 10) * 10)
            if (zone) zones.push(zone.id)
          }
        } else if (kind < 0.86) {
          const fork = nodes.find((n) => (net.adjacency.get(n.id)?.length ?? 0) === 3 && ![...net.junctions.values()].some((j) => j.nodeId === n.id))
          if (fork) {
            const [s0, s1, s2] = net.adjacency.get(fork.id)!
            const junction = declareTurnout(net, { nodeId: fork.id, stemSegmentId: s0, straightSegmentId: s1, divergingSegmentId: s2 })
            if (junction) toggleJunction(junction)
          }
        } else if (kind < 0.92) {
          const middle = nodes.find((n) => (net.adjacency.get(n.id)?.length ?? 0) === 2)
          if (middle) dissolveNode(net, middle.id)
        } else {
          const sections = networkDerived(net, meta).sections
          const sec = pick(sections)
          meta[sec.id] = { ...meta[sec.id], name: `Voie ${step}`, color: '#123456' }
          sectionMetaChanged(meta)
        }
        check(net, meta)
      }
    })
  }
})
