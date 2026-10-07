import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { ConsoleCommand, ConsoleState } from '@application/console/consoleContract'
import type { BrakeCommand } from '@domain/models/trainDynamics'
import type { InstrumentTone } from '@presentation/components/console/instruments'
import type { NotchStop } from '@presentation/components/console/consoleModel'
import {
  BRAKE_LEVER_DEAD_ZONE,
  BRAKE_LEVER_NEUTRAL,
  brakeCommandAtRatio,
  notchAtRatio,
  ratioOfBrakeCommand,
  ratioOfNotch,
} from '@presentation/components/console/leverGeometry'
import { MIN_BRAKE_TRAVEL, MIN_SLIDE_PER_NOTCH, padRatioAfterDrag, padTravel } from './padGeometry'

interface PadStop {
  /** Position along the travel, 0 (bottom) … 1 (top) */
  ratio: number
  /** Empty: a bare graduation */
  label: string
  active: boolean
}

const percentFromTop = (ratio: number): string => `${(1 - ratio) * 100}%`

/**
 * A lever as large as the zone it is given. The thumb lands anywhere in it and slides: `onDrag`
 * gets the slide since the touch (pixels, downwards positive) and the height of the drawn travel,
 * so the caller moves its lever from where it stood. The pointer is captured: the slide
 * carries on outside the pad, and two pads are held at once, one per thumb.
 */
function ThumbPad({ side, title, stops, ratio, tone, fillFrom, spring, disabled, label, valueText, knob, onStart, onDrag, onEnd, children }: {
  /** Which place of the grid it takes */
  side: 'brake' | 'traction'
  title: string
  stops: PadStop[]
  ratio: number
  tone: InstrumentTone
  /** Light the travel from this position to the knob */
  fillFrom?: number
  /** Ease the knob back when it is let go */
  spring?: boolean
  disabled?: boolean
  label: string
  valueText: string
  /** What the knob says: the stop it stands on */
  knob: string
  onStart: () => void
  onDrag: (dy: number, trackHeight: number) => void
  onEnd: () => void
  /** Under the travel: the read-outs of this lever */
  children?: ReactNode
}) {
  const track = useRef<HTMLDivElement>(null)
  const held = useRef<{ pointerId: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (held.current?.pointerId !== e.pointerId) return
    held.current = null
    setDragging(false)
    onEnd()
  }
  const low = Math.min(ratio, fillFrom ?? ratio)
  const high = Math.max(ratio, fillFrom ?? ratio)
  return (
    <div
      className={`phone-panel thumb-pad is-${side} tone-${tone}${dragging ? ' is-held' : ''}${spring ? ' is-spring' : ''}${disabled ? ' is-disabled' : ''}`}
      role="slider"
      aria-label={label}
      aria-valuetext={valueText}
      aria-valuenow={Math.round(ratio * 100)}
      aria-disabled={disabled}
      onPointerDown={(e) => {
        // A second finger on the same pad does not take the lever from the first
        if (disabled || e.button !== 0 || held.current) return
        e.currentTarget.setPointerCapture(e.pointerId)
        held.current = { pointerId: e.pointerId, y: e.clientY }
        setDragging(true)
        onStart()
      }}
      onPointerMove={(e) => {
        const grip = held.current
        if (grip?.pointerId !== e.pointerId) return
        onDrag(e.clientY - grip.y, track.current?.clientHeight ?? 0)
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <span className="console-lbl thumb-pad-title">{title}</span>
      <div className="thumb-pad-track" ref={track}>
        {stops.map((stop) => (
          <div
            key={stop.ratio}
            className={`thumb-pad-stop${stop.active ? ' is-on' : ''}${stop.label ? '' : ' is-bare'}`}
            style={{ top: percentFromTop(stop.ratio) }}
          >
            {stop.label && <span>{stop.label}</span>}
          </div>
        ))}
        {fillFrom !== undefined && high - low > 0.001 && (
          <i className="thumb-pad-fill" style={{ top: percentFromTop(high), bottom: `${low * 100}%` }} />
        )}
        <div className="thumb-pad-knob" style={{ top: percentFromTop(ratio) }}>
          <b>{knob}</b>
        </div>
      </div>
      {children && <div className="thumb-pad-foot">{children}</div>}
    </div>
  )
}

/** Traction and electric brake: it moves from the notch it is on, snaps from notch to notch and stays where it is left */
export function TractionPad({ state, stops, title, onCommand, children }: {
  state: ConsoleState
  stops: NotchStop[]
  title: string
  onCommand: (command: ConsoleCommand) => void
  children?: ReactNode
}) {
  // While sliding, the knob follows the thumb at once instead of waiting for the state to come back
  const [dragNotch, setDragNotch] = useState<number | null>(null)
  const start = useRef(0)
  const sent = useRef(0)
  const notch = dragNotch ?? state.notch
  const ratioOf = (n: number) => ratioOfNotch(n, state.minNotch, state.maxNotch)
  const current = stops.find((stop) => stop.notch === notch)?.label ?? ''
  return (
    <ThumbPad
      side="traction"
      title={title}
      stops={stops.map((stop) => ({ ratio: ratioOf(stop.notch), label: stop.label, active: stop.notch === notch }))}
      ratio={ratioOf(notch)}
      tone={notch < 0 ? 'amber' : notch > 0 ? 'green' : 'grey'}
      fillFrom={ratioOf(0)}
      label="Manipulateur de traction"
      valueText={current}
      knob={current}
      onStart={() => {
        // Touching sends nothing: the lever is where it was
        start.current = ratioOf(state.notch)
        sent.current = state.notch
        setDragNotch(state.notch)
      }}
      onDrag={(dy, height) => {
        const travel = padTravel(height, (state.maxNotch - state.minNotch) * MIN_SLIDE_PER_NOTCH)
        const next = notchAtRatio(padRatioAfterDrag(start.current, dy, travel), state.minNotch, state.maxNotch)
        if (next === sent.current) return
        sent.current = next
        setDragNotch(next)
        onCommand({ type: 'notchSet', notch: next })
      }}
      onEnd={() => setDragNotch(null)}
    >
      {children}
    </ThumbPad>
  )
}

const BRAKE_PAD_STOPS: [ratio: number, label: string, command: BrakeCommand | null][] = [
  [0, 'Serrer', 'apply'],
  [BRAKE_LEVER_NEUTRAL - BRAKE_LEVER_DEAD_ZONE, '', null],
  [BRAKE_LEVER_NEUTRAL, 'Neutre', 'hold'],
  [BRAKE_LEVER_NEUTRAL + BRAKE_LEVER_DEAD_ZONE, '', null],
  [1, 'Desserrer', 'release'],
]

const BRAKE_KNOB: Record<BrakeCommand, string> = { apply: 'Serrer', hold: 'Neutre', release: 'Desserrer' }

/**
 * Spring-centred brake: neutral is wherever the thumb lands. Pulled down it applies, pushed up it
 * releases, for as long as it is held there; let go, it comes back to « hold ».
 */
export function BrakePad({ command, disabled, onCommand, children }: {
  command: BrakeCommand
  disabled: boolean
  onCommand: (command: ConsoleCommand) => void
  children?: ReactNode
}) {
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const sent = useRef<BrakeCommand>('hold')
  const shown = dragRatio === null ? command : brakeCommandAtRatio(dragRatio)
  return (
    <ThumbPad
      side="brake"
      title="Frein"
      stops={BRAKE_PAD_STOPS.map(([ratio, label, stop]) => ({ ratio, label, active: stop === shown }))}
      // Not held, the pad shows what the keys or another console hold
      ratio={dragRatio ?? ratioOfBrakeCommand(command)}
      tone={shown === 'release' ? 'green' : shown === 'apply' ? 'amber' : 'grey'}
      fillFrom={BRAKE_LEVER_NEUTRAL}
      spring={dragRatio === null}
      disabled={disabled}
      label="Robinet de frein"
      valueText={BRAKE_KNOB[shown]}
      knob={BRAKE_KNOB[shown]}
      onStart={() => {
        sent.current = 'hold'
        setDragRatio(BRAKE_LEVER_NEUTRAL)
      }}
      onDrag={(dy, height) => {
        const ratio = padRatioAfterDrag(BRAKE_LEVER_NEUTRAL, dy, padTravel(height, MIN_BRAKE_TRAVEL))
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
    >
      {children}
    </ThumbPad>
  )
}
