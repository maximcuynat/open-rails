import { useRef, useState, type ReactNode } from 'react'
import type { ConsoleCommand, ConsoleState, FleetEntry } from '@application/console/consoleContract'
import type { BrakeCommand } from '@domain/models/trainDynamics'
import { ConsoleIcon, HoldButton, KeyCap, Lever, ReverserSwitch, type LeverStop } from './instruments'
import type { ConsoleView, NotchStop } from './consoleModel'
import {
  BRAKE_LEVER_NEUTRAL,
  brakeCommandAtRatio,
  notchAtRatio,
  ratioOfBrakeCommand,
  ratioOfNotch,
} from './leverGeometry'

/** Labels of the keys that double the controls, as the user has bound them; absent where there is no keyboard */
export interface ConsoleKeys {
  notchUp: string
  notchDown: string
  brakeApply: string
  brakeRelease: string
  reverserForward: string
  reverserBackward: string
  emergencyBrake: string
  steerLeft: string
  steerRight: string
  exit: string
  flipLegacy: string
}

/**
 * What every console takes. A console never reads the store: it shows `state`, lists the trains of
 * `fleet`, and answers with commands, so the same component runs on the PC and on a phone.
 */
export interface ConsoleProps {
  state: ConsoleState
  fleet: readonly FleetEntry[]
  keys?: Partial<ConsoleKeys>
  onCommand: (command: ConsoleCommand) => void
  /** Buttons of the host added to the tools of the console (debug, coupling…) */
  extraTools?: ReactNode
}

export interface ConsolePartProps extends ConsoleProps {
  view: ConsoleView
}

const hint = (key?: string): string => (key ? ` (${key})` : '')

/** Train switcher, next turnout, the host's own tools and the way out */
export function ConsoleTools({ state, view, keys, onCommand, extraTools, className }: ConsolePartProps & { className?: string }) {
  const turnout = view.turnout
  return (
    <div className={`console-tools${className ? ` ${className}` : ''}`}>
      {view.rank !== null && (
        <>
          <button type="button" className="console-tool" title="Train précédent" aria-label="Train précédent" onClick={() => onCommand({ type: 'selectTrainByOffset', offset: -1 })}>
            <ConsoleIcon name="previous" />
          </button>
          <span className="console-tools-rank" title="Train conduit / trains sur le réseau">{view.rank}/{view.fleetSize}</span>
          <button type="button" className="console-tool" title="Train suivant" aria-label="Train suivant" onClick={() => onCommand({ type: 'selectTrainByOffset', offset: 1 })}>
            <ConsoleIcon name="next" />
          </button>
          <span className="console-tools-sep" />
        </>
      )}
      <button
        type="button"
        className={`console-tool${turnout.side === 'left' ? ' is-active' : ''}`}
        title={`${turnout.hint}${turnout.disabled ? '' : ` — donner la voie de gauche${hint(keys?.steerLeft)}`}`}
        aria-label="Aiguille suivante à gauche"
        aria-pressed={turnout.side === 'left'}
        disabled={turnout.disabled}
        onClick={() => onCommand({ type: 'steer', side: 'left' })}
      >
        <ConsoleIcon name="steerLeft" />
        <KeyCap label={keys?.steerLeft} />
      </button>
      <span className={`console-tools-turnout${state.upcomingTurnout?.locked ? ' is-locked' : ''}`} title={turnout.hint}>{turnout.label}</span>
      <button
        type="button"
        className={`console-tool${turnout.side === 'right' ? ' is-active' : ''}`}
        title={`${turnout.hint}${turnout.disabled ? '' : ` — donner la voie de droite${hint(keys?.steerRight)}`}`}
        aria-label="Aiguille suivante à droite"
        aria-pressed={turnout.side === 'right'}
        disabled={turnout.disabled}
        onClick={() => onCommand({ type: 'steer', side: 'right' })}
      >
        <KeyCap label={keys?.steerRight} />
        <ConsoleIcon name="steerRight" />
      </button>
      {state.canSwitchCab && (
        <button
          type="button"
          className="console-tool"
          title="Changer de cabine : conduire depuis l’autre extrémité du train"
          aria-label="Changer de cabine"
          onClick={() => onCommand({ type: 'switchCab' })}
        >
          <ConsoleIcon name="cab" />
        </button>
      )}
      {extraTools}
      <button type="button" className="console-tool is-danger" title={`Quitter la conduite${hint(keys?.exit)}`} aria-label="Quitter la conduite" onClick={() => onCommand({ type: 'releaseControls' })}>
        <ConsoleIcon name="close" />
        <KeyCap label={keys?.exit} />
      </button>
    </div>
  )
}

/** The reverser with the keys that move it; the legacy locomotive has a single « change direction » button */
export function ReverserControl({ state, view, keys, onCommand, className }: ConsolePartProps & { className?: string }) {
  if (view.legacy) {
    return (
      <button type="button" className={`console-flip${className ? ` ${className}` : ''}`} title="Inverser le sens de marche" onClick={() => onCommand({ type: 'switchCab' })}>
        Inverser le sens <KeyCap label={keys?.flipLegacy} />
      </button>
    )
  }
  return (
    <div className={`console-rev-row${className ? ` ${className}` : ''}`}>
      <KeyCap label={keys?.reverserBackward} />
      <ReverserSwitch
        reverser={state.reverser}
        locked={state.reverserLocked}
        needed={view.reverserNeeded}
        onSet={(reverser) => onCommand({ type: 'reverser', reverser })}
      />
      <KeyCap label={keys?.reverserForward} />
    </div>
  )
}

/** One of the two held brake buttons */
export function BrakeHoldButton({ command, state, view, keys, onCommand, className }: ConsolePartProps & {
  command: Exclude<BrakeCommand, 'hold'>
  className: string
}) {
  const release = command === 'release'
  const key = release ? keys?.brakeRelease : keys?.brakeApply
  return (
    <HoldButton
      className={`${className}${release && view.releaseHint ? ' is-hinted' : ''}`}
      active={state.brake?.command === command}
      disabled={state.emergencyBrake}
      title={`${release ? 'Desserrer' : 'Serrer'} le frein, tant que le bouton est maintenu${hint(key)}`}
      onHold={() => onCommand({ type: 'brake', command })}
      onRelease={() => onCommand({ type: 'brake', command: 'hold' })}
    >
      <span>{release ? 'Desserrer' : 'Serrer'}</span>
      <KeyCap label={key} />
    </HoldButton>
  )
}

/** Traction and electric brake lever: it snaps from notch to notch and stays where it is left */
export function ThrottleLever({ state, stops, onCommand }: {
  state: ConsoleState
  stops: NotchStop[]
  onCommand: (command: ConsoleCommand) => void
}) {
  // While dragging, the knob follows the hand at once instead of waiting for the state to come back
  const [dragNotch, setDragNotch] = useState<number | null>(null)
  const sent = useRef<number | null>(null)
  const notch = dragNotch ?? state.notch
  const ratioOf = (n: number) => ratioOfNotch(n, state.minNotch, state.maxNotch)
  const leverStops: LeverStop[] = stops.map((stop) => ({ ratio: ratioOf(stop.notch), label: stop.label, active: stop.notch === notch }))
  return (
    <Lever
      stops={leverStops}
      ratio={ratioOf(notch)}
      tone={notch < 0 ? 'amber' : notch > 0 ? 'green' : 'grey'}
      fillFrom={ratioOf(0)}
      wide={state.legacyThrottle !== undefined}
      label="Manipulateur de traction"
      valueText={stops.find((stop) => stop.notch === notch)?.label ?? ''}
      onMove={(ratio) => {
        const next = notchAtRatio(ratio, state.minNotch, state.maxNotch)
        setDragNotch(next)
        if (next === sent.current) return
        sent.current = next
        onCommand({ type: 'notchSet', notch: next })
      }}
      onEnd={() => {
        setDragNotch(null)
        sent.current = null
      }}
    />
  )
}

const BRAKE_LEVER_STOPS: [ratio: number, label: string, command: BrakeCommand | null][] = [
  [0, 'Serrer', 'apply'],
  [0.25, '', null],
  [BRAKE_LEVER_NEUTRAL, 'Neutre', 'hold'],
  [0.75, '', null],
  [1, 'Desserrer', 'release'],
]

/** Spring-centred brake lever: it acts while it is held away from the centre, then comes back to « hold » */
export function BrakeLever({ command, disabled, onCommand }: {
  command: BrakeCommand
  disabled: boolean
  onCommand: (command: ConsoleCommand) => void
}) {
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const sent = useRef<BrakeCommand>('hold')
  const shown = dragRatio === null ? command : brakeCommandAtRatio(dragRatio)
  return (
    <Lever
      stops={BRAKE_LEVER_STOPS.map(([ratio, label, stop]) => ({ ratio, label, active: stop === shown }))}
      // Not dragged, the lever shows what the keys or another console hold
      ratio={dragRatio ?? ratioOfBrakeCommand(command)}
      tone={shown === 'release' ? 'green' : 'amber'}
      wide
      springBack={dragRatio === null}
      disabled={disabled}
      label="Robinet de frein"
      valueText={shown === 'release' ? 'Desserrer' : shown === 'apply' ? 'Serrer' : 'Neutre'}
      onMove={(ratio) => {
        setDragRatio(ratio)
        const next = brakeCommandAtRatio(ratio)
        if (next === sent.current) return
        sent.current = next
        onCommand({ type: 'brake', command: next })
      }}
      onEnd={() => {
        setDragRatio(null)
        sent.current = 'hold'
        onCommand({ type: 'brake', command: 'hold' })
      }}
    />
  )
}

/** The limit in force as its real board: white figures on black. « — » when there is none to show */
export function LimitBoard({ view }: { view: ConsoleView }) {
  if (!view.limit) return <>—</>
  return <span className="console-limit" title="Limite de vitesse en cours, km/h">{view.limit.label}</span>
}

/** The next lower limit as its announcement board, black on white, and the distance to it */
export function NextLimitBoard({ view }: { view: ConsoleView }) {
  if (!view.nextLimit) return <>—</>
  return (
    <>
      <span className="console-limit is-next" title="Prochaine limite plus basse, km/h">{view.nextLimit.label}</span>
      <span className="console-limit-distance" title="Distance jusqu’à cette limite">{view.nextLimit.distance}</span>
    </>
  )
}

/**
 * The two boards in the bottom corners of a dial, the limit in force on the left and the next one
 * on the right under its distance. Out of the flow: nothing moves when a board comes or goes.
 */
export function LimitCorners({ view }: { view: ConsoleView }) {
  return (
    <>
      {view.limit && (
        <div className="console-corner-limit is-current">
          <small>Limite</small>
          <LimitBoard view={view} />
        </div>
      )}
      {view.nextLimit && (
        <div className="console-corner-limit is-next" title="Prochaine limite plus basse et distance jusqu’à elle">
          <small>{view.nextLimit.distance}</small>
          <span className="console-limit is-next">{view.nextLimit.label}</span>
        </div>
      )}
    </>
  )
}

/**
 * The caption under the speed: its unit, which turns into the warning while a curve is taken too
 * fast. Same place, same size: nothing moves when the warning comes or goes.
 */
export function SpeedCaption({ view, unit }: { view: ConsoleView; unit: string }) {
  if (!view.curve) return <>{unit}</>
  return <span className={`console-curve curve-${view.curve.tone}`} title={view.curve.hint} role="status">{view.curve.label}</span>
}

/**
 * The train has left the rails: what happened, and the way back. It covers the middle of the
 * console stage it is put in; nothing while the train is on the track.
 */
export function DerailmentPanel({ view, onCommand }: Pick<ConsolePartProps, 'view' | 'onCommand'>) {
  if (!view.derailment) return null
  return (
    <div className="console-derail" role="alert">
      <b>{view.derailment}</b>
      <span>Le train est immobilisé.</span>
      <button type="button" className="console-btn tone-amber" onClick={() => onCommand({ type: 'rerail' })}>
        Remettre sur la voie
      </button>
    </div>
  )
}
