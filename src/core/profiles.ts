/** Kato Unitrack HO standard curve radii in model mm.
 *  Ordered from tightest to widest.
 *  All Kato curves are 22.5° segments (except 2-290 at 10°).
 *  4 pieces = quarter circle, 16 pieces = full circle. */
export const CURVE_RADII: number[] = [
  430,  // 2-260
  490,  // 2-270
  550,  // 2-210
  610,  // 2-220
  670,  // 2-230
  730,  // 2-240
  790,  // 2-250
  867,  // 2-290 (10° segments)
  Infinity, // straight
]

/** Standard Kato Unitrack HO straight lengths in mm. */
export const STRAIGHT_LENGTHS: number[] = [
  60,   // 2-105
  94,   // 2-111
  109,  // 2-170 (with buffer)
  114,  // 2-120
  123,  // 2-140
  149,  // 2-193
  174,  // 2-130
  227,  // 2-160
  246,  // 2-150 / 2-151 (feeder)
  369,  // 2-180
]

/** Standard curve segment angles in degrees. */
export const CURVE_ANGLES: number[] = [22.5, 10]

/** Map radius to its standard angle (867mm uses 10°, all others 22.5°). */
export function radiusToAngle(radius: number): number {
  return radius === 867 ? 10 : 22.5
}

/** Snap a raw length to the closest standard straight piece. */
export function snapStraightLength(rawLength: number): number {
  let best = STRAIGHT_LENGTHS[0]
  let bestDiff = Math.abs(rawLength - best)
  for (const len of STRAIGHT_LENGTHS) {
    const diff = Math.abs(rawLength - len)
    if (diff < bestDiff) {
      bestDiff = diff
      best = len
    }
  }
  return best
}

/** Compute the end point of a standard curve piece.
 *  Given a start point, incoming tangent direction, radius, and side (left/right),
 *  the curve turns by the standard angle for that radius.
 *  Returns the end point and the via control point for the Bezier. */
export function computeCurvePiece(
  start: { x: number; y: number },
  tangent: { x: number; y: number },
  radius: number,
  side: 1 | -1,
  customAngle?: number,
): { end: { x: number; y: number }; via: { x: number; y: number }; angle: number } {
  const angle = customAngle !== undefined ? customAngle : radiusToAngle(radius)
  const angleRad = (angle * Math.PI) / 180

  // The chord length for an arc of radius R and angle θ: C = 2R sin(θ/2)
  const halfAngle = angleRad / 2
  const chord = 2 * radius * Math.sin(halfAngle)

  // Direction from start to end: tangent rotated by ±θ/2
  const cosH = Math.cos(halfAngle * side)
  const sinH = Math.sin(halfAngle * side)
  const chordDir = {
    x: tangent.x * cosH - tangent.y * sinH,
    y: tangent.x * sinH + tangent.y * cosH,
  }

  const end = {
    x: start.x + chordDir.x * chord,
    y: start.y + chordDir.y * chord,
  }

  // The quadratic Bézier control point P1 is at the intersection of start and end tangents,
  // at distance R * tan(θ/2) along the start tangent. This guarantees exact G1 tangency at both ends.
  const tDist = radius * Math.tan(halfAngle)
  const via = {
    x: start.x + tangent.x * tDist,
    y: start.y + tangent.y * tDist,
  }

  return { end, via, angle }
}

/** Compute a freeform tangential circular arc from start along tangent to target endpoint.
 *  Returns the computed radius, deflection angle, and quadratic Bézier via point. */
export function computeFreeformCurve(
  start: { x: number; y: number },
  tangent: { x: number; y: number },
  target: { x: number; y: number },
): { end: { x: number; y: number }; via: { x: number; y: number }; radius: number; angle: number } {
  const dx = target.x - start.x
  const dy = target.y - start.y
  const chordLen = Math.hypot(dx, dy)

  if (chordLen < 5) {
    return {
      end: target,
      via: { x: (start.x + target.x) / 2, y: (start.y + target.y) / 2 },
      radius: Infinity,
      angle: 0,
    }
  }

  const cdx = dx / chordLen
  const cdy = dy / chordLen

  // Dot product with tangent gives cos(alpha)
  const dot = Math.max(-1, Math.min(1, tangent.x * cdx + tangent.y * cdy))
  const rawAlpha = Math.acos(dot)
  // Clamp alpha to avoid singularity when curve deflects > 170°
  const alpha = Math.min(rawAlpha, (85 * Math.PI) / 180)

  if (alpha < 0.005) {
    return {
      end: target,
      via: { x: (start.x + target.x) / 2, y: (start.y + target.y) / 2 },
      radius: Infinity,
      angle: 0,
    }
  }

  const sinAlpha = Math.sin(alpha)
  const cosAlpha = Math.cos(alpha)
  const radius = chordLen / (2 * sinAlpha)
  const tDist = chordLen / (2 * cosAlpha)
  const via = {
    x: start.x + tangent.x * tDist,
    y: start.y + tangent.y * tDist,
  }
  const angleDeg = (alpha * 2 * 180) / Math.PI

  return { end: target, via, radius, angle: angleDeg }
}

/** Compute the end point of a standard straight piece.
 *  Given a start point, direction, and the snapped length. */
export function computeStraightPiece(
  start: { x: number; y: number },
  direction: { x: number; y: number },
  length: number,
): { x: number; y: number } {
  return {
    x: start.x + direction.x * length,
    y: start.y + direction.y * length,
  }
}

export interface CurveProfile {
  radius: number
  label: string
}

export const CURVE_PROFILES: CurveProfile[] = CURVE_RADII.map((r) => ({
  radius: r,
  label: r === Infinity ? 'Straight' : `R${r}`,
}))

/** Pick the best curve radius for a given chord length and sagitta.
 *  Sagitta = perpendicular distance from chord midpoint to curve apex.
 *  For a circular arc: R = (h² + (L/2)²) / (2h) where h = sagitta, L = chord. */
export function radiusFromSagitta(chord: number, sagitta: number): number {
  if (sagitta === 0 || chord === 0) return Infinity
  const half = chord / 2
  return (sagitta * sagitta + half * half) / (2 * sagitta)
}

/** Snap a raw radius to the closest predefined profile. */
export function snapRadius(rawRadius: number): number {
  if (!isFinite(rawRadius)) return Infinity
  const largest = CURVE_RADII[CURVE_RADII.length - 2] // last finite (2000)
  if (rawRadius > largest * 1.5) return Infinity
  let best = CURVE_RADII[0]
  let bestDiff = Math.abs(rawRadius - best)
  for (const r of CURVE_RADII) {
    if (r === Infinity) continue
    const diff = Math.abs(rawRadius - r)
    if (diff < bestDiff) {
      bestDiff = diff
      best = r
    }
  }
  return best
}

/** Compute the via control point for a quadratic Bezier that approximates
 *  a circular arc with given start, end, and radius.
 *  The via is placed at the intersection of the start and end tangents
 *  (distance (chord/2) * tan(θ/2) from chord midpoint). */
export function arcToVia(
  start: { x: number; y: number },
  end: { x: number; y: number },
  radius: number,
  side: 1 | -1,
): { x: number; y: number } {
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const chord = Math.hypot(dx, dy)
  if (chord === 0) return mid

  if (radius === Infinity) {
    // Straight: via = midpoint
    return mid
  }

  const half = chord / 2
  if (half >= radius) {
    // Chord too long for this radius — clamp to maximum offset
    return {
      x: mid.x + (-dy / chord) * half * side,
      y: mid.y + (dx / chord) * half * side,
    }
  }

  // Distance from chord midpoint to tangent intersection = half * tan(θ/2)
  // where sin(θ/2) = half / radius, cos(θ/2) = sqrt(1 - sin^2)
  const sinHalf = half / radius
  const cosHalf = Math.sqrt(Math.max(0, 1 - sinHalf * sinHalf))
  const viaOffset = cosHalf > 1e-9 ? half * (sinHalf / cosHalf) : half

  // Perpendicular to chord (normalized), offset by viaOffset * side
  const nx = -dy / chord
  const ny = dx / chord

  return {
    x: mid.x + nx * viaOffset * side,
    y: mid.y + ny * viaOffset * side,
  }
}
