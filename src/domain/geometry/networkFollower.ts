import type { Junction, JunctionId, Network, NodeId, Point, RailNode, Segment, SegmentId } from '../models/types'
import { networkCheckToken, networkJournal, verifyingNetworkRevisions, type JournalEntry } from '../models/networkWatch'
import { SpatialGrid, gridCellSize, type Box } from './spatialGrid'
import { segmentBounds } from './segmentGeometry'

/** Box holding a rail (`segmentBounds`: its ends and control point, or its path), null when one of its nodes is missing */
export function segmentBox(net: Network, seg: Segment): Box | null {
  return segmentBounds(net, seg)
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
  cant: number | undefined
  /** Path of a long rail: replaced, never changed in place */
  path: Segment['path']
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
  /** Rails that are new, whose ends, kind, control point or cant changed, or one of whose ends moved */
  changedRails: SegmentId[]
  /** Nodes a rail that changed or went used to end on */
  leftNodes: NodeId[]
  /** Nodes that are gone */
  removedNodes: NodeId[]
  /** Rails that are gone */
  removedRails: SegmentId[]
  /** The graph is not the same: a node or rail came or went, a rail ends elsewhere, or they are in another order */
  structure: boolean
  /** Rails that are no longer in the same order as before, relative to the others (some more than are) */
  reorderedRails: SegmentId[]
  /** Nodes whose route table came, went or changed (kind, position, passages, positions, frog) */
  changedTables: NodeId[]
}

/** A route table as it was when last followed */
interface TableRecord {
  nodeId: NodeId
  kind: string
  active: number
  frog: number | undefined
  /** `passages` flattened: a, b of each */
  passages: string[]
  /** `positions` flattened: the length of each, then its indices */
  positions: number[]
  pass: number
}

/** `passages` and `positions` of a table flattened, as `TableRecord` keeps them */
function flattenTable(junction: Junction): { passages: string[]; positions: number[] } {
  const passages: string[] = []
  for (const passage of junction.passages) passages.push(passage.a, passage.b)
  const positions: number[] = []
  for (const position of junction.positions) {
    positions.push(position.length)
    for (const index of position) positions.push(index)
  }
  return { passages, positions }
}

function sameList<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Every node and rail of a network as they were when it was last looked at, on two grids: the
 * rails by their box, the nodes by their place. `follow` brings it up to date and tells what
 * changed: from the journal of the network (`networkJournal`) when it says what moved since the
 * last look — only that is read — and otherwise by comparing each node and rail with what is kept
 * of it, one pass over the network, a few numbers each. The grids only take what changed.
 *
 * The ranks (`ord`) go up along the order of the network; after a look through the journal they
 * have gaps (a node or rail gone leaves its rank empty, a new one takes the next), closed again at
 * the next pass over the whole network.
 */
export class NetworkFollower {
  readonly nodes = new Map<NodeId, NodeRecord>()
  readonly rails = new Map<SegmentId, RailRecord>()
  private readonly tables = new Map<JunctionId, TableRecord>()
  /** The nodes and rails by their rank (`ord`): the network in its own order, with empty ranks */
  readonly nodesInOrder: (RailNode | undefined)[] = []
  readonly railsInOrder: (Segment | undefined)[] = []
  private nextNodeOrd = 0
  private nextRailOrd = 0
  private railGridNow: SpatialGrid<SegmentId> | null = null
  private nodeGridNow: SpatialGrid<NodeId> | null = null
  /** Number of rails the cells of the grids were sized for */
  private sizedFor = 0
  private pass = 0
  /** Count of the revision of the network at the last look, for the journal, and the epoch then */
  private seen: number | undefined = undefined
  private seenEpoch = NaN

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
    const journal = networkJournal(net, this.seen ?? -1)
    let changes: NetworkChanges | null = null
    // A change made somewhere without saying where (`networkChanged`): the whole network is read
    if (journal && this.seen !== undefined && journal.entries && journal.epoch === this.seenEpoch) {
      changes = this.followJournal(net, journal.entries)
      if (changes && verifyingNetworkRevisions()) this.checkRecords(net)
    }
    if (!changes) changes = this.followAll(net)
    this.seen = journal?.value
    this.seenEpoch = journal?.epoch ?? NaN
    return changes
  }

  /**
   * What the journal says moved since the last look, and that alone: new, gone, changed, or put
   * back after being taken out (then at the end of the order). Null when it says the whole of a
   * map, or the whole network, is to be looked at again.
   */
  private followJournal(net: Network, entries: readonly JournalEntry[]): NetworkChanges | null {
    const nodeIds = new Set<NodeId>()
    const railIds = new Set<SegmentId>()
    const goneNodes = new Set<NodeId>()
    const goneRails = new Set<SegmentId>()
    const reAddedNodes = new Set<NodeId>()
    const reAddedRails = new Set<SegmentId>()
    for (const { op, map, id } of entries) {
      if (map === 'junctions' || map === 'speedZones' || map === 'signals' || map === 'stations') continue
      if (id === null) return null
      if (map !== 'segments') {
        // `nodes`, `adjacency` (keyed by node), or a touch of something
        nodeIds.add(id)
        if (op === 'delete') goneNodes.add(id)
        else if (op === 'set' && goneNodes.has(id)) reAddedNodes.add(id)
      }
      if (map === 'segments' || map === null) {
        railIds.add(id)
        if (op === 'delete') goneRails.add(id)
        else if (op === 'set' && goneRails.has(id)) reAddedRails.add(id)
      }
    }

    const nodeGrid = this.nodeGridNow!
    const railGrid = this.railGridNow!
    const pass = ++this.pass
    const movedNodes: NodeId[] = []
    const leftNodes: NodeId[] = []
    const removedNodes: NodeId[] = []
    const removedRails: SegmentId[] = []
    const changed = new Set<SegmentId>()
    const reordered = new Set<SegmentId>()
    let structure = false

    for (const id of nodeIds) {
      const node = net.nodes.get(id)
      const rec = this.nodes.get(id)
      if (!node) {
        if (!rec) continue
        this.nodes.delete(id)
        nodeGrid.remove(id)
        this.nodesInOrder[rec.ord] = undefined
        removedNodes.push(id)
        structure = true
        continue
      }
      const level = node.level ?? 0
      if (!rec) {
        const ord = this.nextNodeOrd++
        this.nodes.set(id, { ref: node, x: node.pos.x, y: node.pos.y, level, ord, pass })
        this.nodesInOrder[ord] = node
        movedNodes.push(id)
        structure = true
        continue
      }
      if (reAddedNodes.has(id)) {
        this.nodesInOrder[rec.ord] = undefined
        rec.ord = this.nextNodeOrd++
        this.nodesInOrder[rec.ord] = node
        structure = true
      }
      if (rec.ref !== node || rec.x !== node.pos.x || rec.y !== node.pos.y || rec.level !== level) {
        rec.ref = node
        rec.x = node.pos.x
        rec.y = node.pos.y
        rec.level = level
        movedNodes.push(id)
      }
      rec.pass = pass
    }

    for (const id of railIds) {
      const seg = net.segments.get(id)
      const rec = this.rails.get(id)
      if (!seg) {
        if (!rec) continue
        leftNodes.push(rec.from, rec.to)
        removedRails.push(id)
        this.rails.delete(id)
        railGrid.remove(id)
        this.railsInOrder[rec.ord] = undefined
        structure = true
        continue
      }
      const vx = seg.via?.x
      const vy = seg.via?.y
      if (!rec) {
        const ord = this.nextRailOrd++
        this.rails.set(id, { ref: seg, from: seg.from, to: seg.to, kind: seg.kind, vx, vy, cant: seg.cant, path: seg.path, box: null, ord, pass })
        this.railsInOrder[ord] = seg
        changed.add(id)
        structure = true
        continue
      }
      if (reAddedRails.has(id)) {
        this.railsInOrder[rec.ord] = undefined
        rec.ord = this.nextRailOrd++
        this.railsInOrder[rec.ord] = seg
        reordered.add(id)
        structure = true
      }
      if (rec.ref !== seg || rec.from !== seg.from || rec.to !== seg.to || rec.kind !== seg.kind || rec.vx !== vx || rec.vy !== vy || rec.cant !== seg.cant || rec.path !== seg.path) {
        if (rec.from !== seg.from || rec.to !== seg.to) structure = true
        leftNodes.push(rec.from, rec.to)
        rec.ref = seg
        rec.from = seg.from
        rec.to = seg.to
        rec.kind = seg.kind
        rec.vx = vx
        rec.vy = vy
        rec.cant = seg.cant
        rec.path = seg.path
        changed.add(id)
      }
      rec.pass = pass
    }

    this.placeChanged(net, movedNodes, changed)
    return { movedNodes, changedRails: [...changed], leftNodes, removedNodes, removedRails, structure, reorderedRails: [...reordered], changedTables: this.followTables(net, pass) }
  }

  /** Every node and rail compared with what is kept of it; the ranks are closed up */
  private followAll(net: Network): NetworkChanges {
    const nodeGrid = this.nodeGridNow!
    const railGrid = this.railGridNow!
    const pass = ++this.pass
    const movedNodes: NodeId[] = []
    const leftNodes: NodeId[] = []
    const removedNodes: NodeId[] = []
    const removedRails: SegmentId[] = []
    const changed = new Set<SegmentId>()
    const reordered = new Set<SegmentId>()
    let structure = false

    // The order is the same as before when the old ranks still go up along the new order
    let ord = 0
    let previousOrd = -1
    for (const node of net.nodes.values()) {
      const level = node.level ?? 0
      const rec = this.nodes.get(node.id)
      if (!rec) {
        this.nodes.set(node.id, { ref: node, x: node.pos.x, y: node.pos.y, level, ord, pass })
        movedNodes.push(node.id)
        structure = true
      } else {
        if (rec.ref !== node || rec.x !== node.pos.x || rec.y !== node.pos.y || rec.level !== level) {
          rec.ref = node
          rec.x = node.pos.x
          rec.y = node.pos.y
          rec.level = level
          movedNodes.push(node.id)
        }
        if (rec.ord < previousOrd) structure = true
        previousOrd = rec.ord
        rec.ord = ord
        rec.pass = pass
      }
      this.nodesInOrder[ord] = node
      ord++
    }
    this.nodesInOrder.length = ord
    this.nextNodeOrd = ord
    if (this.nodes.size !== net.nodes.size) {
      structure = true
      for (const [id, rec] of this.nodes) {
        if (rec.pass === pass) continue
        this.nodes.delete(id)
        nodeGrid.remove(id)
        removedNodes.push(id)
      }
    }

    ord = 0
    previousOrd = -1
    let previous: RailRecord | null = null
    for (const seg of net.segments.values()) {
      const vx = seg.via?.x
      const vy = seg.via?.y
      const rec = this.rails.get(seg.id)
      if (!rec) {
        this.rails.set(seg.id, { ref: seg, from: seg.from, to: seg.to, kind: seg.kind, vx, vy, cant: seg.cant, path: seg.path, box: null, ord, pass })
        changed.add(seg.id)
        structure = true
      } else {
        if (rec.ref !== seg || rec.from !== seg.from || rec.to !== seg.to || rec.kind !== seg.kind || rec.vx !== vx || rec.vy !== vy || rec.cant !== seg.cant || rec.path !== seg.path) {
          if (rec.from !== seg.from || rec.to !== seg.to) structure = true
          leftNodes.push(rec.from, rec.to)
          rec.ref = seg
          rec.from = seg.from
          rec.to = seg.to
          rec.kind = seg.kind
          rec.vx = vx
          rec.vy = vy
          rec.cant = seg.cant
          rec.path = seg.path
          changed.add(seg.id)
        }
        if (rec.ord < previousOrd) {
          // Out of sequence: this rail or the one before it moved, both are told
          reordered.add(seg.id)
          reordered.add(previous!.ref.id)
          structure = true
        }
        previousOrd = rec.ord
        previous = rec
        rec.ord = ord
        rec.pass = pass
      }
      this.railsInOrder[ord] = seg
      ord++
    }
    this.railsInOrder.length = ord
    this.nextRailOrd = ord
    if (this.rails.size !== net.segments.size) {
      structure = true
      for (const [id, rec] of this.rails) {
        if (rec.pass === pass) continue
        leftNodes.push(rec.from, rec.to)
        removedRails.push(id)
        this.rails.delete(id)
        railGrid.remove(id)
      }
    }

    this.placeChanged(net, movedNodes, changed)
    return { movedNodes, changedRails: [...changed], leftNodes, removedNodes, removedRails, structure, reorderedRails: [...reordered], changedTables: this.followTables(net, pass) }
  }

  /** The nodes that moved onto the grid, their rails with them, and every rail that changed */
  private placeChanged(net: Network, movedNodes: NodeId[], changed: Set<SegmentId>): void {
    const nodeGrid = this.nodeGridNow!
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
  }

  /** Tests: what is kept is the network, node for node and rail for rail, in its order */
  private checkRecords(net: Network): void {
    const fail = (what: string): never => {
      throw new Error(`The network was changed without touchNetwork saying what: ${what}`)
    }
    if (this.nodes.size !== net.nodes.size) fail(`${this.nodes.size} nodes kept, ${net.nodes.size} in the network`)
    let ord = -1
    for (const node of net.nodes.values()) {
      const rec = this.nodes.get(node.id)
      if (!rec) fail(`node ${node.id} unknown`)
      if (rec!.ref !== node || rec!.x !== node.pos.x || rec!.y !== node.pos.y || rec!.level !== (node.level ?? 0)) fail(`node ${node.id}`)
      if (rec!.ord <= ord || this.nodesInOrder[rec!.ord] !== node) fail(`node ${node.id} out of order`)
      ord = rec!.ord
    }
    if (this.rails.size !== net.segments.size) fail(`${this.rails.size} rails kept, ${net.segments.size} in the network`)
    ord = -1
    for (const seg of net.segments.values()) {
      const rec = this.rails.get(seg.id)
      if (!rec) fail(`rail ${seg.id} unknown`)
      if (rec!.ref !== seg || rec!.from !== seg.from || rec!.to !== seg.to || rec!.kind !== seg.kind || rec!.vx !== seg.via?.x || rec!.vy !== seg.via?.y || rec!.cant !== seg.cant || rec!.path !== seg.path) fail(`rail ${seg.id}`)
      if (rec!.ord <= ord || this.railsInOrder[rec!.ord] !== seg) fail(`rail ${seg.id} out of order`)
      ord = rec!.ord
    }
  }

  /** The nodes whose route table came, went or changed since the last pass */
  private followTables(net: Network, pass: number): NodeId[] {
    const tables = this.tables
    const changedNodes = new Set<NodeId>()
    for (const junction of net.junctions.values()) {
      const rec = tables.get(junction.id)
      const frog = junction.frogNumber
      if (!rec) {
        tables.set(junction.id, { nodeId: junction.nodeId, kind: junction.kind, active: junction.active, frog, ...flattenTable(junction), pass })
        changedNodes.add(junction.nodeId)
        continue
      }
      rec.pass = pass
      const { passages, positions } = flattenTable(junction)
      const same = rec.nodeId === junction.nodeId && rec.kind === junction.kind && rec.active === junction.active && rec.frog === frog
      if (same && sameList(rec.passages, passages) && sameList(rec.positions, positions)) continue
      // A table that moved to another node is a change at both
      changedNodes.add(rec.nodeId)
      changedNodes.add(junction.nodeId)
      rec.nodeId = junction.nodeId
      rec.kind = junction.kind
      rec.active = junction.active
      rec.frog = frog
      rec.passages = passages
      rec.positions = positions
    }
    if (tables.size !== net.junctions.size) {
      for (const [id, rec] of tables) {
        if (rec.pass === pass) continue
        tables.delete(id)
        changedNodes.add(rec.nodeId)
      }
    }
    return [...changedNodes]
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

/** Passes kept in the feed of a network; a reader further behind starts over */
const FEED_PASSES = 64

const feedEntries = (changes: NetworkChanges): number =>
  changes.movedNodes.length + changes.changedRails.length + changes.leftNodes.length + changes.removedNodes.length + changes.removedRails.length + changes.changedTables.length

/**
 * What the shared follower saw change, pass after pass, for whoever keeps something worked out
 * from the network and wants to redo only what changed since it last looked: a reader holds the
 * cursor it was given and asks for what came after it. The feed holds a bounded number of passes,
 * and no more entries than the network has nodes and rails — beyond that, redoing everything costs
 * no more than following the changes, and a reader left behind is told so.
 */
class ChangeFeed {
  private readonly passes: NetworkChanges[] = []
  /** Cursor of the first pass kept */
  private first = 0
  private entries = 0

  /** Cursor of the next pass: what a reader up to date holds */
  get cursor(): number {
    return this.first + this.passes.length
  }

  record(changes: NetworkChanges, size: number): void {
    this.passes.push(changes)
    this.entries += feedEntries(changes)
    while (this.passes.length > 1 && (this.passes.length > FEED_PASSES || this.entries > size)) {
      this.entries -= feedEntries(this.passes.shift()!)
      this.first++
    }
  }

  /** Everything that changed since `cursor`, as one; null when the cursor is unknown or too old */
  since(cursor: number | undefined): NetworkChanges | null {
    if (cursor === undefined || cursor < this.first) return null
    const from = cursor - this.first
    if (from >= this.passes.length) return { movedNodes: [], changedRails: [], leftNodes: [], removedNodes: [], removedRails: [], structure: false, reorderedRails: [], changedTables: [] }
    if (from === this.passes.length - 1) return this.passes[from]
    const movedNodes = new Set<NodeId>()
    const changedRails = new Set<SegmentId>()
    const leftNodes = new Set<NodeId>()
    const removedNodes = new Set<NodeId>()
    const removedRails = new Set<SegmentId>()
    const reorderedRails = new Set<SegmentId>()
    const changedTables = new Set<NodeId>()
    let structure = false
    for (let i = from; i < this.passes.length; i++) {
      const pass = this.passes[i]
      for (const id of pass.movedNodes) movedNodes.add(id)
      for (const id of pass.changedRails) changedRails.add(id)
      for (const id of pass.leftNodes) leftNodes.add(id)
      for (const id of pass.removedNodes) removedNodes.add(id)
      for (const id of pass.removedRails) removedRails.add(id)
      for (const id of pass.reorderedRails) reorderedRails.add(id)
      for (const id of pass.changedTables) changedTables.add(id)
      structure ||= pass.structure
    }
    return { movedNodes: [...movedNodes], changedRails: [...changedRails], leftNodes: [...leftNodes], removedNodes: [...removedNodes], removedRails: [...removedRails], structure, reorderedRails: [...reorderedRails], changedTables: [...changedTables] }
  }
}

interface SharedIndex {
  follower: NetworkFollower
  token: number
  feed: ChangeFeed
}

const indexes = new WeakMap<Network, SharedIndex>()

/** A network without revision is followed at every call: compared with what is kept of it, as before */
function sharedIndex(net: Network, token: number | undefined): SharedIndex {
  let index = indexes.get(net)
  if (!index) {
    index = { follower: new NetworkFollower(), token: NaN, feed: new ChangeFeed() }
    indexes.set(net, index)
  }
  if (token === undefined || index.token !== token) {
    index.feed.record(index.follower.follow(net), net.nodes.size + net.segments.size)
    index.token = token ?? NaN
  }
  return index
}

/**
 * The nodes and rails of a network on a grid, for whoever only reads the network: what is in
 * view, what is under the pointer. It is brought up to date when the revision of the network has
 * moved since it was last asked for. Null for a network without revision (see `networkWatch`):
 * such a network is read from end to end, as before.
 */
export function networkIndex(net: Network): NetworkFollower | null {
  const token = networkCheckToken(net)
  if (token === undefined) return null
  return sharedIndex(net, token).follower
}

/** What a reader of the feed of a network gets: what changed since its cursor, and its new cursor */
export interface FeedReading {
  /** Null when the reader has no cursor yet or was left behind: it starts over from the network */
  changes: NetworkChanges | null
  cursor: number
  /** The follower the changes come from, up to date: ranks and records of every node and rail */
  index: NetworkFollower
}

/**
 * What changed in a network since `cursor` (see `ChangeFeed`), for whoever keeps something worked
 * out from it. A network without revision is compared with what is kept of it at every call (one
 * pass over its nodes and rails), a network with one only when its revision moved.
 */
export function networkChangesSince(net: Network, cursor: number | undefined): FeedReading {
  const index = sharedIndex(net, networkCheckToken(net))
  return { changes: index.feed.since(cursor), cursor: index.feed.cursor, index: index.follower }
}

/** True when the changes tell of anything at all */
export function anyChange(changes: NetworkChanges): boolean {
  return (
    changes.structure ||
    changes.movedNodes.length > 0 ||
    changes.changedRails.length > 0 ||
    changes.leftNodes.length > 0 ||
    changes.reorderedRails.length > 0 ||
    changes.changedTables.length > 0
  )
}

/** The nodes at which something changed: moved, left by a rail, at the end of a rail that changed, or whose table changed */
export function dirtyNodesOf(changes: NetworkChanges, index: NetworkFollower): Set<NodeId> {
  const dirty = new Set<NodeId>(changes.movedNodes)
  for (const id of changes.leftNodes) dirty.add(id)
  for (const id of changes.changedTables) dirty.add(id)
  for (const sid of changes.changedRails) {
    const rec = index.rails.get(sid)
    if (!rec) continue
    dirty.add(rec.from)
    dirty.add(rec.to)
  }
  return dirty
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
  for (const rank of inOrderOnce(ranks, count)) found.push(index.railsInOrder[rank]!)
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
  for (const rank of inOrderOnce(ranks, count)) found.push(index.nodesInOrder[rank]!)
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
