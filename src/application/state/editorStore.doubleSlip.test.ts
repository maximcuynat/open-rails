import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addCurveSegment, addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { doubleSlipView, findJunctionAtNode } from '@domain/models/junction'
import { createLocomotive, findJunctionAhead, steerJunction } from '@domain/models/locomotive'
import { openExit } from '@domain/models/routing'
import { deserializeNetwork, resetMemoryStorage, serializeNetwork } from '@infrastructure/persistence/persistence'
import { networkChanged } from '@domain/models/networkWatch'

/**
 * Store with a double slip at the origin: a straight track along x, and a curve leaving tangent to
 * it on each side (to +y on the left, to -y on the right).
 */
function storeWithDoubleSlip() {
  const store = new EditorStore()
  const net = store.network
  const apex = addNode(net, { x: 0, y: 0 })
  const rails = {
    l1: addSegment(net, addNode(net, { x: -300, y: 0 }).id, apex.id)!.id,
    l2: addCurveSegment(net, addNode(net, { x: -300, y: 30 }).id, apex.id, { x: -150, y: 0 })!.id,
    r1: addSegment(net, apex.id, addNode(net, { x: 300, y: 0 }).id)!.id,
    r2: addCurveSegment(net, apex.id, addNode(net, { x: 300, y: -30 }).id, { x: 150, y: 0 })!.id,
  }
  store.markDirty()
  store.notify()
  return { store, net, apex, rails, junction: findJunctionAtNode(net, apex.id)! }
}

describe('double slip in the editor', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('is declared as soon as the four rails are laid', () => {
    const { junction } = storeWithDoubleSlip()
    expect(junction.kind).toBe('double_slip')
    expect(doubleSlipView(junction)).not.toBeNull()
  })

  it('throws the points on the side of the node that is clicked', () => {
    const { store, net, apex, rails, junction } = storeWithDoubleSlip()
    expect(openExit(net, apex.id, rails.l1)).toBe(rails.r1)

    expect(store.toggleActiveJunction(junction.id, { x: 2, y: 0.5 })).toBe(true)
    expect(openExit(net, apex.id, rails.l1)).toBe(rails.r2)

    expect(store.toggleActiveJunction(junction.id, { x: -2, y: 0.5 })).toBe(true)
    expect(openExit(net, apex.id, rails.l2)).toBe(rails.r2)
    expect(openExit(net, apex.id, rails.l1)).toBeNull()
  })

  it('goes through its four routes when thrown without a side', () => {
    const { store, net, apex, rails, junction } = storeWithDoubleSlip()
    const routes = new Set<string>()
    for (let i = 0; i < 4; i++) {
      const entry = [rails.l1, rails.l2].find((rail) => openExit(net, apex.id, rail) !== null)!
      routes.add(`${entry}>${openExit(net, apex.id, entry)}`)
      store.toggleActiveJunction(junction.id)
    }
    expect(routes.size).toBe(4)
  })

  it('lets a driver pick the exit, and opens the points the train arrives on', () => {
    const { net, apex, rails, junction } = storeWithDoubleSlip()
    // Arriving from the left on the curve, which the near points are set against
    const loco = createLocomotive(net, rails.l2, 0.5, 20, 10)!
    const ahead = findJunctionAhead(net, loco.front, loco.direction)!
    expect(ahead.junction).toBe(junction)
    expect(ahead.facing).toBe(true)
    expect(ahead.open).toBe(false)
    // Heading +x: -y is on the left hand
    expect(ahead.branchRails).toEqual([rails.r2, rails.r1])
    expect(ahead.activeBranch).toBe('straight')

    expect(steerJunction(net, loco, 'left')).toBe(true)
    expect(openExit(net, apex.id, rails.l2)).toBe(rails.r2)
    expect(findJunctionAhead(net, loco.front, loco.direction)!.open).toBe(true)

    expect(steerJunction(net, loco, 'right')).toBe(true)
    expect(openExit(net, apex.id, rails.l2)).toBe(rails.r1)
  })

  it('keeps its table and its position through a save', () => {
    const { net, apex, rails, junction } = storeWithDoubleSlip()
    junction.active = 3
    networkChanged()
    const loaded = deserializeNetwork(JSON.parse(JSON.stringify(serializeNetwork(net, 'P')))).network
    const restored = findJunctionAtNode(loaded, apex.id)!
    expect(restored.kind).toBe('double_slip')
    expect(doubleSlipView(restored)).toEqual(doubleSlipView(junction))
    expect(openExit(loaded, apex.id, rails.l2)).toBe(rails.r2)
  })
})
