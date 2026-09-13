import { describe, it, expect } from 'vitest'
import { createNetwork, addNode, addSegment } from './network'
import {
  computeTrackSections,
  detectDirectionConflicts,
  isEndOfTrackNode,
} from './sections'

describe('detectDirectionConflicts with graph theory', () => {
  it('detects no conflicts when two tracks merge/converge into a single outflow stem', () => {
    const net = createNetwork()
    // Aiguillage where Branch 1 and Branch 2 converge into Stem
    // Apex node at (0, 0)
    const apex = addNode(net, { x: 0, y: 0 })
    // Stem goes to (-100, 0)
    const stem = addNode(net, { x: -100, y: 0 })
    // Branch 1 (straight) from (100, 0) towards apex (0, 0)
    const b1 = addNode(net, { x: 100, y: 0 })
    // Branch 2 (diverging) from (100, 20) towards apex (0, 0)
    const b2 = addNode(net, { x: 100, y: 20 })

    const sStem = addSegment(net, apex.id, stem.id)! // apex -> stem
    const sB1 = addSegment(net, b1.id, apex.id)!     // b1 -> apex
    const sB2 = addSegment(net, b2.id, apex.id)!     // b2 -> apex

    // Sections:
    // Stem flows apex -> stem (forward)
    // Branch 1 flows b1 -> apex (forward)
    // Branch 2 flows b2 -> apex (forward)
    const meta = {
      [sStem.id]: { name: 'Tronc Commun', direction: 'forward' as const },
      [sB1.id]: { name: 'Voie 1 (Directe)', direction: 'forward' as const },
      [sB2.id]: { name: 'Voie 2 (Déviée)', direction: 'forward' as const },
    }

    const sections = computeTrackSections(net, meta)
    const conflicts = detectDirectionConflicts(net, sections)

    // In graph theory, converging into a common outgoing stem is a valid merge!
    expect(conflicts.length).toBe(0)
  })

  it('detects head-on collision when two sections flow towards each other at an intersection', () => {
    const net = createNetwork()
    // Node with degree 3 or 4 so each track is a distinct section
    const center = addNode(net, { x: 0, y: 0 })
    const left = addNode(net, { x: -100, y: 0 })
    const right = addNode(net, { x: 100, y: 0 })
    const north = addNode(net, { x: 0, y: 50 })

    const segLeft = addSegment(net, left.id, center.id)!   // left -> center
    const segRight = addSegment(net, right.id, center.id)! // right -> center
    addSegment(net, center.id, north.id)                   // north connection (degree 3)

    // segLeft moves forward towards center (-> center)
    // segRight moves forward towards center (<- center)
    // segNorth is two-way but perpendicular (dot = 0)
    const meta = {
      [segLeft.id]: { name: 'Voie A', direction: 'forward' as const },
      [segRight.id]: { name: 'Voie B', direction: 'forward' as const },
    }

    const sections = computeTrackSections(net, meta)
    const conflicts = detectDirectionConflicts(net, sections)

    expect(conflicts.length).toBe(1)
    expect(conflicts[0].nodeId).toBe(center.id)
    expect(conflicts[0].type).toBe('head_on')
  })

  it('detects collision when stem and straight route are in opposing flow at a turnout', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const stem = addNode(net, { x: -100, y: 0 })
    const b1 = addNode(net, { x: 100, y: 0 })
    const b2 = addNode(net, { x: 100, y: 20 })

    const sStem = addSegment(net, stem.id, apex.id)! // stem -> apex
    const sB1 = addSegment(net, b1.id, apex.id)!     // b1 -> apex
    const sB2 = addSegment(net, b2.id, apex.id)!     // b2 -> apex

    // ALL three flow into apex: deadlock / head-on
    const meta = {
      [sStem.id]: { name: 'Tronc', direction: 'forward' as const }, // into apex
      [sB1.id]: { name: 'Voie 1', direction: 'forward' as const },  // into apex
      [sB2.id]: { name: 'Voie 2', direction: 'forward' as const },  // into apex
    }

    const sections = computeTrackSections(net, meta)
    const conflicts = detectDirectionConflicts(net, sections)

    expect(conflicts.length).toBeGreaterThanOrEqual(1)
    expect(conflicts.some((c) => c.nodeId === apex.id)).toBe(true)
  })
})

describe('isEndOfTrackNode', () => {
  it('correctly identifies dead ends vs junction and link nodes', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 50, y: 0 })
    const n3 = addNode(net, { x: 100, y: 0 })
    const n4 = addNode(net, { x: 100, y: 50 })

    addSegment(net, n1.id, n2.id)
    addSegment(net, n2.id, n3.id)
    addSegment(net, n2.id, n4.id)

    // n1 has degree 1 -> dead end
    expect(isEndOfTrackNode(net, n1.id)).toBe(true)
    // n3 has degree 1 -> dead end
    expect(isEndOfTrackNode(net, n3.id)).toBe(true)
    // n4 has degree 1 -> dead end
    expect(isEndOfTrackNode(net, n4.id)).toBe(true)
    // n2 has degree 3 (turnout) -> not a dead end
    expect(isEndOfTrackNode(net, n2.id)).toBe(false)
  })
})
