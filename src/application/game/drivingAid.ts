// How much the game helps the driver along the itinerary of the train:
//  · `full`  — the way is drawn on the track and the points ahead are set for it;
//  · `guide` — the way is drawn, the driver sets the points and is told when they lead off it;
//  · `none`  — nothing: the itinerary panel alone says where the train is going.

export type DrivingAid = 'full' | 'guide' | 'none'

export const DRIVING_AIDS = ['full', 'guide', 'none'] as const satisfies readonly DrivingAid[]

export function isDrivingAid(value: unknown): value is DrivingAid {
  return (DRIVING_AIDS as readonly unknown[]).includes(value)
}

export const DRIVING_AID_LABELS: Record<DrivingAid, { name: string; detail: string }> = {
  full: { name: 'Complète', detail: 'Chemin tracé, aiguilles orientées automatiquement' },
  guide: { name: 'Guidage', detail: 'Chemin tracé, aiguilles à la main' },
  none: { name: 'Aucune', detail: 'Ni tracé ni aiguilles' },
}

/** Shortest distance (m) ahead of a train within which the points are set for it or watched */
export const AID_MIN_REACH = 2000
/** That distance grows with the speed: this many seconds of running */
export const AID_REACH_SECONDS = 45

/** How far ahead of a train running at `speed` (m/s) the points are looked at */
export function aidReach(speed: number): number {
  return Math.max(AID_MIN_REACH, Math.abs(speed) * AID_REACH_SECONDS)
}
