import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createCamera } from '@infrastructure/render/camera'
import { createNetwork, addNode, addSegment } from '@domain/models/network'
import { renderNetwork } from '@infrastructure/render/renderer'
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
})
