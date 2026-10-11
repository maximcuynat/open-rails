import type { EditorStore } from '@application/state/editorStore'
import { SANDBOX_TRAINS } from '@application/game/sandbox'
import { ROLLING_STOCK, DEFAULT_ROLLING_STOCK } from '@domain/models/rollingStock'

/** Asks the top bar for the window that sets a train down at a station (see `TopBar`) */
export const OPEN_SANDBOX_EVENT = 'rail:open-sandbox'

/**
 * FreeViewPanel — what this screen shows once its train was left to the automatic pilot: the
 * trains that run, each to be taken back with a click, and a train to set down — on the track
 * with a click, or at a station. Nothing here lays track: while trains run the track is theirs.
 */
export function FreeViewPanel({ store }: { store: EditorStore }) {
  if (!store.isFreeView) return null
  const armed = store.rakePlacement
  return (
    <aside className="itinerary-panel free-view-panel" aria-label="Vue libre">
      <div className="itinerary-head">
        <span className="itinerary-title">Vue libre</span>
        <span className="itinerary-origin">les trains continuent</span>
      </div>

      <ul className="spectator-list" aria-label="Trains en marche">
        {store.trains.map((train, i) => {
          const piloted = store.autopilots.has(train.id)
          const kmh = Math.round(train.currentSpeed * 3.6)
          return (
            <li key={train.id}>
              <button type="button" className="spectator-row" title="Reprendre ce train" onClick={() => store.spectateTrain(train.id)}>
                <span className={`spectator-dot ${piloted ? 'is-driven' : 'is-stopped'}`} aria-hidden="true" />
                <span className="spectator-name">
                  T{i + 1} · {ROLLING_STOCK[train.vehicles[0]?.model ?? DEFAULT_ROLLING_STOCK].label}
                </span>
                <span className="spectator-state">
                  <span className="spectator-speed">{kmh > 0 ? `${kmh} km/h` : 'À l’arrêt'}</span>
                  <span className="spectator-status">{piloted ? 'Pilote auto' : 'Libre'}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="free-view-place">
        <span className="itinerary-next-label">Poser un train</span>
        <div className="free-view-models" role="radiogroup" aria-label="Train à poser">
          {SANDBOX_TRAINS.filter((choice) => choice.model).map((choice) => (
            <button
              type="button"
              role="radio"
              aria-checked={armed === choice.model}
              className={`itinerary-aid-choice${armed === choice.model ? ' is-active' : ''}`}
              key={choice.id}
              onClick={() => store.armRakePlacement(armed === choice.model ? null : choice.model!)}
            >
              {choice.name}
            </button>
          ))}
        </div>
        <p className="itinerary-empty">{armed ? 'Cliquez sur la voie, là où poser la tête du train.' : 'Choisissez un train, puis cliquez sur la voie.'}</p>
        <button type="button" className="itinerary-aid-choice" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SANDBOX_EVENT))}>
          Dans une gare…
        </button>
      </div>
    </aside>
  )
}
