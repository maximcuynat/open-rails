import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, generateId, resetIdCounter } from '../../domain/models/network'
import { addSignal, addSignalPair } from '../../domain/models/signals'
import { signalHeading, signalWorldPosition } from '../../domain/services/signalLayout'
import { deserializeNetwork, serializeNetwork, type SerializedProject } from './persistence'

beforeEach(() => resetIdCounter(0))

/** Three rails along y = 0 (0–300–600–1000) */
function track() {
  const net = createNetwork()
  const nodes = [0, 300, 600, 1000].map((x) => addNode(net, { x, y: 0 }))
  const rails = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
  return { net, nodes, rails }
}

const throughJson = (project: SerializedProject): SerializedProject => JSON.parse(JSON.stringify(project))
const save = (net: ReturnType<typeof createNetwork>, signalling?: Parameters<typeof serializeNetwork>[18]) =>
  serializeNetwork(net, 'P', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, signalling)

describe('signals in a saved project', () => {
  it('a project without signal on the default settings is written without any of the keys and saved again identically', () => {
    const { net } = track()
    const saved = throughJson(save(net, { level: 'standard', stopEnforced: true }))
    expect('signals' in saved).toBe(false)
    expect('signallingLevel' in saved).toBe(false)
    expect('signalStopEnforced' in saved).toBe(false)

    const loaded = deserializeNetwork(saved)
    expect(loaded.network.signals.size).toBe(0)
    expect(loaded.signallingLevel).toBeUndefined()
    expect(loaded.signalStopEnforced).toBeUndefined()
    const again = save(loaded.network, { level: 'standard', stopEnforced: true })
    expect(JSON.stringify(again)).toBe(JSON.stringify(save(net, { level: 'standard', stopEnforced: true })))
    // And exactly what a save made before the signals existed holds
    expect(JSON.stringify(again)).toBe(JSON.stringify(serializeNetwork(net, 'P')))
  })

  it('signals come back the same: ids, places, directions, roles and options', () => {
    const { net, rails } = track()
    const block = addSignal(net, { segId: rails[0].id, t: 0.25 }, true, 'spacing')
    const path = addSignal(net, { segId: rails[2].id, t: 0.5 }, false, 'protection', { oneWay: true })
    const marker = addSignal(net, { segId: rails[1].id, t: 0.5 }, true, 'spacing', { cabMarker: true })
    if (!block.ok || !path.ok || !marker.ok) throw new Error('refused')

    const saved = throughJson(save(net))
    expect(saved.signals).toEqual([
      { id: block.signal.id, segId: rails[0].id, t: 0.25, forward: true, role: 'spacing' },
      { id: path.signal.id, segId: rails[2].id, t: 0.5, forward: false, role: 'protection', oneWay: true },
      { id: marker.signal.id, segId: rails[1].id, t: 0.5, forward: true, role: 'spacing', cabMarker: true },
    ])
    const loaded = deserializeNetwork(saved).network
    expect([...loaded.signals.values()]).toEqual([...net.signals.values()])
    expect(JSON.stringify(save(loaded))).toBe(JSON.stringify(save(net)))
  })

  it('the settings are written only when they differ from the defaults, and read back', () => {
    const { net } = track()
    const saved = throughJson(save(net, { level: 'pro', stopEnforced: false }))
    expect(saved.signallingLevel).toBe('pro')
    expect(saved.signalStopEnforced).toBe(false)
    expect(deserializeNetwork(saved)).toMatchObject({ signallingLevel: 'pro', signalStopEnforced: false })

    const onlyLevel = throughJson(save(net, { level: 'pro', stopEnforced: true }))
    expect(onlyLevel.signallingLevel).toBe('pro')
    expect('signalStopEnforced' in onlyLevel).toBe(false)
    // Anything else in a file is ignored
    const odd = { ...saved, signallingLevel: 'expert', signalStopEnforced: 'no' } as unknown as SerializedProject
    expect(deserializeNetwork(odd).signallingLevel).toBeUndefined()
    expect(deserializeNetwork(odd).signalStopEnforced).toBeUndefined()
  })

  it('the two displays are written only when ticked, and read back; a file of the first batch has neither', () => {
    const { net } = track()
    const settings = { level: 'standard', stopEnforced: true } as const
    const display = (blocks: boolean, reservations: boolean) =>
      throughJson(
        serializeNetwork(net, 'P', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, settings, { blocks, reservations }),
      )
    // Both off: byte for byte what was written before these keys existed
    expect(JSON.stringify(display(false, false))).toBe(JSON.stringify(throughJson(save(net, settings))))
    expect(deserializeNetwork(display(false, false))).toMatchObject({ showSignalBlocks: undefined, showSignalReservations: undefined })

    const blocks = display(true, false)
    expect(blocks.showSignalBlocks).toBe(true)
    expect('showSignalReservations' in blocks).toBe(false)
    expect(deserializeNetwork(blocks).showSignalBlocks).toBe(true)
    expect(deserializeNetwork(blocks).showSignalReservations).toBeUndefined()
    expect(deserializeNetwork(display(true, true))).toMatchObject({ showSignalBlocks: true, showSignalReservations: true })
    // Anything but `true` in a file is ignored
    const odd = { ...blocks, showSignalBlocks: 'yes', showSignalReservations: 1 } as unknown as SerializedProject
    expect(deserializeNetwork(odd).showSignalBlocks).toBeUndefined()
    expect(deserializeNetwork(odd).showSignalReservations).toBeUndefined()
  })

  it('the options of the pro level survive a project saved at the standard level, and back', () => {
    const { net, rails } = track()
    const laid = addSignal(net, { segId: rails[0].id, t: 0.25 }, true, 'protection', { cabMarker: true, oneWay: true })
    if (!laid.ok) throw new Error('refused')
    let project = throughJson(save(net, { level: 'pro' }))
    for (const level of ['standard', 'pro', 'standard'] as const) {
      const loaded = deserializeNetwork(project).network
      expect([...loaded.signals.values()]).toEqual([laid.signal])
      project = throughJson(save(loaded, { level }))
    }
    expect(project.signals).toEqual([{ id: laid.signal.id, segId: rails[0].id, t: 0.25, forward: true, role: 'protection', cabMarker: true, oneWay: true }])
  })

  it('reads a damaged file without failing: what does not hold together is skipped', () => {
    const { net, rails } = track()
    const good = addSignal(net, { segId: rails[0].id, t: 0.25 }, true, 'spacing')
    if (!good.ok) throw new Error('refused')
    const saved = throughJson(save(net))
    saved.signals = [
      ...saved.signals!,
      null,
      { id: 'sig_50' },
      { id: 'sig_51', segId: 'nowhere', t: 0.5, forward: true, role: 'spacing' },
      { id: 'sig_52', segId: rails[1].id, t: 7, forward: true, role: 'spacing' },
      { id: 'sig_53', segId: rails[1].id, t: 0.5, forward: 'yes', role: 'spacing' },
      { id: good.signal.id, segId: rails[1].id, t: 0.5, forward: true, role: 'spacing' },
      { id: 'sig_54', segId: rails[1].id, t: 0.5, forward: false, role: 'mystery' },
    ] as never
    const loaded = deserializeNetwork(saved).network
    expect([...loaded.signals.keys()]).toEqual([good.signal.id, 'sig_54'])
    expect(loaded.signals.get('sig_54')!.role).toBe('spacing')

    expect(deserializeNetwork({ ...saved, signals: 'none' } as never).network.signals.size).toBe(0)
  })

  it('new ids do not reuse those of the signals read', () => {
    const { net, rails } = track()
    const laid = addSignal(net, { segId: rails[0].id, t: 0.25 }, true, 'spacing')
    if (!laid.ok) throw new Error('refused')
    const saved = throughJson(save(net))
    saved.signals![0].id = 'sig_700'
    resetIdCounter(0)
    const loaded = deserializeNetwork(saved).network
    expect(loaded.signals.has('sig_700')).toBe(true)
    expect(generateId('n')).toBe('n_701')
  })

  it('signals are put back before the reconcile pass, which carries them onto the rails it cuts', () => {
    // A file in which a second track runs across the rail of the signals without a node there: the
    // load cuts both rails at the crossing
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 1000, y: 0 })
    const rail = addSegment(net, a.id, b.id)!
    const c = addNode(net, { x: 400, y: -300 })
    const d = addNode(net, { x: 400, y: 300 })
    addSegment(net, c.id, d.id)
    const pair = addSignalPair(net, { segId: rail.id, t: 0.7 }, 'spacing')
    const before = addSignal(net, { segId: rail.id, t: 0.1 }, true, 'protection')
    if (!pair.ok || !before.ok) throw new Error('refused')

    const loaded = deserializeNetwork(throughJson(save(net))).network
    expect(loaded.segments.has(rail.id)).toBe(false)
    expect(loaded.signals.size).toBe(3)
    for (const original of net.signals.values()) {
      const signal = loaded.signals.get(original.id)!
      expect(loaded.segments.has(signal.segId)).toBe(true)
      expect(signalWorldPosition(loaded, signal)!.x).toBeCloseTo(signalWorldPosition(net, original)!.x, 6)
      expect(signalWorldPosition(loaded, signal)!.y).toBeCloseTo(0, 6)
      expect(signalHeading(loaded, signal)!.x).toBeCloseTo(signalHeading(net, original)!.x, 6)
      expect(signal.role).toBe(original.role)
    }
  })
})
