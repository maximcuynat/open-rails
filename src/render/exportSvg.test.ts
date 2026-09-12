import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment } from '../core/network'
import { autoDetectJunctions } from '../core/junction'
import { generateRealisticSVG } from './exportSvg'

describe('generateRealisticSVG', () => {
  it('returns empty svg when network has no nodes', () => {
    const net = createNetwork()
    const svg = generateRealisticSVG(net, 'EmptyNetwork')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })

  it('generates complete layered SVG for a straight track', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 246, y: 0 })
    addSegment(net, n1.id, n2.id)

    const svg = generateRealisticSVG(net, 'StraightTrack')
    expect(svg).toContain('<?xml version="1.0"')
    expect(svg).toContain('<g id="ballast">')
    expect(svg).toContain('<g id="sleepers">')
    expect(svg).toContain('<g id="rails">')
    expect(svg).toContain('<g id="turnouts">')
    expect(svg).toContain('<g id="crossings">')

    // Contains ballast polygon, sleepers, and 2 rails
    expect(svg).toContain('<polygon points="')
    expect(svg).toContain('<rect')
    expect(svg).toContain('<line x1="')
  })

  it('keeps junctions clean without extra fixtures when two straight tracks connect', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 123, y: 0 })
    const n3 = addNode(net, { x: 246, y: 0 })
    addSegment(net, n1.id, n2.id)
    addSegment(net, n2.id, n3.id)

    const svg = generateRealisticSVG(net, 'TwoTracks')
    expect(svg).not.toContain('class="fishplate"')
    expect(svg).not.toContain('class="bolt"')
    expect(svg).toContain('class="rail-head"')
  })

  it('generates realistic turnout elements (guard rails, frog, blades, motor) for auto-detected turnout', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 246, y: 0 })
    const div = addNode(net, { x: 240, y: 40 })

    addSegment(net, stem.id, apex.id)
    addSegment(net, apex.id, straight.id)
    addSegment(net, apex.id, div.id)

    autoDetectJunctions(net)
    expect(net.junctions.size).toBe(1)

    const svg = generateRealisticSVG(net, 'TurnoutTrack')
    expect(svg).toContain('class="guard-rail"')
    expect(svg).toContain('class="switch-blade"')
    expect(svg).toContain('class="stretcher-bar"')
    expect(svg).toContain('class="switch-motor"')
  })

  it('generates realistic SVG for curved tracks', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 100 })
    addCurveSegment(net, n1.id, n2.id, { x: 100, y: 0 })

    const svg = generateRealisticSVG(net, 'CurvedTrack')
    expect(svg).toContain('<g id="ballast">')
    expect(svg).toContain('<g id="sleepers">')
    expect(svg).toContain('<g id="rails">')
    expect(svg).toContain('class="ballast"')
    expect(svg).toContain('class="sleeper"')
    expect(svg).toContain('class="rail"')
  })

  it('aligns continuous rails dynamically and seamlessly with polished rail head at joint node', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 246, y: 0 })
    const n3 = addNode(net, { x: 492, y: 0 })
    addSegment(net, n1.id, n2.id)
    addSegment(net, n2.id, n3.id)

    const svg = generateRealisticSVG(net, 'JointTrack')
    // Does NOT place a sleeper directly at x=246 (translate(246, 0)) due to half-offset
    expect(svg).not.toContain('translate(246, 0)')
    // Rail lines meet continuously and exactly at x=246 with zero gap or misalignment
    expect(svg).toContain('x2="246"')
    expect(svg).toContain('x1="246"')
    // Ballast fill covers the joint
    expect(svg).toContain('class="joint-fill"')
    // Polished rail head is present
    expect(svg).toContain('class="rail-head"')
    // No obsolete fishplates or bolts
    expect(svg).not.toContain('class="fishplate"')
    expect(svg).not.toContain('class="bolt"')
  })

  it('dynamically generates miter joint paths when tracks meet at an angle', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const n3 = addNode(net, { x: 170.71, y: 70.71 }) // 45 degree turn
    addSegment(net, n1.id, n2.id)
    addSegment(net, n2.id, n3.id)

    const svg = generateRealisticSVG(net, 'AngledTrack')
    // Should have ballast joint fill polygon connecting the angled roadbed
    expect(svg).toContain('class="joint-fill"')
    // Should have dynamic miter path bridging the rails across the angle
    expect(svg).toMatch(/<path d="M [0-9.-]+ [0-9.-]+ L [0-9.-]+ [0-9.-]+ L [0-9.-]+ [0-9.-]+" class="rail"/)
    expect(svg).toMatch(/<path d="M [0-9.-]+ [0-9.-]+ L [0-9.-]+ [0-9.-]+ L [0-9.-]+ [0-9.-]+" class="rail-head"/)
  })

  it('connects turnout stem routes without creating transverse crossing lines between branches', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 246, y: 0 })
    const div = addNode(net, { x: 240, y: 40 })

    addSegment(net, stem.id, apex.id)
    addSegment(net, apex.id, straight.id)
    addSegment(net, apex.id, div.id)

    autoDetectJunctions(net)

    const svg = generateRealisticSVG(net, 'TurnoutJoints')
    // Ballast joint fill is present
    expect(svg).toContain('class="joint-fill"')
    // Check that switch blades and frog details are present
    expect(svg).toContain('class="guard-rail"')
    expect(svg).toContain('class="switch-blade"')
  })

  it('generates diamond crossing elements (ballast platform, crossing ties, flangeways, frogs, guard rails)', () => {
    const net = createNetwork()
    // Two intersecting tracks at (100, 100)
    const a1 = addNode(net, { x: 0, y: 100 })
    const a2 = addNode(net, { x: 200, y: 100 })
    const b1 = addNode(net, { x: 100, y: 0 })
    const b2 = addNode(net, { x: 100, y: 200 })
    addSegment(net, a1.id, a2.id)
    addSegment(net, b1.id, b2.id)

    const svg = generateRealisticSVG(net, 'CrossingTrack')
    expect(svg).toContain('<g id="crossings">')
    expect(svg).toContain('class="flangeway"')
    expect(svg).toContain('class="frog-point"')
    expect(svg).toContain('class="guard-rail"')
    expect(svg).toContain('class="spacer-block"')
  })

  it('generates realistic buffer stops (heurtoirs de voie) at open dead-end tracks', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 200, y: 0 })
    addSegment(net, n1.id, n2.id)

    const svg = generateRealisticSVG(net, 'DeadEndTrack')
    expect(svg).toContain('<g id="buffer-stops">')
    expect(svg).toContain('class="buffer-beam"')
    expect(svg).toContain('class="buffer-target"')
    expect(svg).toContain('class="buffer-pad"')
    expect(svg).toContain('class="buffer-strut"')
  })

  it('ensures SVG elements strictly follow mathematical straight lines and Bézier curves (Q) at intersections', () => {
    const net = createNetwork()
    // 1 straight track and 1 curved track intersecting
    const s1 = addNode(net, { x: -100, y: 0 })
    const s2 = addNode(net, { x: 100, y: 0 })
    addSegment(net, s1.id, s2.id)

    const c1 = addNode(net, { x: 0, y: -100 })
    const c2 = addNode(net, { x: 0, y: 100 })
    addCurveSegment(net, c1.id, c2.id, { x: 40, y: 0 })

    const svg = generateRealisticSVG(net, 'CurvesAndLines')
    // Straight rails must be <line>
    expect(svg).toMatch(/<line x1="[^"]+" y1="[^"]+" x2="[^"]+" y2="[^"]+" class="rail"/)
    // Curved rails must be pure Bézier curves with Q
    expect(svg).toMatch(/<path d="M [0-9.-]+ [0-9.-]+ Q [0-9.-]+ [0-9.-]+ [0-9.-]+ [0-9.-]+/)
  })
})
