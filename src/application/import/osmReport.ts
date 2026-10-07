import type { OsmImportIssue, OsmImportReport, OsmSignalCount, OsmSignalIgnored, OsmSignalMode, OsmSignalReport, OsmSignalSkip, OsmSurvey } from '@domain/import/osmTypes'
import type { SignalReportType } from '@domain/models/signalReport'
import type { SignallingLevel } from '@domain/models/signals'

/**
 * Wording of the count shown before an import and of the report shown after it. Plain data for
 * the window: nothing here touches the DOM.
 */

/** From this many rails editing gets slower; the window warns */
export const OSM_RAILS_WARNING = 2000
/** From this many rails the autosave may not fit in the browser's storage; the window warns strongly */
export const OSM_RAILS_STRONG_WARNING = 4000

export type OsmSizeWarning = { level: 'warning' | 'strong'; text: string } | null

export function osmSizeWarning(estimatedRails: number): OsmSizeWarning {
  if (estimatedRails > OSM_RAILS_STRONG_WARNING) {
    return {
      level: 'strong',
      text: `Environ ${formatCount(estimatedRails)} rails : l’édition sera lente et l’enregistrement automatique risque de dépasser la place que le navigateur accorde. Réduisez le rayon ou décochez des voies ; sinon, exportez le projet en JSON dès l’import terminé.`,
    }
  }
  if (estimatedRails > OSM_RAILS_WARNING) {
    return {
      level: 'warning',
      text: `Environ ${formatCount(estimatedRails)} rails : c’est un grand réseau, l’édition et l’annulation seront plus lentes.`,
    }
  }
  return null
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('fr-FR')
}

export function formatKm(value: number): string {
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`
}

/** `1,2 Mo`, `340 ko` */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    const mb = bytes / 1_000_000
    return `${mb.toLocaleString('fr-FR', { maximumFractionDigits: mb < 10 ? 1 : 0 })} Mo`
  }
  return `${Math.max(1, Math.round(bytes / 1000)).toLocaleString('fr-FR')} ko`
}

/** A date of the data (`2026-10-06T07:12:00Z` or `2026-10-06`) as « 6 octobre 2026 »; the text itself when unreadable */
export function formatDataDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export interface Figure {
  label: string
  value: string
}

/** What the area holds under the options ticked, before anything is built */
export function surveyFigures(survey: OsmSurvey): Figure[] {
  return [
    { label: survey.ways > 1 ? 'voies' : 'voie', value: formatCount(survey.ways) },
    { label: 'de voies', value: formatKm(survey.lengthKm) },
    { label: survey.switches > 1 ? 'aiguillages' : 'aiguillage', value: formatCount(survey.switches) },
    { label: survey.bridges > 1 ? 'ponts' : 'pont', value: formatCount(survey.bridges) },
    { label: survey.tunnels > 1 ? 'tunnels' : 'tunnel', value: formatCount(survey.tunnels) },
    { label: (survey.stations ?? 0) > 1 ? 'gares' : 'gare', value: formatCount(survey.stations ?? 0) },
    { label: 'rails estimés', value: `≈ ${formatCount(survey.estimatedRails)}` },
  ]
}

/** What the conversion built */
export function reportFigures(report: OsmImportReport): Figure[] {
  return [
    { label: report.rails > 1 ? 'rails' : 'rail', value: formatCount(report.rails) },
    { label: 'de voies', value: formatKm(report.lengthKm) },
    { label: report.turnouts > 1 ? 'aiguillages' : 'aiguillage', value: formatCount(report.turnouts) },
    { label: report.doubleSlips > 1 ? 'traversées-jonctions' : 'traversée-jonction', value: formatCount(report.doubleSlips) },
    { label: report.fixedCrossings > 1 ? 'traversées' : 'traversée', value: formatCount(report.fixedCrossings) },
    { label: report.speedZones > 1 ? 'zones de vitesse' : 'zone de vitesse', value: formatCount(report.speedZones) },
    { label: report.railsOnBridge > 1 ? 'rails sur un pont' : 'rail sur un pont', value: formatCount(report.railsOnBridge) },
    { label: report.railsInTunnel > 1 ? 'rails en tunnel' : 'rail en tunnel', value: formatCount(report.railsInTunnel) },
    ...(report.stations ? [{ label: report.stations.placed > 1 ? 'gares' : 'gare', value: formatCount(report.stations.placed) }] : []),
  ]
}

/** Sentences of the report that are not a figure of what was built */
export function reportNotes(report: OsmImportReport): string[] {
  const notes: string[] = []
  if (report.stackedCrossings > 0 || report.undecidedCrossings > 0) {
    const stacked =
      report.stackedCrossings > 1
        ? `${formatCount(report.stackedCrossings)} croisements superposés (une voie passe au-dessus de l’autre)`
        : `${formatCount(report.stackedCrossings)} croisement superposé (une voie passe au-dessus de l’autre)`
    notes.push(`${stacked}, ${formatCount(report.undecidedCrossings)} indécis.`)
  }
  if (report.lengthWithoutSpeedKm > 0) {
    notes.push(`${formatKm(report.lengthWithoutSpeedKm)} de voie principale sans limite de vitesse dans les données : la vitesse de ligne s’y applique.`)
  }
  if (report.droppedComponents > 0) {
    notes.push(
      report.droppedComponents > 1
        ? `${formatCount(report.droppedComponents)} groupes de voies isolés du réseau principal ont été laissés de côté.`
        : 'Un groupe de voies isolé du réseau principal a été laissé de côté.',
    )
  }
  return notes
}

export type OsmIssueKind = OsmImportIssue['kind']

/** Title of each kind of issue (one place, several places) and what it means */
export const OSM_ISSUE_TEXT: Record<OsmIssueKind, { one: string; many: string; meaning: string }> = {
  'undecided-crossing': {
    one: 'Croisement indécis',
    many: 'Croisements indécis',
    meaning: 'Deux voies se croisent sans point commun et au même niveau : les données ne disent pas laquelle passe au-dessus.',
  },
  'uncertain-level': {
    one: 'Niveau incertain',
    many: 'Niveaux incertains',
    meaning: 'Le niveau a été lu avec réserve : plusieurs valeurs dans les données, ou un étage hors de ceux de l’éditeur.',
  },
  'unknown-junction': {
    one: 'Appareil de voie non reconnu',
    many: 'Appareils de voie non reconnus',
    meaning: 'Quatre voies ou plus se rejoignent sans former un appareil connu : les itinéraires y sont à vérifier.',
  },
  'sharp-angle': {
    one: 'Raccord trop anguleux',
    many: 'Raccords trop anguleux',
    meaning: 'Les deux voies se rejoignent sous un angle qu’un train ne franchit pas.',
  },
  'cut-by-area': {
    one: 'Voie coupée par le bord de la zone',
    many: 'Voies coupées par le bord de la zone',
    meaning: 'La voie s’arrête là où s’arrête la zone importée, pas à un heurtoir.',
  },
  'signal-not-placed': {
    one: 'Signal réel non posé',
    many: 'Signaux réels non posés',
    meaning: 'Les données ne disent pas à quel sens de circulation le signal s’adresse, ou il se trouve sur un aiguillage.',
  },
  'station-not-placed': {
    one: 'Gare sans voie',
    many: 'Gares sans voie',
    meaning: 'La gare est nommée dans les données, mais aucune voie importée ne passe assez près pour lui donner des voies à quai.',
  },
}

/** Order of the groups in the report: what needs a decision first */
const ISSUE_ORDER: readonly OsmIssueKind[] = ['undecided-crossing', 'unknown-junction', 'sharp-angle', 'uncertain-level', 'signal-not-placed', 'station-not-placed', 'cut-by-area']

export interface OsmIssueGroup {
  kind: OsmIssueKind
  title: string
  meaning: string
  issues: OsmImportIssue[]
}

/** The issues of a report by kind, each with its count; a kind this version does not know is kept under its raw name */
export function groupIssues(issues: readonly OsmImportIssue[]): OsmIssueGroup[] {
  const byKind = new Map<OsmIssueKind, OsmImportIssue[]>()
  for (const issue of issues) {
    const list = byKind.get(issue.kind)
    if (list) list.push(issue)
    else byKind.set(issue.kind, [issue])
  }
  const kinds = [...ISSUE_ORDER.filter((kind) => byKind.has(kind)), ...[...byKind.keys()].filter((kind) => !ISSUE_ORDER.includes(kind))]
  return kinds.map((kind) => {
    const list = byKind.get(kind)!
    const text = OSM_ISSUE_TEXT[kind] as { one: string; many: string; meaning: string } | undefined
    return {
      kind,
      title: text ? (list.length > 1 ? text.many : text.one) : kind,
      meaning: text?.meaning ?? '',
      issues: list,
    }
  })
}

// ─────────────────── Signals ───────────────────

/** The two boxes of the window: real signals, automatic signalling. Both: the automatic one fills in */
export function signalModeOf(real: boolean, automatic: boolean): OsmSignalMode {
  if (real) return automatic ? 'mixed' : 'real'
  return automatic ? 'generated' : 'none'
}

export const usesRealSignals = (mode: OsmSignalMode | undefined): boolean => mode === 'real' || mode === 'mixed'
export const usesAutomaticSignals = (mode: OsmSignalMode | undefined): boolean => mode === undefined || mode === 'generated' || mode === 'mixed'

/** The choice a signalling level comes with, until the user ticks a box: see `tasks/plan-import-osm.md` */
export function defaultSignalMode(level: SignallingLevel): OsmSignalMode {
  return level === 'pro' ? 'real' : 'generated'
}

/** « 125 signaux réels dans la zone »: the ones the import can lay, counted before anything is built */
export function realSignalsInArea(survey: Pick<OsmSurvey, 'usableSignals' | 'typedMainSignals'>): string {
  const count = survey.usableSignals ?? survey.typedMainSignals
  if (count <= 0) return 'aucun signal réel dans la zone'
  return count > 1 ? `${formatCount(count)} signaux réels dans la zone` : '1 signal réel dans la zone'
}

/** What the two boxes ticked will do, in one sentence */
export function signalModeHint(mode: OsmSignalMode, survey: Pick<OsmSurvey, 'usableSignals' | 'typedMainSignals'> | null): string {
  const none = survey !== null && (survey.usableSignals ?? survey.typedMainSignals) <= 0
  switch (mode) {
    case 'none':
      return 'Le réseau sera importé sans signal.'
    case 'generated':
      return 'Un signal de protection avant chaque aiguillage, des signaux d’espacement en pleine voie, dans les deux sens.'
    case 'real':
      return none
        ? 'Aucun signal réel dans cette zone : le réseau sera importé sans signal.'
        : 'Les signaux d’OpenStreetMap tels qu’ils sont ; le rapport de contrôle dira ce qui manque.'
    case 'mixed':
      return none
        ? 'Aucun signal réel dans cette zone : seule la signalisation automatique sera posée.'
        : 'Les signaux d’OpenStreetMap, et la signalisation automatique sur les voies qui n’en portent aucun.'
  }
}

const plural = (count: number, one: string, many: string): string => `${formatCount(count)} ${count > 1 ? many : one}`

function byRole(count: OsmSignalCount): string {
  const parts = [`${formatCount(count.protection)} de protection`, `${formatCount(count.spacing)} d’espacement`]
  if (count.cabMarkers > 0) parts.push(`dont ${plural(count.cabMarkers, 'repère de ligne à grande vitesse', 'repères de ligne à grande vitesse')}`)
  return parts.join(', ')
}

const SKIP_WORDS: Record<OsmSignalSkip, string> = {
  'no-direction': 'sans sens de circulation',
  'ambiguous-direction': 'de sens illisible',
  'track-not-imported': 'sur une voie non importée',
  'off-track': 'trop loin de la voie',
  'on-switch': 'sur un aiguillage',
  duplicate: 'en double',
}

const IGNORED_WORDS: Record<OsmSignalIgnored, string> = {
  speed: 'de vitesse',
  shunting: 'de manœuvre',
  distant: 'd’annonce',
  other: 'd’un autre genre',
  untyped: 'sans type',
  unknown: 'de type inconnu',
  deactivated: 'hors service',
}

function breakdown<K extends string>(counts: Partial<Record<K, number>>, words: Record<K, string>): { total: number; text: string } {
  const entries = (Object.entries(counts) as [K, number][]).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1])
  return {
    total: entries.reduce((sum, [, count]) => sum + count, 0),
    text: entries.map(([kind, count]) => `${formatCount(count)} ${words[kind] ?? kind}`).join(', '),
  }
}

/** What the import did about the signals, sentence by sentence */
export function signalNotes(signals: OsmSignalReport | undefined): string[] {
  if (!signals) return []
  const notes: string[] = []
  const real = signals.real.protection + signals.real.spacing
  const generated = signals.generated.protection + signals.generated.spacing
  if (usesRealSignals(signals.mode)) {
    if (real > 0) {
      const moved = signals.realMoved > 0 ? ` ${plural(signals.realMoved, 'a été écarté', 'ont été écartés')} de deux mètres d’un aiguillage.` : ''
      notes.push(`${plural(real, 'signal réel posé', 'signaux réels posés')} : ${byRole(signals.real)}.${moved}`)
    } else {
      notes.push('Aucun signal réel utilisable dans les données de cette zone.')
    }
    const skipped = breakdown(signals.skipped, SKIP_WORDS)
    if (skipped.total > 0) notes.push(`${plural(skipped.total, 'signal réel non posé', 'signaux réels non posés')} : ${skipped.text}.`)
    const ignored = breakdown(signals.ignored, IGNORED_WORDS)
    if (ignored.total > 0) notes.push(`${plural(ignored.total, 'autre signal laissé de côté', 'autres signaux laissés de côté')} : ${ignored.text}.`)
  }
  if (signals.mode === 'generated' || signals.mode === 'mixed') {
    if (generated > 0) notes.push(`${plural(generated, 'signal posé', 'signaux posés')} par la signalisation automatique : ${byRole(signals.generated)}.`)
    else notes.push('La signalisation automatique n’a rien eu à poser.')
    if (signals.stretchesLeftToReal > 0) {
      notes.push(`${plural(signals.stretchesLeftToReal, 'portion de voie laissée', 'portions de voie laissées')} aux signaux réels qu’elle porte.`)
    }
  }
  if (signals.mode === 'none') notes.push('Aucun signal posé : la signalisation n’était pas demandée.')
  return notes
}

const CONTROL_WORDS: Record<SignalReportType, [string, string]> = {
  'block-too-long': ['canton trop long', 'cantons trop longs'],
  'block-too-short': ['canton trop court pour s’arrêter', 'cantons trop courts pour s’arrêter'],
  'unprotected-switch': ['aiguillage sans signal de protection', 'aiguillages sans signal de protection'],
  'signal-on-switch': ['signal trop près d’un aiguillage', 'signaux trop près d’un aiguillage'],
  'lone-signal': ['signal d’espacement isolé', 'signaux d’espacement isolés'],
}

/**
 * What the control report of the signalling says of the imported network, in one sentence; null for
 * a network without signal. `entries` are those of `signalReport` at the level of the project.
 */
export function controlNote(entries: readonly { type: SignalReportType }[], level: SignallingLevel, signalCount: number): string | null {
  if (signalCount === 0) return null
  const name = level === 'pro' ? 'pro' : 'standard'
  if (entries.length === 0) return `Rapport de contrôle (niveau ${name}) : rien à signaler.`
  const counts = new Map<SignalReportType, number>()
  for (const entry of entries) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1)
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([type, count]) => plural(count, CONTROL_WORDS[type]?.[0] ?? type, CONTROL_WORDS[type]?.[1] ?? type))
  return `Rapport de contrôle (niveau ${name}) : ${parts.join(', ')}. Chaque point est marqué sur le plan.`
}
