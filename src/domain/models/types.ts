export type NodeId = string
export type SegmentId = string

export interface Point {
  x: number
  y: number
}

export interface RailNode {
  id: NodeId
  pos: Point
}

export type SegmentKind = 'straight' | 'curve'

export interface Segment {
  id: SegmentId
  from: NodeId
  to: NodeId
  kind: SegmentKind
  /** Control point for curved segments (midpoint arc definition). */
  via?: Point
  /** Parent segment ID if this segment was split from another segment */
  parentSegmentId?: SegmentId
  /**
   * Stacking level (bridge > 0, tunnel < 0), absent on the ground. Two rails only interact
   * (crossing, weld, split, duplicate) where they share a level. Read it with `segmentLevel`.
   */
  level?: number
}

export type JunctionId = string

/** A way through a node: the two rails a train passes between. The pair is unordered. */
export interface Passage {
  a: SegmentId
  b: SegmentId
}

/** What the device at a node is. A hint for drawing and the interface: routing only reads the table. */
export type JunctionKind = 'turnout' | 'three_way' | 'crossing' | 'double_slip' | 'custom'

/**
 * Route table of a node: the passages a train can take through it and which of them are open.
 * It is declared once (by the tool that lays the device, or proposed from the geometry of a fork)
 * and then kept as it is: it names rails, so splitting or renaming a rail only renames an entry.
 * Rails of the node the table does not name follow the default rule (see `models/routing.ts`).
 *
 * For a `turnout` and a `three_way`, `passages[i].a` is the stem and `passages[i].b` a branch, in
 * the order straight, diverging (left on a 3-way), right; position `i` opens passage `i` alone.
 * Read them through `turnoutView` (`models/junction.ts`).
 */
export interface Junction {
  id: JunctionId
  /** The node the table belongs to (the points of a turnout) */
  nodeId: NodeId
  kind: JunctionKind
  passages: Passage[]
  /** For each position of the device, the indices of the passages it opens */
  positions: number[][]
  /** Index of the current position */
  active: number
  /** Frog number when the device was laid from a catalog piece; derived from the geometry otherwise */
  frogNumber?: number
}

export interface Network {
  nodes: Map<NodeId, RailNode>
  segments: Map<SegmentId, Segment>
  /** Adjacency: nodeId -> list of segment ids connected to it. */
  adjacency: Map<NodeId, SegmentId[]>
  /** Junctions: junctionId -> Junction definition */
  junctions: Map<JunctionId, Junction>
}

export interface Selection {
  nodes: Set<NodeId>
  segments: Set<SegmentId>
}
