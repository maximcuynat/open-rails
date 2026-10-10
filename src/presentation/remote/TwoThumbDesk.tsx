import type { CSSProperties, ReactNode } from 'react'
import type { ConsoleCommand, ConsoleState, FleetEntry } from '@application/console/consoleContract'
import {
  DerailmentPanel,
  LimitBoard,
  NextLimitBoard,
  ReverserControl,
  SpeedCaption,
} from '@presentation/components/console/consoleParts'
import { consoleView, decimal, notchStops } from '@presentation/components/console/consoleModel'
import { SignalPanel } from '@presentation/components/console/signalParts'
import { aheadLabel, trainTitle } from './deskView'
import { useAheadDistance } from './deskHooks'
import { BrakePad, TractionPad } from './ThumbPads'

/**
 * The desk of a phone, one lever per thumb: the brake under the left one, traction under the
 * right one, each as large as its half of the screen. Upright the two pads sit side by side under
 * the speed; on its side the phone is held like a game controller, a pad at each edge and the
 * speed between them. Same content both ways — the grid of `remoteDesk.css` places it — and it is
 * laid out on the real screen, not scaled from a drawing.
 */
export function TwoThumbDesk({ state, fleet, canSwitchCab, cut, bar, onCommand }: {
  state: ConsoleState
  fleet: readonly FleetEntry[]
  canSwitchCab: boolean
  /** The link is down: the desk stays on screen, dimmed and out of reach */
  cut: boolean
  /** The ways out and the next turnout, placed by the grid */
  bar: ReactNode
  onCommand: (command: ConsoleCommand) => void
}) {
  const view = consoleView(state, fleet)
  const aheadDistance = useAheadDistance(state)
  const parts = { state, fleet, view, onCommand }
  const speed = { '--phone-speed': view.speedRatio } as CSSProperties
  const effort = { '--console-effort': `${view.handlePercent}%` } as CSSProperties
  return (
    <div className={`console-stage phone-pads${state.brake ? ' has-brake' : ''}${cut ? ' is-cut' : ''}`}>
      {bar}

      <section className="phone-panel phone-info">
        <div className="phone-info-head">
          <span className="console-lbl">{trainTitle(state, fleet)}</span>
          <span className="console-lbl">{view.composition}</span>
        </div>
        <div className="phone-info-row">
          <div className="phone-speed-num">
            <div className={`phone-speed-value speed-${view.speedTone}`}>{view.kmh}</div>
            <div className="phone-speed-unit"><SpeedCaption view={view} unit={`KM/H · MAX ${view.maxKmh}`} /></div>
          </div>
          <div className="console-stats">
            <span>Limite</span><b><LimitBoard view={view} /></b>
            <span>Proch.</span><b><NextLimitBoard view={view} /></b>
            <span>Arrêt en</span><b>{view.stopping}</b>
          </div>
        </div>
        <div className="phone-speed-scale">
          <div className={`phone-speed-bar speed-${view.speedTone}`} style={speed} role="img" aria-label={`${view.kmh} km/h sur ${view.maxKmh}`}><i /></div>
          {view.limit && <span className="phone-limit-mark" style={{ left: `${view.limit.ratio * 100}%` }} />}
          {view.nextLimit && <span className="phone-limit-mark is-next" style={{ left: `${view.nextLimit.ratio * 100}%` }} />}
        </div>
        <div className="phone-info-stats">
          <span>Pente <b>{view.gradient}</b></span>
          <span>Accél. <b>{view.acceleration} m/s²</b></span>
        </div>
        {state.ahead && aheadDistance !== null && (
          <p className="phone-ahead" role="status">
            Train devant <b>{aheadLabel(aheadDistance, state.ahead)}</b>
          </p>
        )}
        {/* Only on a network that has signals: it does not come or go while driving */}
        {view.signals && <SignalPanel signals={view.signals} />}
        {!state.brake && <p className="console-note">Pas de frein à air : la commande freine directement.</p>}
      </section>

      {state.brake && (
        <BrakePad command={state.brake.command} disabled={state.emergencyBrake} onCommand={onCommand}>
          <span className={`console-pill tone-${state.brake.tone}`}>{view.brakeLabel}</span>
          <span className="thumb-pad-air" title="Conduite générale et cylindres de frein, bar">
            CG <b>{decimal(state.brake.pipeBar, 1)}</b> · CF <b>{decimal(state.brake.cylinderBar, 1)}</b>
          </span>
        </BrakePad>
      )}

      <TractionPad state={state} stops={notchStops(state)} title={view.legacy ? 'Commande' : 'Traction'} onCommand={onCommand}>
        <span className={`thumb-pad-value side-${view.handleSide}`}>{view.handleLabel}</span>
        <div className={`console-bar side-${view.handleSide}`} style={effort}><i /></div>
      </TractionPad>

      <footer className="phone-foot">
        <ReverserControl {...parts} />
        {!view.legacy && (
          <>
            {/* Always there, so the emergency stop never slides under a thumb */}
            <button
              type="button"
              className="phone-btn phone-cab"
              disabled={!canSwitchCab}
              aria-label="Changer de cabine"
              onClick={() => onCommand({ type: 'switchCab' })}
            >
              Cabine
            </button>
            <button
              type="button"
              className={`phone-btn phone-estop${state.emergencyBrake ? ' is-active' : ''}`}
              onClick={() => onCommand({ type: 'emergencyBrake' })}
            >
              {state.emergencyBrake ? view.emergencyLabel : 'Arrêt d’urgence'}
            </button>
          </>
        )}
      </footer>

      <DerailmentPanel view={view} onCommand={onCommand} />
    </div>
  )
}
