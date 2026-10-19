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

export type SegmentKind = 'straight' | 'curve' | 'path'

/**
 * One piece of the path of a long rail: a straight line (curvature 0) or a circular arc, given
 * from its own start — where it begins, the direction of travel there, how hard it turns and how
 * long it runs. The pieces of a rail follow each other tangent to tangent.
 */
export interface PathPiece {
  /** Start of the piece, world metres */
  x: number
  y: number
  /** Direction of travel at the start, radians (`atan2(dy, dx)`) */
  heading: number
  /** Signed curvature, 1/m: positive turns towards increasing heading; 0 for a straight line */
  curvature: number
  /** Length along the piece, metres */
  length: number
}

export interface Segment {
  id: SegmentId
  from: NodeId
  to: NodeId
  kind: SegmentKind
  /** Control point for curved segments (midpoint arc definition). */
  via?: Point
  /**
   * Path of a long rail (`kind: 'path'`), from `from` to `to`: what an imported line is made of
   * between two junctions, in one rail. Never changed in place — replaced by a new list. When its
   * nodes are moved the rail follows them: its path is read turned, scaled and shifted onto where
   * they now are (see `railPath`).
   */
  path?: readonly PathPiece[]
  /** Parent segment ID if this segment was split from another segment */
  parentSegmentId?: SegmentId
  /** Cant of a curved rail in mm, set by hand; absent = computed from its radius and speed (see `curveCant`) */
  cant?: number
  /**
   * Normal direction of running on this rail, relative to its `from` → `to`: on a double line
   * trains keep to one track each way (to the left in France). Absent: none (single track, yard,
   * unknown). A cost for the path search (`runningToll`), never a ban.
   */
  running?: RunningDirection
  /**
   * What kind of railway the rail belongs to (OSM `railway=subway`, `tram`, `light_rail`): absent for
   * the railway itself, the one trains run on. A metro or tram track is drawn and saved like any
   * other, but no rolling stock of the table runs on it (`isUrbanRail`, `store.railsBlockedFor`).
   */
  railway?: RailwayKind
}

/** Normal direction of running on a rail: from its `from` node to its `to` node, or the other way */
export type RunningDirection = 'forward' | 'backward'

/** A railway other than the main one a rail may belong to (`Segment.railway`) */
export type RailwayKind = 'subway' | 'tram' | 'light_rail'

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

export type SignalId = string

/**
 * What a signal is for: `spacing` keeps trains apart on plain track (block signal, French
 * sémaphore), `protection` guards points or a crossing and stays closed until a train has its
 * route (path signal, French carré).
 */
export type SignalRole = 'spacing' | 'protection'

/**
 * A signal laid at a place of the track. Only the signals are stored: their blocks, what they show
 * and the routes they give are worked out from them (`models/signalBlocks.ts`,
 * `models/signalling.ts`). The same record is read by both signalling levels of a project. It
 * names a rail, so the domain keeps it in place when the rail is cut or merged and removes it with
 * the rail (see `replaceRail`). Change it only through the helpers of `models/signals.ts`.
 */
export interface Signal {
  id: SignalId
  segId: SegmentId
  /** Parameter on the rail, 0…1 */
  t: number
  /**
   * The direction of travel the signal speaks to: true for trains running the rail from its `from`
   * node to its `to` node (growing `t`), false for the other way. A train running against it does
   * not see it.
   */
  forward: boolean
  role: SignalRole
  /** Pro level: a marker board of a cab-signalled line (LGV), without lights. Kept on the standard level */
  cabMarker?: boolean
  /**
   * A path signal that may not be passed from behind: a train that meets it against its direction
   * reads it as a closed signal it may not pass, at both levels (see `isOneWayWall`). Kept, without
   * effect, on a block signal.
   */
  oneWay?: boolean
}

export type StationId = string

/** A platform track of a station: the place of a rail where trains stop at it */
export interface StationStop {
  segId: SegmentId
  /** Parameter on the rail, 0…1 */
  t: number
  /** Platform or track number as the data gives it (`local_ref`), when known */
  ref?: string
}

/**
 * A railway station: a name, a place, and the rails trains stop at (its platform tracks). Laid by
 * the OpenStreetMap import or made in the editor; with platforms, its stops come from their markers. It names
 * rails, so the domain keeps its stops in place when a rail is cut or merged and drops them with
 * the rail (see `replaceRail`). Change it only through the helpers of `models/stations.ts`.
 */
export interface Station {
  id: StationId
  name: string
  /** Where the station is drawn and looked for: on the track when it was built from its stops */
  pos: Point
  /** UIC code, the seven digits OpenStreetMap writes (`uic_ref`) */
  uic?: string
  /** Three-letter code of the SNCF registry (MSC for Marseille Saint-Charles) */
  code?: string
  stops: StationStop[]
}

export type PlatformId = string

/**
 * One edge of a platform: the track it runs along and on which side. `track` is walked from the
 * start of the platform to its end, rail after rail; `side` is the side of that track as seen
 * walking it that way, on screen (world y grows downwards: the left of a heading (hx, hy) is
 * (hy, −hx)). The two ends of `track` are the ends of the platform (its « bornes »).
 */
export interface PlatformEdge {
  track: TrackSpan[]
  side: 'left' | 'right'
  /** Track number shown at the platform (« 1 », « A »): `local_ref` of the data, or typed in */
  ref?: string
}

/**
 * Where the head of a train stops at a platform edge. `at` is a distance along the edge from its
 * start, in metres along the track — not a parameter, so that it does not stretch with a rail.
 */
export interface StopMarker {
  /** Index of the edge in `Platform.edges` */
  edge: 0 | 1
  at: number
  /** The direction of travel it speaks to: `forward` from the start of the edge towards its end */
  heading: 'forward' | 'backward'
  /** Longest train it stops, metres; absent: every train */
  maxLength?: number
}

/**
 * A platform of a station, beside one track (one edge) or between two (an island, two edges that
 * face each other). It names rails, like a speed zone: the domain keeps it in place when a rail is
 * cut or merged and shortens it when one goes. Change it only through the helpers of
 * `models/platforms.ts`.
 */
export interface Platform {
  id: PlatformId
  stationId: StationId
  edges: [PlatformEdge] | [PlatformEdge, PlatformEdge]
  /** Width of a platform beside one track, metres at 1:1 (an island runs from one edge to the other) */
  width: number
  markers: StopMarker[]
}

export interface Network {
  nodes: Map<NodeId, RailNode>
  segments: Map<SegmentId, Segment>
  /** Adjacency: nodeId -> list of segment ids connected to it. */
  adjacency: Map<NodeId, SegmentId[]>
  /**
   * Junctions: junctionId -> Junction definition. `findJunctionAtNode` answers from an index of
   * this map: code that adds, removes or moves a table without the helpers of `models/junction.ts`
   * calls `invalidateJunctionIndex` afterwards.
   */
  junctions: Map<JunctionId, Junction>
  /** Speed limits laid on the track (see `models/speedZones.ts`) */
  speedZones: Map<SpeedZoneId, SpeedZone>
  /** Signals laid on the track (see `models/signals.ts`) */
  signals: Map<SignalId, Signal>
  /** Stations and their platform tracks (see `models/stations.ts`) */
  stations: Map<StationId, Station>
  /** Platforms of the stations (see `models/platforms.ts`) */
  platforms: Map<PlatformId, Platform>
}

export interface Selection {
  nodes: Set<NodeId>
  segments: Set<SegmentId>
}
