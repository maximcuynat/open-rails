import { ConsoleTools, type ConsolePartProps } from './consoleParts'
import type { CabView, SignalHeadView, SignalsView } from './consoleModel'
import './consoleSignals.css'

/**
 * What the consoles show of the signalling: the next signal seen from the front (or the cab display
 * of a high-speed line), its distance, and the one thing the driver has to know besides. Driven by
 * a `SignalsView` only; a console of a network without signal renders none of this.
 */

const HEAD_WIDTH = 22
const HEAD_HEIGHT = 48
const HEAD_CENTRE = HEAD_WIDTH / 2

/** The plate under a target or a marker: « F » or « Nf », white on black */
function Plate({ plate }: { plate: 'F' | 'Nf' }) {
  return (
    <>
      <rect className="console-signal-plate" x={4} y={38.5} width={14} height={9} rx={1} />
      <text className="console-signal-plate-text" x={HEAD_CENTRE} y={45.6} textAnchor="middle">{plate}</text>
    </>
  )
}

/** The next signal seen from the front: a lamp on its mast, a French target with its plate, or a marker board */
export function SignalHead({ head }: { head: SignalHeadView }) {
  const label = `${head.label}${head.plate ? `, plaque ${head.plate}` : ''}`
  if (head.kind === 'light') {
    return (
      <svg className="console-signal-head" viewBox={`0 0 ${HEAD_WIDTH} ${HEAD_HEIGHT}`} role="img" aria-label={label}>
        <line className="console-signal-mast" x1={HEAD_CENTRE} y1={26} x2={HEAD_CENTRE} y2={46} />
        <circle className="console-signal-target" cx={HEAD_CENTRE} cy={16} r={10} />
        <circle className={`console-signal-lamp is-on lamp-${head.lamps[0]?.color ?? 'red'}`} cx={HEAD_CENTRE} cy={16} r={6.5} />
      </svg>
    )
  }
  if (head.kind === 'marker') {
    return (
      <svg className="console-signal-head" viewBox={`0 0 ${HEAD_WIDTH} ${HEAD_HEIGHT}`} role="img" aria-label={label}>
        <rect className="console-signal-marker" x={1} y={9} width={20} height={20} rx={1.5} />
        <path className="console-signal-marker-arrow" d="M 4.5 14 L 17.5 14 L 11 26 Z" />
        {head.plate && <Plate plate={head.plate} />}
      </svg>
    )
  }
  const top = 1
  const bottom = 36
  if (head.slow) {
    // A wider target: the usual column on the left, the two yellow lamps of the diverging route
    // side by side on the top row (announcement) or one above the other on the right (reminder)
    const rows = head.lamps.length + 1
    const pitch = (bottom - top - 5) / rows
    const radius = Math.min(3.1, pitch / 2 - 0.5)
    const y = (row: number): number => top + 2.5 + pitch * (row + 0.5)
    const left = 6.8
    const right = 15.2
    const announce = head.slow.kind === 'slowdown'
    const slow = (on: boolean): string => `console-signal-lamp lamp-yellow${on ? ` is-on${head.slow!.flashing ? ' is-flashing' : ''}` : ''}`
    return (
      <svg className="console-signal-head" viewBox={`0 0 ${HEAD_WIDTH} ${HEAD_HEIGHT}`} role="img" aria-label={label}>
        <rect className="console-signal-target" x={1} y={top} width={20} height={bottom - top} rx={6} />
        <circle className={slow(announce)} cx={left} cy={y(0)} r={radius} />
        <circle className={slow(announce)} cx={right} cy={y(0)} r={radius} />
        <circle className={slow(!announce)} cx={right} cy={y(1)} r={radius} />
        <circle className={slow(!announce)} cx={right} cy={y(2)} r={radius} />
        {head.lamps.map((lamp, i) => (
          <circle key={i} className={`console-signal-lamp lamp-${lamp.color}${lamp.on ? ' is-on' : ''}`} cx={left} cy={y(i + 1)} r={radius} />
        ))}
        {head.plate && <Plate plate={head.plate} />}
      </svg>
    )
  }
  // Lamps spread over the target, from top to bottom
  const count = head.lamps.length
  const pitch = (bottom - top - 5) / count
  const radius = Math.min(4.4, pitch / 2 - 0.6)
  return (
    <svg className="console-signal-head" viewBox={`0 0 ${HEAD_WIDTH} ${HEAD_HEIGHT}`} role="img" aria-label={label}>
      <rect className="console-signal-target" x={3} y={top} width={16} height={bottom - top} rx={7} />
      {head.lamps.map((lamp, i) => (
        <circle
          key={i}
          className={`console-signal-lamp lamp-${lamp.color}${lamp.on ? ' is-on' : ''}`}
          cx={HEAD_CENTRE}
          cy={top + 2.5 + pitch * (i + 0.5)}
          r={radius}
        />
      ))}
      {head.plate && <Plate plate={head.plate} />}
    </svg>
  )
}

/** The cab display of a high-speed line: three figures in a cartouche whose colours tell what they ask */
export function CabDisplay({ cab }: { cab: CabView }) {
  return (
    <span className={`console-cab cab-${cab.tone}${cab.flashing ? ' is-flashing' : ''}`} role="img" aria-label={cab.label}>
      {cab.figures}
    </span>
  )
}

/**
 * The signalling block of a console: fixed size, so nothing moves when an alert comes or goes.
 * First line: what the next signal (or the cab) shows and how far it is. Second line: the most
 * pressing note — brake alert, closed signal passed, running on sight, route awaited, closed signal
 * further ahead — the others in the tooltip.
 */
export function SignalPanel({ signals, className }: { signals: SignalsView; className?: string }) {
  const { next, cab } = signals
  const note = signals.notes[0]
  const label = cab ? cab.label : next ? next.label : signals.empty
  const distance = cab ? cab.distance : next ? next.distance : ''
  const tone = cab ? '' : next?.color ? ` signal-${next.color}` : next ? '' : ' is-empty'
  const hint = [`${signals.title} : ${label}${distance && distance !== '—' ? ` à ${distance}` : ''}`, ...signals.notes.map((n) => n.text)].join(' — ')
  return (
    <div className={`console-signals${signals.brakeAlert ? ' is-alert' : ''}${className ? ` ${className}` : ''}`} title={hint}>
      <div className="console-signals-icon">
        {cab ? <CabDisplay cab={cab} /> : next ? <SignalHead head={next} /> : <span className="console-signals-none" />}
      </div>
      <div className="console-signals-text">
        <div className="console-signals-main">
          <b className={`console-signals-label${tone}`}>{label}</b>
          <span className="console-signals-distance">{distance}</span>
        </div>
        {note ? (
          <div className={`console-signals-note note-${note.tone}`}>{note.text}</div>
        ) : (
          <div className="console-signals-note">{signals.title}</div>
        )}
      </div>
    </div>
  )
}

/**
 * The row of tools of a console, with the signalling block riding above it when the network has
 * signals. Without signal it is the row of tools alone, as it always was.
 */
export function ConsoleToolRow(props: ConsolePartProps) {
  const signals = props.view.signals
  if (!signals) return <ConsoleTools {...props} />
  return (
    <div className="console-toolrow">
      <SignalPanel signals={signals} />
      <ConsoleTools {...props} />
    </div>
  )
}
