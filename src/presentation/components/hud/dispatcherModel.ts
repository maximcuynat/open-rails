import type { FleetEntry } from '@application/console/consoleContract'
import type { PointsAhead } from '@application/console/dispatcher'

// The rows of the dispatcher's board, worked out from the fleet and from what the store reads on
// the track: pure, so that the panel only renders them and the tests read them directly.

/** Below this speed (m/s) a train reads as stopped */
const MOVING_FROM = 0.1

export interface DispatcherTrainRow {
  id: string
  /** « T1 · TGV Duplex » */
  title: string
  /** « 2M · 8V » */
  consist: string
  /** « 132 km/h », « À l’arrêt » */
  speed: string
  /** « PC », the name of a desk, « Libre » */
  driver: string
  /** `host`: driven from this screen; `desk`: from a phone; `free`: nobody */
  held: 'host' | 'desk' | 'free'
  /** The camera follows this train */
  followed: boolean
}

/** Every train of the layout with who drives it; no row is followed in free view */
export function dispatcherTrainRows(fleet: readonly FleetEntry[], followedId: string | null, freeView: boolean): DispatcherTrainRow[] {
  return fleet.map((train) => {
    const kmh = Math.round(Math.abs(train.speed) * 3.6)
    const held = train.driver === 'host' ? 'host' : typeof train.driver === 'number' ? 'desk' : 'free'
    return {
      id: train.id,
      title: `T${train.rank} · ${train.model}`,
      consist: `${train.locoCount}M · ${train.wagonCount}V`,
      speed: Math.abs(train.speed) >= MOVING_FROM ? `${kmh} km/h` : 'À l’arrêt',
      driver: held === 'free' ? 'Libre' : train.driverName ?? (held === 'host' ? 'PC' : `Pupitre ${train.driver}`),
      held,
      followed: !freeView && train.id === followedId,
    }
  })
}

export interface DispatcherPointsRow {
  junctionId: string
  /** « T1 · 850 m » */
  title: string
  /** « Directe », « Déviée », « Gauche », « Droite », « Traversée » */
  position: string
  /** « Occupé », « Réservé », '' */
  lock: string
  canThrow: boolean
  x: number
  y: number
}

const BRANCH_LABELS: Record<string, string> = { straight: 'Directe', diverging: 'Déviée', left: 'Gauche', right: 'Droite' }

const distanceLabel = (metres: number): string =>
  metres >= 1000 ? `${(metres / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : `${Math.round(metres / 10) * 10} m`

/** The points ahead of the driven trains, nearest first; a set of points two trains run towards is listed once, for the nearer */
export function dispatcherPointsRows(points: readonly PointsAhead[], limit = 8): DispatcherPointsRow[] {
  const nearest = new Map<string, PointsAhead>()
  for (const p of points) {
    const known = nearest.get(p.junctionId)
    if (!known || p.distance < known.distance) nearest.set(p.junctionId, p)
  }
  return [...nearest.values()]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((p) => ({
      junctionId: p.junctionId,
      title: `T${p.trainRank} · ${distanceLabel(p.distance)}`,
      position: p.branch === null ? 'Traversée' : BRANCH_LABELS[p.branch] ?? p.branch,
      lock: p.lock === 'occupied' ? 'Occupé' : p.lock === 'reserved' ? 'Réservé' : '',
      canThrow: p.lock === null,
      x: p.x,
      y: p.y,
    }))
}
