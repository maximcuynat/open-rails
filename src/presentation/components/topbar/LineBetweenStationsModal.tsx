import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorStore } from '@application/state/editorStore'
import { datasetErrorMessage, loadDatasetIndex, type LineFetchProgress } from '@application/dataset/datasetClient'
import { loadJourney } from '@application/dataset/journeyLoader'
import { formatDataDate, type Figure } from '@application/import/osmReport'
import type { DatasetIndex } from '@domain/dataset/datasetIndex'
import { EMPTY_PLAN, addStop, moveStop, previewJourney, removeStop, type JourneyPlan } from '@domain/dataset/journeyPlan'
import { searchStations, stationBadge } from '@domain/dataset/stationSearch'
import { Figures } from '../common/Figures'
import { showToast } from '../common/Toast'

interface LineBetweenStationsModalProps {
  store: EditorStore
  onClose: () => void
}

type Phase = 'plan' | 'loading' | 'error'

/**
 * « Ligne entre gares… » : the stations of the published « LGV France » dataset are searched in
 * its index, put in order, and the lines of the journey through them are fetched and loaded as
 * a locked project. Mounted when opened and unmounted when closed: every opening starts blank.
 * It has its own buttons: `Modal` closes as soon as its confirm button is pressed, which does not
 * suit a download.
 */
export function LineBetweenStationsModal({ store, onClose }: LineBetweenStationsModalProps) {
  const [index, setIndex] = useState<DatasetIndex | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [plan, setPlan] = useState<JourneyPlan>(EMPTY_PLAN)
  const [phase, setPhase] = useState<Phase>('plan')
  const [progress, setProgress] = useState<LineFetchProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  const results = useMemo(() => (index ? searchStations(index, query, 8).filter((m) => !plan.stops.includes(m.station.id)) : []), [index, query, plan])
  const preview = useMemo(() => (index ? previewJourney(index, plan) : null), [index, plan])
  const stationName = (id: string): string => index?.stations.find((s) => s.id === id)?.name ?? id
  const stationLines = (id: string): string => {
    const station = index?.stations.find((s) => s.id === id)
    return station ? station.lines.map((lineId) => index?.lines.find((l) => l.id === lineId)?.name ?? lineId).join(', ') : ''
  }

  const choose = (id: string) => {
    setPlan((p) => addStop(p, id))
    setQuery('')
    setActive(0)
    input.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const match = results[active]
      if (match) choose(match.station.id)
    }
  }

  const replaces = store.network.segments.size > 0
  const canLoad = !!index && !!preview?.route && !loading

  const load = async () => {
    if (!index || !preview?.route) return
    setPhase('loading')
    setError(null)
    setProgress({ done: 0, total: preview.route.lines.length })
    try {
      await loadJourney(store, index, plan.stops, { onProgress: setProgress })
      showToast(`Ligne « ${store.projectName} » chargée`, 'success')
      onClose()
    } catch (e) {
      setError(datasetErrorMessage(e))
      setPhase('error')
    }
  }

  const figures: Figure[] = preview?.route
    ? [
        { label: preview.route.lines.length > 1 ? 'lignes' : 'ligne', value: String(preview.route.lines.length) },
        { label: 'de voie', value: preview.lengthLabel.replace(' de voie', '') },
        { label: 'à télécharger', value: preview.sizeLabel.replace(' à télécharger', '') },
        { label: 'données du', value: index ? formatDataDate(index.dataDate) : '' },
      ]
    : []

  return (
    <div className="modal-backdrop" onClick={loading ? undefined : onClose}>
      <div className="modal-dialog modal-dialog-wide osm-dialog dataset-dialog" role="dialog" aria-modal="true" aria-label="Ligne entre gares" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Ligne entre gares</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Fermer" disabled={loading}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="settings-container">
            <div className="settings-section">
              <label className="settings-label" htmlFor="dataset-station">
                Gares
                <span className="settings-hint">Les gares du réseau à grande vitesse français et de ses raccordements, dans l’ordre du trajet</span>
              </label>
              <input
                id="dataset-station"
                ref={input}
                className="settings-input dataset-station-input"
                value={query}
                placeholder={index ? 'Marseille Saint-Charles, Lyon Part-Dieu…' : 'Lecture de l’index…'}
                autoComplete="off"
                spellCheck={false}
                disabled={!index || loading}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKeyDown}
              />
              {indexError && (
                <p className="osm-message is-error" role="alert">
                  {indexError}{' '}
                  <button type="button" className="modal-btn modal-btn-secondary" onClick={readIndex}>
                    Réessayer
                  </button>
                </p>
              )}
              {query.trim() && results.length === 0 && index && <p className="osm-message">Aucune gare de ce nom sur ces lignes.</p>}
              {results.length > 0 && (
                <ul className="osm-results" aria-label="Gares trouvées">
                  {results.map((match, i) => (
                    <li key={match.station.id}>
                      <button
                        type="button"
                        className={`osm-result${i === active ? ' is-active' : ''}`}
                        aria-pressed={i === active}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(match.station.id)}
                      >
                        <span className="osm-result-name">{match.station.name}</span>
                        <span className="osm-result-kind">{stationBadge(match)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {plan.stops.length > 0 && (
                <ol className="dataset-stops" aria-label="Gares du trajet">
                  {plan.stops.map((id, i) => (
                    <li className="dataset-stop" key={id}>
                      <span className="dataset-stop-index">{i + 1}</span>
                      <span className="dataset-stop-name">
                        {stationName(id)}
                        <span className="dataset-stop-lines">{stationLines(id)}</span>
                      </span>
                      <span className="dataset-stop-actions">
                        <button type="button" className="modal-btn modal-btn-secondary" aria-label="Monter" disabled={i === 0 || loading} onClick={() => setPlan((p) => moveStop(p, i, -1))}>
                          ↑
                        </button>
                        <button type="button" className="modal-btn modal-btn-secondary" aria-label="Descendre" disabled={i === plan.stops.length - 1 || loading} onClick={() => setPlan((p) => moveStop(p, i, 1))}>
                          ↓
                        </button>
                        <button type="button" className="modal-btn modal-btn-secondary" aria-label="Retirer" disabled={loading} onClick={() => setPlan((p) => removeStop(p, i))}>
                          ✕
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {plan.stops.length === 1 && <p className="osm-message">Ajoutez la gare d’arrivée.</p>}
            </div>

            {preview && (
              <div className="settings-section">
                <div className="settings-label">
                  {preview.name}
                  {preview.route && <span className="settings-hint">{preview.lineNames.join(' › ')}</span>}
                </div>
                {preview.route && <Figures figures={figures} wide />}
                {preview.problem && (
                  <p className="osm-message is-error" role="alert">
                    {preview.problem}
                  </p>
                )}
                {error && (
                  <p className="osm-message is-error" role="alert">
                    {error}
                  </p>
                )}
                {preview.route && (
                  <p className="osm-note">
                    {replaces ? 'Le réseau actuel sera remplacé par la ligne choisie, sans retour en arrière. ' : ''}
                    La voie chargée n’est pas modifiable ; trains et conduite restent libres. Le projet n’enregistre que sa recette : les lignes sont rechargées à l’ouverture.
                  </p>
                )}
                {preview.route &&
                  preview.attribution.map((line) => (
                    <p className="osm-note dataset-attribution" key={line}>
                      {line}
                    </p>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          {loading && progress && (
            <span className="osm-footer-status" role="status">
              {progress.done} {progress.total > 1 ? 'fichiers' : 'fichier'} sur {progress.total}
            </span>
          )}
          <button type="button" className="modal-btn modal-btn-secondary" onClick={onClose} disabled={loading}>
            Annuler
          </button>
          <button type="button" className={`modal-btn ${replaces ? 'modal-btn-danger' : 'modal-btn-primary'}`} disabled={!canLoad} onClick={() => void load()}>
            {loading ? 'Chargement…' : replaces ? 'Charger et remplacer' : 'Charger'}
          </button>
        </div>
      </div>
    </div>
  )
}
