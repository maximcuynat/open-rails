import type { FleetEntry } from '@application/console/consoleContract'

/** What a train is doing, as the spectator list tells it */
export type SpectatorStatus = 'driven' | 'moving' | 'stopped'

export const SPECTATOR_STATUS_LABELS: Record<SpectatorStatus, string> = {
  driven: 'Piloté',
  moving: 'En marche',
  stopped: 'À l’arrêt',
}

/** Below this speed (m/s) a train reads as stopped */
const MOVING_FROM = 0.1

export interface SpectatorRow {
  id: string
  /** « T1 · TGV Duplex » */
  title: string
  /** « 2M · 8V » */
  consist: string
  /** « 132 km/h » */
  speed: string
  status: SpectatorStatus
  /** The camera follows this train */
  followed: boolean
}

/**
 * The rows of the spectator list: every train of the layout, the one the phone drives marked as
 * such. `followedId` is the train the camera follows — the driven one when it is null — and no row
 * is followed in free view.
 */
export function spectatorRows(fleet: readonly FleetEntry[], followedId: string | null, freeView: boolean): SpectatorRow[] {
  const cameraId = followedId !== null && fleet.some((t) => t.id === followedId)
    ? followedId
    : fleet.find((t) => t.driven)?.id ?? null
  return fleet.map((train) => ({
    id: train.id,
    title: `T${train.rank} · ${train.model}`,
    consist: `${train.locoCount}M · ${train.wagonCount}V`,
    speed: `${Math.round(Math.abs(train.speed) * 3.6)} km/h`,
    status: train.driven ? 'driven' : Math.abs(train.speed) >= MOVING_FROM ? 'moving' : 'stopped',
    followed: !freeView && train.id === cameraId,
  }))
}
