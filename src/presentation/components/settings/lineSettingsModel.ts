import { LINE_PRESETS, LINE_SPEED_RANGE, type LineSettings, type LineType } from '@domain/models/speedLimits'

/**
 * The « Type de ligne » list of the settings: the real line types, plus one entry per kind of line
 * for a speed that matches none of them. Pure: the dialog only renders it, the tests read it.
 */

/** The two line settings the dialog edits */
export type LineChoiceSettings = Pick<LineSettings, 'lineSpeed' | 'lineType'>

export interface LineChoice {
  id: string
  label: string
  lineType: LineType
  /** Speed the choice sets, km/h; absent for the « other speed » entries, which keep the typed one */
  lineSpeed?: number
}

const CUSTOM_CHOICES: readonly LineChoice[] = [
  { id: 'custom-classic', label: 'Ligne classique (autre vitesse)', lineType: 'classic' },
  { id: 'custom-highSpeed', label: 'LGV (autre vitesse)', lineType: 'highSpeed' },
]

export const LINE_CHOICES: readonly LineChoice[] = [...LINE_PRESETS, ...CUSTOM_CHOICES]

/** The entry of the list that stands for these settings: the preset they match, else « other speed » */
export function lineChoiceId(settings: LineChoiceSettings): string {
  const preset = LINE_PRESETS.find((p) => p.lineType === settings.lineType && p.lineSpeed === settings.lineSpeed)
  return preset?.id ?? `custom-${settings.lineType}`
}

/** The settings after picking an entry: a preset sets the speed too, « other speed » keeps it */
export function applyLineChoice(id: string, current: LineChoiceSettings): LineChoiceSettings {
  const choice = LINE_CHOICES.find((c) => c.id === id)
  if (!choice) return current
  return { lineType: choice.lineType, lineSpeed: choice.lineSpeed ?? current.lineSpeed }
}

/** A typed line speed as a number of km/h, or null when it is not one the line can carry */
export function parseLineSpeed(text: string): number | null {
  const value = Math.round(parseFloat(text.replace(',', '.')))
  return Number.isFinite(value) && value >= LINE_SPEED_RANGE.min && value <= LINE_SPEED_RANGE.max ? value : null
}
