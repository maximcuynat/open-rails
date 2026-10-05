import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment } from '@domain/models/network'
import { autoDetectJunctions } from '@domain/models/junction'
import { generateRealisticSVG } from '@infrastructure/export/exportSvg'

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
    expect(svg).toContain('class="fishplate"')
    expect(svg).toContain('class="fishplate-bolt"')
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
    // Fishplates with bolts at track joints
    expect(svg).toContain('class="fishplate"')
    expect(svg).toContain('class="fishplate-bolt"')
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

  describe('track levels', () => {
    /** Ground track along y = 100 and a track across it along x = 100, added first, with no common node */
    function crossingTracks(upperLevel: number) {
      const net = createNetwork()
      const b1 = addNode(net, { x: 100, y: 0 })
      const b2 = addNode(net, { x: 100, y: 200 })
      const upper = addSegment(net, b1.id, b2.id)!
      upper.level = upperLevel
      const a1 = addNode(net, { x: 0, y: 100 })
      const a2 = addNode(net, { x: 200, y: 100 })
      addSegment(net, a1.id, a2.id)
      return net
    }

    it('a network on the ground keeps its seven plain groups, with no level group or deck', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 246, y: 0 })
      addSegment(net, n1.id, n2.id)!.level = 0

      const svg = generateRealisticSVG(net, 'Flat')
      expect(svg.match(/<g id="[^"]+"/g)).toEqual([
        '<g id="ballast"', '<g id="sleepers"', '<g id="rails"', '<g id="crossings"',
        '<g id="turnouts"', '<g id="fishplates"', '<g id="buffer-stops"',
      ])
      expect(svg).not.toContain('class="bridge-deck"')
      expect(svg).not.toContain('class="tunnel"')
    })

    it('bridge: the level-1 group comes after the ground, with its deck under its own track', () => {
      const svg = generateRealisticSVG(crossingTracks(1), 'Bridge')

      const ground = svg.indexOf('<g id="level-0">')
      const bridge = svg.indexOf('<g id="level-1">')
      expect(ground).toBeGreaterThan(-1)
      expect(bridge).toBeGreaterThan(ground)
      // Ground rails, then deck (parapet, slab), then the ballast and rails of the bridge
      expect(svg.indexOf('<g id="rails">')).toBeLessThan(bridge)
      const parapet = svg.indexOf('class="bridge-parapet" />')
      const slab = svg.indexOf('class="bridge-deck" />')
      expect(parapet).toBeGreaterThan(bridge)
      expect(slab).toBeGreaterThan(parapet)
      expect(svg.indexOf('<g id="ballast-l1">')).toBeGreaterThan(slab)
      expect(svg.indexOf('<g id="rails-l1">')).toBeGreaterThan(slab)
      // The deck follows the centreline of the raised track
      expect(svg).toContain('<path d="M 100 0 L 100 200" class="bridge-deck" />')
      // Each track has its rails in its own group
      const groundRails = svg.slice(svg.indexOf('<g id="rails">'), bridge)
      expect(groundRails).toContain('x1="0" y1="100.72"')
      expect(groundRails).not.toContain('x1="100.72" y1="0"')
      expect(svg.slice(svg.indexOf('<g id="rails-l1">'))).toContain('x1="100.72" y1="0"')
      // Free ends on both sides: no ramp, no abutment
      expect(svg).not.toContain('class="bridge-abutment" />')
    })

    it('tunnel: the level −1 group comes before the ground and is dimmed and dashed', () => {
      const svg = generateRealisticSVG(crossingTracks(-1), 'Tunnel')

      const tunnel = svg.indexOf('<g id="level--1" class="tunnel">')
      expect(tunnel).toBeGreaterThan(-1)
      expect(svg.indexOf('<g id="level-0">')).toBeGreaterThan(tunnel)
      expect(svg).toContain('.tunnel { opacity:')
      expect(svg).toContain('.tunnel .rail, .tunnel .rail-head { stroke-dasharray:')
      expect(svg).not.toContain('class="bridge-deck" />')
    })

    it('ramp: an abutment closes the deck at the node shared with a lower rail', () => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const b = addNode(net, { x: 100, y: 0 })
      const c = addNode(net, { x: 200, y: 0 })
      addSegment(net, a.id, b.id)
      addSegment(net, b.id, c.id)!.level = 1

      const svg = generateRealisticSVG(net, 'Ramp')
      expect(svg.match(/class="bridge-abutment" \/>/g)).toHaveLength(1)
      // Closing line across the deck at x = 100, wings splayed towards the lower rail
      expect(svg).toMatch(/<path d="M 9[0-9.]+ [0-9.-]+ L 100 2\.32 L 100 -2\.32 L 9[0-9.]+ [0-9.-]+" class="bridge-abutment"/)
    })
  })
})
