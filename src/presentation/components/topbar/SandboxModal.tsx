import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorStore } from '@application/state/editorStore'
import type { ConsolePreference } from '@application/console/consolePreference'
import { datasetErrorMessage, loadDatasetIndex, type LineFetchProgress } from '@application/dataset/datasetClient'
import { prepareSandbox, SANDBOX_TRAINS, sandboxErrorMessage, type SandboxStart } from '@application/game/sandbox'
import type { DatasetIndex } from '@domain/dataset/datasetIndex'
import { searchStations, stationBadge, type StationMatch } from '@domain/dataset/stationSearch'

interface SandboxModalProps {
  store: EditorStore
  /** Opens the room of the phone desks and shows its window */
  onPhoneDesk: () => void
  onClose: () => void
}

type Phase = 'setup' | 'loading' | 'desk'

const PC_CONSOLES: readonly { preference: ConsolePreference; name: string; detail: string }[] = [
  { preference: 'auto', name: 'Automatique', detail: 'Le pupitre qui convient à la fenêtre' },
  { preference: 'band', name: 'Bandeau', detail: 'Une bande d’instruments en bas de l’écran' },
  { preference: 'screen', name: 'Écran de bord', detail: 'Le poste complet, cadrans et manomètres' },
  { preference: 'levers', name: 'Manettes', detail: 'Deux manettes, pour une petite fenêtre' },
]

/**
 * « Bac à sable » : the first game mode. A station to start from and a train are chosen, the
 * lines of the station are fetched and a complete rake is set down at a platform; the player then
 * says where the train is driven from — a phone, or a console of this screen — and the driving
 * begins. Mounted when opened and unmounted when closed: every opening starts blank.
 */
export function SandboxModal({ store, onPhoneDesk, onClose }: SandboxModalProps) {
  const [index, setIndex] = useState<DatasetIndex | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [station, setStation] = useState<StationMatch | null>(null)
  const [trainId, setTrainId] = useState(SANDBOX_TRAINS[0].id)
  const [phase, setPhase] = useState<Phase>('setup')
  const [progress, setProgress] = useState<LineFetchProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [start, setStart] = useState<SandboxStart | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const loading = phase === 'loading'

  const readIndex = () => {
    setIndexError(null)
    loadDatasetIndex()
      .then(setIndex)
      .catch((e: unknown) => setIndexError(datasetErrorMessage(e)))
  }

  useEffect(() => {
    input.current?.focus()
    readIndex()
  }, [])

  // Escape closes, unless a download is on its way
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (!loading) onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [loading, onClose])

  const results = useMemo(() => (index && !station ? searchStations(index, query, 8) : []), [index, query, station])
  const train = SANDBOX_TRAINS.find((t) => t.id === trainId)
  const replaces = store.network.segments.size > 0
  const canStart = !!index && !!station && !!train?.model && !loading

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[active]) setStation(results[active])
    }
  }

  const launch = async () => {
    if (!index || !station || !train?.model) return
    setPhase('loading')
    setError(null)
    setProgress({ done: 0, total: station.lines.length })
    try {
      setStart(await prepareSandbox(store, index, station.station.id, train.model, { onProgress: setProgress }))
      setPhase('desk')
    } catch (e) {
      setError(sandboxErrorMessage(e))
      setPhase('setup')
    }
  }

  const driveHere = (preference: ConsolePreference) => {
    store.setConsolePreference(preference)
    if (!store.isPlayMode) store.togglePlayMode()
    onClose()
  }

  const driveFromPhone = () => {
    if (!store.isPlayMode) store.togglePlayMode()
    onPhoneDesk()
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={loading ? undefined : onClose}>
      <div className="modal-dialog modal-dialog-wide osm-dialog dataset-dialog" role="dialog" aria-modal="true" aria-label="Bac à sable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{phase === 'desk' ? 'Prendre les commandes' : 'Bac à sable'}</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Fermer" disabled={loading}>
            ✕
          </button>
        </div>

        {phase === 'desk' && start ? (
          <div className="modal-body">
            <div className="settings-container">
              <div className="settings-section">
                <div className="settings-label">
                  {train?.name} à quai — {start.stationName}
                  {start.stop.ref ? `, voie ${start.stop.ref}` : ''}
                  <span className="settings-hint">D’où voulez-vous conduire ?</span>
                </div>
                <div className="sandbox-choices">
                  <button type="button" className="sandbox-choice" onClick={driveFromPhone}>
                    <span className="sandbox-choice-name">Téléphone</span>
                    <span className="sandbox-choice-detail">Le téléphone devient le pupitre (QR code), cet écran montre la voie</span>
                  </button>
                </div>
              </div>
              <div className="settings-section">
                <div className="settings-label">
                  Pupitre sur cet écran
                  <span className="settings-hint">Modifiable ensuite dans Affichage ▸ Pupitre de conduite</span>
                </div>
                <div className="sandbox-choices">
                  {PC_CONSOLES.map((choice) => (
                    <button type="button" className="sandbox-choice" key={choice.preference} onClick={() => driveHere(choice.preference)}>
                      <span className="sandbox-choice-name">{choice.name}</span>
                      <span className="sandbox-choice-detail">{choice.detail}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div className="settings-container">
              <div className="settings-section">
                <label className="settings-label" htmlFor="sandbox-station">
                  Gare de départ
                  <span className="settings-hint">Une gare du réseau à grande vitesse français et de ses raccordements</span>
                </label>
                {station ? (
                  <div className="dataset-stop">
                    <span className="dataset-stop-name">
                      {station.station.name}
                      <span className="dataset-stop-lines">{stationBadge(station)}</span>
                    </span>
                    <span className="dataset-stop-actions">
                      <button type="button" className="modal-btn modal-btn-secondary" disabled={loading} onClick={() => setStation(null)}>
                        Changer
                      </button>
                    </span>
                  </div>
                ) : (
                  <input
                    id="sandbox-station"
                    ref={input}
                    className="settings-input dataset-station-input"
                    value={query}
                    placeholder={index ? 'Marseille Saint-Charles, Lyon Part-Dieu…' : 'Lecture de l’index…'}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    disabled={!index || loading}
                    onChange={(e) => {
                      setQuery(e.target.value)
                      setActive(0)
                    }}
                    onKeyDown={onKeyDown}
                  />
                )}
                {indexError && (
                  <p className="osm-message is-error" role="alert">
                    {indexError}{' '}
                    <button type="button" className="modal-btn modal-btn-secondary" onClick={readIndex}>
                      Réessayer
                    </button>
                  </p>
                )}
                {!station && query.trim() && results.length === 0 && index && <p className="osm-message">Aucune gare de ce nom sur ces lignes.</p>}
                {results.length > 0 && (
                  <ul className="osm-results" aria-label="Gares trouvées">
                    {results.map((match, i) => (
                      <li key={match.station.id}>
                        <button type="button" className={`osm-result${i === active ? ' is-active' : ''}`} aria-pressed={i === active} onMouseEnter={() => setActive(i)} onClick={() => setStation(match)}>
                          <span className="osm-result-name">{match.station.name}</span>
                          <span className="osm-result-kind">{stationBadge(match)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="settings-section">
                <div className="settings-label">Train</div>
                <div className="sandbox-choices" role="radiogroup" aria-label="Train">
                  {SANDBOX_TRAINS.map((choice) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={choice.id === trainId}
                      className={`sandbox-choice${choice.id === trainId ? ' is-active' : ''}`}
                      key={choice.id}
                      disabled={!choice.model || loading}
                      onClick={() => setTrainId(choice.id)}
                    >
                      <span className="sandbox-choice-name">{choice.name}</span>
                      <span className="sandbox-choice-detail">{choice.detail}</span>
                    </button>
                  ))}
                </div>
                {error && (
                  <p className="osm-message is-error" role="alert">
                    {error}
                  </p>
                )}
                {station && (
                  <p className="osm-note">
                    {replaces ? 'Le réseau actuel sera remplacé par les lignes de la gare, sans retour en arrière. ' : ''}
                    Les lignes voisines se chargent à l’approche du train. La voie chargée n’est pas modifiable.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="modal-footer">
          {loading && progress && (
            <span className="osm-footer-status" role="status">
              {progress.done} {progress.total > 1 ? 'fichiers' : 'fichier'} sur {progress.total}
            </span>
          )}
          <button type="button" className="modal-btn modal-btn-secondary" onClick={onClose} disabled={loading}>
            {phase === 'desk' ? 'Plus tard' : 'Ouvrir l’éditeur'}
          </button>
          {phase !== 'desk' && (
            <button type="button" className={`modal-btn ${replaces ? 'modal-btn-danger' : 'modal-btn-primary'}`} disabled={!canStart} onClick={() => void launch()}>
              {loading ? 'Chargement…' : 'Lancer'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
