import { useMemo, useState } from 'react'
import type { EditorStore } from '@application/state/editorStore'
import { DRIVING_AIDS, DRIVING_AID_LABELS } from '@application/game/drivingAid'
import { addItineraryStop, buildItineraryView, removeItineraryStop, stationRefs } from '@application/game/itinerary'
import { showToast } from '../common/Toast'
import { formatRouteDistance, formatRouteDuration, routeStatusNote, stationChoices } from './itineraryModel'

interface ItineraryPanelProps {
  store: EditorStore
}

/**
 * ItineraryPanel — where the driven train is going, top right of the driving view: the station
 * it left, the next one with the distance to it, the stations after it down to the destination.
 * A station typed is put where it belongs on the way (see `withStop`), a station ahead can be
 * taken out. Shown while driving a train on a project that has stations.
 */
export function ItineraryPanel({ store }: ItineraryPanelProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const train = store.isPlayMode ? store.selectedTrain : null
  const index = store.datasetIndex
  const stationCount = store.network.stations.size + (index?.stations.length ?? 0)
  const refs = useMemo(() => stationRefs(store), [store, index, store.network, stationCount])
  if (!train || refs.size === 0) return null

  const view = buildItineraryView(store, train)
  const taken = new Set(view?.stops.map((stop) => stop.id) ?? [])
  const choices = stationChoices(index, refs, query, taken)
  const note = view ? routeStatusNote(view.status) : null

  const choose = (id: string) => {
    const refusal = addItineraryStop(store, train, id)
    if (refusal) showToast(refusal, 'warning', 5000)
    setQuery('')
    setActive(0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, choices.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (choices[active]) choose(choices[active].id)
    } else if (e.key === 'Escape') {
      // The field only: Escape must not also leave the driving
      e.stopPropagation()
      setQuery('')
      e.currentTarget.blur()
    }
  }

  return (
    <aside className="itinerary-panel" aria-label="Itinéraire">
      <div className="itinerary-head">
        <span className="itinerary-title">Itinéraire</span>
        {view?.origin && <span className="itinerary-origin">depuis {view.origin}</span>}
      </div>

      {view?.status === 'arrived' && <p className="itinerary-arrived">Arrivé à {view.origin}</p>}

      {view?.next && (
        <div className="itinerary-next">
          <span className="itinerary-next-label">{view.stops.length > 1 ? 'Prochaine gare' : 'Destination'}</span>
          <span className="itinerary-next-name">{view.next}</span>
          <span className="itinerary-next-distance">
            {formatRouteDistance(view.distance, view.exact)}
            {view.duration !== null && view.status === 'ok' ? ` · ${formatRouteDuration(view.duration)}` : ''}
            {view.platform ? ` · voie ${view.platform}` : ''}
          </span>
          {note && (
            <span className="itinerary-note" role="status">
              {note}
            </span>
          )}
          {view.pointsAgainst !== null && (
            <span className="itinerary-note" role="status">
              Aiguille à {formatRouteDistance(view.pointsAgainst, true)} orientée hors du chemin.
            </span>
          )}
        </div>
      )}

      {view && view.stops.length > 0 && (
        <ol className="itinerary-stops" aria-label="Gares à venir">
          {view.stops.map((stop, i) => (
            <li className={`itinerary-stop${i === 0 ? ' is-next' : ''}`} key={stop.id}>
              <span className="itinerary-stop-name">{stop.name}</span>
              {i === view.stops.length - 1 && view.stops.length > 1 && (
                <span className="itinerary-stop-tag">
                  {formatRouteDistance(view.total, false)}
                  {view.totalDuration !== null && view.status === 'ok' ? ` · ${formatRouteDuration(view.totalDuration)}` : ''}
                </span>
              )}
              <button type="button" className="itinerary-remove" aria-label={`Retirer ${stop.name}`} onClick={() => removeItineraryStop(store, train, stop.index)}>
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}

      <input
        className="itinerary-input"
        value={query}
        placeholder={view?.next ? 'Ajouter une étape…' : 'Choisir une destination…'}
        aria-label={view?.next ? 'Ajouter une étape' : 'Choisir une destination'}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      {query.trim() && choices.length === 0 && <p className="itinerary-empty">Aucune gare de ce nom.</p>}
      {choices.length > 0 && (
        <ul className="itinerary-choices" aria-label="Gares trouvées">
          {choices.map((choice, i) => (
            <li key={choice.id}>
              <button type="button" className={`itinerary-choice${i === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => choose(choice.id)}>
                {choice.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="itinerary-aid" role="radiogroup" aria-label="Aide à la conduite">
        <span className="itinerary-aid-label">Aide</span>
        {DRIVING_AIDS.map((aid) => (
          <button
            type="button"
            role="radio"
            aria-checked={store.drivingAid === aid}
            className={`itinerary-aid-choice${store.drivingAid === aid ? ' is-active' : ''}`}
            title={DRIVING_AID_LABELS[aid].detail}
            key={aid}
            onClick={() => store.setDrivingAid(aid)}
          >
            {DRIVING_AID_LABELS[aid].name}
          </button>
        ))}
      </div>
    </aside>
  )
}
