// How long each paint of the canvas takes, for the frame bench (`frameBench.ts`). `Canvas.tsx`
// reports every paint under `npm run dev` only; nobody listens outside a bench run.

type PaintListener = (ms: number, endedAt: number) => void

let listeners: PaintListener[] = []

/** Called by the canvas after each paint, with its duration in ms */
export function notePaint(ms: number): void {
  if (listeners.length === 0) return
  const endedAt = performance.now()
  for (const listener of listeners) listener(ms, endedAt)
}

/** The next paint: its duration and when it ended */
export function nextPaint(): Promise<{ ms: number; endedAt: number }> {
  return new Promise((resolve) => {
    const listener: PaintListener = (ms, endedAt) => {
      listeners = listeners.filter((l) => l !== listener)
      resolve({ ms, endedAt })
    }
    listeners.push(listener)
  })
}
