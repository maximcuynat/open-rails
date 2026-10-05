import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ConsoleCommand, ConsoleState, FleetEntry } from '@application/console/consoleContract'
import {
  DESK_QUERY_PARAM,
  ROOM_CODE_LENGTH,
  normalizeRoomCode,
  roomFromPageUrl,
} from '@application/remote/protocol'
import { DrivingConsole } from '@presentation/components/console/DrivingConsole'
import { ConsoleIcon } from '@presentation/components/console/instruments'
import { newSignalPassed } from '@presentation/components/console/consoleModel'
import {
  compositionLabel,
  deskDesign,
  deskOrientation,
  deskScreen,
  fitStage,
  fleetSpeedLabel,
  hapticFor,
  turnoutView,
  type DeskScreen,
  type StageDesign,
  type StageFit,
} from './deskView'
import { useAppViewport, useRemoteDesk, useViewportSize, useWakeLock, vibrate } from './deskHooks'
import { PortraitDesk } from './PortraitDesk'
import './remoteDesk.css'

/**
 * The page a phone opens with `?pupitre=CODE`: it joins the room of the PC, lists its trains, and
 * becomes the desk of the one that is driven. No editor, no canvas, no store.
 */
export default function RemoteDesk() {
  const [room, setRoom] = useState<string | null>(() => roomFromPageUrl(window.location.href))
  const [attempt, setAttempt] = useState(0)
  const { snapshot, session, send } = useRemoteDesk(room, attempt)
  // The driver asked for the list while the PC still drives a train
  const [browsing, setBrowsing] = useState(false)
  // Train touched in the list, until the PC answers with its state
  const [pending, setPending] = useState<string | null>(null)
  const viewport = useViewportSize()
  useAppViewport()

  const orientation = deskOrientation(viewport.width, viewport.height)
  const landscape = orientation === 'landscape'
  const screen = deskScreen(room, snapshot, session, browsing)
  const awake = useWakeLock(screen.kind === 'desk' || screen.kind === 'fleet')
  const online = snapshot.joined
  const driving = snapshot.state !== null
  const drivenId = snapshot.state?.trainId ?? null

  // Once the PC drives nothing there is no desk to come back to: the next train it drives shows up
  useEffect(() => {
    if (!driving) setBrowsing(false)
  }, [driving])

  useEffect(() => {
    setPending(null)
  }, [drivenId, online])

  // A closed signal passed is felt in the hand once, when it happens; the desk keeps its note up
  const announcedPassings = useRef(new Set<string>())
  const signalPassed = !!snapshot.state?.signals?.passed
  useEffect(() => {
    if (newSignalPassed(announcedPassings.current, snapshot.state)) vibrate([140, 60, 140])
    // Only when the driven train changes or the trace comes or goes: the state is new ten times a second
  }, [drivenId, signalPassed])

  const command = useCallback((next: ConsoleCommand) => {
    if (!online) return
    const haptic = hapticFor(next)
    if (haptic !== null) vibrate(haptic)
    send(next)
  }, [online, send])

  const connect = (code: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set(DESK_QUERY_PARAM, code)
    window.history.replaceState(null, '', url)
    setRoom(code)
    setAttempt((n) => n + 1)
  }

  const pick = (trainId: string) => {
    if (!online) return
    vibrate(12)
    // Coming back to the train already driven needs no answer from the PC
    if (trainId !== drivenId) setPending(trainId)
    setBrowsing(false)
    send({ type: 'selectTrain', trainId })
  }

  const release = () => {
    if (!online) return
    // The list right away; the PC confirms by sending a state without a train
    setBrowsing(true)
    send({ type: 'releaseControls' })
  }

  return (
    <div className={`phone-desk is-${orientation}`}>
      {renderScreen()}
    </div>
  )

  function renderScreen(): ReactNode {
    switch (screen.kind) {
      case 'enter-code':
        return (
          <StatusScreen
            title={screen.reason === 'missing' ? 'Pupitre sur téléphone' : 'Code inconnu ou expiré'}
            text={
              screen.reason === 'missing'
                ? 'Saisissez le code affiché sur le PC (menu Simulation, « Pupitre sur téléphone… »).'
                : `Aucun PC n’attend de pupitre sous le code ${room}. Le code change à chaque ouverture : vérifiez celui que le PC affiche.`
            }
          >
            <CodeForm initial="" onSubmit={connect} />
          </StatusScreen>
        )
      case 'connecting':
        return <StatusScreen busy title="Connexion au PC…" text={`Code ${room}`} />
      case 'ended':
        return (
          <StatusScreen title={ENDED_TEXT[screen.reason].title} text={ENDED_TEXT[screen.reason].text}>
            <button type="button" className="phone-btn is-primary" onClick={() => setAttempt((n) => n + 1)}>Réessayer</button>
            <CodeForm initial="" onSubmit={connect} />
          </StatusScreen>
        )
      case 'fleet':
        return (
          <>
            {!screen.online && <CutBanner />}
            <FleetList
              room={room ?? ''}
              fleet={snapshot.fleet}
              online={screen.online}
              pending={pending}
              awake={awake}
              onPick={pick}
            />
          </>
        )
      case 'desk':
        return (
          <>
            {!screen.online && <CutBanner />}
            <DeskBar
              state={screen.state}
              online={screen.online}
              landscape={landscape}
              onBrowse={() => setBrowsing(true)}
              onRelease={release}
              onCommand={command}
            />
            <Desk screen={screen} fleet={snapshot.fleet} landscape={landscape} onCommand={command} />
          </>
        )
    }
  }
}

const ENDED_TEXT: Record<Extract<DeskScreen, { kind: 'ended' }>['reason'], { title: string; text: string }> = {
  'room-full': {
    title: 'Pupitre déjà pris',
    text: 'Un autre téléphone est déjà relié à ce PC. Coupez-le depuis le PC, puis réessayez.',
  },
  'host-closed': {
    title: 'Session terminée',
    text: 'Le PC a coupé la liaison. Pour reprendre, rouvrez « Pupitre sur téléphone… » sur le PC : il affichera un nouveau code.',
  },
  version: {
    title: 'Versions différentes',
    text: 'Cette page et le PC n’ont pas la même version. Rechargez la page sur le téléphone et sur le PC.',
  },
  error: {
    title: 'Liaison refusée',
    text: 'Le relais a refusé la connexion. Réessayez, ou rouvrez le pupitre depuis le PC.',
  },
}

function StatusScreen({ title, text, busy, children }: {
  title: string
  text: string
  busy?: boolean
  children?: ReactNode
}) {
  return (
    <main className="phone-status" role="status">
      {busy && <span className="phone-spinner" aria-hidden="true" />}
      <h1>{title}</h1>
      <p>{text}</p>
      {children}
    </main>
  )
}

function CodeForm({ initial, onSubmit }: { initial: string; onSubmit: (code: string) => void }) {
  const [value, setValue] = useState(initial)
  const code = normalizeRoomCode(value)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (code) onSubmit(code)
  }
  return (
    <form className="phone-code" onSubmit={submit}>
      <label htmlFor="phone-code-input">Code du PC</label>
      <div className="phone-code-row">
        <input
          id="phone-code-input"
          value={value}
          onChange={(event) => setValue(event.target.value.toUpperCase())}
          maxLength={ROOM_CODE_LENGTH}
          placeholder="ABC234"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <button type="submit" className="phone-btn is-primary" disabled={!code}>Rejoindre</button>
      </div>
    </form>
  )
}

function CutBanner() {
  return (
    <div className="phone-banner" role="status">
      <span className="phone-spinner is-small" aria-hidden="true" />
      Liaison perdue — reconnexion… Les commandes sont suspendues.
    </div>
  )
}

function FleetList({ room, fleet, online, pending, awake, onPick }: {
  room: string
  fleet: readonly FleetEntry[]
  online: boolean
  pending: string | null
  awake: boolean
  onPick: (trainId: string) => void
}) {
  return (
    <main className={`phone-fleet${online ? '' : ' is-cut'}`}>
      <header className="phone-fleet-head">
        <h1>Choisir un train</h1>
        <span className="phone-room" title="Code du salon">
          <i className={online ? 'is-on' : ''} aria-hidden="true" />
          {room}
        </span>
      </header>
      {fleet.length === 0 ? (
        <div className="phone-empty">
          <h2>Aucun train sur le réseau</h2>
          <p>Posez un train sur le PC : il apparaîtra ici.</p>
        </div>
      ) : (
        <ul className="phone-trains">
          {fleet.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={`phone-train${entry.driven ? ' is-driven' : ''}${pending === entry.id ? ' is-pending' : ''}`}
                disabled={!online}
                onClick={() => onPick(entry.id)}
              >
                <span className="phone-train-rank">{entry.rank}</span>
                <span className="phone-train-text">
                  <b>{entry.model || `Train ${entry.rank}`}</b>
                  <small>{compositionLabel(entry.locoCount, entry.wagonCount)}</small>
                </span>
                <span className="phone-train-side">
                  <b>{fleetSpeedLabel(entry)}</b>
                  <small>{pending === entry.id ? 'Prise des commandes…' : entry.driven ? 'Aux commandes' : 'Conduire'}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <footer className="phone-fleet-foot">
        Toucher un train prend ses commandes sur le PC.
        {!awake && ' L’écran peut se mettre en veille : gardez-le actif.'}
      </footer>
    </main>
  )
}

// A PC of an older version does not send these two fields: read them as possibly absent
const readTurnout = (state: ConsoleState) => (state as Partial<ConsoleState>).upcomingTurnout
const readCanSwitchCab = (state: ConsoleState) => (state as Partial<ConsoleState>).canSwitchCab === true

/** The two ways out of the desk, the next turnout and the other cab */
function DeskBar({ state, online, landscape, onBrowse, onRelease, onCommand }: {
  state: ConsoleState
  online: boolean
  /** Upright, the cab change sits between the levers instead */
  landscape: boolean
  onBrowse: () => void
  onRelease: () => void
  onCommand: (command: ConsoleCommand) => void
}) {
  const turnout = turnoutView(readTurnout(state))
  const steer = (side: 'left' | 'right', label: string) => (
    <button
      type="button"
      className={`phone-btn phone-steer${turnout.side === side ? ' is-on' : ''}`}
      aria-label={`Aiguillage suivant à ${label}`}
      aria-pressed={turnout.side === side}
      disabled={!online || !turnout.enabled}
      onClick={() => onCommand({ type: 'steer', side })}
    >
      {side === 'left' && <ConsoleIcon name="steerLeft" />}
      <span>{side === 'left' ? 'Gauche' : 'Droite'}</span>
      {side === 'right' && <ConsoleIcon name="steerRight" />}
    </button>
  )
  return (
    <header className={`phone-bar${online ? '' : ' is-cut'}`}>
      <div className="phone-bar-exit">
        <button type="button" className="phone-btn" disabled={!online} onClick={onBrowse}>Changer de train</button>
        <button type="button" className="phone-btn is-danger" disabled={!online} onClick={onRelease}>Rendre les commandes</button>
      </div>
      <div className="phone-bar-track">
        {steer('left', 'gauche')}
        <span className="phone-turnout">{turnout.label}</span>
        {steer('right', 'droite')}
        {/* Always there on its side, so the turnout buttons never slide under a thumb */}
        {landscape && (
          <button
            type="button"
            className="phone-btn phone-cab"
            disabled={!online || !readCanSwitchCab(state)}
            aria-label="Changer de cabine"
            onClick={() => onCommand({ type: 'switchCab' })}
          >
            Cabine
          </button>
        )}
      </div>
    </header>
  )
}

function Desk({ screen, fleet, landscape, onCommand }: {
  screen: Extract<DeskScreen, { kind: 'desk' }>
  fleet: readonly FleetEntry[]
  landscape: boolean
  onCommand: (command: ConsoleCommand) => void
}) {
  return (
    <ScaledStage design={deskDesign(landscape ? 'landscape' : 'portrait', screen.state)} className={screen.online ? '' : 'is-cut'}>
      {/* Remounted when the link drops or comes back: a lever held at that moment lets go */}
      {landscape ? (
        <DrivingConsole key={`band-${screen.online}`} layout="band" state={screen.state} fleet={fleet} onCommand={onCommand} />
      ) : (
        <PortraitDesk
          key={`portrait-${screen.online}`}
          state={screen.state}
          fleet={fleet}
          canSwitchCab={readCanSwitchCab(screen.state)}
          onCommand={onCommand}
        />
      )}
    </ScaledStage>
  )
}

/**
 * Lays its content out at the size of a design and scales it to cover the room it is given.
 * A transform rather than `zoom`: pointer positions and bounding boxes then agree in every browser.
 */
function ScaledStage({ design, className, children }: { design: StageDesign; className: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      setSize((previous) => (previous && previous.width === width && previous.height === height ? previous : { width, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const fit: StageFit | null = size && size.width > 0 && size.height > 0 ? fitStage(size.width, size.height, design) : null
  return (
    <div ref={box} className={`phone-stage ${className}`}>
      {fit && (
        <div className="phone-stage-inner" style={{ width: fit.width, height: fit.height, transform: `scale(${fit.scale})` }}>
          {children}
        </div>
      )}
    </div>
  )
}
