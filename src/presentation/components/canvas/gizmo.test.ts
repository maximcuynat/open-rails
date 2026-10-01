import { describe, it, expect } from 'vitest'
import { hitTestGizmo, constrainGizmoDrag, GIZMO_LENGTH } from './gizmo'

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
})
