import { beforeEach, describe, expect, it } from 'vitest'
import {
  createNetwork,
  addNode,
  addSegment,
  addCurveSegment,
  resetIdCounter,
} from '../../domain/models/network'
import { placeTurnout, toggleJunction, activeBranchOf, turnoutView } from '../../domain/models/junction'
import { openExit } from '../../domain/models/routing'
import {
  serializeNetwork,
  deserializeNetwork,
  saveNetworkToStorage,
  loadNetworkFromStorage,
  clearNetworkStorage,
  resetMemoryStorage,
  STORAGE_KEY,
} from './persistence'
import { createCamera } from '@infrastructure/render/camera'
import { advanceTrainSet, createVehicle, makeTrainSet, setNotch, setReverser } from '../../domain/models/train'
import { generateId } from '../../domain/models/network'

describe('persistence module', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
  })

  it('serializes and deserializes an empty network', () => {
    const net = createNetwork()
    const serialized = serializeNetwork(net, 'Empty Project')
    expect(serialized.version).toBe(2)
    expect(serialized.name).toBe('Empty Project')
    expect(serialized.nodes).toHaveLength(0)
    expect(serialized.segments).toHaveLength(0)

    const restored = deserializeNetwork(serialized)
    expect(restored.projectName).toBe('Empty Project')
    expect(restored.network.nodes.size).toBe(0)
    expect(restored.network.segments.size).toBe(0)
  })

  it('serializes and restores straight and curved segments with camera', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const n3 = addNode(net, { x: 150, y: 50 })

    addSegment(net, n1.id, n2.id)
    addCurveSegment(net, n2.id, n3.id, { x: 130, y: 20 })

    const cam = createCamera(50, 25, 4)
    const serialized = serializeNetwork(net, 'Test Layout', cam)

    expect(serialized.nodes).toHaveLength(3)
    expect(serialized.segments).toHaveLength(2)
    expect(serialized.camera).toEqual({ x: 50, y: 25, scale: 4 })

    const restored = deserializeNetwork(serialized)
    expect(restored.network.nodes.size).toBe(3)
    expect(restored.network.segments.size).toBe(2)
    expect(restored.camera).toEqual({ x: 50, y: 25, scale: 4 })

    // Check adjacency reconstruction
    expect(restored.network.adjacency.get(n2.id)).toHaveLength(2)

    // Check curve via preservation
    const curveSeg = [...restored.network.segments.values()].find((s) => s.kind === 'curve')
    expect(curveSeg?.via).toEqual({ x: 130, y: 20 })
  })

  /** Stem west of the apex, then a catalog #6 turnout: straight on, diverging to +y */
  function turnoutNetwork() {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const stemSeg = addSegment(net, stem.id, apex.id)!
    const turnout = placeTurnout(net, {
      startPos: apex.pos,
      direction: { x: 1, y: 0 },
      frogNumber: 6,
      hand: 'left',
      stemNodeId: apex.id,
    })
    return { net, apex, stemSeg, turnout, junction: turnout.junction! }
  }

  it('preserves the route table of a turnout: rails, roles and position', () => {
    const { net, junction } = turnoutNetwork()

    // Switch the turnout to diverging
    toggleJunction(junction)
    expect(activeBranchOf(junction)).toBe('diverging')

    const serialized = serializeNetwork(net, 'Turnout Project')
    expect(serialized.junctions).toEqual([
      {
        id: junction.id,
        nodeId: junction.nodeId,
        kind: 'turnout',
        passages: junction.passages.map((p) => [p.a, p.b]),
        positions: [[0], [1]],
        active: 1,
        frogNumber: 6,
      },
    ])
    const restored = deserializeNetwork(serialized)

    expect([...restored.network.junctions.values()]).toEqual([junction])
    const restoredJunc = [...restored.network.junctions.values()][0]
    expect(activeBranchOf(restoredJunc)).toBe('diverging')
    expect(turnoutView(restored.network, restoredJunc)).toEqual(turnoutView(net, junction))
  })

  it('reads a turnout saved by its parts (version 1) and leaves it open on the same rail', () => {
    const { net, apex, stemSeg, turnout, junction } = turnoutNetwork()
    const serialized = serializeNetwork(net, 'Old Project')
    const view = turnoutView(net, junction)!
    // As version 1 wrote it, with the roles the old detector could give a tangent turnout: the
    // curve named "straight", the points set to "diverging" — that is, open on the straight rail
    const legacy = {
      ...serialized,
      version: 1 as const,
      junctions: [
        {
          id: 'j_77',
          nodeId: apex.id,
          stemNodeId: view.stemNodeId,
          straightNodeId: view.divergingNodeId,
          divergingNodeId: view.straightNodeId,
          straightSegmentId: view.divergingSegmentId,
          divergingSegmentId: view.straightSegmentId,
          activeBranch: 'diverging' as const,
          hand: 'right' as const,
          frogNumber: 6,
        },
      ],
    }

    const restored = deserializeNetwork(legacy).network
    const restoredJunc = [...restored.junctions.values()]
    expect(restoredJunc).toHaveLength(1)
    expect(restoredJunc[0].id).toBe('j_77')
    const restoredView = turnoutView(restored, restoredJunc[0])!
    expect(restoredView.stemSegmentId).toBe(stemSeg.id)
    expect(restoredView.straightNodeId).toBe(turnout.straightNode.id)
    expect(restoredView.divergingNodeId).toBe(turnout.divergingNode.id)
    expect(restoredView.hand).toBe('left')
    // Same rail open as in the file
    expect(restoredView.activeBranch).toBe('straight')
    expect(openExit(restored, apex.id, stemSeg.id)).toBe(view.straightSegmentId)
  })

  it('reads every turnout of a version 1 file, whatever their ids', () => {
    // Three turnouts in a row on one line, saved with ids a fresh counter would hand out again
    const net = createNetwork()
    let prev = addNode(net, { x: 0, y: 0 })
    const legacy: NonNullable<ReturnType<typeof serializeNetwork>['junctions']> = []
    ;['j_2', 'j_50', 'j_51'].forEach((id, i) => {
      const apex = addNode(net, { x: 300 * (i + 1), y: 0 })
      const next = addNode(net, { x: 300 * (i + 1) + 150, y: 0 })
      const spur = addNode(net, { x: 300 * (i + 1) + 150, y: 20 })
      addSegment(net, prev.id, apex.id)
      const straight = addSegment(net, apex.id, next.id)!
      const diverging = addSegment(net, apex.id, spur.id)!
      legacy.push({
        id,
        nodeId: apex.id,
        stemNodeId: prev.id,
        straightNodeId: next.id,
        divergingNodeId: spur.id,
        straightSegmentId: straight.id,
        divergingSegmentId: diverging.id,
        activeBranch: 'diverging',
        hand: 'left',
      })
      prev = next
    })
    const file = { ...serializeNetwork(net), version: 1 as const, junctions: legacy }

    resetIdCounter()
    const restored = deserializeNetwork(file).network

    expect([...restored.junctions.keys()].sort()).toEqual(['j_2', 'j_50', 'j_51'])
    for (const junction of restored.junctions.values()) expect(activeBranchOf(junction)).toBe('diverging')
  })

  it('skips a saved table that does not hold together instead of failing to load', () => {
    const { net, junction } = turnoutNetwork()
    const file = serializeNetwork(net)
    for (const broken of [
      { passages: [], positions: [[]] },
      { passages: [file.junctions![0].passages![0], file.junctions![0].passages![0]] },
      { passages: [[junction.passages[0].a, junction.passages[0].a], file.junctions![0].passages![1]] },
    ]) {
      const restored = deserializeNetwork({ ...file, junctions: [{ ...file.junctions![0], ...broken } as never] }).network
      // The fork is still there: its table is read again from the geometry
      expect(restored.junctions.size).toBe(1)
      expect(turnoutView(restored, [...restored.junctions.values()][0])).toEqual(turnoutView(net, junction))
    }
  })

  it('does not reuse the ids of the file for what the reconcile pass creates on load', () => {
    // Two straights crossing without a shared node: the file still needs reconciling
    const net = createNetwork()
    const w = addNode(net, { x: -50, y: 0 })
    const e = addNode(net, { x: 50, y: 0 })
    const s = addNode(net, { x: 0, y: -50 })
    const n = addNode(net, { x: 0, y: 50 })
    addSegment(net, w.id, e.id)
    addSegment(net, s.id, n.id)
    const serialized = serializeNetwork(net)

    resetIdCounter()
    const restored = deserializeNetwork(serialized).network

    // The four ends are where they were, and a fifth node joins the two tracks
    for (const node of [w, e, s, n]) expect(restored.nodes.get(node.id)!.pos).toEqual(node.pos)
    expect(restored.nodes.size).toBe(5)
    expect(restored.segments.size).toBe(4)
    for (const [nodeId, adj] of restored.adjacency) {
      for (const sid of adj) {
        const seg = restored.segments.get(sid)!
        expect([seg.from, seg.to]).toContain(nodeId)
      }
    }
  })

  it('synchronizes idCounter after restore to prevent collisions', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    addSegment(net, n1.id, n2.id)

    const serialized = serializeNetwork(net)

    // Reset counter to 0 as if page just reloaded
    resetIdCounter(0)

    const restored = deserializeNetwork(serialized)
    // Next node added should have an ID strictly greater than existing nodes
    const nNew = addNode(restored.network, { x: 200, y: 0 })
    expect(restored.network.nodes.has(nNew.id)).toBe(true)
    expect(nNew.id).not.toBe(n1.id)
    expect(nNew.id).not.toBe(n2.id)
  })

  it('saves to and loads from localStorage correctly', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 10, y: 20 })
    const n2 = addNode(net, { x: 200, y: 20 })
    addSegment(net, n1.id, n2.id)

    const cam = createCamera(100, 20, 2.5)
    const saved = saveNetworkToStorage(net, 'My Train Layout', cam)
    expect(saved).toBe(true)

    const loaded = loadNetworkFromStorage()
    expect(loaded).not.toBeNull()
    expect(loaded?.projectName).toBe('My Train Layout')
    expect(loaded?.network.nodes.size).toBe(2)
    expect(loaded?.network.segments.size).toBe(1)
    expect(loaded?.camera?.scale).toBe(2.5)
  })

  it('serializes and restores scale, units, and layout board dimensions', () => {
    const net = createNetwork()
    const serialized = serializeNetwork(
      net,
      'HO Layout',
      undefined,
      undefined,
      'fixed',
      0.1,
      undefined,
      'mm',
      'HO',
      0.0165,
      0.050,
      true,
      true,
      2.40,
      1.20,
    )

    expect(serialized.unit).toBe('mm')
    expect(serialized.scalePreset).toBe('HO')
    expect(serialized.gauge).toBe(0.0165)
    expect(serialized.boardEnabled).toBe(true)
    expect(serialized.boardWidth).toBe(2.40)
    expect(serialized.boardHeight).toBe(1.20)

    const restored = deserializeNetwork(serialized)
    expect(restored.unit).toBe('mm')
    expect(restored.scalePreset).toBe('HO')
    expect(restored.gauge).toBe(0.0165)
    expect(restored.boardEnabled).toBe(true)
    expect(restored.boardWidth).toBe(2.40)
    expect(restored.boardHeight).toBe(1.20)
  })

  it('clears storage properly', () => {
    const net = createNetwork()
    addNode(net, { x: 0, y: 0 })
    saveNetworkToStorage(net)
    expect(loadNetworkFromStorage()).not.toBeNull()

    clearNetworkStorage()
    expect(loadNetworkFromStorage()).toBeNull()
  })

  it('handles invalid or corrupted data in storage gracefully', () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, 'corrupted{json')
      expect(loadNetworkFromStorage()).toBeNull()

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes: 'not an array' }))
      const loaded = loadNetworkFromStorage()
      expect(loaded?.network.nodes.size).toBe(0)
    }
  })

  describe('trains', () => {
    function networkWithTrain() {
      const net = createNetwork()
      const n1 = addNode(net, { x: 0, y: 0 })
      const n2 = addNode(net, { x: 500, y: 0 })
      const seg = addSegment(net, n1.id, n2.id)!
      const train = makeTrainSet(generateId('train'), [
        createVehicle(net, seg.id, 0.5, 'loco')!,
        createVehicle(net, seg.id, 0.4, 'wagon')!,
      ])
      // Lay the trailer out behind the power car: loading re-lays every rake from its lead
      advanceTrainSet(net, train, 0)
      return { net, seg, train }
    }

    it('round-trips trains through JSON, stopped and with controls at rest', () => {
      const { net, train } = networkWithTrain()
      setReverser(train, 'forward')
      setNotch(train, 5)
      train.currentSpeed = 30

      const data = JSON.parse(JSON.stringify(serializeNetwork(
        net, 'P', undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, [train],
      )))
      const restored = deserializeNetwork(data)

      expect(restored.trains).toHaveLength(1)
      expect(restored.trains[0].id).toBe(train.id)
      expect(restored.trains[0].vehicles).toEqual(train.vehicles)
      expect(restored.trains[0].currentSpeed).toBe(0)
      expect(restored.trains[0].notch).toBe(0)
      expect(restored.trains[0].reverser).toBe('neutral')
    })

    it('keeps the existing positional arguments working and omits the key without trains', () => {
      const { net } = networkWithTrain()
      const data = serializeNetwork(net, 'P', createCamera(1, 2, 3))
      expect(data.name).toBe('P')
      expect(data.camera).toEqual({ x: 1, y: 2, scale: 3 })
      expect('trains' in JSON.parse(JSON.stringify(data))).toBe(false)
    })

    it('loads an old file without trains', () => {
      const { net } = networkWithTrain()
      const data = JSON.parse(JSON.stringify(serializeNetwork(net, 'Old')))
      const restored = deserializeNetwork(data)
      expect(restored.network.segments.size).toBe(1)
      expect(restored.trains).toEqual([])
      expect(deserializeNetwork(null as never).trains).toEqual([])
    })

    it('drops trains standing on segments missing from the file', () => {
      const { net, seg, train } = networkWithTrain()
      const data = serializeNetwork(net, 'P', undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, [train])
      data.segments = data.segments.filter(s => s.id !== seg.id)
      expect(deserializeNetwork(data).trains).toEqual([])
    })

    it('keeps new ids clear of the restored train and vehicle ids', () => {
      const { net, train } = networkWithTrain()
      saveNetworkToStorage(net, 'P', undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, [train])
      resetIdCounter(0)

      const loaded = loadNetworkFromStorage()!
      expect(loaded.trains).toHaveLength(1)
      const used = new Set([loaded.trains[0].id, ...loaded.trains[0].vehicles.map(v => v.id)])
      expect(used.has(generateId('train'))).toBe(false)
      expect(used.has(generateId('veh'))).toBe(false)
    })
  })
})

describe('track levels', () => {
  beforeEach(() => resetIdCounter(0))

  /** A ground track along x and a track along y on `level`, crossing at the origin without a node */
  function crossed(level: number) {
    const net = createNetwork()
    const w = addNode(net, { x: -100, y: 0 })
    const e = addNode(net, { x: 100, y: 0 })
    const s = addNode(net, { x: 0, y: -100 })
    const n = addNode(net, { x: 0, y: 100 })
    const ground = addSegment(net, w.id, e.id)!
    const other = addSegment(net, s.id, n.id, level)!
    return { net, ground, other }
  }

  it('writes the level of a rail only when it is off the ground', () => {
    const { net, ground, other } = crossed(2)
    const data = serializeNetwork(net)

    const saved = (id: string) => data.segments.find((seg) => seg.id === id)!
    expect(saved(other.id).level).toBe(2)
    expect('level' in saved(ground.id)).toBe(false)
  })

  it('round-trips levels, and loading does not put a node under the bridge', () => {
    const { net, ground, other } = crossed(-1)
    const restored = deserializeNetwork(JSON.parse(JSON.stringify(serializeNetwork(net)))).network

    expect(restored.nodes.size).toBe(4)
    expect([...restored.segments.keys()]).toEqual([ground.id, other.id])
    expect(restored.segments.get(other.id)!.level).toBe(-1)
    expect(restored.segments.get(ground.id)!.level).toBeUndefined()
  })

  it('a file without levels loads as it always did: the crossing gets its node and no rail gets a level', () => {
    const { net } = crossed(0)
    const data = JSON.parse(JSON.stringify(serializeNetwork(net)))
    expect(JSON.stringify(data)).not.toContain('level')

    const restored = deserializeNetwork(data).network

    expect(restored.nodes.size).toBe(5)
    expect(restored.segments.size).toBe(4)
    for (const seg of restored.segments.values()) expect('level' in seg).toBe(false)
    // Saving it again adds nothing to the file
    expect(JSON.stringify(serializeNetwork(restored))).not.toContain('level')
  })

  it('ignores a level that is not a whole number within the allowed range', () => {
    const { net, other } = crossed(1)
    for (const bad of [1.5, 99, -6, '1', null, NaN]) {
      const data = JSON.parse(JSON.stringify(serializeNetwork(net)))
      data.segments.find((seg: { id: string }) => seg.id === other.id).level = bad
      const restored = deserializeNetwork(data).network
      for (const seg of restored.segments.values()) expect(seg.level).toBeUndefined()
    }
  })
})
