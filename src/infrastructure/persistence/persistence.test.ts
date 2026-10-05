import { beforeEach, describe, expect, it } from 'vitest'
import {
  createNetwork,
  addNode,
  addSegment,
  addCurveSegment,
  resetIdCounter,
  nodeLevel,
  segmentBand,
  segmentEndLevels,
} from '../../domain/models/network'
import { placeTurnout, toggleJunction } from '../../domain/models/junction'
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
    expect(serialized.version).toBe(1)
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

  it('preserves turnout junction state (activeBranch)', () => {
    const net = createNetwork()
    const turnout = placeTurnout(net, {
      startPos: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      frogNumber: 6,
      hand: 'left',
    })

    // Switch the turnout to diverging
    toggleJunction(turnout.junction)
    expect(turnout.junction.activeBranch).toBe('diverging')

    const serialized = serializeNetwork(net, 'Turnout Project')
    const restored = deserializeNetwork(serialized)

    expect(restored.network.junctions.size).toBe(1)
    const restoredJunc = [...restored.network.junctions.values()][0]
    expect(restoredJunc.activeBranch).toBe('diverging')
    expect(restoredJunc.hand).toBe('left')
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

describe('gradient settings', () => {
  beforeEach(() => resetMemoryStorage())

  const save = (gradient?: { levelHeight?: number; maxGradient?: number }) =>
    serializeNetwork(createNetwork(), 'P', undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, gradient)

  it('round-trip the height of a level and the steepest slope, decimals included', () => {
    const data = JSON.parse(JSON.stringify(save({ levelHeight: 6 / 87, maxGradient: 27.5 })))
    expect(data.levelHeight).toBe(6 / 87)
    expect(data.maxGradient).toBe(27.5)
    const restored = deserializeNetwork(data)
    expect(restored.levelHeight).toBe(6 / 87)
    expect(restored.maxGradient).toBe(27.5)
  })

  it('are absent from a file saved without them, and read as undefined', () => {
    const data = JSON.parse(JSON.stringify(save()))
    expect('levelHeight' in data).toBe(false)
    expect('maxGradient' in data).toBe(false)
    const restored = deserializeNetwork(data)
    expect(restored.levelHeight).toBeUndefined()
    expect(restored.maxGradient).toBeUndefined()
  })

  it('unusable values in a file are dropped', () => {
    for (const bad of [0, -6, 'six', null, {}]) {
      const restored = deserializeNetwork({ ...save(), levelHeight: bad, maxGradient: bad } as never)
      expect(restored.levelHeight).toBeUndefined()
      expect(restored.maxGradient).toBeUndefined()
    }
  })

  it('go through the storage', () => {
    saveNetworkToStorage(createNetwork(), 'P', undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { levelHeight: 0.04, maxGradient: 30 })
    const loaded = loadNetworkFromStorage()!
    expect(loaded.levelHeight).toBe(0.04)
    expect(loaded.maxGradient).toBe(30)
  })
})

describe('track levels', () => {
  beforeEach(() => resetIdCounter(0))

  /** A ground track along x and a track along y at height `level`, crossing at the origin without a node */
  function crossed(level: number) {
    const net = createNetwork()
    const w = addNode(net, { x: -100, y: 0 })
    const e = addNode(net, { x: 100, y: 0 })
    const s = addNode(net, { x: 0, y: -100 }, level)
    const n = addNode(net, { x: 0, y: 100 }, level)
    const ground = addSegment(net, w.id, e.id)!
    const other = addSegment(net, s.id, n.id)!
    return { net, ground, other, w, e, s, n }
  }

  const reload = (data: unknown) => deserializeNetwork(JSON.parse(JSON.stringify(data))).network

  it('writes the height of a node only when it is off the ground, and nothing on the rails', () => {
    const { net, w, s, n } = crossed(2)
    const data = serializeNetwork(net)

    const saved = (id: string) => data.nodes.find((node) => node.id === id)!
    expect(saved(s.id).level).toBe(2)
    expect(saved(n.id).level).toBe(2)
    expect('level' in saved(w.id)).toBe(false)
    for (const seg of data.segments) expect('level' in seg).toBe(false)
  })

  it('round-trips heights, and loading does not put a node under the bridge', () => {
    const { net, ground, other } = crossed(-1)
    const restored = reload(serializeNetwork(net))

    expect(restored.nodes.size).toBe(4)
    expect([...restored.segments.keys()]).toEqual([ground.id, other.id])
    expect(segmentEndLevels(restored, restored.segments.get(other.id)!)).toEqual({ from: -1, to: -1 })
    expect(segmentEndLevels(restored, restored.segments.get(ground.id)!)).toEqual({ from: 0, to: 0 })
  })

  it('round-trips a decimal height: a ramp cut in the middle comes back with its node at 0.5', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const m = addNode(net, { x: 100, y: 0 }, 0.5)
    const b = addNode(net, { x: 200, y: 0 }, 1)
    addSegment(net, a.id, m.id)
    addSegment(net, m.id, b.id)
    // A ground track crossing under the upper half, which must stay clear of it
    const c = addNode(net, { x: 190, y: -50 })
    const d = addNode(net, { x: 190, y: 50 })
    addSegment(net, c.id, d.id)

    const data = serializeNetwork(net)
    expect(data.nodes.find((node) => node.id === m.id)!.level).toBe(0.5)
    const restored = reload(data)

    expect(restored.nodes.size).toBe(5)
    expect(restored.segments.size).toBe(3)
    expect(nodeLevel(restored.nodes.get(a.id))).toBe(0)
    expect(nodeLevel(restored.nodes.get(m.id))).toBe(0.5)
    expect(nodeLevel(restored.nodes.get(b.id))).toBe(1)
    expect(serializeNetwork(restored).nodes).toEqual(data.nodes)
  })

  it('a file without heights loads as it always did: the crossing gets its node and nothing gets a level', () => {
    const { net } = crossed(0)
    const data = JSON.parse(JSON.stringify(serializeNetwork(net)))
    expect(JSON.stringify(data)).not.toContain('level')
    // The file is what it was before heights existed: nodes are an id and two coordinates
    expect(Object.keys(data.nodes[0])).toEqual(['id', 'x', 'y'])
    expect(Object.keys(data.segments[0])).toEqual(['id', 'from', 'to', 'kind'])

    const restored = deserializeNetwork(data).network

    expect(restored.nodes.size).toBe(5)
    expect(restored.segments.size).toBe(4)
    for (const node of restored.nodes.values()) expect('level' in node).toBe(false)
    for (const seg of restored.segments.values()) expect('level' in seg).toBe(false)
    // Saving it again adds nothing to the file
    expect(JSON.stringify(serializeNetwork(restored))).not.toContain('level')
  })

  it('ignores a height that is not a finite number within the allowed range', () => {
    const { net, s } = crossed(1)
    for (const bad of [99, -6, 5.01, '1', null, NaN, Infinity]) {
      const data = JSON.parse(JSON.stringify(serializeNetwork(net)))
      data.nodes.find((node: { id: string }) => node.id === s.id).level = bad
      const restored = deserializeNetwork(data).network
      expect(restored.nodes.get(s.id)!.level).toBeUndefined()
    }
  })

  describe('a save made when the level was on the rails', () => {
    /** The file format of the first version of track levels: `level` on the segments, none on the nodes */
    const legacy = (level: number) => ({
      version: 1,
      nodes: [
        { id: 'n_1', x: -100, y: 0 },
        { id: 'n_2', x: 100, y: 0 },
        { id: 'n_3', x: 0, y: -100 },
        { id: 'n_4', x: 0, y: 100 },
      ],
      segments: [
        { id: 's_5', from: 'n_1', to: 'n_2', kind: 'straight' },
        { id: 's_6', from: 'n_3', to: 'n_4', kind: 'straight', level },
      ],
      junctions: [],
    })

    it('keeps its bridge and its tunnel: their nodes take the level, before reconcile can cut them', () => {
      for (const level of [1, -1]) {
        const restored = reload(legacy(level))

        expect(restored.nodes.size).toBe(4)
        expect([...restored.segments.keys()]).toEqual(['s_5', 's_6'])
        const other = restored.segments.get('s_6')!
        expect(segmentEndLevels(restored, other)).toEqual({ from: level, to: level })
        expect(segmentBand(restored, other)).toBe(level)
        expect(segmentBand(restored, restored.segments.get('s_5')!)).toBe(0)
        expect('level' in other).toBe(false)

        // Saved again in the current format
        const saved = serializeNetwork(restored)
        expect(saved.nodes.filter((node) => node.level === level).map((node) => node.id)).toEqual(['n_3', 'n_4'])
        for (const seg of saved.segments) expect('level' in seg).toBe(false)
      }
    })

    it('a node between rails of different levels takes the one furthest from the ground, the upper one on a tie', () => {
      const chain = (first: number | undefined, second: number | undefined) => {
        const data = {
          version: 1,
          nodes: [
            { id: 'n_1', x: 0, y: 0 },
            { id: 'n_2', x: 100, y: 0 },
            { id: 'n_3', x: 200, y: 0 },
          ],
          segments: [
            { id: 's_4', from: 'n_1', to: 'n_2', kind: 'straight', ...(first === undefined ? {} : { level: first }) },
            { id: 's_5', from: 'n_2', to: 'n_3', kind: 'straight', ...(second === undefined ? {} : { level: second }) },
          ],
          junctions: [],
        }
        const restored = reload(data)
        return ['n_1', 'n_2', 'n_3'].map((id) => nodeLevel(restored.nodes.get(id)))
      }

      // The old "cliff" between a ground rail and a bridge rail becomes a ramp up to the bridge
      expect(chain(undefined, 1)).toEqual([0, 1, 1])
      expect(chain(1, 2)).toEqual([1, 2, 2])
      expect(chain(-2, 1)).toEqual([-2, -2, 1])
      expect(chain(-1, 1)).toEqual([-1, 1, 1])
      expect(chain(1, -1)).toEqual([1, 1, -1])
      expect(chain(undefined, -1)).toEqual([0, -1, -1])
    })
  })
})
