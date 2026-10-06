import type { Network, NodeId, Point, RailNode, Segment, SegmentId } from '../models/types'
import { networkCheckToken } from '../models/networkWatch'
import { SpatialGrid, gridCellSize, type Box } from './spatialGrid'

/** Box holding a rail (a curve lies inside the box of its control points), null when one of its nodes is missing */
export function segmentBox(net: Network, seg: Segment): Box | null {
  const a = net.nodes.get(seg.from)
  const b = net.nodes.get(seg.to)
  if (!a || !b) return null
  let minX = Math.min(a.pos.x, b.pos.x)
  let maxX = Math.max(a.pos.x, b.pos.x)
  let minY = Math.min(a.pos.y, b.pos.y)
  let maxY = Math.max(a.pos.y, b.pos.y)
  if (seg.via) {
    minX = Math.min(minX, seg.via.x)
    maxX = Math.max(maxX, seg.via.x)
    minY = Math.min(minY, seg.via.y)
    maxY = Math.max(maxY, seg.via.y)
  }
  return { minX, maxX, minY, maxY }
}

export interface NodeRecord {
  ref: RailNode
  x: number
  y: number
  level: number
  /** Rank of the node in the network when it was last followed */
  ord: number
  pass: number
}

export interface RailRecord {
  ref: Segment
  from: NodeId
  to: NodeId
  kind: Segment['kind']
  vx: number | undefined
  vy: number | undefined
  /** Box of the rail as it is on the grid; null while one of its nodes is missing */
  box: Box | null
  /** Rank of the rail in the network when it was last followed */
  ord: number
  pass: number
}

/** What changed in a network between two `follow` */
export interface NetworkChanges {
  /** Nodes that are new, moved or changed height */
  movedNodes: NodeId[]
  /** Rails that are new, whose ends, kind or control point changed, or one of whose ends moved */
  changedRails: SegmentId[]
  /** Nodes a rail that changed or went used to end on */
  leftNodes: NodeId[]
}

/**
 * Every node and rail of a network as they were when it was last looked at, on two grids: the
 * rails by their box, the nodes by their place. `follow` brings it up to date by comparing each
 * node and rail with what is kept of it — one pass over the network, a few numbers each — and
 * moves on the grids only what changed; it tells what that was.
 */
export class NetworkFollower {
  readonly nodes = new Map<NodeId, NodeRecord>()
  readonly rails = new Map<SegmentId, RailRecord>()
  /** The nodes and rails by their rank (`ord`): the network in its own order */
  readonly nodesInOrder: RailNode[] = []
  readonly railsInOrder: Segment[] = []
  private railGridNow: SpatialGrid<SegmentId> | null = null
  private nodeGridNow: SpatialGrid<NodeId> | null = null
  /** Number of rails the cells of the grids were sized for */
  private sizedFor = 0
  private pass = 0

  /** `margin` widens the box of every rail on the grid: a point within `margin` of a rail finds it */
  constructor(private readonly margin = 0) {}

  /** Rails by their box (widened by the margin). Only after a first `follow`. */
  get railGrid(): SpatialGrid<SegmentId> {
    return this.railGridNow!
  }

  /** Nodes by their place. Only after a first `follow`. */
  get nodeGrid(): SpatialGrid<NodeId> {
    return this.nodeGridNow!
  }

  follow(net: Network): NetworkChanges {
    if (!this.railGridNow || net.segments.size > 2 * this.sizedFor + 64) this.buildGrids(net)
    const nodeGrid = this.nodeGridNow!
    const railGrid = this.railGridNow!
    const pass = ++this.pass
    const movedNodes: NodeId[] = []
    const leftNodes: NodeId[] = []
    const changed = new Set<SegmentId>()

    let ord = 0
    for (const node of net.nodes.values()) {
      const level = node.level ?? 0
      const rec = this.nodes.get(node.id)
      if (!rec) {
        this.nodes.set(node.id, { ref: node, x: node.pos.x, y: node.pos.y, level, ord, pass })
        movedNodes.push(node.id)
      } else {
        if (rec.ref !== node || rec.x !== node.pos.x || rec.y !== node.pos.y || rec.level !== level) {
          rec.ref = node
          rec.x = node.pos.x
          rec.y = node.pos.y
          rec.level = level
          movedNodes.push(node.id)
        }
        rec.ord = ord
        rec.pass = pass
      }
      this.nodesInOrder[ord] = node
      ord++
    }
    this.nodesInOrder.length = ord
    if (this.nodes.size !== net.nodes.size) {
      for (const [id, rec] of this.nodes) {
        if (rec.pass === pass) continue
        this.nodes.delete(id)
        nodeGrid.remove(id)
      }
    }

    ord = 0
    for (const seg of net.segments.values()) {
      const vx = seg.via?.x
      const vy = seg.via?.y
      const rec = this.rails.get(seg.id)
      if (!rec) {
        this.rails.set(seg.id, { ref: seg, from: seg.from, to: seg.to, kind: seg.kind, vx, vy, box: null, ord, pass })
        changed.add(seg.id)
      } else {
        if (rec.ref !== seg || rec.from !== seg.from || rec.to !== seg.to || rec.kind !== seg.kind || rec.vx !== vx || rec.vy !== vy) {
          leftNodes.push(rec.from, rec.to)
          rec.ref = seg
          rec.from = seg.from
          rec.to = seg.to
          rec.kind = seg.kind
          rec.vx = vx
          rec.vy = vy
          changed.add(seg.id)
        }
        rec.ord = ord
        rec.pass = pass
      }
      this.railsInOrder[ord] = seg
      ord++
    }
    this.railsInOrder.length = ord
    if (this.rails.size !== net.segments.size) {
      for (const [id, rec] of this.rails) {
        if (rec.pass === pass) continue
        leftNodes.push(rec.from, rec.to)
        this.rails.delete(id)
        railGrid.remove(id)
      }
    }

    // A node that moved takes its rails with it
    for (const id of movedNodes) {
      const rec = this.nodes.get(id)!
      nodeGrid.insert(id, rec.x, rec.y, rec.x, rec.y)
      for (const sid of net.adjacency.get(id) ?? []) {
        if (this.rails.has(sid)) changed.add(sid)
      }
    }
    for (const sid of changed) {
      const rec = this.rails.get(sid)!
      rec.box = segmentBox(net, rec.ref)
      this.placeRail(sid, rec.box)
    }
    return { movedNodes, changedRails: [...changed], leftNodes }
  }

  private buildGrids(net: Network): void {
    const boxes: (Box | null)[] = []
    for (const seg of net.segments.values()) boxes.push(segmentBox(net, seg))
    const cell = gridCellSize(boxes) + 2 * this.margin
    this.sizedFor = net.segments.size
    this.railGridNow = new SpatialGrid(cell)
    this.nodeGridNow = new SpatialGrid(cell)
    // What is already known goes onto the new grids as it is; `follow` places what changed since
    for (const [id, rec] of this.nodes) this.nodeGridNow.insert(id, rec.x, rec.y, rec.x, rec.y)
    for (const [id, rec] of this.rails) this.placeRail(id, rec.box)
  }

  private placeRail(id: SegmentId, box: Box | null): void {
    const m = this.margin
    if (box) this.railGridNow!.insert(id, box.minX - m, box.minY - m, box.maxX + m, box.maxY + m)
    else this.railGridNow!.remove(id)
  }
}

interface SharedIndex {
  follower: NetworkFollower
  token: number
}

const indexes = new WeakMap<Network, SharedIndex>()

/**
 * The nodes and rails of a network on a grid, for whoever only reads the network: what is in
 * view, what is under the pointer. It is brought up to date when the revision of the network has
 * moved since it was last asked for. Null for a network without revision (see `networkWatch`):
 * such a network is read from end to end, as before.
 */
export function networkIndex(net: Network): NetworkFollower | null {
  const token = networkCheckToken(net)
  if (token === undefined) return null
  let index = indexes.get(net)
  if (!index) {
    index = { follower: new NetworkFollower(), token: NaN }
    indexes.set(net, index)
  }
  if (index.token !== token) {
    index.follower.follow(net)
    index.token = token
  }
  return index.follower
}

/** Past this share of the network a question is answered by reading it from end to end: no grid, no sorting */
const MOST_OF_IT = 0.25
/** A network of fewer nodes and rails than this is read from end to end: it is done before a grid is laid */
const SMALL_NETWORK = 200

/**
 * The rails that may touch a box, in the order of the network: those whose own box does. What a
 * loop over `net.segments` that tests each box would keep, without the loop.
 */
export function railsInBox(net: Network, box: Box): Segment[] {
  const index = net.segments.size < SMALL_NETWORK ? null : networkIndex(net)
  const ids = index?.railGrid.inBoxRepeated(box.minX, box.minY, box.maxX, box.maxY)
  const found: Segment[] = []
  if (!index || !ids || ids.length > net.segments.size * MOST_OF_IT) {
    for (const seg of net.segments.values()) {
      const own = segmentBox(net, seg)
      if (own && own.maxX >= box.minX && own.minX <= box.maxX && own.maxY >= box.minY && own.minY <= box.maxY) found.push(seg)
    }
    return found
  }
  const ranks = new Int32Array(ids.length)
  let count = 0
  for (const id of ids) {
    const rec = index.rails.get(id)!
    const own = rec.box!
    if (own.maxX >= box.minX && own.minX <= box.maxX && own.maxY >= box.minY && own.minY <= box.maxY) ranks[count++] = rec.ord
  }
  for (const rank of inOrderOnce(ranks, count)) found.push(index.railsInOrder[rank])
  return found
}

/** The first `count` ranks in ascending order, each once */
function inOrderOnce(ranks: Int32Array, count: number): Int32Array {
  const sorted = ranks.subarray(0, count).sort()
  let kept = 0
  for (let i = 0; i < count; i++) {
    if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[kept++] = sorted[i]
  }
  return sorted.subarray(0, kept)
}

/** The nodes inside a box (its edges included), in the order of the network */
export function nodesInBox(net: Network, box: Box): RailNode[] {
  const index = net.nodes.size < SMALL_NETWORK ? null : networkIndex(net)
  const ids = index?.nodeGrid.inBoxRepeated(box.minX, box.minY, box.maxX, box.maxY)
  const found: RailNode[] = []
  if (!index || !ids || ids.length > net.nodes.size * MOST_OF_IT) {
    for (const node of net.nodes.values()) {
      const { x, y } = node.pos
      if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) found.push(node)
    }
    return found
  }
  const ranks = new Int32Array(ids.length)
  let count = 0
  for (const id of ids) {
    const rec = index.nodes.get(id)!
    if (rec.x >= box.minX && rec.x <= box.maxX && rec.y >= box.minY && rec.y <= box.maxY) ranks[count++] = rec.ord
  }
  for (const rank of inOrderOnce(ranks, count)) found.push(index.nodesInOrder[rank])
  return found
}

/**
 * Those of `ids` that are nodes inside a box, in the order of the network — for whoever knows which
 * few nodes it is after. Null for a network read from end to end (small, or without revision):
 * `nodesInBox` then does as well.
 */
export function nodesAmongInBox(net: Network, ids: Iterable<NodeId>, box: Box): RailNode[] | null {
  const index = net.nodes.size < SMALL_NETWORK ? null : networkIndex(net)
  if (!index) return null
  const recs: NodeRecord[] = []
  for (const id of ids) {
    const rec = index.nodes.get(id)
    if (rec && rec.x >= box.minX && rec.x <= box.maxX && rec.y >= box.minY && rec.y <= box.maxY) recs.push(rec)
  }
  recs.sort((a, b) => a.ord - b.ord)
  return recs.map((rec) => rec.ref)
}

/**
 * The rails that can come within `reach` of a point, in the order of the network: every rail when
 * the reach has no end. A search for the nearest rail within a distance looks at these alone and
 * finds what it would find among all of them.
 */
export function railsWithin(net: Network, p: Point, reach: number): Iterable<Segment> {
  if (!Number.isFinite(reach)) return net.segments.values()
  return railsInBox(net, { minX: p.x - reach, minY: p.y - reach, maxX: p.x + reach, maxY: p.y + reach })
}

/** The nodes that can be within `reach` of a point, in the order of the network */
export function nodesWithin(net: Network, p: Point, reach: number): Iterable<RailNode> {
  if (!Number.isFinite(reach)) return net.nodes.values()
  return nodesInBox(net, { minX: p.x - reach, minY: p.y - reach, maxX: p.x + reach, maxY: p.y + reach })
}
