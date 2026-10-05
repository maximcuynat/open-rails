import type { SerializedProject } from '@infrastructure/persistence/persistence'
import marseilleSaintCharlesUrl from './marseille-saint-charles.json?url'

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
 * Examples made from real stations come from OpenStreetMap (`tools/osm-import/osm_to_project.py`):
 * © OpenStreetMap contributors, ODbL — the About box says so.
 */
export const EXAMPLES: readonly ExampleNetwork[] = [
  {
    id: 'marseille-saint-charles',
    label: 'Marseille Saint-Charles',
    description:
      'La gare en cul-de-sac et son avant-gare à l\'échelle réelle, d\'après OpenStreetMap : 37 km de voies, 124 aiguillages et 20 traversées-jonctions.',
    url: marseilleSaintCharlesUrl,
  },
]

/** Fetch the project file of an example. Rejects when it cannot be read. */
export async function loadExample(example: ExampleNetwork): Promise<SerializedProject> {
  const response = await fetch(example.url)
  if (!response.ok) throw new Error(`Example ${example.id}: HTTP ${response.status}`)
  return (await response.json()) as SerializedProject
}
