import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EditorStore } from '@application/state/editorStore'
import { loadOsmImport, osmProjectName, showOsmPlace } from '@application/import/osmProject'
import {
  controlNote,
  defaultSignalMode,
  formatBytes,
  formatCount,
  formatDataDate,
  groupIssues,
  osmSizeWarning,
  realSignalsInArea,
  reportFigures,
  reportNotes,
  signalModeHint,
  signalModeOf,
  signalNotes,
  surveyFigures,
  usesAutomaticSignals,
  usesRealSignals,
  type Figure,
  type OsmIssueGroup,
} from '@application/import/osmReport'
import { convertOsm, surveyOsm } from '@domain/import/osmImport'
import {
  DEFAULT_OSM_IMPORT_OPTIONS,
  OSM_ATTRIBUTION,
  OSM_COPYRIGHT_URL,
  type OsmExtraTrackKind,
  type OsmImportOptions,
  type OsmImportReport,
  type OsmSurvey,
  type OsmSignalMode,
  type OverpassResponse,
} from '@domain/import/osmTypes'
import { signalReport } from '@domain/models/signalReport'
import { DEFAULT_SIGNALLING_SETTINGS, type SignallingLevel } from '@domain/models/signals'
import { formatGeoPoint, looksLikeLink, parseLocation, type GeoPoint } from '@infrastructure/osm/locationInput'
import { isAbort, osmErrorMessage } from '@infrastructure/osm/osmError'
import {
  OSM_RADIUS_KM,
  OSM_RADIUS_WARNING_KM,
  areaProblem,
  areaSizeKm,
  estimateAnswerBytes,
  fetchOverpass,
  type OsmArea,
  type OverpassProgress,
} from '@infrastructure/osm/overpassClient'
import { readOverpassFile } from '@infrastructure/osm/overpassFile'
import { searchPlaces, type PlaceResult } from '@infrastructure/osm/placeSearch'
import { SIGNALLING_LEVEL_CHOICES } from '../settings/signallingSettingsModel'

/** Speeds offered for the service tracks, km/h: always picked in a list, by tens */
const SERVICE_SPEEDS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

const EXTRA_KINDS: readonly { kind: OsmExtraTrackKind; label: string }[] = [
  { kind: 'tram', label: 'Tram' },
  { kind: 'subway', label: 'Métro' },
  { kind: 'light_rail', label: 'Métro léger' },
  { kind: 'narrow_gauge', label: 'Voie étroite' },
]

/** The centre of the area, and the name it is known by */
interface Centre extends GeoPoint {
  /** What to show: the name of the place found, or the coordinates pasted */
  label: string
  /** Name of the place, to name the project after; absent for pasted coordinates */
  name?: string
}

/** The data to convert, and where it comes from */
interface Dataset {
  response: OverpassResponse
  /** One line saying what was loaded: « Gare de Lyon — rayon 2 km » or the name of the file */
  origin: string
  placeName?: string
  bytes?: number
}

type DownloadState =
  | { status: 'idle' }
  | { status: 'loading'; text: string; detail?: string }
  | { status: 'error'; message: string }

type Phase = 'setup' | 'converting' | 'report'

interface Outcome {
  report: OsmImportReport
  projectName: string
  /** What was done about the signals, and what the control report of the editor says of the result */
  signalNotes: string[]
}

function progressText(progress: OverpassProgress): { text: string; detail?: string } {
  const attempt = `Essai ${progress.attempt} sur ${progress.attempts} au plus`
  if (progress.phase === 'waiting') {
    return { text: `Serveurs occupés : nouvel essai dans ${progress.waitSeconds ?? 0} s…`, detail: 'Les serveurs publics d’OpenStreetMap sont souvent surchargés.' }
  }
  if (progress.phase === 'receiving') {
    return { text: `Réception depuis ${progress.server}…`, detail: progress.receivedBytes ? `${formatBytes(progress.receivedBytes)} reçus` : attempt }
  }
  return { text: `Demande à ${progress.server}…`, detail: attempt }
}

function parseRadius(text: string): number {
  return Number(text.replace(',', '.'))
}

function formatLength(km: number): string {
  return `${km.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`
}

/** Let the browser paint once before a long synchronous job */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })
}

function Figures({ figures, wide }: { figures: Figure[]; wide?: boolean }) {
  return (
    <dl className={`osm-figures${wide ? ' is-wide' : ''}`}>
      {figures.map((figure) => (
        <div className="osm-figure" key={figure.label}>
          <dd>{figure.value}</dd>
          <dt>{figure.label}</dt>
        </div>
      ))}
    </dl>
  )
}

function Option({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className={`settings-checkbox-row${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-checkbox-text">{children}</span>
    </label>
  )
}

interface OsmImportModalProps {
  store: EditorStore
  onClose: () => void
}

/**
 * Import of a real network from OpenStreetMap, in one window: where (a place, pasted coordinates
 * or a link, a radius — or a file saved from Overpass), what (the options), the count of what the
 * area holds, then the report of what was built.
 *
 * Mounted when opened and unmounted when closed: every opening starts from a blank window.
 * It has its own buttons: `Modal` closes as soon as its confirm button is pressed, which does not
 * suit a download followed by a conversion.
 */
export function OsmImportModal({ store, onClose }: OsmImportModalProps) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<PlaceResult[] | null>(null)
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  const [centre, setCentre] = useState<Centre | null>(null)
  const [radiusText, setRadiusText] = useState(String(OSM_RADIUS_KM.default))
  const [download, setDownload] = useState<DownloadState>({ status: 'idle' })
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [options, setOptions] = useState<OsmImportOptions>(DEFAULT_OSM_IMPORT_OPTIONS)
  /** Signalling level of the project to come: it reads the signals, it does not choose them */
  const [level, setLevel] = useState<SignallingLevel>(DEFAULT_SIGNALLING_SETTINGS.level)
  /** Once a signal box is ticked by hand, changing the level no longer proposes its own choice */
  const [signalsChosen, setSignalsChosen] = useState(false)
  const [phase, setPhase] = useState<Phase>('setup')
  const [convertError, setConvertError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  /** The place of the report being shown on the plan: the window then shrinks to a strip */
  const [locating, setLocating] = useState<{ kind: string; index: number } | null>(null)

  const placeInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)

  const loading = download.status === 'loading'
  const busy = loading || searching || phase === 'converting'

  useEffect(() => {
    placeInput.current?.focus()
    // Closing the window drops whatever request is still out
    return () => abort.current?.abort()
  }, [])

  const cancelRequest = useCallback(() => {
    abort.current?.abort()
    abort.current = null
  }, [])

  // Escape: stop the request in progress, else leave the plan view, else close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (phase === 'converting') return
      if (loading || searching) cancelRequest()
      else if (locating) setLocating(null)
      else onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [phase, loading, searching, locating, cancelRequest, onClose])

  const radiusKm = parseRadius(radiusText)
  const area: OsmArea | null = centre ? { kind: 'around', lat: centre.lat, lon: centre.lon, radiusKm } : null
  const radiusProblem = areaProblem({ kind: 'around', lat: centre?.lat ?? 0, lon: centre?.lon ?? 0, radiusKm })

  const onQueryChange = (text: string) => {
    setQuery(text)
    setSearchMessage(null)
    // Coordinates or a link are read on the spot: nothing is asked to anyone while typing
    const pasted = parseLocation(text)
    if (pasted) {
      setResults(null)
      setCentre({ ...pasted, label: formatGeoPoint(pasted) })
    }
  }

  const search = async () => {
    const text = query.trim()
    if (!text || busy) return
    const pasted = parseLocation(text)
    if (pasted) {
      setCentre({ ...pasted, label: formatGeoPoint(pasted) })
      return
    }
    if (looksLikeLink(text)) {
      setSearchMessage('Ce lien ne contient pas de position. Sur openstreetmap.org, copiez l’adresse de la page une fois la carte centrée (elle se termine par « #map=… »).')
      return
    }
    const controller = new AbortController()
    abort.current = controller
    setSearching(true)
    setSearchMessage(null)
    try {
      const found = await searchPlaces(text, { signal: controller.signal })
      setResults(found)
      const first = found[0]
      if (first) setCentre({ lat: first.lat, lon: first.lon, label: first.label, name: first.name })
    } catch (error) {
      if (!isAbort(error)) setSearchMessage(osmErrorMessage(error))
      setResults(null)
    } finally {
      if (abort.current === controller) abort.current = null
      setSearching(false)
    }
  }

  const startDownload = async () => {
    if (!area || !centre || radiusProblem || busy) return
    const controller = new AbortController()
    abort.current = controller
    let received = 0
    setDownload({ status: 'loading', text: 'Préparation de la requête…' })
    try {
      const response = await fetchOverpass(area, undefined, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.receivedBytes) received = progress.receivedBytes
          setDownload({ status: 'loading', ...progressText(progress) })
        },
      })
      setDataset({
        response,
        origin: `${centre.name ?? centre.label} — rayon de ${formatLength(radiusKm)}`,
        placeName: centre.name,
        bytes: received || undefined,
      })
      setDownload({ status: 'idle' })
    } catch (error) {
      setDownload(isAbort(error) ? { status: 'idle' } : { status: 'error', message: osmErrorMessage(error) })
    } finally {
      if (abort.current === controller) abort.current = null
    }
  }

  const openFile = async (file: File | undefined) => {
    if (!file) return
    setDownload({ status: 'loading', text: `Lecture de « ${file.name} »…` })
    try {
      const response = await readOverpassFile(file)
      setDataset({ response, origin: `Fichier « ${file.name} »`, bytes: file.size })
      setDownload({ status: 'idle' })
    } catch (error) {
      setDownload({ status: 'error', message: osmErrorMessage(error) })
    }
  }

  // Counted again whenever a box changes; the data is not asked again
  const survey = useMemo<{ value: OsmSurvey | null; failed: boolean }>(() => {
    if (!dataset) return { value: null, failed: false }
    try {
      return { value: surveyOsm(dataset.response, options), failed: false }
    } catch {
      return { value: null, failed: true }
    }
  }, [dataset, options])

  const runImport = async () => {
    if (!dataset || phase !== 'setup') return
    setConvertError(null)
    setPhase('converting')
    // The conversion holds the page for a while: the « Conversion… » state is painted first
    await nextPaint()
    try {
      const result = convertOsm(dataset.response, options)
      loadOsmImport(store, result, { levels: options.levels, placeName: dataset.placeName, signallingLevel: level })
      const control = controlNote(signalReport(store.network, { level, line: store.lineSettings }), level, store.network.signals.size)
      setOutcome({
        report: result.report,
        projectName: osmProjectName(dataset.placeName),
        signalNotes: [...signalNotes(result.report.signals), ...(control ? [control] : [])],
      })
      setPhase('report')
    } catch {
      setConvertError('La conversion a échoué : le projet en cours n’a pas été modifié. Essayez une zone plus petite ou d’autres options.')
      setPhase('setup')
    }
  }

  const set = <K extends keyof OsmImportOptions>(key: K, value: OsmImportOptions[K]) => setOptions((current) => ({ ...current, [key]: value }))
  const toggleKind = (kind: OsmExtraTrackKind, on: boolean) =>
    setOptions((current) => ({
      ...current,
      extraKinds: on ? [...current.extraKinds.filter((k) => k !== kind), kind] : current.extraKinds.filter((k) => k !== kind),
    }))

  const signalMode: OsmSignalMode = options.signals ?? 'generated'
  const chooseSignals = (real: boolean, automatic: boolean) => {
    setSignalsChosen(true)
    set('signals', signalModeOf(real, automatic))
  }
  const chooseLevel = (next: SignallingLevel) => {
    setLevel(next)
    if (!signalsChosen) set('signals', defaultSignalMode(next))
  }

  const groups = useMemo(() => (outcome ? groupIssues(outcome.report.issues) : []), [outcome])
  const located: { group: OsmIssueGroup; index: number } | null = useMemo(() => {
    if (!locating) return null
    const group = groups.find((g) => g.kind === locating.kind)
    return group && group.issues[locating.index] ? { group, index: locating.index } : null
  }, [groups, locating])

  const locate = (group: OsmIssueGroup, index: number) => {
    const count = group.issues.length
    const wrapped = ((index % count) + count) % count
    showOsmPlace(store, group.issues[wrapped])
    setLocating({ kind: group.kind, index: wrapped })
  }

  // --- The strip shown while a place of the report is on the plan ---
  if (phase === 'report' && located) {
    const issue = located.group.issues[located.index]
    const count = located.group.issues.length
    return (
      <>
        <PlaceMarker />
        <div className="osm-locator" role="dialog" aria-label="Lieu du bilan d’import">
          <div className="osm-locator-text">
            <b>
              {located.group.title} — {located.index + 1} / {count}
            </b>
            <span>
              {issue.detail ? `${issue.detail} · ` : ''}
              {issue.osmIds.length > 0 ? `OpenStreetMap n° ${issue.osmIds.join(', ')}` : 'Au centre de la vue'}
            </span>
          </div>
          <div className="osm-locator-actions">
            {count > 1 && (
              <>
                <button type="button" className="modal-btn modal-btn-secondary" onClick={() => locate(located.group, located.index - 1)}>
                  Précédent
                </button>
                <button type="button" className="modal-btn modal-btn-secondary" onClick={() => locate(located.group, located.index + 1)}>
                  Suivant
                </button>
              </>
            )}
            <button type="button" className="modal-btn modal-btn-primary" onClick={() => setLocating(null)}>
              Retour au bilan
            </button>
          </div>
        </div>
      </>
    )
  }

  const replaces = store.network.nodes.size > 0 || store.network.segments.size > 0
  const sizeWarning = survey.value ? osmSizeWarning(survey.value.estimatedRails) : null
  const nothingToImport = survey.value !== null && survey.value.ways === 0
  const size = area && !radiusProblem ? areaSizeKm(area) : null
  const weight = area && !radiusProblem ? estimateAnswerBytes(area) : null
  // A stray click outside must not throw a download away
  const closeOnBackdrop = phase === 'report' || (phase === 'setup' && !loading && !dataset)

  return (
    <div className="modal-backdrop" onClick={closeOnBackdrop ? onClose : undefined}>
      <div className="modal-dialog modal-dialog-wide osm-dialog" role="dialog" aria-modal="true" aria-label="Importer depuis OpenStreetMap" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{phase === 'report' ? 'Bilan de l’import' : 'Importer depuis OpenStreetMap'}</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Fermer" disabled={phase === 'converting'}>
            ✕
          </button>
        </div>

        {phase === 'report' && outcome ? (
          <div className="modal-body">
            <div className="settings-container">
              <div className="settings-section">
                <div className="settings-label">
                  {outcome.projectName}
                  <span className="settings-hint">Le réseau est chargé. Ctrl+Z ramène le projet précédent.</span>
                </div>
                <Figures figures={reportFigures(outcome.report)} wide />
                {reportNotes(outcome.report).map((note) => (
                  <p className="osm-note" key={note}>
                    {note}
                  </p>
                ))}
              </div>

              {outcome.signalNotes.length > 0 && (
                <div className="settings-section">
                  <div className="settings-label">
                    Signalisation
                    <span className="settings-hint">
                      Projet au niveau {SIGNALLING_LEVEL_CHOICES.find((choice) => choice.id === level)?.label.toLowerCase()} ; il se change dans les réglages sans toucher aux signaux.
                    </span>
                  </div>
                  {outcome.signalNotes.map((note) => (
                    <p className="osm-note" key={note}>
                      {note}
                    </p>
                  ))}
                </div>
              )}

              <div className="settings-section">
                <div className="settings-label">
                  À vérifier
                  <span className="settings-hint">
                    {groups.length > 0 ? 'Ce que l’import n’a pas pu trancher. « Voir » centre le plan sur chaque lieu, l’un après l’autre.' : 'Rien à signaler.'}
                  </span>
                </div>
                {groups.length > 0 && (
                  <ul className="osm-issues">
                    {groups.map((group) => (
                      <li className="osm-issue" key={group.kind}>
                        <span className="osm-issue-count">{formatCount(group.issues.length)}</span>
                        <span className="osm-issue-text">
                          <b>{group.title}</b>
                          <span>{group.meaning}</span>
                        </span>
                        <button type="button" className="modal-btn modal-btn-secondary" onClick={() => locate(group, 0)}>
                          Voir
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className="osm-note">
                Données{' '}
                <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">
                  {OSM_ATTRIBUTION}
                </a>
                , sous licence ODbL. La mention reste affichée sur le plan et suit le projet dans ses exports.
              </p>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div className="settings-container">
              {/* --- Zone --- */}
              {dataset ? (
                <div className="settings-section">
                  <div className="settings-label">Zone</div>
                  <div className="osm-loaded">
                    <span className="osm-loaded-text">
                      <b>{dataset.origin}</b>
                      <span>
                        {dataset.response.osm3s?.timestamp_osm_base ? `Données du ${formatDataDate(dataset.response.osm3s.timestamp_osm_base)}` : 'Date des données inconnue'}
                        {dataset.bytes ? ` · ${formatBytes(dataset.bytes)}` : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="modal-btn modal-btn-secondary"
                      disabled={phase === 'converting'}
                      onClick={() => {
                        setDataset(null)
                        setConvertError(null)
                      }}
                    >
                      Changer de zone
                    </button>
                  </div>
                </div>
              ) : (
                <div className="settings-section">
                  <label className="settings-label" htmlFor="osm-place">
                    Zone
                    <span className="settings-hint">Un lieu à chercher, ou collez des coordonnées (48.8443, 2.3744) ou un lien openstreetmap.org</span>
                  </label>
                  <div className="osm-row">
                    <input
                      id="osm-place"
                      ref={placeInput}
                      className="settings-input osm-place-input"
                      value={query}
                      placeholder="Gare de Lyon, Paris"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={loading}
                      onChange={(e) => onQueryChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void search()
                        }
                      }}
                    />
                    <button type="button" className="modal-btn modal-btn-secondary" disabled={!query.trim() || busy} onClick={() => void search()}>
                      {searching ? 'Recherche…' : 'Chercher'}
                    </button>
                  </div>
                  {searchMessage && (
                    <p className="osm-message is-error" role="alert">
                      {searchMessage}
                    </p>
                  )}
                  {results && results.length > 0 && (
                    <ul className="osm-results" aria-label="Lieux trouvés">
                      {results.map((place) => {
                        const active = centre !== null && centre.lat === place.lat && centre.lon === place.lon
                        return (
                          <li key={`${place.lat},${place.lon},${place.label}`}>
                            <button
                              type="button"
                              className={`osm-result${active ? ' is-active' : ''}`}
                              aria-pressed={active}
                              disabled={loading}
                              onClick={() => setCentre({ lat: place.lat, lon: place.lon, label: place.label, name: place.name })}
                            >
                              <span className="osm-result-name">{place.label}</span>
                              {place.kind && <span className="osm-result-kind">{place.kind}</span>}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <div className="osm-row osm-radius-row">
                    <div className="settings-field osm-radius-field">
                      <label htmlFor="osm-radius" className="settings-sublabel">
                        Rayon
                      </label>
                      <div className="settings-input-wrap">
                        <input
                          id="osm-radius"
                          className="settings-input"
                          type="number"
                          inputMode="decimal"
                          min={OSM_RADIUS_KM.min}
                          max={OSM_RADIUS_KM.max}
                          step={0.1}
                          value={radiusText}
                          disabled={loading}
                          onChange={(e) => setRadiusText(e.target.value)}
                        />
                        <span className="settings-input-unit">km</span>
                      </div>
                    </div>
                    <p className="osm-zone-summary">
                      {centre ? (
                        <>
                          <b>Centre : {centre.name ?? centre.label}</b>
                          {centre.name && <span>{formatGeoPoint(centre)}</span>}
                        </>
                      ) : (
                        <b>Aucun centre choisi</b>
                      )}
                      {radiusProblem ? (
                        <span className="is-error">{radiusProblem}</span>
                      ) : (
                        size &&
                        weight && (
                          <span>
                            Disque de {formatLength(size.width)} de diamètre ({formatLength(size.surface)}²) · de {formatBytes(weight.country)} en campagne à{' '}
                            {formatBytes(weight.city)} en ville dense
                          </span>
                        )
                      )}
                    </p>
                  </div>
                  {!radiusProblem && radiusKm > OSM_RADIUS_WARNING_KM && (
                    <p className="osm-message">
                      Au-delà de {formatLength(OSM_RADIUS_WARNING_KM)} de rayon, une ville donne des milliers de rails et une réponse que les serveurs refusent souvent : à
                      réserver à une ligne en campagne.
                    </p>
                  )}

                  {loading && (
                    <div className="remote-status is-waiting" role="status">
                      <span className="remote-status-dot" />
                      <b>{download.text}</b>
                      {download.detail && <span className="remote-status-detail">{download.detail}</span>}
                    </div>
                  )}
                  {download.status === 'error' && (
                    <p className="osm-message is-error" role="alert">
                      {download.message}
                    </p>
                  )}
                </div>
              )}

              {/* --- Options --- */}
              <div className="settings-section">
                <div className="settings-label">
                  Ce qu’il faut importer
                  <span className="settings-hint">Les voies ferrées principales le sont toujours</span>
                </div>
                <fieldset className="osm-options" disabled={phase === 'converting'}>
                  <Option checked={options.levels} onChange={(on) => set('levels', on)}>
                    Ponts et tunnels (niveaux)
                  </Option>
                  <Option checked={options.speedLimits} onChange={(on) => set('speedLimits', on)}>
                    Limites de vitesse
                  </Option>
                  <Option checked={options.serviceTracks} onChange={(on) => set('serviceTracks', on)}>
                    Voies de service
                  </Option>
                  <Option checked={options.disusedTracks} onChange={(on) => set('disusedTracks', on)}>
                    Voies désaffectées
                  </Option>
                  {EXTRA_KINDS.map(({ kind, label }) => {
                    const present = survey.value?.extraKinds[kind] ?? 0
                    return (
                      <Option key={kind} checked={options.extraKinds.includes(kind)} onChange={(on) => toggleKind(kind, on)}>
                        {label}
                        {dataset && survey.value && <span className="osm-option-count"> · {present > 0 ? `${formatCount(present)} dans la zone` : 'aucune dans la zone'}</span>}
                      </Option>
                    )
                  })}
                </fieldset>
                <div className="osm-row osm-speed-row">
                  <label htmlFor="osm-service-speed" className="settings-checkbox-text">
                    Vitesse des voies de service qui n’en portent pas
                  </label>
                  <select
                    id="osm-service-speed"
                    className="settings-input osm-speed-select"
                    value={options.defaultServiceSpeed}
                    disabled={!options.serviceTracks || phase === 'converting'}
                    onChange={(e) => set('defaultServiceSpeed', Number(e.target.value))}
                  >
                    {SERVICE_SPEEDS.map((speed) => (
                      <option key={speed} value={speed}>
                        {speed} km/h
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* --- Frame --- */}
              <div className="settings-section">
                <div className="settings-label">
                  Repère
                  <span className="settings-hint">Où les coordonnées du réseau prennent leur origine</span>
                </div>
                <fieldset className="osm-options" disabled={phase === 'converting'}>
                  <Option checked={options.frame === 'lambert93'} onChange={(on) => set('frame', on ? 'lambert93' : 'local')}>
                    Repère national Lambert-93
                    <span className="osm-option-count"> · les imports se superposent ; les longueurs s’écartent de 1 m par km, 3 m en Corse</span>
                  </Option>
                </fieldset>
              </div>

              {/* --- Signals --- */}
              <div className="settings-section">
                <div className="settings-label">
                  Signalisation
                  <span className="settings-hint">{signalModeHint(signalMode, dataset ? survey.value : null)}</span>
                </div>
                <fieldset className="osm-options" disabled={phase === 'converting'}>
                  <Option checked={usesAutomaticSignals(signalMode)} onChange={(on) => chooseSignals(usesRealSignals(signalMode), on)}>
                    Signalisation automatique
                  </Option>
                  <Option checked={usesRealSignals(signalMode)} onChange={(on) => chooseSignals(on, usesAutomaticSignals(signalMode))}>
                    Signaux réels
                    {dataset && survey.value && <span className="osm-option-count"> · {realSignalsInArea(survey.value)}</span>}
                  </Option>
                </fieldset>
                <div className="osm-row osm-speed-row">
                  <label htmlFor="osm-signalling-level" className="settings-checkbox-text">
                    Niveau de signalisation du projet
                  </label>
                  <select
                    id="osm-signalling-level"
                    className="settings-input osm-speed-select"
                    value={level}
                    disabled={phase === 'converting'}
                    onChange={(e) => chooseLevel(e.target.value === 'pro' ? 'pro' : 'standard')}
                  >
                    {SIGNALLING_LEVEL_CHOICES.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* --- Count --- */}
              {dataset && (
                <div className="settings-section" aria-live="polite">
                  <div className="settings-label">
                    Dans cette zone
                    <span className="settings-hint">Avec les cases cochées ci-dessus</span>
                  </div>
                  {survey.value && <Figures figures={surveyFigures(survey.value)} />}
                  {survey.failed && (
                    <p className="osm-message is-error" role="alert">
                      Le décompte de ces données a échoué : elles ne sont peut-être pas lisibles.
                    </p>
                  )}
                  {nothingToImport && <p className="osm-message">Aucune voie à importer avec ces cases : cochez-en d’autres, ou changez de zone.</p>}
                  {sizeWarning && (
                    <p className={`osm-message${sizeWarning.level === 'strong' ? ' is-error' : ''}`} role={sizeWarning.level === 'strong' ? 'alert' : undefined}>
                      {sizeWarning.text}
                    </p>
                  )}
                  {convertError && (
                    <p className="osm-message is-error" role="alert">
                      {convertError}
                    </p>
                  )}
                  <p className="osm-note">
                    {replaces ? 'L’import remplace le projet en cours ; Ctrl+Z le ramène.' : 'L’import crée un nouveau projet à l’échelle réelle.'} Les données sont{' '}
                    <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">
                      {OSM_ATTRIBUTION}
                    </a>
                    .
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="modal-footer">
          {phase === 'report' ? (
            <button type="button" className="modal-btn modal-btn-primary" onClick={onClose}>
              Fermer
            </button>
          ) : loading ? (
            <button type="button" className="modal-btn modal-btn-secondary" onClick={cancelRequest}>
              Annuler le téléchargement
            </button>
          ) : dataset ? (
            <>
              {phase === 'converting' && (
                <span className="osm-footer-status" role="status">
                  Conversion…
                </span>
              )}
              <button type="button" className="modal-btn modal-btn-secondary" onClick={onClose} disabled={phase === 'converting'}>
                Annuler
              </button>
              <button
                type="button"
                className={`modal-btn modal-btn-${replaces ? 'danger' : 'primary'}`}
                disabled={phase === 'converting' || !survey.value || nothingToImport}
                onClick={() => void runImport()}
              >
                {replaces ? 'Importer et remplacer' : 'Importer'}
              </button>
            </>
          ) : (
            <>
              <input ref={fileInput} type="file" accept=".json,.osmjson,application/json" hidden onChange={(e) => {
                void openFile(e.target.files?.[0])
                e.target.value = ''
              }} />
              <button type="button" className="modal-btn modal-btn-secondary osm-file-btn" onClick={() => fileInput.current?.click()} title="Un fichier JSON enregistré depuis Overpass : l’import sans réseau">
                Depuis un fichier…
              </button>
              <button type="button" className="modal-btn modal-btn-secondary" onClick={onClose}>
                Annuler
              </button>
              <button type="button" className="modal-btn modal-btn-primary" disabled={!centre || radiusProblem !== null || searching} onClick={() => void startDownload()}>
                Télécharger
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A ring at the centre of the plan, where the view has just been centred. Drawn over the canvas
 * rather than in it: the place belongs to the report, not to the network.
 */
function PlaceMarker() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const measure = () => {
      const rect = document.querySelector('.canvas-wrap')?.getBoundingClientRect()
      setAt(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  if (!at) return null
  return <div className="osm-place-marker" style={{ left: at.x, top: at.y }} aria-hidden="true" />
}
