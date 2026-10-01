/**
 * Units, Scales and CAD Dimensioning System for OpenRails.
 *
 * Supports Real Scale (1:1 UIC) as well as Model Railway Scales (HO, N, TT, O, Z, custom).
 * The canonical internal world coordinates are in meters.
 * For miniature scales (e.g. HO 1:87), 1 world unit = 1 model meter (100 cm / 1000 mm).
 */

export type Unit = 'm' | 'cm' | 'mm'

export type ScalePresetId = '1:1' | 'HO' | 'N' | 'TT' | 'O' | 'Z' | 'custom'

export interface ScalePreset {
  id: ScalePresetId
  name: string
  ratio: number // 1 for 1:1, 87 for HO, 160 for N, etc.
  description: string
  defaultGauge: number // in world meters (e.g. 1.435m for 1:1, 0.0165m = 16.5mm for HO)
  defaultTrackSpacing: number // entraxe standard (e.g. 3.80m for 1:1, 0.050m = 50mm for HO)
  defaultUnit: Unit
  minLength: number // min track segment length in world meters (e.g. 0.5m for 1:1, 0.020m = 20mm for HO)
}

export const SCALE_PRESETS: Record<ScalePresetId, ScalePreset> = {
  '1:1': {
    id: '1:1',
    name: 'Échelle Réelle (1:1 UIC)',
    ratio: 1,
    description: 'Réseau ferroviaire grandeur nature (SNCF / DB / UIC). Écartement standard 1435 mm.',
    defaultGauge: 1.435,
    defaultTrackSpacing: 3.80,
    defaultUnit: 'm',
    minLength: 0.5,
  },
  HO: {
    id: 'HO',
    name: 'Échelle HO (1:87)',
    ratio: 87,
    description: 'Modélisme ferroviaire le plus populaire (16.5 mm). Roco, Märklin, Jouef, Hornby.',
    defaultGauge: 0.0165, // 16.5 mm
    defaultTrackSpacing: 0.050, // 50 mm standard NEM
    defaultUnit: 'mm',
    minLength: 0.020, // 20 mm
  },
  N: {
    id: 'N',
    name: 'Échelle N (1:160)',
    ratio: 160,
    description: 'Modélisme compact (9 mm). Kato, Fleischmann, Minitrix.',
    defaultGauge: 0.009, // 9 mm
    defaultTrackSpacing: 0.028, // 28 mm standard
    defaultUnit: 'mm',
    minLength: 0.015, // 15 mm
  },
  TT: {
    id: 'TT',
    name: 'Échelle TT (1:120)',
    ratio: 120,
    description: 'Table Top intermédiaire (12 mm). Tillig.',
    defaultGauge: 0.012, // 12 mm
    defaultTrackSpacing: 0.034, // 34 mm
    defaultUnit: 'mm',
    minLength: 0.018,
  },
  O: {
    id: 'O',
    name: 'Échelle O (1:45 / 1:43.5)',
    ratio: 45,
    description: 'Grande échelle de modélisme (32 mm). Lenz, Brawa.',
    defaultGauge: 0.032, // 32 mm
    defaultTrackSpacing: 0.070, // 70 mm
    defaultUnit: 'mm',
    minLength: 0.030,
  },
  Z: {
    id: 'Z',
    name: 'Échelle Z (1:220)',
    ratio: 220,
    description: 'Micro-modélisme (6.5 mm). Märklin mini-club.',
    defaultGauge: 0.0065, // 6.5 mm
    defaultTrackSpacing: 0.020, // 20 mm
    defaultUnit: 'mm',
    minLength: 0.010,
  },
  custom: {
    id: 'custom',
    name: 'Personnalisée',
    ratio: 1,
    description: 'Gabarit et écartement configurables librement.',
    defaultGauge: 1.435,
    defaultTrackSpacing: 3.80,
    defaultUnit: 'm',
    minLength: 0.1,
  },
}

/**
 * Format a world distance (in meters) to string using the selected unit.
 */
export function formatDistance(distInMeters: number, unit: Unit, decimals?: number): string {
  if (!Number.isFinite(distInMeters)) return '—'
  switch (unit) {
    case 'mm': {
      const val = distInMeters * 1000
      const dec = decimals ?? (Math.abs(val) < 100 ? 1 : 0)
      return `${val.toFixed(dec)} mm`
    }
    case 'cm': {
      const val = distInMeters * 100
      const dec = decimals ?? (Math.abs(val) < 10 ? 2 : 1)
      return `${val.toFixed(dec)} cm`
    }
    case 'm':
    default: {
      const dec = decimals ?? 2
      return `${distInMeters.toFixed(dec)} m`
    }
  }
}

/**
 * Format a curve radius in world meters.
 */
export function formatRadius(radiusInMeters: number, unit: Unit): string {
  if (radiusInMeters === Infinity || !Number.isFinite(radiusInMeters)) return 'R ∞'
  return `R ${formatDistance(radiusInMeters, unit)}`
}

/**
 * Format an angle in degrees.
 */
export function formatAngle(angleInDegrees: number, decimals: number = 1): string {
  if (!Number.isFinite(angleInDegrees)) return '0°'
  return `${angleInDegrees.toFixed(decimals)}°`
}

/**
 * Parse a distance string or number from user input into world meters.
 */
export function parseDistance(input: string | number, unit: Unit): number {
  const num = typeof input === 'number' ? input : parseFloat(input.replace(',', '.'))
  if (isNaN(num)) return 0
  switch (unit) {
    case 'mm':
      return num / 1000
    case 'cm':
      return num / 100
    case 'm':
    default:
      return num
  }
}

/**
 * Convert world meters to the numerical value in the chosen unit.
 */
export function toUnitValue(distInMeters: number, unit: Unit): number {
  switch (unit) {
    case 'mm':
      return distInMeters * 1000
    case 'cm':
      return distInMeters * 100
    case 'm':
    default:
      return distInMeters
  }
}
