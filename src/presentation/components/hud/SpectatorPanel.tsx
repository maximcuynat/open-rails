import type { EditorStore } from '@application/state/editorStore'
import { applyConsoleCommand } from '@application/console/consoleCommands'
import { buildFleet } from '@application/console/consoleState'
import { SPECTATOR_STATUS_LABELS, spectatorRows } from './spectatorModel'

interface SpectatorPanelProps {
  store: EditorStore
  /** Cuts the link with the phone: the console comes back on this screen */
  onCutLink: () => void
}

/**
 * SpectatorPanel — what the PC shows in place of the driving console while a phone holds the
 * desk: the trains of the layout and what each is doing. This screen only watches: a click on a
 * train makes the camera follow it, nothing here drives.
 */
export function SpectatorPanel({ store, onCutLink }: SpectatorPanelProps) {
  const freeView = !store.followLocomotiveCamera
  const rows = spectatorRows(buildFleet(store), store.spectatedTrainId, freeView)

  return (
    <section className="spectator-panel" aria-label="Mode spectateur">
      <header className="spectator-header">
        <span className="spectator-title">Spectateur</span>
        <span className="spectator-note">Le téléphone conduit</span>
      </header>

      <ul className="spectator-list">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={`spectator-row${row.followed ? ' is-followed' : ''}`}
              aria-pressed={row.followed}
              title={row.followed ? 'La vue suit ce train' : 'Suivre ce train'}
              onClick={() => store.spectateTrain(row.status === 'driven' ? null : row.id)}
            >
              <span className={`spectator-dot is-${row.status}`} aria-hidden="true" />
              <span className="spectator-name">
                {row.title}
                <span className="spectator-consist">{row.consist}</span>
              </span>
              <span className="spectator-state">
                <span className="spectator-speed">{row.speed}</span>
                <span className="spectator-status">{SPECTATOR_STATUS_LABELS[row.status]}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <footer className="spectator-actions">
        <button
          type="button"
          className={`spectator-action${freeView ? ' is-active' : ''}`}
          aria-pressed={freeView}
          title="Ne suivre aucun train : la vue se déplace librement"
          onClick={() => (freeView ? store.spectateTrain(store.spectatedTrainId) : store.setSpectatorFreeView())}
        >
          Vue libre
        </button>
        <button type="button" className="spectator-action" title="Couper la liaison : le poste de conduite revient sur cet écran" onClick={onCutLink}>
          Reprendre la main
        </button>
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
