import type { EditorStore } from '@application/state/editorStore'
import { applyConsoleCommand } from '@application/console/consoleCommands'
import { buildFleet } from '@application/console/consoleState'
import { pointsAhead } from '@application/console/dispatcher'
import { showToast } from '../common/Toast'
import { dispatcherPointsRows, dispatcherTrainRows } from './dispatcherModel'

interface DispatcherPanelProps {
  store: EditorStore
  /** Desks are seated: cutting the link sends them away */
  linked: boolean
  onCutLink: () => void
}

/**
 * DispatcherPanel — the board of whoever sets the routes while trains run: every train with its
 * driver (this screen, a phone desk by its name, nobody), and the points that lie ahead of the
 * driven trains with the way they are set. A click on a train makes the view follow it — and
 * drive it from this screen when no desk holds it; a click on a set of points shows it, its
 * button throws it.
 */
export function DispatcherPanel({ store, linked, onCutLink }: DispatcherPanelProps) {
  const freeView = !store.followLocomotiveCamera
  const trains = dispatcherTrainRows(buildFleet(store), store.selectedTrainId, freeView)
  const points = dispatcherPointsRows(pointsAhead(store))

  const throwPoints = (junctionId: string) => {
    if (!store.toggleActiveJunction(junctionId)) showToast(store.junctionRefusalMessage, 'warning')
  }

  return (
    <section className="spectator-panel dispatcher-panel" aria-label="Tableau de l’aiguilleur">
      <header className="spectator-header">
        <span className="spectator-title">Aiguilleur</span>
        <span className="spectator-note">{store.isSpectating ? `Ce train est conduit par ${store.driverName(store.driverOf(store.selectedTrainId ?? '')) ?? 'un pupitre'}` : 'Trains et aiguillages'}</span>
      </header>

      <ul className="spectator-list">
        {trains.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={`spectator-row${row.followed ? ' is-followed' : ''}`}
              aria-pressed={row.followed}
              title={row.followed ? 'La vue suit ce train' : row.held === 'desk' ? 'Suivre ce train' : 'Suivre et conduire ce train'}
              onClick={() => store.spectateTrain(row.id)}
            >
              <span className={`spectator-dot ${row.held === 'free' ? 'is-stopped' : 'is-driven'}`} aria-hidden="true" />
              <span className="spectator-name">
                {row.title}
                <span className="spectator-consist">{row.consist}</span>
              </span>
              <span className="spectator-state">
                <span className="spectator-speed">{row.speed}</span>
                <span className={`spectator-status dispatcher-driver is-${row.held}`}>{row.driver}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {points.length > 0 && (
        <ul className="spectator-list dispatcher-points" aria-label="Aiguillages à venir">
          {points.map((row) => (
            <li key={row.junctionId} className="dispatcher-points-row">
              <button type="button" className="spectator-row" title="Montrer cet aiguillage" onClick={() => store.showPlace(row.x, row.y)}>
                <span className="spectator-name">
                  {row.title}
                  <span className="spectator-consist">{row.lock || 'Aiguillage'}</span>
                </span>
                <span className="spectator-state">
                  <span className="spectator-speed">{row.position}</span>
                </span>
              </button>
              <button
                type="button"
                className="spectator-action"
                disabled={!row.canThrow}
                title={row.canThrow ? 'Changer la position de cet aiguillage' : `${row.lock} : il ne peut pas être manœuvré`}
                onClick={() => throwPoints(row.junctionId)}
              >
                Basculer
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="spectator-actions">
        <button
          type="button"
          className={`spectator-action${freeView ? ' is-active' : ''}`}
          aria-pressed={freeView}
          title="Ne suivre aucun train : la vue se déplace librement"
          onClick={() => (freeView ? store.spectateTrain(null) : store.setSpectatorFreeView())}
        >
          Vue libre
        </button>
        {linked && (
          <button type="button" className="spectator-action" title="Couper la liaison : les pupitres sont renvoyés, leurs trains s’arrêtent" onClick={onCutLink}>
            Couper la liaison
          </button>
        )}
        <button
          type="button"
          className="spectator-action is-danger"
          title={`Quitter la conduite${store.shortcutHint('drive.exit')} : tous les trains s’arrêtent`}
          onClick={() => applyConsoleCommand(store, { type: 'releaseControls' })}
        >
          Quitter
        </button>
      </footer>
    </section>
  )
}
