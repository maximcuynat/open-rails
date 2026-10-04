import { describe, it, expect } from 'vitest'
import {
  hitTestGizmo,
  constrainGizmoDrag,
  rotateGizmoDrag,
  rotatePoint,
  GIZMO_LENGTH,
  getGizmoAnchor,
} from './gizmo'

describe('gizmo module', () => {
  const nodeScreen = { x: 200, y: 300 }

  describe('hitTestGizmo', () => {
    it('detects hits along the horizontal X arrow', () => {
      // Right along the X arrow shaft
      const onShaft = { x: nodeScreen.x + 30, y: nodeScreen.y }
      expect(hitTestGizmo(onShaft, nodeScreen)).toBe('x')

      // Near the X arrow tip
      const nearTip = { x: nodeScreen.x + GIZMO_LENGTH, y: nodeScreen.y }
      expect(hitTestGizmo(nearTip, nodeScreen)).toBe('x')

      // Slightly off-axis within tolerance
      const slightlyOff = { x: nodeScreen.x + 25, y: nodeScreen.y + 8 }
      expect(hitTestGizmo(slightlyOff, nodeScreen)).toBe('x')

      // Too far off-axis vertically
      const tooFarY = { x: nodeScreen.x + 25, y: nodeScreen.y + 25 }
      expect(hitTestGizmo(tooFarY, nodeScreen)).toBe(null)

      // Past the tip horizontally
      const pastTip = { x: nodeScreen.x + GIZMO_LENGTH + 20, y: nodeScreen.y }
      expect(hitTestGizmo(pastTip, nodeScreen)).toBe(null)
    })

    it('detects hits along the vertical Y arrow', () => {
      // Up along the Y arrow shaft
      const onShaft = { x: nodeScreen.x, y: nodeScreen.y - 30 }
      expect(hitTestGizmo(onShaft, nodeScreen)).toBe('y')

      // Near the Y arrow tip
      const nearTip = { x: nodeScreen.x, y: nodeScreen.y - GIZMO_LENGTH }
      expect(hitTestGizmo(nearTip, nodeScreen)).toBe('y')

      // Slightly off-axis within tolerance
      const slightlyOff = { x: nodeScreen.x - 7, y: nodeScreen.y - 25 }
      expect(hitTestGizmo(slightlyOff, nodeScreen)).toBe('y')

      // Too far off-axis horizontally
      const tooFarX = { x: nodeScreen.x + 25, y: nodeScreen.y - 25 }
      expect(hitTestGizmo(tooFarX, nodeScreen)).toBe(null)

      // Past the tip vertically
      const pastTip = { x: nodeScreen.x, y: nodeScreen.y - GIZMO_LENGTH - 20 }
      expect(hitTestGizmo(pastTip, nodeScreen)).toBe(null)
    })

    it('detects hits along the rotation arc', () => {
      // 45 degrees in top-right quadrant at radius GIZMO_ROT_RADIUS (58px)
      const rad = (45 * Math.PI) / 180
      const onArc = {
        x: nodeScreen.x + Math.round(58 * Math.cos(rad)),
        y: nodeScreen.y - Math.round(58 * Math.sin(rad)),
      }
      expect(hitTestGizmo(onArc, nodeScreen)).toBe('rotate')
    })

    it('returns null at the node center (reserved for node selection / free move)', () => {
      const center = { x: nodeScreen.x, y: nodeScreen.y }
      expect(hitTestGizmo(center, nodeScreen)).toBe(null)
    })

    it('returns null outside both arrows', () => {
      expect(hitTestGizmo({ x: 50, y: 50 }, nodeScreen)).toBe(null)
      expect(hitTestGizmo({ x: nodeScreen.x - 30, y: nodeScreen.y }, nodeScreen)).toBe(null)
      expect(hitTestGizmo({ x: nodeScreen.x, y: nodeScreen.y + 30 }, nodeScreen)).toBe(null)
    })
  })

  describe('rotateGizmoDrag and rotatePoint', () => {
    it('calculates rotation angle delta and snaps to 15 degrees', () => {
      const anchor = { x: 0, y: 0 }
      const start = { x: 10, y: 0 } // 0 deg
      const current = { x: 0, y: 10 } // 90 deg
      const res = rotateGizmoDrag(anchor, start, current, true, 15)
      expect(res.angleDeg).toBeCloseTo(90)

      const pt = { x: 10, y: 0 }
      const rotated = rotatePoint(pt, anchor, (90 * Math.PI) / 180)
      expect(rotated.x).toBeCloseTo(0)
      expect(rotated.y).toBeCloseTo(10)
    })
  })

  describe('constrainGizmoDrag', () => {
    const startWorld = { x: 10, y: 20 }

    it('constrains movement to X axis only when axis is x', () => {
      const currentWorld = { x: 15.5, y: 99 } // user moved in both X and Y
      const res = constrainGizmoDrag('x', startWorld, currentWorld, false, 1)

      expect(res.pos.x).toBeCloseTo(15.5)
      expect(res.pos.y).toBe(20) // Y is strictly locked to startWorld.y!
      expect(res.delta.x).toBeCloseTo(5.5)
      expect(res.delta.y).toBe(0)
    })

    it('snaps X coordinate to grid when snap is true', () => {
      const currentWorld = { x: 14.3, y: 50 }
      const res = constrainGizmoDrag('x', startWorld, currentWorld, true, 2) // spacing 2m

      // targetX is 14.3 -> snapped to nearest 2 is 14
      expect(res.pos.x).toBe(14)
      expect(res.pos.y).toBe(20)
      expect(res.delta.x).toBe(4)
      expect(res.delta.y).toBe(0)
    })

    it('constrains movement to Y axis only when axis is y', () => {
      const currentWorld = { x: 88, y: 28.2 } // user moved in both X and Y
      const res = constrainGizmoDrag('y', startWorld, currentWorld, false, 1)

      expect(res.pos.x).toBe(10) // X is strictly locked to startWorld.x!
      expect(res.pos.y).toBeCloseTo(28.2)
      expect(res.delta.x).toBe(0)
      expect(res.delta.y).toBeCloseTo(8.2)
    })

    it('snaps Y coordinate to grid when snap is true', () => {
      const currentWorld = { x: -30, y: 24.8 }
      const res = constrainGizmoDrag('y', startWorld, currentWorld, true, 5) // spacing 5m

      // targetY is 24.8 -> snapped to nearest 5 is 25
      expect(res.pos.x).toBe(10)
      expect(res.pos.y).toBe(25)
      expect(res.delta.x).toBe(0)
      expect(res.delta.y).toBe(5)
    })
  })

  describe('getGizmoAnchor', () => {
    it('returns anchor on the node when a node is selected', () => {
      const net = {
        nodes: new Map([
          ['n1', { id: 'n1', pos: { x: 50, y: 80 } }],
          ['n2', { id: 'n2', pos: { x: 100, y: 80 } }],
        ]),
        segments: new Map([
          ['s1', { id: 's1', from: 'n1', to: 'n2', kind: 'straight' as const }],
        ]),
        adjacency: new Map([
          ['n1', ['s1']],
          ['n2', ['s1']],
        ]),
        junctions: new Map(),
      }

      const selection = {
        nodes: new Set(['n1']),
        segments: new Set<string>(),
      }

      const anchor = getGizmoAnchor(net, selection)
      expect(anchor).not.toBeNull()
      expect(anchor?.type).toBe('node')
      expect(anchor?.worldPos).toEqual({ x: 50, y: 80 })
      expect(anchor?.nodeIds.has('n1')).toBe(true)
    })

    it('returns anchor at the center of the track when a section is selected', () => {
      const net = {
        nodes: new Map([
          ['n1', { id: 'n1', pos: { x: 0, y: 0 } }],
          ['n2', { id: 'n2', pos: { x: 100, y: 0 } }],
        ]),
        segments: new Map([
          ['s1', { id: 's1', from: 'n1', to: 'n2', kind: 'straight' as const }],
        ]),
        adjacency: new Map([
          ['n1', ['s1']],
          ['n2', ['s1']],
        ]),
        junctions: new Map(),
      }

      const selection = {
        nodes: new Set<string>(),
        segments: new Set(['s1']),
      }

      const anchor = getGizmoAnchor(net, selection)
      expect(anchor).not.toBeNull()
      expect(anchor?.type).toBe('section')
      // Center of straight segment from (0,0) to (100,0) is (50,0)
      expect(anchor?.worldPos.x).toBeCloseTo(50)
      expect(anchor?.worldPos.y).toBeCloseTo(0)
      expect(anchor?.nodeIds.has('n1')).toBe(true)
      expect(anchor?.nodeIds.has('n2')).toBe(true)
    })

    it('snapshots the curves attached to a selected node so their control points can follow', () => {
      const net = {
        nodes: new Map([
          ['n1', { id: 'n1', pos: { x: 0, y: 0 } }],
          ['n2', { id: 'n2', pos: { x: 50, y: 50 } }],
          ['n3', { id: 'n3', pos: { x: 50, y: 150 } }],
        ]),
        segments: new Map([
          ['s1', { id: 's1', from: 'n1', to: 'n2', kind: 'curve' as const, via: { x: 50, y: 0 } }],
          ['s2', { id: 's2', from: 'n2', to: 'n3', kind: 'straight' as const }],
        ]),
        adjacency: new Map([
          ['n1', ['s1']],
          ['n2', ['s1', 's2']],
          ['n3', ['s2']],
        ]),
        junctions: new Map(),
      }

      // Single node
      const nodeAnchor = getGizmoAnchor(net, { nodes: new Set(['n1']), segments: new Set<string>() })
      expect(nodeAnchor?.curvedSegments.get('s1')).toEqual({ x: 50, y: 0 })

      // Section selection as Canvas builds it: node ids and segment ids together
      const sectionAnchor = getGizmoAnchor(net, { nodes: new Set(['n1', 'n2']), segments: new Set(['s1']) })
      expect(sectionAnchor?.curvedSegments.get('s1')).toEqual({ x: 50, y: 0 })

      // Segment-only selection of the straight: the adjacent curve is covered too (it will be refitted)
      const straightAnchor = getGizmoAnchor(net, { nodes: new Set<string>(), segments: new Set(['s2']) })
      expect(straightAnchor?.type).toBe('section')
      expect(straightAnchor?.curvedSegments.get('s1')).toEqual({ x: 50, y: 0 })

      // The snapshot is a copy
      nodeAnchor!.curvedSegments.get('s1')!.x = 0
      expect(net.segments.get('s1')!.via).toEqual({ x: 50, y: 0 })
    })

    it('returns null when nothing is selected', () => {
      const net = {
        nodes: new Map(),
        segments: new Map(),
        adjacency: new Map(),
        junctions: new Map(),
      }
      const selection = {
        nodes: new Set<string>(),
        segments: new Set<string>(),
      }
      expect(getGizmoAnchor(net, selection)).toBeNull()
    })
  })
})
