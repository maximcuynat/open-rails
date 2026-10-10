import type { MergeReport } from '@infrastructure/persistence/projectMerge'
import type { Figure } from './osmReport'

// What « Ajouter un JSON au projet… » says once done: the figures of the merge and, in sentences,
// what the user should know of it. Pure, so that the window is only a view.

/** What a merge did, with the rails and nodes the welding made or took away */
export type MergeOutcome = MergeReport & { repairs: number }

const count = (n: number): string => n.toLocaleString('fr-FR')

export function mergeReportFigures(report: MergeOutcome): Figure[] {
  const figures: Figure[] = [
    { label: report.railsAdded > 1 ? 'rails ajoutés' : 'rail ajouté', value: count(report.railsAdded) },
    { label: report.nodesMerged > 1 ? 'nœuds communs' : 'nœud commun', value: count(report.nodesMerged) },
    { label: report.railsDropped > 1 ? 'doublons écartés' : 'doublon écarté', value: count(report.railsDropped) },
  ]
  if (report.stationsAdded + report.stationsMerged > 0) {
    figures.push({ label: report.stationsAdded > 1 ? 'gares ajoutées' : 'gare ajoutée', value: count(report.stationsAdded) })
  }
  if (report.repairs > 0) figures.push({ label: report.repairs > 1 ? 'raccords soudés' : 'raccord soudé', value: count(report.repairs) })
  return figures
}

/** The sentences under the figures, the most important first */
export function mergeReportNotes(report: MergeOutcome): string[] {
  const notes: string[] = []
  if (report.railsAdded === 0 && report.nodesAdded === 0) notes.push('Tout ce que contient ce fichier était déjà dans le projet : rien n’a été ajouté.')
  if (report.frame === 'as-is') {
    notes.push('Les deux projets n’ont pas de repère géographique commun : le réseau ajouté est posé à ses coordonnées d’origine. Déplacez-le si besoin.')
  } else if (report.frame === 'reprojected') {
    notes.push('Le réseau ajouté a été reprojeté dans le repère du projet.')
  }
  if (report.gaugeDiffers) notes.push('Les deux projets n’ont pas le même écartement : celui du projet courant est gardé.')
  if (report.stationsMerged > 0) {
    notes.push(report.stationsMerged > 1 ? `${count(report.stationsMerged)} gares étaient déjà dans le projet : leurs quais ont été réunis.` : 'Une gare était déjà dans le projet : ses quais ont été réunis.')
  }
  if (report.junctionsRebuilt > 0) notes.push('Aux jonctions où les deux réseaux se rejoignent, les itinéraires des aiguillages ont été proposés à nouveau : vérifiez-les.')
  if (report.trainsAdded > 0) notes.push(report.trainsAdded > 1 ? `${count(report.trainsAdded)} trains du fichier ont été ajoutés.` : 'Un train du fichier a été ajouté.')
  notes.push('En cas de conflit, le projet courant est gardé. Ctrl+Z annule la fusion.')
  return notes
}
