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
