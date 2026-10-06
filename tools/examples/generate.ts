/**
 * Writes the hand-made example networks of File ▸ Exemples into `src/examples/`.
 *
 *   npx vite-node tools/examples/generate.ts            every example
 *   npx vite-node tools/examples/generate.ts terminus   the named ones only (ids of `src/examples/index.ts`)
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { build as bifurcation } from './bifurcation'
import { build as gareDePassage } from './gare-de-passage'
import { build as marseilleTrain, MARSEILLE_FILE } from './marseille-train'
import { build as premiersToursDeRoue } from './premiers-tours-de-roue'
import { build as rampeEtCourbe } from './rampe-et-courbe'
import { build as sautDeMouton } from './saut-de-mouton'
import { build as terminus } from './terminus'
import { build as voieUniqueEvitement } from './voie-unique-evitement'

const GENERATORS: Record<string, () => SerializedProject> = {
  'premiers-tours-de-roue': premiersToursDeRoue,
  'gare-de-passage': gareDePassage,
  bifurcation,
  'voie-unique-evitement': voieUniqueEvitement,
  'saut-de-mouton': sautDeMouton,
  'rampe-et-courbe': rampeEtCourbe,
  terminus,
}

const wanted = process.argv.slice(2)
for (const [id, build] of Object.entries(GENERATORS)) {
  if (wanted.length > 0 && !wanted.includes(id)) continue
  const project = build()
  // Written as the editor exports a project (File ▸ Exporter)
  const file = fileURLToPath(new URL(`../../src/examples/${id}.json`, import.meta.url))
  writeFileSync(file, JSON.stringify(project, null, 2))
  console.log(`${id}: ${project.nodes.length} nodes, ${project.segments.length} rails, ${project.trains?.length ?? 0} train(s)`)
}

// Marseille Saint-Charles comes from OpenStreetMap (`tools/osm-import`): only its train is laid here
if (wanted.length === 0 || wanted.includes('marseille-saint-charles')) writeFileSync(MARSEILLE_FILE, marseilleTrain())
