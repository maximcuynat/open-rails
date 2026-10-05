// Sequential ids (`n_12`, `s_40`, `z_41`…) shared by everything the network holds. Kept apart from
// `network.ts` so that modules `network.ts` itself depends on can generate ids too.

let idCounter = 0

export function resetIdCounter(startFrom = 0): void {
  idCounter = startFrom
}

export function generateId(prefix: string): string {
  idCounter++
  return `${prefix}_${idCounter}`
}
