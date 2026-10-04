import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createCamera } from '@infrastructure/render/camera'
import { createNetwork, addNode, addSegment, addCurveSegment } from '@domain/models/network'
import {
  renderNetwork,
  renderTrainSet,
  renderLocomotive,
  renderCouplerPoints,
  getSegmentRenderIntervals,
  subdivideStraight,
  subdivideCurve,
  isInactiveBranchAtNode,
  TURNOUT_ZONE_LENGTH,
} from '@infrastructure/render/renderer'
import { createTrainSet, getAllCouplerPoints, MAX_NOTCH } from '@domain/models/train'
import { createLocomotive } from '@domain/models/locomotive'
import { addJunction, toggleJunction } from '@domain/models/junction'
import { bezierPoint } from '@domain/geometry/curve'
import { isRenamedSection, type TrackSection } from '@domain/models/sections'

function createMockContext(): CanvasRenderingContext2D {
  return {
    canvas: {
      width: 800,
      height: 600,
    },
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    closePath: vi.fn(),
    quadraticCurveTo: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 60 }),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

describe('Pan Mode Rendering (Vue épurée en mode Déplacer)', () => {
  let mockCtx: CanvasRenderingContext2D

  beforeEach(() => {
    mockCtx = createMockContext()
  })

  it('isRenamedSection identifies customized track names correctly', () => {
    const defaultSecA: TrackSection = {
      id: 'seg-1',
      name: 'Section A',
      segmentIds: ['seg-1'],
      nodeIds: ['n1', 'n2'],
      orderedNodeIds: ['n1', 'n2'],
      totalLength: 100,
      type: 'circulation',
      direction: 'two_way',
      color: '#3b82f6',
    }
    expect(isRenamedSection(defaultSecA)).toBe(false)

    const defaultSecB12: TrackSection = {
      ...defaultSecA,
      name: 'Section B12',
    }
    expect(isRenamedSection(defaultSecB12)).toBe(false)

    const renamedVoie1: TrackSection = {
      ...defaultSecA,
      name: 'Voie 1',
    }
    expect(isRenamedSection(renamedVoie1)).toBe(true)

    const customFlagged: TrackSection = {
      ...defaultSecA,
      name: 'Section A',
      isCustomName: true,
    }
    expect(isRenamedSection(customFlagged)).toBe(true)
  })

  it('hides construction nodes and dead-end markers in pan mode but renders them in select mode', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 200, y: 0 })
    addSegment(net, n1.id, n2.id)

    const cam = createCamera(100, 0, 2)
    const selection = { nodes: new Set<string>(), segments: new Set<string>() }

    // 1. In select mode: nodes and dead ends are rendered (calls ctx.arc)
    renderNetwork(mockCtx, cam, 800, 600, net, selection, {}, { tool: 'select' })
    expect(vi.mocked(mockCtx.arc).mock.calls.length).toBeGreaterThan(0)

    // 2. In pan mode: construction nodes and dead-ends are strictly suppressed
    const panCtx = createMockContext()
    renderNetwork(panCtx, cam, 800, 600, net, selection, {}, { tool: 'pan' })
    expect(vi.mocked(panCtx.arc).mock.calls.length).toBe(0)
  })

  it('hides unrenamed section badges in pan mode, but displays renamed track badges', () => {
    const net = createNetwork()
    // Track 1: unrenamed default section
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 200, y: 0 })
    addSegment(net, n1.id, n2.id)

    // Track 2: renamed section
    const n3 = addNode(net, { x: 0, y: 100 })
    const n4 = addNode(net, { x: 200, y: 100 })
    const seg2 = addSegment(net, n3.id, n4.id)!

    const sectionMeta = {
      [seg2.id]: {
        name: 'Voie Principale',
        isCustomName: true,
      },
    }

    const cam = createCamera(100, 50, 2)
    const selection = { nodes: new Set<string>(), segments: new Set<string>() }

    // In select mode: both badges are displayed
    const selectCtx = createMockContext()
    renderNetwork(selectCtx, cam, 800, 600, net, selection, sectionMeta, { tool: 'select' })
    const selectTextCalls = vi.mocked(selectCtx.fillText).mock.calls.map((call) => call[0] as string)
    expect(selectTextCalls.some((t) => t.includes('Voie Principale'))).toBe(true)
    expect(selectTextCalls.some((t) => t.startsWith('Section '))).toBe(true)

    // In pan mode: only the renamed section badge is displayed, unrenamed default sections are hidden
    const panCtx = createMockContext()
    renderNetwork(panCtx, cam, 800, 600, net, selection, sectionMeta, { tool: 'pan' })
    const panTextCalls = vi.mocked(panCtx.fillText).mock.calls.map((call) => call[0] as string)
    expect(panTextCalls.some((t) => t.includes('Voie Principale'))).toBe(true)
    expect(panTextCalls.some((t) => t.startsWith('Section '))).toBe(false)
  })

  describe('Turnout Localized Dimmed Rendering (Rendu grisé restreint à l\'aiguillage)', () => {
    it('isInactiveBranchAtNode identifies inactive branch specifically at the junction apex', () => {
      const net = createNetwork()
      const stem = addNode(net, { x: -50, y: 0 })
      const apex = addNode(net, { x: 0, y: 0 })
      const straight = addNode(net, { x: 100, y: 0 })
      const div = addNode(net, { x: 100, y: 30 })

      addSegment(net, stem.id, apex.id)
      const sStraight = addSegment(net, apex.id, straight.id)!
      const sDiv = addSegment(net, apex.id, div.id)!

      const junc = addJunction(net, {
        nodeId: apex.id,
        straightNodeId: straight.id,
        divergingNodeId: div.id,
        straightSegmentId: sStraight.id,
        divergingSegmentId: sDiv.id,
        hand: 'right',
        activeBranch: 'straight',
      })

      // At apex node: diverging is inactive, straight is active
      expect(isInactiveBranchAtNode(net, sDiv.id, apex.id)).toBe(true)
      expect(isInactiveBranchAtNode(net, sStraight.id, apex.id)).toBe(false)

      // At distant endpoints: not considered inactive junction apex
      expect(isInactiveBranchAtNode(net, sDiv.id, div.id)).toBe(false)
      expect(isInactiveBranchAtNode(net, sStraight.id, straight.id)).toBe(false)

      // Toggle junction: now straight is inactive, diverging is active
      toggleJunction(junc)
      expect(isInactiveBranchAtNode(net, sDiv.id, apex.id)).toBe(false)
      expect(isInactiveBranchAtNode(net, sStraight.id, apex.id)).toBe(true)
    })

    it('splits a long inactive track into a turnout zone (25m) and a normal active remainder', () => {
      const net = createNetwork()
      const stem = addNode(net, { x: -50, y: 0 })
      const apex = addNode(net, { x: 0, y: 0 })
      const straight = addNode(net, { x: 100, y: 0 }) // 100m straight track
      const div = addNode(net, { x: 100, y: 30 })

      addSegment(net, stem.id, apex.id)
      const sStraight = addSegment(net, apex.id, straight.id)!
      const sDiv = addSegment(net, apex.id, div.id)!

      addJunction(net, {
        nodeId: apex.id,
        straightNodeId: straight.id,
        divergingNodeId: div.id,
        straightSegmentId: sStraight.id,
        divergingSegmentId: sDiv.id,
        hand: 'right',
        activeBranch: 'diverging', // Straight branch is now inactive
      })

      const intervals = getSegmentRenderIntervals(net, sStraight, apex.pos, straight.pos)
      // Expect 2 intervals:
      // 1. [0, 0.25]: turnout zone (25m), isTurnout = true (dimmed)
      // 2. [0.25, 1.0]: remainder of track (75m), isTurnout = false (normal 100% opacity)
      expect(intervals.length).toBe(2)
      expect(intervals[0].isTurnout).toBe(true)
      expect(intervals[0].t0).toBe(0)
      expect(intervals[0].t1).toBeCloseTo(TURNOUT_ZONE_LENGTH / 100, 3)

      expect(intervals[1].isTurnout).toBe(false)
      expect(intervals[1].t0).toBeCloseTo(TURNOUT_ZONE_LENGTH / 100, 3)
      expect(intervals[1].t1).toBe(1)
    })

    it('keeps short tracks (<= 25m) entirely as a turnout zone when inactive', () => {
      const net = createNetwork()
      const stem = addNode(net, { x: -20, y: 0 })
      const apex = addNode(net, { x: 0, y: 0 })
      const div = addNode(net, { x: 20, y: 5 }) // 20.6m short branch
      const straight = addNode(net, { x: 50, y: 0 })

      addSegment(net, stem.id, apex.id)
      const sStraight = addSegment(net, apex.id, straight.id)!
      const sDiv = addSegment(net, apex.id, div.id)!

      addJunction(net, {
        nodeId: apex.id,
        straightNodeId: straight.id,
        divergingNodeId: div.id,
        straightSegmentId: sStraight.id,
        divergingSegmentId: sDiv.id,
        hand: 'right',
        activeBranch: 'straight',
      })

      const intervals = getSegmentRenderIntervals(net, sDiv, apex.pos, div.pos)
      expect(intervals.length).toBe(1)
      expect(intervals[0].isTurnout).toBe(true)
      expect(intervals[0].t0).toBe(0)
      expect(intervals[0].t1).toBe(1)
    })

    it('subdivideStraight produces exact geometry', () => {
      const a = { x: 0, y: 0 }
      const b = { x: 100, y: 0 }
      const sub = subdivideStraight(a, b, 0, 0.25)
      expect(sub.a).toEqual({ x: 0, y: 0 })
      expect(sub.b).toEqual({ x: 25, y: 0 })

      const subRemainder = subdivideStraight(a, b, 0.25, 1)
      expect(subRemainder.a).toEqual({ x: 25, y: 0 })
      expect(subRemainder.b).toEqual({ x: 100, y: 0 })
    })

    it('subdivideCurve produces exact sub-curves matching original quadratic Bezier', () => {
      const p0 = { x: 0, y: 0 }
      const via = { x: 50, y: 50 }
      const p2 = { x: 100, y: 0 }

      const sub1 = subdivideCurve(p0, via, p2, 0, 0.5)
      // At parameter u = 0.5 on sub1 (which corresponds to t = 0.25 on original):
      const ptSub = bezierPoint(0.5, sub1.p0, sub1.via, sub1.p2)
      const ptOrig = bezierPoint(0.25, p0, via, p2)
      expect(ptSub.x).toBeCloseTo(ptOrig.x, 4)
      expect(ptSub.y).toBeCloseTo(ptOrig.y, 4)

      const sub2 = subdivideCurve(p0, via, p2, 0.5, 1)
      // At parameter u = 0.5 on sub2 (which corresponds to t = 0.75 on original):
      const ptSub2 = bezierPoint(0.5, sub2.p0, sub2.via, sub2.p2)
      const ptOrig2 = bezierPoint(0.75, p0, via, p2)
      expect(ptSub2.x).toBeCloseTo(ptOrig2.x, 4)
      expect(ptSub2.y).toBeCloseTo(ptOrig2.y, 4)
    })
  })

  describe('TrainSet & Coupler Rendering', () => {
    it('renders a TrainSet onto the canvas context without error', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 200, y: 0 })
      addSegment(net, n1.id, n2.id)

      const ts = createTrainSet(net, { x: 50, y: 0 }, 'loco')!
      const cam = createCamera()
      const mockCtx = createMockContext()

      renderTrainSet(mockCtx, cam, 800, 600, net, ts, true, false, false)
      expect(mockCtx.save).toHaveBeenCalled()
      expect(mockCtx.restore).toHaveBeenCalled()
      expect(mockCtx.beginPath).toHaveBeenCalled()
      expect(mockCtx.stroke).toHaveBeenCalled()
    })

    it('renders CouplerPoints on canvas including hover state and proximity links', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 200, y: 0 })
      addSegment(net, n1.id, n2.id)

      const ts = createTrainSet(net, { x: 50, y: 0 }, 'loco')!
      const pts = getAllCouplerPoints(net, [ts])
      const cam = createCamera()
      const mockCtx = createMockContext()

      renderCouplerPoints(mockCtx, cam, 800, 600, pts, pts[0])
      expect(mockCtx.save).toHaveBeenCalled()
      expect(mockCtx.restore).toHaveBeenCalled()
      expect(mockCtx.arc).toHaveBeenCalled()
    })

    it('renders locomotive with debug skeleton and dynamic vectors (speed, acceleration, centrifugal forces)', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 200, y: 0 })
      const seg = addSegment(net, n1.id, n2.id)!

      const loco = createLocomotive(net, seg.id, 0.5, 20, 14, 1)!
      const cam = createCamera()
      const mockCtx = createMockContext()

      renderLocomotive(mockCtx, cam, 800, 600, net, loco, false, true, true, {
        speed: 40,
        throttle: 1,
        acceleration: 5.5,
        braking: 10,
      })

      expect(mockCtx.save).toHaveBeenCalled()
      expect(mockCtx.restore).toHaveBeenCalled()
      // Badges with speed and status are rendered with fillText
      expect(mockCtx.fillText).toHaveBeenCalled()
      const fillCalls = vi.mocked(mockCtx.fillText).mock.calls.map(c => c[0])
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('V = 144 km/h'))).toBe(true)
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('TRACTION'))).toBe(true)
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('a = +5.5 m/s²'))).toBe(true)
    })

    it('renders TrainSet with debug skeleton and dynamic vectors without error', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 200, y: 0 })
      addSegment(net, n1.id, n2.id)

      const ts = createTrainSet(net, { x: 50, y: 0 }, 'loco')!
      ts.currentSpeed = 25
      ts.notch = -MAX_NOTCH

      const cam = createCamera()
      const mockCtx = createMockContext()

      renderTrainSet(mockCtx, cam, 800, 600, net, ts, false, false, true)
      expect(mockCtx.fillText).toHaveBeenCalled()
      const fillCalls = vi.mocked(mockCtx.fillText).mock.calls.map(c => c[0])
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('FREINAGE'))).toBe(true)
    })

    it('renders track lookahead trajectory and detects buffer stop dead-end within 50m', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      // Segment of length 45m: shorter than the 50m lookahead distance
      const n2 = addNode(net, { x: 45, y: 0 })
      const seg = addSegment(net, n1.id, n2.id)!

      const loco = createLocomotive(net, seg.id, 0.6, 20, 14, 1)!
      expect(loco).toBeDefined()
      const cam = createCamera()
      const mockCtx = createMockContext()

      renderLocomotive(mockCtx, cam, 800, 600, net, loco, false, true, true, {
        speed: 15,
        throttle: 1,
        acceleration: 3.5,
        braking: 8,
        debugOptions: { lookahead: true },
      })

      expect(mockCtx.fillText).toHaveBeenCalled()
      const fillCalls = vi.mocked(mockCtx.fillText).mock.calls.map(c => c[0])
      // Detects the dead end at the end of the 35m track
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('Heurtoir'))).toBe(true)
      // Checks lookahead distance ticks (+10m, +20m)
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('+10m'))).toBe(true)
    })

    it('does not render floating telemetry HUD card on canvas', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 200, y: 0 })
      const seg = addSegment(net, n1.id, n2.id)!

      const loco = createLocomotive(net, seg.id, 0.3, 20, 14, 1)!
      const cam = createCamera()
      const mockCtx = createMockContext()

      renderLocomotive(mockCtx, cam, 800, 600, net, loco, false, true, true, {
        speed: 25,
        throttle: 1,
        acceleration: 5.5,
        braking: 10,
        debugOptions: { vectors: true },
      })

      expect(mockCtx.fillText).toHaveBeenCalled()
      const fillCalls = vi.mocked(mockCtx.fillText).mock.calls.map(c => c[0])
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('TÉLÉMÉTRIE TGV · BORD'))).toBe(false)
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('V = 90 km/h'))).toBe(true)
    })

    it('respects vectors: false and lookahead: false options', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 200, y: 0 })
      const seg = addSegment(net, n1.id, n2.id)!

      const loco = createLocomotive(net, seg.id, 0.3, 20, 14, 1)!
      const cam = createCamera()
      const mockCtx = createMockContext()

      renderLocomotive(mockCtx, cam, 800, 600, net, loco, false, true, true, {
        speed: 25,
        throttle: 1,
        acceleration: 5.5,
        braking: 10,
        debugOptions: {
          vectors: false,
          lookahead: false,
        },
      })

      const fillCalls = vi.mocked(mockCtx.fillText).mock.calls.map(c => c[0])
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('TÉLÉMÉTRIE TGV · BORD'))).toBe(false)
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('V = 90 km/h'))).toBe(false)
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('Heurtoir'))).toBe(false)
    })

    it('renders bogie yaw angles (Δθ) and articulation angles on curves', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 100, y: 0 })
      const n3 = addNode(net, { x: 200, y: 100 })
      addSegment(net, n1.id, n2.id)
      const curve = addCurveSegment(net, n2.id, n3.id, { x: 200, y: 0 })!

      const loco = createLocomotive(net, curve.id, 0.4, 20, 14, 2)!
      const cam = createCamera()
      const mockCtx = createMockContext()

      renderLocomotive(mockCtx, cam, 800, 600, net, loco, false, true, true, {
        speed: 15,
        debugOptions: { yawAngles: true },
      })

      expect(mockCtx.fillText).toHaveBeenCalled()
      const fillCalls = vi.mocked(mockCtx.fillText).mock.calls.map(c => c[0])
      expect(fillCalls.some(t => typeof t === 'string' && (t.includes('Δθ') || t.includes('θ artic')))).toBe(true)

      // When yawAngles is disabled, no Δθ should be rendered
      const mockCtxDisabled = createMockContext()
      renderLocomotive(mockCtxDisabled, cam, 800, 600, net, loco, false, true, true, {
        speed: 15,
        debugOptions: { yawAngles: false },
      })
      const fillCallsDisabled = vi.mocked(mockCtxDisabled.fillText).mock.calls.map(c => c[0])
      expect(fillCallsDisabled.some(t => typeof t === 'string' && (t.includes('Δθ') || t.includes('θ artic')))).toBe(false)
    })

    it('renders kinematic clearance gauge envelope and badges on curves', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 100, y: 0 })
      const n3 = addNode(net, { x: 200, y: 100 })
      addSegment(net, n1.id, n2.id)
      const curve = addCurveSegment(net, n2.id, n3.id, { x: 200, y: 0 })!

      const loco = createLocomotive(net, curve.id, 0.5, 20, 14, 2)!
      const cam = createCamera()
      const mockCtx = createMockContext()

      renderLocomotive(mockCtx, cam, 800, 600, net, loco, false, true, true, {
        speed: 10,
        debugOptions: { gauge: true },
      })

      const fillCalls = vi.mocked(mockCtx.fillText).mock.calls.map(c => c[0])
      expect(fillCalls.some(t => typeof t === 'string' && t.includes('Gabarit'))).toBe(true)

      // When gauge is disabled, no Gabarit badge should be rendered
      const mockCtxDisabled = createMockContext()
      renderLocomotive(mockCtxDisabled, cam, 800, 600, net, loco, false, true, true, {
        speed: 10,
        debugOptions: { gauge: false },
      })
      const fillCallsDisabled = vi.mocked(mockCtxDisabled.fillText).mock.calls.map(c => c[0])
      expect(fillCallsDisabled.some(t => typeof t === 'string' && t.includes('Gabarit'))).toBe(false)
    })

    it('supports X-Ray mode filling transparent body and toggles with xray option', () => {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 200, y: 0 })
      const seg = addSegment(net, n1.id, n2.id)!

      const loco = createLocomotive(net, seg.id, 0.5, 20, 14, 1)!
      const cam = createCamera()
      const mockCtxXray = createMockContext()

      // X-Ray enabled (default in debug skeleton)
      renderLocomotive(mockCtxXray, cam, 800, 600, net, loco, false, true, false, {
        debugOptions: { xray: true },
      })
      // Should have filled the semi-transparent body
      expect(mockCtxXray.fill).toHaveBeenCalled()

      // Pure wireframe (xray: false)
      const mockCtxWireframe = createMockContext()
      renderLocomotive(mockCtxWireframe, cam, 800, 600, net, loco, false, true, false, {
        debugOptions: { xray: false },
      })
      // setLineDash called for dotted wireframe
      expect(mockCtxWireframe.setLineDash).toHaveBeenCalledWith([3, 3])
    })
  })
})


