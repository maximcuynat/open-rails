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
}

export type JunctionId = string

export interface Junction {
  id: JunctionId
  /** The switch apex / fork node where the tracks diverge */
  nodeId: NodeId
  /** The common approach / stem node (incoming direction before fork) */
  stemNodeId?: NodeId
  /** The straight route branch endpoint node */
  straightNodeId: NodeId
  /** The diverging route branch endpoint node (left branch for 3-way turnouts) */
  divergingNodeId: NodeId
  /** Segment for the straight branch */
  straightSegmentId: SegmentId
  /** Segment for the diverging branch (left branch for 3-way turnouts) */
  divergingSegmentId: SegmentId
  /** For 3-way turnouts: the right diverging route branch endpoint node */
  divergingRightNodeId?: NodeId
  /** For 3-way turnouts: segment for the right diverging branch */
  divergingRightSegmentId?: SegmentId
  /** Which branch is currently set */
  activeBranch: 'straight' | 'diverging' | 'left' | 'right'
  /** Divergence direction: left or right, or three_way */
  hand: 'left' | 'right' | 'three_way'
  /** Frog number: e.g. 4 or 6 */
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
  junctions?: Set<JunctionId>
}
