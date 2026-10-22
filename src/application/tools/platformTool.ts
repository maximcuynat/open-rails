import type { EditorStore } from '@application/state/editorStore'
import type { Network, Point } from '@domain/models/types'
import { networkCheckToken } from '@domain/models/networkWatch'
import { platformDimensions, type PlatformDimensions } from '@domain/models/platforms'
import { formatDistance, type Unit } from '@domain/models/units'
import {
  aimPlatformStart,
  layPlatforms,
  planPlatform,
  rakesFitting,
  type IslandCheck,
  type LaidPlatforms,
  type PlatformAim,
  type PlatformPlan,
  type PlatformSnapKind,
} from '@domain/services/platformLayout'
import type { PlatformPreviewDrawing } from '@infrastructure/render/platformPreviewRender'

// ─────────────────── Platform tool (`platform`) ───────────────────
//
// Two clicks along a track: the start, then the end. Between the two the plan follows the cursor
// (`resolvePlatformTool`), read by the preview on the canvas and by the contextual bar. The store
// only keeps the start (`platformStart`) and the « both sides » setting; the rest is worked out here.

/** Reach of the cursor around the track for the first click, pixels */
const START_REACH_PX = 20
/** Distance within which an end is caught by what is near it, pixels */
const SNAP_PX = 12

export const PLATFORM_OFF_TRACK = 'Quai : cliquez sur une voie pour commencer'

/** The sizes of a platform at the scale of the layout */
export function platformToolDims(store: EditorStore): PlatformDimensions {
  return platformDimensions(store.gauge)
}

const snapDistance = (store: EditorStore): number => SNAP_PX / store.camera.scale

/** The tool may lay a platform: in hand, outside play mode, on a track that may be edited */
export function isPlatformToolActive(store: EditorStore): boolean {
  return store.tool === 'platform' && store.canEditNetwork
}

/** What the platform tool shows: before the first click the start under the cursor, after it the plan */
export type PlatformToolPreview =
  | { phase: 'start'; aim: PlatformAim | null }
  | { phase: 'end'; plan: PlatformPlan | null }

let last: { net: Network; key: string; preview: PlatformToolPreview } | null = null

/**
 * What the tool would do with the cursor where it is. Kept while nothing it reads changes: the
 * canvas and the bar both ask at every pointer move.
 */
export function resolvePlatformTool(store: EditorStore, cursor: Point = store.cursorWorld): PlatformToolPreview | null {
  if (!isPlatformToolActive(store)) return null
  const start = store.platformStart
  const both = store.platformBothSidesActive
  const token = networkCheckToken(store.network)
  const key = [
    token, store.camera.scale, store.gauge, cursor.x, cursor.y,
    start ? `${start.segId}:${start.t}` : '-', both,
  ].join('|')
  if (token !== undefined && last && last.net === store.network && last.key === key) return last.preview
  const dims = platformToolDims(store)
  const preview: PlatformToolPreview = start
    ? { phase: 'end', plan: planPlatform(store.network, { start, cursor, dims, snapDistance: snapDistance(store), bothSides: both, gauge: store.gauge }) }
    : { phase: 'start', aim: aimPlatformStart(store.network, cursor, Math.max(START_REACH_PX / store.camera.scale, dims.edgeOffset + dims.width), dims, snapDistance(store)) }
  last = { net: store.network, key, preview }
  return preview
}

export type PlatformClick = 'refused' | 'off-track' | 'started' | 'invalid' | 'placed'

/**
 * One click of the platform tool at `world`. The first sets the start on the track; the second
 * lays what the plan says (and the station it needs) as one undo step. A click the plan refuses
 * keeps the start, so the next one can still close the platform.
 */
export function clickPlatformTool(store: EditorStore, world: Point): { result: PlatformClick; laid?: LaidPlatforms } {
  if (!isPlatformToolActive(store)) return { result: 'refused' }
  const preview = resolvePlatformTool(store, world)
  if (!preview) return { result: 'refused' }
  if (preview.phase === 'start') {
    if (!preview.aim) return { result: 'off-track' }
    store.platformStart = { segId: preview.aim.segId, t: preview.aim.t }
    store.notify()
    return { result: 'started' }
  }
  if (!preview.plan) {
    // The start went with its rail
    store.platformStart = null
    store.notify()
    return { result: 'refused' }
  }
  const laid = layPlatforms(store.network, preview.plan, store.gauge)
  if (!laid) return { result: 'invalid' }
  store.platformStart = null
  store.markDirty()
  return { result: 'placed', laid }
}

// ─────────────────── Wording ───────────────────

const SNAP_LABEL: Record<PlatformSnapKind, string> = {
  'platform-end': 'bout du quai voisin',
  'platform-across': 'aligné sur le quai d’en face',
  turnout: 'aiguille',
  'rail-end': 'bout de voie',
}

/** « Gare 2 créée » or « Quai rattaché à Gare 1 »: which station the platforms went to */
export function stationLaidText(laid: LaidPlatforms): string {
  if (laid.newStation) return `${laid.station.name} créée`
  return `${laid.platforms.length > 1 ? 'Quais rattachés' : 'Quai rattaché'} à ${laid.station.name}`
}

/** « aiguille », « aligné sur le quai d’en face »…: what an end was caught by */
export function platformSnapLabel(aim: PlatformAim | null): string | null {
  return aim?.snap ? SNAP_LABEL[aim.snap.kind] : null
}

/** « Voies trop proches pour un quai central (3.80 m, il faut 6.40 m) » */
export function islandRefusalText(island: IslandCheck, unit: Unit): string {
  return `Voies trop proches pour un quai central (${formatDistance(island.spacing, unit)}, il faut ${formatDistance(island.minSpacing, unit)})`
}

/** « TER Régiolis ✓ UM ✗ · TGV Duplex ✓ UM ✗ »: the rakes a platform that long holds */
export function rakeFitText(length: number, gauge?: number): string {
  return rakesFitting(length, gauge)
    .map((fit) => `${fit.label} ${fit.single ? '✓' : '✗'} UM ${fit.double ? '✓' : '✗'}`)
    .join(' · ')
}

/** What the plan lays, in a few words */
export function platformKindLabel(plan: PlatformPlan): string {
  if (plan.kind === 'island') return 'Quai central'
  if (plan.kind === 'both') return 'Deux quais encadrant la voie'
  return plan.side === 'left' ? 'Quai à gauche' : 'Quai à droite'
}

/** Why the click would lay nothing, or null */
export function platformRefusalText(plan: PlatformPlan, store: EditorStore): string | null {
  if (plan.refusal === 'no-path') return 'Aucune voie continue jusqu’ici'
  if (plan.refusal === 'too-short') return `Quai trop court (${formatDistance(plan.length, store.unit)})`
  return null
}

// ─────────────────── Preview ───────────────────

/** What the canvas draws for the tool, or null when there is nothing to draw */
export function platformPreviewDrawing(store: EditorStore): PlatformPreviewDrawing | null {
  const preview = resolvePlatformTool(store)
  if (!preview) return null
  const dims = platformToolDims(store)
  const base = { dims, labelAt: store.cursorWorld }
  if (preview.phase === 'start') {
    if (!preview.aim) return null
    return {
      ...base, start: preview.aim.at, startSnapped: preview.aim.snap !== null, end: null, endSnap: null,
      track: null, platforms: [], refused: false, label: platformSnapLabel(preview.aim),
    }
  }
  const plan = preview.plan
  if (!plan) return null
  const refusal = platformRefusalText(plan, store)
  const path = plan.platforms[0]?.[0]?.track ?? null
  return {
    ...base,
    start: plan.start.at,
    startSnapped: false,
    end: plan.end.at,
    endSnap: plan.end.snap,
    track: path,
    platforms: plan.platforms,
    refused: refusal !== null,
    label: refusal ?? `${platformKindLabel(plan)} · ${formatDistance(plan.length, store.unit)}`,
  }
}
