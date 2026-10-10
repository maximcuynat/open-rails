import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ConsoleCommand, ConsoleState, FleetEntry } from '@application/console/consoleContract'
import {
  DESK_QUERY_PARAM,
  MAX_DESKS,
  MAX_DRIVER_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  normalizeRoomCode,
  roomFromPageUrl,
} from '@application/remote/protocol'
import { ConsoleIcon } from '@presentation/components/console/instruments'
import { newSignalPassed } from '@presentation/components/console/consoleModel'
import {
  DRIVER_NAME_KEY,
  cleanDriverName,
  compositionLabel,
  deskOrientation,
  deskScreen,
  fleetChoice,
  fleetSpeedLabel,
  hapticFor,
  turnoutView,
  type DeskScreen,
} from './deskView'
import { useAppViewport, useRemoteDesk, useViewportSize, useWakeLock, vibrate } from './deskHooks'
import { TwoThumbDesk } from './TwoThumbDesk'
import './remoteDesk.css'

/**
 * The page a phone opens with `?pupitre=CODE`: it joins the room of the PC, lists its trains, and
 * becomes the desk of the one that is driven. No editor, no canvas, no store.
 */
export default function RemoteDesk() {
  const [room, setRoom] = useState<string | null>(() => roomFromPageUrl(window.location.href))
  const [attempt, setAttempt] = useState(0)
  const [name, setName] = useState<string | null>(() => readDriverName())
  const { snapshot, session, send } = useRemoteDesk(room, attempt, name)
  // The driver asked for the list while the PC still drives a train
  const [browsing, setBrowsing] = useState(false)
  // Train touched in the list, until the PC answers with its state
  const [pending, setPending] = useState<string | null>(null)
  const viewport = useViewportSize()
  useAppViewport()

  const orientation = deskOrientation(viewport.width, viewport.height)
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

  const rename = (raw: string) => {
    const next = cleanDriverName(raw, MAX_DRIVER_NAME_LENGTH)
    if (next === name) return
    try {
      if (next) localStorage.setItem(DRIVER_NAME_KEY, next)
      else localStorage.removeItem(DRIVER_NAME_KEY)
    } catch {
      // Private browsing: the name lasts as long as the page
    }
    setName(next)
    // The PC learns a name when the desk sits down: it sits down again
    setAttempt((n) => n + 1)
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
              desk={snapshot.desk}
              name={name}
              online={screen.online}
              pending={pending}
              awake={awake}
              onPick={pick}
              onRename={rename}
            />
          </>
        )
      case 'desk':
        return (
          <>
            {!screen.online && <CutBanner />}
            {/* Remounted when the link drops or comes back: a pad held at that moment lets go */}
            <TwoThumbDesk
              key={`pads-${screen.online}`}
              state={screen.state}
              fleet={snapshot.fleet}
              canSwitchCab={readCanSwitchCab(screen.state)}
              cut={!screen.online}
              bar={
                <DeskBar
                  state={screen.state}
                  online={screen.online}
                  onBrowse={() => setBrowsing(true)}
                  onRelease={release}
                  onCommand={command}
                />
              }
              onCommand={command}
            />
          </>
        )
    }
  }
}

function readDriverName(): string | null {
  try {
    return cleanDriverName(localStorage.getItem(DRIVER_NAME_KEY), MAX_DRIVER_NAME_LENGTH)
  } catch {
    return null
  }
}

const ENDED_TEXT: Record<Extract<DeskScreen, { kind: 'ended' }>['reason'], { title: string; text: string }> = {
  'room-full': {
    title: 'Salon complet',
    text: `Ce salon a déjà ses ${MAX_DESKS} pupitres. Attendez qu’un conducteur quitte, puis réessayez.`,
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

function FleetList({ room, fleet, desk, name, online, pending, awake, onPick, onRename }: {
  room: string
  fleet: readonly FleetEntry[]
  /** The number of this desk in the room */
  desk: number | null
  name: string | null
  online: boolean
  pending: string | null
  awake: boolean
  onPick: (trainId: string) => void
  onRename: (name: string) => void
}) {
  const [draft, setDraft] = useState(name ?? '')
  return (
    <main className={`phone-fleet${online ? '' : ' is-cut'}`}>
      <header className="phone-fleet-head">
        <h1>Choisir un train</h1>
        <span className="phone-room" title="Code du salon">
          <i className={online ? 'is-on' : ''} aria-hidden="true" />
          {room}
        </span>
      </header>
      <form
        className="phone-driver"
        onSubmit={(event) => {
          event.preventDefault()
          onRename(draft)
        }}
      >
        <label htmlFor="phone-driver-name">Votre nom</label>
        <input
          id="phone-driver-name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onRename(draft)}
          maxLength={MAX_DRIVER_NAME_LENGTH}
          placeholder={desk === null ? 'Pupitre' : `Pupitre ${desk}`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
        />
      </form>
      {fleet.length === 0 ? (
        <div className="phone-empty">
          <h2>Aucun train sur le réseau</h2>
          <p>Posez un train sur le PC : il apparaîtra ici.</p>
        </div>
      ) : (
        <ul className="phone-trains">
          {fleet.map((entry) => {
            const choice = fleetChoice(entry, desk, pending)
            return (
            <li key={entry.id}>
              <button
                type="button"
                className={`phone-train${choice.mine ? ' is-driven' : ''}${choice.taken ? ' is-taken' : ''}${pending === entry.id ? ' is-pending' : ''}`}
                disabled={!online || choice.taken}
                onClick={() => onPick(entry.id)}
              >
                <span className="phone-train-rank">{entry.rank}</span>
                <span className="phone-train-text">
                  <b>{entry.model || `Train ${entry.rank}`}</b>
                  <small>{compositionLabel(entry.locoCount, entry.wagonCount)}</small>
                </span>
                <span className="phone-train-side">
                  <b>{fleetSpeedLabel(entry)}</b>
                  <small>{choice.label}</small>
                </span>
              </button>
            </li>
            )
          })}
        </ul>
      )}
      <footer className="phone-fleet-foot">
        Toucher un train libre prend ses commandes.
        {!awake && ' L’écran peut se mettre en veille : gardez-le actif.'}
      </footer>
    </main>
  )
}

// A PC of an older version does not send these two fields: read them as possibly absent
const readTurnout = (state: ConsoleState) => (state as Partial<ConsoleState>).upcomingTurnout
const readCanSwitchCab = (state: ConsoleState) => (state as Partial<ConsoleState>).canSwitchCab === true

/** The two ways out of the desk and the next turnout, on one row */
function DeskBar({ state, online, onBrowse, onRelease, onCommand }: {
  state: ConsoleState
  online: boolean
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
      <ConsoleIcon name={side === 'left' ? 'steerLeft' : 'steerRight'} />
    </button>
  )
  return (
    <header className="phone-bar">
      <button type="button" className="phone-btn" disabled={!online} aria-label="Changer de train" onClick={onBrowse}>Trains</button>
      {steer('left', 'gauche')}
      <span className="phone-turnout">{turnout.label}</span>
      {steer('right', 'droite')}
      <button type="button" className="phone-btn is-danger" disabled={!online} aria-label="Rendre les commandes" onClick={onRelease}>Rendre</button>
    </header>
  )
}
