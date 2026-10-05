import type { CSSProperties } from 'react'
import type { ConsoleCommand, ConsoleState, FleetEntry } from '@application/console/consoleContract'
import { HalfGauge } from '@presentation/components/console/instruments'
import {
  BrakeLever,
  DerailmentPanel,
  LimitBoard,
  NextLimitBoard,
  ReverserControl,
  SpeedCaption,
  ThrottleLever,
} from '@presentation/components/console/consoleParts'
import {
  BRAKE_CYLINDER_GAUGE,
  BRAKE_PIPE_GAUGE,
  consoleView,
  notchStops,
} from '@presentation/components/console/consoleModel'
import { trainTitle } from './deskView'

/**
 * The desk of a phone held upright: the speed on top, the two pressure gauges, then the brake
 * lever under the left thumb and the traction lever under the right one. Built from the
 * instruments of the PC consoles; it sits in a `ScaledStage`.
 */
export function PortraitDesk({ state, fleet, canSwitchCab, onCommand }: {
  state: ConsoleState
  fleet: readonly FleetEntry[]
  canSwitchCab: boolean
  onCommand: (command: ConsoleCommand) => void
}) {
  const view = consoleView(state, fleet)
  const parts = { state, fleet, view, onCommand }
  const speed = { '--phone-speed': view.speedRatio } as CSSProperties
  const effort = { '--console-effort': `${view.handlePercent}%` } as CSSProperties
  return (
    <div className="console-stage phone-portrait">
      <section className="phone-panel phone-speed">
        <div className="phone-speed-head">
          <span className="console-lbl">{trainTitle(state, fleet)}</span>
          <span className="console-lbl">{view.composition}</span>
        </div>
        <div className="phone-speed-row">
          <div className="phone-speed-num">
            <div className={`phone-speed-value speed-${view.speedTone}`}>{view.kmh}</div>
            <div className="phone-speed-unit"><SpeedCaption view={view} unit={`KM/H · MAX ${view.maxKmh}`} /></div>
          </div>
          <div className="console-stats">
            <span>Accél.</span><b>{view.acceleration} m/s²</b>
            <span>Pente</span><b>{view.gradient}</b>
            <span>Arrêt en</span><b>{view.stopping}</b>
            <span>Limite</span><b><LimitBoard view={view} /></b>
            <span>Proch.</span><b><NextLimitBoard view={view} /></b>
          </div>
        </div>
        <div className="phone-speed-scale">
          <div className={`phone-speed-bar speed-${view.speedTone}`} style={speed} role="img" aria-label={`${view.kmh} km/h sur ${view.maxKmh}`}><i /></div>
          {view.limit && <span className="phone-limit-mark" style={{ left: `${view.limit.ratio * 100}%` }} />}
          {view.nextLimit && <span className="phone-limit-mark is-next" style={{ left: `${view.nextLimit.ratio * 100}%` }} />}
        </div>
      </section>

      <section className="phone-panel phone-air">
        {state.brake ? (
          <div className="console-gauges">
            <HalfGauge value={state.brake.pipeBar} spec={BRAKE_PIPE_GAUGE} tone="blue" name="CG" title="Conduite générale" />
            <HalfGauge value={state.brake.cylinderBar} spec={BRAKE_CYLINDER_GAUGE} tone="red" name="CF" title="Cylindres de frein" />
          </div>
        ) : (
          <p className="console-note">Cette locomotive n’a pas de frein à air : sa commande freine directement.</p>
        )}
        <div className="phone-air-side">
          <span className="console-lbl">{view.legacy ? 'Sens' : 'Inverseur'}</span>
          <ReverserControl {...parts} />
          {state.brake && <span className={`console-pill tone-${state.brake.tone}`}>{view.brakeLabel}</span>}
        </div>
      </section>

      <section className="phone-levers">
        {state.brake && (
          <div className="phone-panel phone-lever-box is-brake">
            <span className="console-lbl">Frein</span>
            <div className="phone-lever-fit">
              <BrakeLever command={state.brake.command} disabled={state.emergencyBrake} onCommand={onCommand} />
            </div>
          </div>
        )}
        {!view.legacy && (
          <div className="phone-levers-mid">
            <button
              type="button"
              className={`console-estop phone-estop${state.emergencyBrake ? ' is-active' : ''}`}
              onClick={() => onCommand({ type: 'emergencyBrake' })}
            >
              {state.emergencyBrake ? view.emergencyLabel : <>ARRÊT<br />URGENCE</>}
            </button>
            {/* In the slack of this column: appearing at rest, it moves no lever under a thumb */}
            {canSwitchCab && (
              <button type="button" className="phone-btn phone-cab" onClick={() => onCommand({ type: 'switchCab' })}>
                Changer<br />de cabine
              </button>
            )}
            <div className="phone-handle">
              <span className="console-lbl">{view.handleTitle}</span>
              <span className={`phone-handle-value side-${view.handleSide}`}>{view.handleLabel}</span>
              <div className={`console-bar side-${view.handleSide}`} style={effort}><i /></div>
            </div>
          </div>
        )}
        <div className="phone-panel phone-lever-box">
          <span className="console-lbl">{view.legacy ? 'Commande' : 'Traction'}</span>
          <div className="phone-lever-fit">
            <ThrottleLever state={state} stops={notchStops(state)} onCommand={onCommand} />
          </div>
        </div>
      </section>
      <DerailmentPanel view={view} onCommand={onCommand} />
    </div>
  )
}
