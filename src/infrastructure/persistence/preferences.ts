import { getStorage } from './persistence'

/** User keyboard preferences: kept apart from the project so they follow the user across layouts */
export const KEY_PREFERENCES_KEY = 'open-rail:keybindings'

export interface KeyPreferences {
  /** Saved bindings, validated by the caller */
  bindings: unknown
  /** Key position → character produced on the user's keyboard layout */
  labels: Record<string, string>
}

export function loadKeyPreferences(): KeyPreferences | null {
  try {
    const raw = getStorage()?.getItem(KEY_PREFERENCES_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const labels: Record<string, string> = {}
    if (data.labels && typeof data.labels === 'object') {
      for (const [code, label] of Object.entries(data.labels)) {
        if (typeof label === 'string') labels[code] = label
      }
    }
    return { bindings: data.bindings, labels }
  } catch {
    return null
  }
}

export function saveKeyPreferences(prefs: KeyPreferences): void {
  try {
    getStorage()?.setItem(KEY_PREFERENCES_KEY, JSON.stringify(prefs))
  } catch {
    // Storage full or denied: the bindings still apply for this session
  }
}
