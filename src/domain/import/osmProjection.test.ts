import { describe, it, expect } from 'vitest'
import { createProjection } from './osmProjection'

/** Length of the geodesic between two places on the WGS 84 ellipsoid (Vincenty's inverse formula), in metres */
function geodesic(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = 6378137
  const f = 1 / 298.257223563
  const b = a * (1 - f)
  const rad = Math.PI / 180
  const u1 = Math.atan((1 - f) * Math.tan(lat1 * rad))
  const u2 = Math.atan((1 - f) * Math.tan(lat2 * rad))
  const l = (lon2 - lon1) * rad
  let lambda = l
  let sinSigma = 0
  let cosSigma = 0
  let sigma = 0
  let cosSqAlpha = 0
  let cos2SigmaM = 0
  for (let i = 0; i < 100; i++) {
    const sinLambda = Math.sin(lambda)
    const cosLambda = Math.cos(lambda)
    sinSigma = Math.hypot(Math.cos(u2) * sinLambda, Math.cos(u1) * Math.sin(u2) - Math.sin(u1) * Math.cos(u2) * cosLambda)
    if (sinSigma === 0) return 0
    cosSigma = Math.sin(u1) * Math.sin(u2) + Math.cos(u1) * Math.cos(u2) * cosLambda
    sigma = Math.atan2(sinSigma, cosSigma)
    const sinAlpha = (Math.cos(u1) * Math.cos(u2) * sinLambda) / sinSigma
    cosSqAlpha = 1 - sinAlpha * sinAlpha
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * Math.sin(u1) * Math.sin(u2)) / cosSqAlpha
    const c = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha))
    const next = l + (1 - c) * f * sinAlpha * (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)))
    const done = Math.abs(next - lambda) < 1e-13
    lambda = next
    if (done) break
  }
  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b)
  const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
  const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
  const deltaSigma =
    bigB * sinSigma * (cos2SigmaM + (bigB / 4) * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) - (bigB / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)))
  return b * bigA * (sigma - deltaSigma)
}

describe('local projection of an imported area', () => {
  const centre = { lat: 47, lon: 5 }
  const project = createProjection(centre.lat, centre.lon)
  /** Degrees of latitude and of longitude for about a kilometre at the centre */
  const kmLat = 1 / 111.17
  const kmLon = 1 / (111.32 * Math.cos((centre.lat * Math.PI) / 180))

  it('puts the centre at the origin, east to the right and south downwards', () => {
    const origin = project(centre.lat, centre.lon)
    expect(origin.x).toBeCloseTo(0, 9)
    expect(origin.y).toBeCloseTo(0, 9)
    expect(project(centre.lat, centre.lon + kmLon).x).toBeGreaterThan(990)
    expect(project(centre.lat + kmLat, centre.lon).y).toBeLessThan(-990)
    expect(Math.abs(project(centre.lat + kmLat, centre.lon).x)).toBeLessThan(1e-6)
  })

  it('keeps a kilometre of track within 1 cm of its length, up to 25 km from the centre', () => {
    let worst = 0
    for (let east = -25; east <= 25; east += 5) {
      for (let north = -25; north <= 25; north += 5) {
        const lat = centre.lat + north * kmLat
        const lon = centre.lon + east * kmLon
        const here = project(lat, lon)
        // A kilometre to the north, to the east and across
        for (const [dLat, dLon] of [[kmLat, 0], [0, kmLon], [kmLat * 0.7, kmLon * 0.7]]) {
          const there = project(lat + dLat, lon + dLon)
          const error = Math.abs(Math.hypot(there.x - here.x, there.y - here.y) - geodesic(lat, lon, lat + dLat, lon + dLon))
          worst = Math.max(worst, error)
        }
      }
    }
    expect(worst).toBeLessThan(0.01)
  })

  it('is within 10 cm of the true distance to the centre 25 km away, and 60 cm at 50 km', () => {
    for (const [km, limit] of [[5, 0.01], [10, 0.02], [25, 0.1], [50, 0.6]]) {
      let worst = 0
      for (let bearing = 0; bearing < 360; bearing += 15) {
        const lat = centre.lat + km * kmLat * Math.cos((bearing * Math.PI) / 180)
        const lon = centre.lon + km * kmLon * Math.sin((bearing * Math.PI) / 180)
        const p = project(lat, lon)
        worst = Math.max(worst, Math.abs(Math.hypot(p.x, p.y) - geodesic(centre.lat, centre.lon, lat, lon)))
      }
      expect(worst, `${km} km`).toBeLessThan(limit)
    }
  })

  it('keeps the angles: a right angle of the ground is a right angle of the plan', () => {
    const lat = centre.lat + 20 * kmLat
    const lon = centre.lon + 20 * kmLon
    const here = project(lat, lon)
    const north = project(lat + kmLat / 10, lon)
    const east = project(lat, lon + kmLon / 10)
    const angle = Math.atan2(north.y - here.y, north.x - here.x) - Math.atan2(east.y - here.y, east.x - here.x)
    expect(Math.abs(Math.abs(angle) - Math.PI / 2)).toBeLessThan(1e-5)
  })
})
