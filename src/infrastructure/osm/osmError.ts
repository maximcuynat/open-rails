/**
 * What can go wrong between the import window and OpenStreetMap. The message is in French and
 * is shown to the user as it is; the kind lets the window decide what to offer next.
 */
export type OsmErrorKind =
  | 'busy' // every server answered that it is overloaded, or did not answer in time
  | 'too-large' // the server gave up on the area (time or memory), or the area is refused before asking
  | 'empty' // the answer holds no track
  | 'offline' // no server could be reached at all
  | 'aborted' // cancelled by the user
  | 'invalid' // the answer, or the file, is not what an Overpass server writes
  | 'not-found' // the place search found nothing

export class OsmError extends Error {
  readonly kind: OsmErrorKind

  constructor(kind: OsmErrorKind, message: string) {
    super(message)
    this.name = 'OsmError'
    this.kind = kind
  }
}

export const OSM_ERROR_MESSAGES = {
  busy: 'Les serveurs d’OpenStreetMap sont surchargés et n’ont pas répondu. Réessayez dans une minute, réduisez le rayon, ou importez depuis un fichier.',
  tooLarge: 'La zone est trop grande pour le serveur : il a abandonné la requête. Réduisez le rayon.',
  empty: 'Aucune voie ferrée trouvée dans cette zone.',
  offline: 'Impossible de joindre les serveurs d’OpenStreetMap. Vérifiez la connexion à Internet (ou un bloqueur de requêtes), ou importez depuis un fichier.',
  aborted: 'Téléchargement annulé.',
  invalidAnswer: 'La réponse du serveur n’est pas lisible. Réessayez, ou importez depuis un fichier.',
} as const

/** The message to show for anything thrown along the import */
export function osmErrorMessage(error: unknown): string {
  if (error instanceof OsmError) return error.message
  return 'L’import a échoué pour une raison inattendue.'
}

export function isAbort(error: unknown): boolean {
  return error instanceof OsmError && error.kind === 'aborted'
}
