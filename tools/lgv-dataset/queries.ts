import type { Approach } from './manifest'
import type { Tile } from './tiles'

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
 * A classic line into a terminal: the main and branch tracks within reach of the corridor, every
 * track within reach of the terminal, their nodes and the stations beside them.
 */
export function approachQuery(approach: Approach): string {
  const line = approach.corridor.map(([lat, lon]) => `${degrees(lat)},${degrees(lon)}`).join(',')
  const [lat, lon] = approach.corridor[approach.corridor.length - 1]
  return [
    `[out:json][timeout:${QUERY_TIMEOUT_S}];`,
    `(way[railway=rail][usage~"^(main|branch)$"](around:${Math.round(approach.radiusM)},${line});`,
    `way[railway=rail](around:${Math.round(approach.stationRadiusM)},${degrees(lat)},${degrees(lon)});)->.w;`,
    `(.w;.w>;node(around.w:${STATION_REACH_M})[railway~"^(station|halt)$"];);`,
    'out body qt;',
  ].join('\n')
}
