/** The three driving consoles: a band along the bottom, an on-board screen in the corner, two levers */
export type ConsoleLayout = 'band' | 'screen' | 'levers'

/** What the user asks for in Affichage → Console de conduite; `auto` picks from the window size */
export type ConsolePreference = 'auto' | ConsoleLayout

export const CONSOLE_PREFERENCES = ['auto', 'band', 'screen', 'levers'] as const satisfies readonly ConsolePreference[]

export function isConsolePreference(value: unknown): value is ConsolePreference {
  return (CONSOLE_PREFERENCES as readonly unknown[]).includes(value)
}
