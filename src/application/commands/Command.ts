import type { Network, Selection } from '@domain/models/types'

/**
 * Snapshot for state restoration in commands
 */
export interface NetworkSnapshot {
  network: Network
  selection: Selection
  lastNodeId: string | null
}

/**
 * Command Pattern interface for all user mutations.
 * Allows clean execution, atomic undo, and redo.
 */
export interface ICommand {
  /** Descriptive name for logging / tooltip UI (e.g. 'Ajouter un rail') */
  readonly description: string

  /** Execute the command and apply modifications */
  execute(): void

  /** Revert modifications applied by this command */
  undo(): void
}
