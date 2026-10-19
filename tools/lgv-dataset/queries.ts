import type { Approach, Region, Subway } from './manifest'
import type { Tile } from './tiles'
import { platformQuery } from '@infrastructure/osm/overpassClient'

/** Seconds a server is given for one of these queries: a tile of high-speed track is small, a busy server slow */
export const QUERY_TIMEOUT_S = 180

/** Seven decimals: the precision of OpenStreetMap itself */
const degrees = (v: number): string => String(Number(v.toFixed(7)))

const bbox = (t: Tile): string => `(${degrees(t.south)},${degrees(t.west)},${degrees(t.north)},${degrees(t.east)})`

/** Stations within this distance (m) of a high-speed track come with it */
const STATION_REACH_M = 400

/** The Overpass area of metropolitan France (relation 2202162): the box of the manifest reaches into four other countries */
export const FRANCE_AREA = 3602202162

/**
 * The high-speed tracks of a tile (`highspeed=yes`, or a TVM cab-signalling speed, which only they
 * carry: `railway:tvm=no` is on thousands of classic tracks) within France, their nodes, the
 * stations beside them, and the line relations they belong to. A way is returned whole with all
 * its nodes, even outside the tile: tiles never cut anything.
 */
export function tileQuery(tile: Tile): string {
  const b = bbox(tile)
  return [
    `[out:json][timeout:${QUERY_TIMEOUT_S}];`,
    `area(${FRANCE_AREA})->.fr;`,
    `(way[railway=rail][highspeed=yes](area.fr)${b};way[railway=rail]["railway:tvm"~"^[0-9]"](area.fr)${b};)->.w;`,
    `(.w;.w>;node(around.w:${STATION_REACH_M})[railway~"^(station|halt)$"];);`,
    'out body qt;',
    'rel(bw.w)[type=route][route~"^(tracks|railway)$"];',
    'out body;',
  ].join('\n')
}

/**
 * A classic line into a terminal: the running tracks within reach of the corridor (everything
 * but yards, sidings, spurs and industrial or tourist lines — the crossovers and the junction
 * tracks, often without a `usage`, are what joins the main tracks to one another), every track
 * within reach of the terminal, their nodes and the stations beside them.
 */
export function approachQuery(approach: Approach): string {
  const line = approach.corridor.map(([lat, lon]) => `${degrees(lat)},${degrees(lon)}`).join(',')
  const [lat, lon] = approach.corridor[approach.corridor.length - 1]
  return [
    `[out:json][timeout:${QUERY_TIMEOUT_S}];`,
    `(way[railway=rail][service!~"^(yard|siding|spur)$"][usage!~"^(industrial|military|tourism|test)$"](around:${Math.round(approach.radiusM)},${line});`,
    `way[railway=rail](around:${Math.round(approach.stationRadiusM)},${degrees(lat)},${degrees(lon)});)->.w;`,
    `(.w;.w>;node(around.w:${STATION_REACH_M})[railway~"^(station|halt)$"];);`,
    'out body qt;',
  ].join('\n')
}

/** Seconds a server is given for a whole region */
export const REGION_TIMEOUT_S = 300

/**
 * The classic lines of a region: its running tracks (as for an approach: everything but yards,
 * sidings, spurs and industrial or tourist lines), their nodes, its stations, and the line
 * relations the tracks belong to — a classic line is named by its relation, there are too many
 * to list by hand.
 */
export function regionQuery(region: Region): string {
  return [
    `[out:json][timeout:${REGION_TIMEOUT_S}];`,
    `area["ISO3166-2"="${region.iso}"]->.r;`,
    'way[railway=rail][service!~"^(yard|siding|spur)$"][usage!~"^(industrial|military|tourism|test)$"](area.r)->.w;',
    '(.w;.w>;node[railway~"^(station|halt)$"](area.r););',
    'out body qt;',
    'rel(bw.w)[type=route][route~"^(tracks|railway)$"];',
    'out body;',
  ].join('\n')
}

/**
 * The metro of a city: its tracks (`railway=subway`, but its depots and sidings), their nodes, and
 * the routes of its lines (`route=subway`, one per direction), which name the lines. No station: the
 * stations of the dataset are those of the trains.
 */
export function subwayQuery(subway: Subway): string {
  const [south, west, north, east] = subway.bbox
  const b = bbox({ south, west, north, east })
  return [
    `[out:json][timeout:${QUERY_TIMEOUT_S}];`,
    `way[railway=subway][service!~"^(yard|siding|spur)$"]${b}->.w;`,
    '(.w;.w>;);',
    'out body qt;',
    'rel(bw.w)[type=route][route=subway];',
    'out body;',
  ].join('\n')
}

/**
 * The platforms of the trains within a tile of France (the ways and the multipolygons the in-app
 * import asks for, `platformQuery`) and their nodes. Asked apart from the tracks, so that the
 * answers cached before the platforms still serve; most are far from any track kept, and left out
 * by the import.
 */
export function platformTileQuery(tile: Tile): string {
  return [`[out:json][timeout:${QUERY_TIMEOUT_S}];`, `area(${FRANCE_AREA})->.fr;`, `(${platformQuery(`(area.fr)${bbox(tile)}`)});`, '(._;>;);', 'out body qt;'].join('\n')
}
