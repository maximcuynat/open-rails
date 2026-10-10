import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConsoleCommand, ConsoleState } from '@application/console/consoleContract'
import { createRemoteDesk, type RemoteDesk, type RemoteDeskSnapshot } from '@application/remote/remoteDesk'
import type { RemoteLink } from '@application/remote/remoteLink'
import { createDeskLink } from '@infrastructure/remote/remoteLinks'
import { RtcDeskLink, type RtcTrouble } from '@infrastructure/remote/rtcDeskLink'
import { NEW_SESSION, extrapolateAhead, nextSession, type DeskSession } from './deskView'

const IDLE_SNAPSHOT: RemoteDeskSnapshot = {
  link: 'connecting',
  joined: false,
  desk: null,
  fleet: [],
  state: null,
  ack: 0,
  ended: null,
}

interface LiveDesk {
  snapshot: RemoteDeskSnapshot
  session: DeskSession
}

const IDLE: LiveDesk = { snapshot: IDLE_SNAPSHOT, session: NEW_SESSION }

/**
 * The distance to the train ahead as it is now: what the PC last said, carried forward at the
 * speeds it gave until the next state comes. Null when the PC names no train ahead.
 */
export function useAheadDistance(state: ConsoleState | null): number | null {
  const ahead = state?.ahead ?? null
  const received = useRef({ state, at: 0 })
  const [, redraw] = useState(0)
  if (received.current.state !== state) received.current = { state, at: performance.now() }
  useEffect(() => {
    if (!ahead) return
    // The PC speaks ten times a second: twice that keeps the figure moving through a lost state
    const timer = window.setInterval(() => redraw((n) => n + 1), 50)
    return () => window.clearInterval(timer)
  }, [ahead !== null])
  if (!ahead || !state) return null
  return extrapolateAhead(ahead, state.speed, (performance.now() - received.current.at) / 1000)
}

/**
 * The link to the PC for a room code. A new code, or a new `attempt` with the same code, drops
 * the link and opens another; nothing else does, so turning the phone keeps it.
 */
export function useRemoteDesk(room: string | null, attempt: number, name?: string | null) {
  const [live, setLive] = useState<LiveDesk>(IDLE)
  const deskRef = useRef<RemoteDesk | null>(null)
  const linkRef = useRef<RemoteLink | null>(null)

  useEffect(() => {
    setLive(IDLE)
    if (room === null) return
    // The name is read when the link opens: changing it takes a new attempt
    const link = createDeskLink(room)
    linkRef.current = link
    const desk = createRemoteDesk({ link, room, name: name ?? undefined })
    deskRef.current = desk
    const sync = () => {
      const snapshot = desk.getSnapshot()
      setLive((previous) => ({ snapshot, session: nextSession(previous.session, snapshot) }))
    }
    sync()
    const unsubscribe = desk.subscribe(sync)
    // A page that is closed says so: the PC rests the train now, not when it notices the silence
    const leave = () => desk.stop()
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      unsubscribe()
      desk.stop()
      if (deskRef.current === desk) deskRef.current = null
    }
  }, [room, attempt])

  // A direct link that keeps failing changes what it says is wrong without changing status: look again now and then
  const waiting = room !== null && !live.snapshot.joined && live.snapshot.ended === null
  const [, look] = useState(0)
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => look((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [waiting])

  const send = useCallback((command: ConsoleCommand): number => deskRef.current?.send(command) ?? 0, [])
  // Why a direct link stays down, as far as it can tell; read at each render, which the retries cause
  const link = linkRef.current
  const trouble: RtcTrouble = link instanceof RtcDeskLink ? link.trouble : null
  return { snapshot: live.snapshot, session: live.session, send, trouble }
}

/** Size of the window, followed through rotations */
export function useViewportSize(): { width: number; height: number } {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight })
  const [size, setSize] = useState(read)
  useEffect(() => {
    const update = () => {
      const next = read()
      setSize((previous) => (previous.width === next.width && previous.height === next.height ? previous : next))
    }
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return size
}

/**
 * Asks the browser to keep the screen on while `wanted`. The API only exists on a secure page and
 * may refuse (battery saver): the result says whether the lock is really held.
 */
export function useWakeLock(wanted: boolean): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!wanted || !('wakeLock' in navigator)) return
    let cancelled = false
    let sentinel: WakeLockSentinel | null = null
    const onRelease = () => setHeld(false)
    const request = async () => {
      if (document.visibilityState !== 'visible' || sentinel) return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void lock.release().catch(() => {})
          return
        }
        sentinel = lock
        setHeld(true)
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null
          onRelease()
        })
      } catch {
        // Refused: the screen will dim as usual
      }
    }
    // The browser drops the lock whenever the page is hidden
    const onVisibility = () => void request()
    document.addEventListener('visibilitychange', onVisibility)
    void request()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
      sentinel = null
      setHeld(false)
    }
  }, [wanted])
  return held
}

/**
 * While mounted, the page behaves like an application: no pinch or double-tap zoom, no
 * pull-to-refresh. The viewport is put back as it was on the way out.
 */
export function useAppViewport(): void {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    const previous = meta?.content
    if (meta) meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    // iOS ignores `user-scalable=no`: refuse its pinch gesture
    const refuse = (event: Event) => event.preventDefault()
    document.addEventListener('gesturestart', refuse)
    document.documentElement.classList.add('phone-desk-page')
    return () => {
      if (meta && previous !== undefined) meta.content = previous
      document.removeEventListener('gesturestart', refuse)
      document.documentElement.classList.remove('phone-desk-page')
    }
  }, [])
}

/** Vibrates when the device can; a desktop browser and iOS simply do nothing */
export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Not allowed here
  }
}
