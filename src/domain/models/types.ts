export type NodeId = string
export type SegmentId = string

export interface Point {
  x: number
  y: number
}

export interface RailNode {
  id: NodeId
  pos: Point
  /**
   * Height of the track at this node, in levels (bridge > 0, tunnel < 0, decimals allowed), absent
   * on the ground. A rail runs from the height of its `from` node to that of its `to` node: a ramp
   * when they differ. Two tracks only interact (crossing, weld, split, duplicate) where their
   * heights are within `LEVEL_CLEARANCE`. Read it with `nodeLevel`.
   */
  level?: number
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
  /** Cant of a curved rail in mm, set by hand; absent = computed from its radius and speed (see `curveCant`) */
  cant?: number
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

/**
 * A stretch of one rail, in the order it is walked: from `t0` to `t1`, so `t0 > t1` on a rail taken
 * against its own direction (`to` → `from`).
 */
export interface TrackSpan {
  segId: SegmentId
  t0: number
  t1: number
}

export type SpeedZoneId = string

/**
 * A speed limit laid on the track from a point A to a point B. It names rails, like a route table:
 * the domain keeps it in place when a rail is cut, merged or removed (see `replaceRail` in
 * `models/network.ts`). Change it only through the helpers of `models/speedZones.ts`, which keep
 * the rail → zones index in step.
 */
export interface SpeedZone {
  id: SpeedZoneId
  /** Limit in km/h: a multiple of 10, at least 10. It applies to every train, in both directions. */
  speed: number
  /** The track covered, in order from A to B; each stretch runs from its `t0` to its `t1` in that order */
  spans: TrackSpan[]
  /**
   * Reserved, not read yet: the direction of travel the limit applies to, relative to the A → B
   * order of `spans`. Absent = both.
   */
  direction?: 'both' | 'a_to_b' | 'b_to_a'
  /** Reserved, not read yet: limit in km/h per train category, overriding `speed` for that category */
  speedByCategory?: Record<string, number>
}

export interface Network {
  nodes: Map<NodeId, RailNode>
  segments: Map<SegmentId, Segment>
  /** Adjacency: nodeId -> list of segment ids connected to it. */
  adjacency: Map<NodeId, SegmentId[]>
  /** Junctions: junctionId -> Junction definition */
  junctions: Map<JunctionId, Junction>
  /** Speed limits laid on the track (see `models/speedZones.ts`) */
  speedZones: Map<SpeedZoneId, SpeedZone>
}

export interface Selection {
  nodes: Set<NodeId>
  segments: Set<SegmentId>
}
