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
}

export interface Network {
  nodes: Map<NodeId, RailNode>
  segments: Map<SegmentId, Segment>
  /** Adjacency: nodeId -> list of segment ids connected to it. */
  adjacency: Map<NodeId, SegmentId[]>
}

export interface Selection {
  nodes: Set<NodeId>
  segments: Set<SegmentId>
}
