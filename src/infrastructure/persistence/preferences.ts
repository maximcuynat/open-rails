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

/** Which driving console the user asked for; a display preference, kept apart from the project too */
export const CONSOLE_PREFERENCE_KEY = 'open-rail:console'

/** The saved value as it was written: the caller validates it */
export function loadConsolePreference(): string | null {
  try {
    return getStorage()?.getItem(CONSOLE_PREFERENCE_KEY) ?? null
  } catch {
    return null
  }
}

export function saveConsolePreference(preference: string): void {
  try {
    getStorage()?.setItem(CONSOLE_PREFERENCE_KEY, preference)
  } catch {
    // Storage full or denied: the choice still applies for this session
  }
}

/** Address of the PC on the local network, as the user typed it for the phone desk; kept apart from the project too */
export const REMOTE_HOST_PREFERENCE_KEY = 'open-rail:remote-host'

export function loadRemoteHostPreference(): string {
  try {
    return getStorage()?.getItem(REMOTE_HOST_PREFERENCE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveRemoteHostPreference(host: string): void {
  try {
    getStorage()?.setItem(REMOTE_HOST_PREFERENCE_KEY, host)
  } catch {
    // Storage full or denied: the address still applies for this session
  }
}

/** How fast the simulated time runs against the real one (×1, ×2…); the host's choice, kept apart from the project */
export const TIME_FACTOR_PREFERENCE_KEY = 'open-rail:time-factor'

/** The saved value as it was written: the caller validates it */
export function loadTimeFactorPreference(): string | null {
  try {
    return getStorage()?.getItem(TIME_FACTOR_PREFERENCE_KEY) ?? null
  } catch {
    return null
  }
}

export function saveTimeFactorPreference(factor: number): void {
  try {
    getStorage()?.setItem(TIME_FACTOR_PREFERENCE_KEY, String(factor))
  } catch {
    // Storage full or denied: the choice still applies for this session
  }
}
