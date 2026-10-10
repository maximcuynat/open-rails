import type { Point } from '../models/types'

// Local projection of the imported area: a transverse Mercator whose central meridian and origin
// are the centre of the data, on the WGS 84 ellipsoid, with no scale factor. It is conformal (the
// angles of the track are kept) and its scale error grows with the square of the distance to the
// central meridian: under 1 cm on a kilometre of track 25 km away (see the test).

const SEMI_MAJOR_AXIS = 6378137
const FLATTENING = 1 / 298.257223563
const E2 = FLATTENING * (2 - FLATTENING)
const EP2 = E2 / (1 - E2)
const RAD = Math.PI / 180

/** Length of the meridian from the equator to a latitude (radians), in metres */
function meridianArc(phi: number): number {
  const e4 = E2 * E2
  const e6 = e4 * E2
  return (
    SEMI_MAJOR_AXIS *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))
  )
}

/**
 * The projection centred on a place: latitude and longitude (degrees) to world metres, x to the
 * east, y to the south (the canvas draws y downwards), the centre at (0, 0).
 */
export function createProjection(lat0: number, lon0: number): (lat: number, lon: number) => Point {
  const origin = meridianArc(lat0 * RAD)
  return (lat, lon) => {
    const phi = lat * RAD
    const sin = Math.sin(phi)
    const cos = Math.cos(phi)
    const tan = Math.tan(phi)
    const n = SEMI_MAJOR_AXIS / Math.sqrt(1 - E2 * sin * sin)
    const t = tan * tan
    const c = EP2 * cos * cos
    const a = (lon - lon0) * RAD * cos
    const a2 = a * a
    const east = n * a * (1 + (a2 / 6) * (1 - t + c) + (a2 * a2 / 120) * (5 - 18 * t + t * t + 72 * c - 58 * EP2))
    const north =
      meridianArc(phi) -
      origin +
      n * tan * a2 * (0.5 + (a2 / 24) * (5 - t + 9 * c + 4 * c * c) + (a2 * a2 / 720) * (61 - 58 * t + t * t + 600 * c - 330 * EP2))
    return { x: east, y: -north }
  }
}

// ─────────────────────────────── Lambert-93, the national frame ───────────────────────────────

/**
 * The frame an import is projected in. `local`: the transverse Mercator above, centred on the data
 * (exact lengths, but two imports do not line up). `lambert93`: the French national projection,
 * the same for every import, so that imports and the official station positions lie on one map.
 */
export type OsmFrame = 'local' | 'lambert93'

/** Natural origin of Lambert-93: world (0, 0) of every import made in that frame */
export const LAMBERT93_ORIGIN = { lat: 46.5, lon: 3 } as const

// EPSG:2154 — Lambert conformal conic with two standard parallels on the GRS 80 ellipsoid (RGF93).
// Its scale is exact on the parallels 44° and 49°, 0.95 m/km short between them (46.5°) and up to
// 3 m/km long in Corsica: good enough for a map, said to the user, not for a survey.
const GRS80_SEMI_MAJOR_AXIS = 6378137
const GRS80_FLATTENING = 1 / 298.257222101
const GRS80_E = Math.sqrt(GRS80_FLATTENING * (2 - GRS80_FLATTENING))
const L93_LAT0 = 46.5 * RAD
const L93_LON0 = 3 * RAD
const L93_LAT1 = 44 * RAD
const L93_LAT2 = 49 * RAD

function conicM(phi: number): number {
  const sin = Math.sin(phi)
  return Math.cos(phi) / Math.sqrt(1 - GRS80_E * GRS80_E * sin * sin)
}

function conicT(phi: number): number {
  const sin = Math.sin(phi)
  return Math.tan(Math.PI / 4 - phi / 2) / ((1 - GRS80_E * sin) / (1 + GRS80_E * sin)) ** (GRS80_E / 2)
}

const L93_N = (Math.log(conicM(L93_LAT1)) - Math.log(conicM(L93_LAT2))) / (Math.log(conicT(L93_LAT1)) - Math.log(conicT(L93_LAT2)))
const L93_F = conicM(L93_LAT1) / (L93_N * conicT(L93_LAT1) ** L93_N)
const L93_R0 = GRS80_SEMI_MAJOR_AXIS * L93_F * conicT(L93_LAT0) ** L93_N

/**
 * Lambert-93 to world metres: easting minus 700 000 to the east, northing minus 6 600 000 to the
 * north, y to the south as everywhere in the editor. The origin (46.5° N, 3° E) is at (0, 0):
 * the same point in the same place whatever the import.
 */
export function createLambert93Projection(): (lat: number, lon: number) => Point {
  return (lat, lon) => {
    const r = GRS80_SEMI_MAJOR_AXIS * L93_F * conicT(lat * RAD) ** L93_N
    const theta = L93_N * (lon * RAD - L93_LON0)
    // Easting 700 000 + r·sin θ, northing 6 600 000 + r0 − r·cos θ, the false origin taken off
    return { x: r * Math.sin(theta), y: -(L93_R0 - r * Math.cos(theta)) }
  }
}

/**
 * The projection of a frame: the one thing every reader of an import's coordinates goes through,
 * conversion and tests alike. `origin` is the centre of the local frame; it is ignored by the
 * national one, whose origin is fixed.
 */
export function projectionFor(frame: OsmFrame | undefined, origin: { lat: number; lon: number }): (lat: number, lon: number) => Point {
  return frame === 'lambert93' ? createLambert93Projection() : createProjection(origin.lat, origin.lon)
}

// ─────────────────────────────── Back from world metres to the globe ───────────────────────────────

export interface GeoPoint {
  lat: number
  lon: number
}

/**
 * The inverse of a projection, found by walking to the place whose projection is the point asked
 * for: both projections are conformal and nearly true to scale, so a miss in metres is a miss in
 * degrees along the meridian and the parallel, and each step divides the error by ten or more
 * (the turn of the grid against the north is all that is left). Exact to the forward projection
 * it is given, which a series written apart would not be.
 */
function inverseOf(forward: (lat: number, lon: number) => Point, start: GeoPoint): (p: Point) => GeoPoint {
  return (p) => {
    let lat = start.lat
    let lon = start.lon
    for (let i = 0; i < 60; i++) {
      const q = forward(lat, lon)
      const east = p.x - q.x
      const north = q.y - p.y
      if (Math.hypot(east, north) < 1e-7) break
      const phi = lat * RAD
      const sin = Math.sin(phi)
      const w = 1 - E2 * sin * sin
      const meridian = (SEMI_MAJOR_AXIS * (1 - E2)) / (w * Math.sqrt(w))
      const parallel = (SEMI_MAJOR_AXIS / Math.sqrt(w)) * Math.cos(phi)
      lat += north / meridian / RAD
      lon += east / parallel / RAD
    }
    return { lat, lon }
  }
}

/** World metres back to latitude and longitude, for the frame `projectionFor` projects in */
export function inverseProjectionFor(frame: OsmFrame | undefined, origin: GeoPoint): (p: Point) => GeoPoint {
  return inverseOf(projectionFor(frame, origin), frame === 'lambert93' ? LAMBERT93_ORIGIN : origin)
}

/** A frame as an import remembers it: where its world (0, 0) is, and in which projection */
export interface FrameOrigin extends GeoPoint {
  frame?: OsmFrame
}

/** True when two imports lie on one map already: both in Lambert-93, or local frames with one centre */
export function sameFrame(a: FrameOrigin, b: FrameOrigin): boolean {
  const la = a.frame === 'lambert93'
  const lb = b.frame === 'lambert93'
  if (la || lb) return la && lb
  return a.lat === b.lat && a.lon === b.lon
}

/**
 * Moves a point of one import onto the map of another: back to the globe through the frame it was
 * projected in, then forward through the other. Point by point, so that the turn between the two
 * grids (the convergence of the meridians) is taken along.
 */
export function reprojection(from: FrameOrigin, to: FrameOrigin): (p: Point) => Point {
  if (sameFrame(from, to)) return (p) => p
  const back = inverseProjectionFor(from.frame, from)
  const forward = projectionFor(to.frame, to)
  return (p) => {
    const geo = back(p)
    return forward(geo.lat, geo.lon)
  }
}
