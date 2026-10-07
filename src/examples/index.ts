import type { SerializedProject } from '@infrastructure/persistence/persistence'
import bifurcationUrl from './bifurcation.json?url'
import gareDePassageUrl from './gare-de-passage.json?url'
import marseilleSaintCharlesUrl from './marseille-saint-charles.json?url'
import premiersToursDeRoueUrl from './premiers-tours-de-roue.json?url'
import rampeEtCourbeUrl from './rampe-et-courbe.json?url'
import sautDeMoutonUrl from './saut-de-mouton.json?url'
import terminusUrl from './terminus.json?url'
import voieUniqueEvitementUrl from './voie-unique-evitement.json?url'

/**
 * A ready-made network offered in File ▸ Examples. Its project file is a separate asset, fetched
 * when the example is opened: none of them weighs on the editor bundle.
 */
export interface ExampleNetwork {
  id: string
  /** Name shown in the menu */
  label: string
  /** One sentence shown before the example replaces the current network */
  description: string
  url: string
}

/**
 * The examples, from the simplest to the busiest. Each one has a train ready to be driven.
 *
 * The hand-made ones are written by `tools/examples/generate.ts`, one generator per example, and
 * open on their train (their file carries a camera). The ones made from real stations come from
 * OpenStreetMap (`tools/osm-import/osm_to_project.py`): © OpenStreetMap contributors, ODbL — the
 * About box says so.
 */
export const EXAMPLES: readonly ExampleNetwork[] = [
  {
    id: 'premiers-tours-de-roue',
    label: 'Premiers tours de roue',
    description:
      'Cinq kilomètres de ligne droite entre deux heurtoirs et une rame TGV prête à partir : F5 pour prendre les commandes, desserrez le frein, mettez l\'inverseur en avant, tractionnez, puis essayez de vous arrêter avant le bout.',
    url: premiersToursDeRoueUrl,
  },
  {
    id: 'rampe-et-courbe',
    label: 'Rampe et courbe',
    description:
      'Une ligne de montagne : une rampe de 35 ‰, puis au sommet une courbe de 250 m de rayon en dévers, limitée à 70 km/h. F5, prenez de l\'élan et freinez à temps : trop vite dans la courbe, la rame se couche.',
    url: rampeEtCourbeUrl,
  },
  {
    id: 'saut-de-mouton',
    label: 'Saut-de-mouton',
    description:
      'Une voie quitte la ligne à double voie, monte une rampe de 25 ‰, franchit les deux voies sur un pont et redescend de l\'autre côté : F5 et suivez-la, l\'aiguille est déjà tournée.',
    url: sautDeMoutonUrl,
  },
  {
    id: 'bifurcation',
    label: 'Bifurcation',
    description:
      'Une ligne à double voie d\'où part une branche à double voie, protégée par ses carrés : F5, roulez vers l\'aiguille, tournez-la avec ← ou → et regardez le signal s\'ouvrir et l\'itinéraire se réserver.',
    url: bifurcationUrl,
  },
  {
    id: 'terminus',
    label: 'Terminus',
    description:
      'Une gare en cul-de-sac à trois voies, avec sa bretelle d\'entrée, ses heurtoirs et ses signaux, limitée à 60 km/h : F5, Tab pour passer dans la cabine de l\'autre bout, puis repartez vers la ligne.',
    url: terminusUrl,
  },
  {
    id: 'voie-unique-evitement',
    label: 'Voie unique avec évitement',
    description:
      'Une voie unique, son évitement et ses six carrés, avec une rame de chaque côté : F5, entrez sur la voie directe et arrêtez-vous au carré de sortie ; cliquez l\'autre rame, tournez son aiguille (← ou →) pour la faire entrer sur l\'évitement, puis rendez à chacune son aiguille pour repartir.',
    url: voieUniqueEvitementUrl,
  },
  {
    id: 'gare-de-passage',
    label: 'Gare de passage (type Aix-en-Provence TGV)',
    description:
      'Une gare sur ligne à grande vitesse : deux voies centrales passantes à 300 km/h et, de chaque côté, une voie à quai limitée à 160 km/h par ses aiguilles. F5 pour faire partir la rame à quai ; cliquez ensuite la seconde rame pour traverser la gare sans arrêt.',
    url: gareDePassageUrl,
  },
  {
    id: 'marseille-saint-charles',
    label: 'Marseille Saint-Charles',
    description:
      'La gare en cul-de-sac et son avant-gare à l\'échelle réelle, d\'après OpenStreetMap : 37 km de voies, 124 aiguillages et 20 traversées-jonctions. Une rame attend à quai au milieu de la gare : F5 pour la sortir.',
    url: marseilleSaintCharlesUrl,
  },
]

/** Fetch the project file of an example. Rejects when it cannot be read. */
export async function loadExample(example: ExampleNetwork): Promise<SerializedProject> {
  const response = await fetch(example.url)
  if (!response.ok) throw new Error(`Example ${example.id}: HTTP ${response.status}`)
  return (await response.json()) as SerializedProject
}
