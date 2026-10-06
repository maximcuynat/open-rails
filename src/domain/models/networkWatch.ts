import type { Network } from './types'

// ─────────────────── Has the network changed? ───────────────────
//
// What is computed from the track (speed profile, blocks, sections) is kept from one frame to the
// next, so everything that keeps something asks, at every frame: is the network still what it
// was? Comparing all of it gives the answer, at the cost of one pass over every node and rail.
// A network made by `createNetwork` answers with a counter instead — its revision:
//
// - its maps count for themselves: adding, replacing or removing a node, a rail, a route table,
//   a speed zone or a signal moves the revision;
// - code that changes one of those in place (a node moved, a control point, a height, a cant, the
//   position of a set of points, the span of a zone…) calls `touchNetwork` afterwards — or
//   `networkChanged` where it does not know which network the thing belongs to.
//
// The same revision means the same network; a new one means it may have changed, and whoever
// keeps something then compares what it reads, as before. A network put together by hand, without
// `createNetwork`, has no revision and is compared every time.
//
// The tests run with `verifyNetworkRevisions`: every revision read is checked against the content
// of the network, and a change made without `touchNetwork` throws.

interface Counter {
  value: number
}

/** A map of a network: changing what it holds moves the revision of the network */
class CountingMap<K, V> extends Map<K, V> {
  private counter: Counter | undefined

  constructor(counter: Counter) {
    super()
    this.counter = counter
  }

  override set(key: K, value: V): this {
    if (this.counter) this.counter.value++
    return super.set(key, value)
  }

  override delete(key: K): boolean {
    if (this.counter) this.counter.value++
    return super.delete(key)
  }

  override clear(): void {
    if (this.counter) this.counter.value++
    super.clear()
  }
}

const counters = new WeakMap<Network, Counter>()
/** Changes made in place by code that does not know its network: they count for every network */
let epoch = 0

/** An empty network that knows when it changes (see the top of this file) */
export function createCountedNetwork(): Network {
  const counter: Counter = { value: 0 }
  const net: Network = {
    nodes: new CountingMap(counter),
    segments: new CountingMap(counter),
    adjacency: new CountingMap(counter),
    junctions: new CountingMap(counter),
    speedZones: new CountingMap(counter),
    signals: new CountingMap(counter),
  }
  counters.set(net, counter)
  return net
}

/** Something of the network was changed in place: a node, a rail, a route table, a zone, a signal */
export function touchNetwork(net: Network): void {
  const counter = counters.get(net)
  if (counter) counter.value++
}

/** Something was changed in place in a network, whichever it is */
export function networkChanged(): void {
  epoch++
}

/**
 * Everything a network holds, value by value, as it was at a revision: what the tests check the
 * revisions against. `update` records the content and names the first thing that differs from
 * what was recorded before.
 */
class ContentRecord {
  revision = NaN
  private values: unknown[] = []

  update(net: Network): string | null {
    const values = this.values
    let at = 0
    let label = ''
    let differs: string | null = null
    const put = (value: unknown): void => {
      // `Object.is`: a value that is not a number is the same as itself
      if (!Object.is(values[at], value)) {
        values[at] = value
        differs ??= label
      }
      at++
    }
    for (const node of net.nodes.values()) {
      label = `node ${node.id}`
      put(node.id)
      put(node.pos.x)
      put(node.pos.y)
      put(node.level ?? 0)
    }
    for (const seg of net.segments.values()) {
      label = `rail ${seg.id}`
      put(seg.id)
      put(seg.from)
      put(seg.to)
      put(seg.kind)
      put(seg.via?.x)
      put(seg.via?.y)
      put(seg.parentSegmentId)
      put(seg.cant)
    }
    for (const [nodeId, segIds] of net.adjacency) {
      label = `rails of node ${nodeId}`
      put(nodeId)
      put(segIds.length)
      for (const sid of segIds) put(sid)
    }
    for (const junction of net.junctions.values()) {
      label = `route table ${junction.id}`
      put(junction.id)
      put(junction.nodeId)
      put(junction.kind)
      put(junction.active)
      put(junction.frogNumber)
      put(junction.passages.length)
      for (const passage of junction.passages) {
        put(passage.a)
        put(passage.b)
      }
      put(junction.positions.length)
      for (const position of junction.positions) {
        put(position.length)
        for (const index of position) put(index)
      }
    }
    for (const zone of net.speedZones.values()) {
      label = `speed zone ${zone.id}`
      put(zone.id)
      put(zone.speed)
      put(zone.direction)
      put(zone.speedByCategory ? JSON.stringify(zone.speedByCategory) : undefined)
      put(zone.spans.length)
      for (const span of zone.spans) {
        put(span.segId)
        put(span.t0)
        put(span.t1)
      }
    }
    for (const signal of net.signals.values()) {
      label = `signal ${signal.id}`
      put(signal.id)
      put(signal.segId)
      put(signal.t)
      put(signal.forward)
      put(signal.role)
      put(signal.cabMarker)
      put(signal.oneWay)
    }
    if (values.length !== at) {
      values.length = at
      differs ??= 'something removed'
    }
    return differs
  }
}

let verifying = false
const verified = new WeakMap<Network, ContentRecord>()

/** Check every revision read against the content of the network (tests): slow, and exact */
export function verifyNetworkRevisions(on: boolean): void {
  verifying = on
}

/** True while the revisions are checked against the content they stand for */
export function verifyingNetworkRevisions(): boolean {
  return verifying
}

/**
 * What a kept comparison of `net` is good for: the same token as when it was made means the
 * network was not touched since. `undefined` for a network without revision — compare.
 */
export function networkCheckToken(net: Network): number | undefined {
  const counter = counters.get(net)
  if (!counter) return undefined
  // Both only ever go up: their sum moves whenever one of them does
  const revision = counter.value + epoch
  if (verifying) {
    let record = verified.get(net)
    if (!record) {
      record = new ContentRecord()
      verified.set(net, record)
    }
    const differs = record.update(net)
    if (differs !== null && record.revision === revision) {
      throw new Error(`The network was changed in place without touchNetwork: ${differs}`)
    }
    record.revision = revision
  }
  return revision
}
