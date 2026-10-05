import { MAX_ZONE_SPEED, SPEED_ZONE_NO_PATH, SPEED_ZONE_OFF_TRACK, SPEED_ZONE_OVERLAP, type EditorStore } from '@application/state/editorStore'
import { MIN_ZONE_SPEED, SPEED_ZONE_STEP } from '@domain/models/speedZones'
import type { TrackPoint } from '@domain/services/trackPath'
import { showToast } from './Toast'

/**
 * The speed zone actions of the signalling mode as the interface runs them: the store call plus
 * the message it owes the user (refusal, overlap warning). Shared by the canvas, the contextual
 * bar and the inspector, so the three say the same thing.
 */

/** « 90 km/h » */
export function zoneSpeedLabel(speed: number): string {
  return `${speed} km/h`
}

/** The zones of each store the overlap warning has been given for, while they still overlap */
const overlapWarned = new WeakMap<EditorStore, Set<string>>()

/**
 * Warn when the zone shares track with another one — once per zone for as long as it does: each
 * step of the speed counter of an overlapping zone does not say it again. The warning is owed
 * again once the zone has stopped overlapping and overlaps anew.
 */
function warnIfOverlapping(store: EditorStore, zoneId: string): void {
  let warned = overlapWarned.get(store)
  if (!warned) overlapWarned.set(store, (warned = new Set()))
  if (!store.speedZoneOverlapsAnother(zoneId)) {
    warned.delete(zoneId)
    return
  }
  if (warned.has(zoneId)) return
  warned.add(zoneId)
  showToast(SPEED_ZONE_OVERLAP, 'warning', 4500)
}

/** One click of the speed limit tool on a place of the track (null: off the track). */
export function clickSpeedZoneTool(store: EditorStore, point: TrackPoint | null): void {
  const result = store.clickSpeedZoneTool(point)
  if (result === 'off-track') showToast(SPEED_ZONE_OFF_TRACK, 'warning')
  else if (result === 'no-path') showToast(SPEED_ZONE_NO_PATH, 'warning')
  else if (result === 'placed' && store.selectedSpeedZoneId) warnIfOverlapping(store, store.selectedSpeedZoneId)
}

/** Give a zone another speed. */
export function changeZoneSpeed(store: EditorStore, zoneId: string, speed: number): void {
  if (store.setSpeedZoneSpeed(zoneId, speed)) warnIfOverlapping(store, zoneId)
}

/** Every speed a zone can take: the multiples of 10 km/h from the lowest to the highest, for a pick list */
export function zoneSpeedChoices(): number[] {
  const speeds: number[] = []
  for (let speed = MIN_ZONE_SPEED; speed <= MAX_ZONE_SPEED; speed += SPEED_ZONE_STEP) speeds.push(speed)
  return speeds
}

export const canLowerZoneSpeed = (speed: number): boolean => speed - SPEED_ZONE_STEP >= MIN_ZONE_SPEED
export const canRaiseZoneSpeed = (speed: number): boolean => speed + SPEED_ZONE_STEP <= MAX_ZONE_SPEED
