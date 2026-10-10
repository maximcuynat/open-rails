import { Suspense, lazy, useState } from 'react'
import { MenuBar, type MenuDef } from './Menu'
import { AboutModal, REPO_URL, RELEASE_NOTES_URL } from './AboutModal'
import { ShortcutsModal } from './ShortcutsModal'
import { RemoteDeskModal, remoteDeskUnavailable } from './RemoteDeskModal'
import type { EditorStore, ThemeMode } from '@application/state/editorStore'
import type { RemoteSession } from '@application/remote/remoteSession'
import { exportSVG } from '@infrastructure/export/exportSvg'
import { showToast } from '../common/Toast'
import { Modal } from '../common/Modal'
import { Figures } from '../common/Figures'
import { mergeReportFigures, mergeReportNotes, type MergeOutcome } from '@application/import/mergeReport'
import { SettingsModal } from '../settings/SettingsModal'
import { formatDistance } from '@domain/models/units'
import { EXAMPLES, loadExample, type ExampleNetwork } from '../../../examples'

// The import window brings the whole conversion with it: loaded when it is first opened
const OsmImportModal = lazy(() => import('./OsmImportModal').then((module) => ({ default: module.OsmImportModal })))
// The dataset window likewise: its search and route logic come with it
const SandboxModal = lazy(() => import('./SandboxModal').then((module) => ({ default: module.SandboxModal })))
const LineBetweenStationsModal = lazy(() => import('./LineBetweenStationsModal').then((module) => ({ default: module.LineBetweenStationsModal })))

const THEME_LABELS: Record<ThemeMode, string> = {
  auto: 'automatique (système)',
  light: 'clair',
  dark: 'sombre',
}

interface TopBarProps {
  store: EditorStore
  /** The phone desk session, opened from the Simulation menu */
  remote: RemoteSession
  onFitView: () => void
}

export function TopBar({ store, remote, onFitView }: TopBarProps) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(store.projectName)
  const [showNewModal, setShowNewModal] = useState(false)
  const [pendingExample, setPendingExample] = useState<ExampleNetwork | null>(null)
  const [showShortcutsModal, setShowShortcutsModal] = useState(false)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [showRemoteModal, setShowRemoteModal] = useState(false)
  const [showOsmImport, setShowOsmImport] = useState(false)
  const [showLineBetween, setShowLineBetween] = useState(false)
  // The game is offered at start on a blank page; with a project to come back to, from the menu
  const [showSandbox, setShowSandbox] = useState(() => store.network.segments.size === 0 && !store.dataset)
  const [mergeOutcome, setMergeOutcome] = useState<MergeOutcome | null>(null)

  const commitName = () => {
    setEditingName(false)
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== store.projectName) {
      store.setProjectName(trimmed)
    } else {
      setNameDraft(store.projectName)
    }
  }

  const hasSelection = store.selection.nodes.size > 0 || store.selection.segments.size > 0 || store.isTrainSelected
  const hasTrain = store.locomotive !== null || store.trains.length > 0

  // Shortcuts of rebindable actions come from the store; the others are fixed keys of useKeyboardShortcuts
  const menus: MenuDef[] = [
    {
      label: 'Fichier',
      items: [
        { id: 'sandbox', label: 'Nouvelle partie (bac à sable)…' },
        { id: 'new', label: 'Nouveau réseau', separatorAfter: true },
        { id: 'import-json', label: 'Importer JSON…' },
        { id: 'merge-json', label: 'Ajouter un JSON au projet…', disabled: !store.canEditNetwork },
        { id: 'import-osm', label: 'Importer depuis OpenStreetMap…' },
        { id: 'line-between-stations', label: 'Ligne entre gares…' },
        {
          id: 'examples',
          label: 'Exemples',
          submenu: EXAMPLES.map((example) => ({ id: `${EXAMPLE_ITEM_PREFIX}${example.id}`, label: example.label })),
        },
        {
          id: 'export',
          label: 'Exporter',
          separatorAfter: true,
          submenu: [
            { id: 'export-json', label: 'JSON (réseau complet)' },
            { id: 'export-svg', label: 'SVG réaliste (1:87)' },
            { id: 'export-png', label: 'PNG (vue actuelle)' },
          ],
        },
        { id: 'settings', label: 'Paramètres du réseau…', shortcut: 'Ctrl+,' },
      ],
      onSelect: (id) => {
        if (id.startsWith(EXAMPLE_ITEM_PREFIX)) {
          const example = EXAMPLES.find((e) => e.id === id.slice(EXAMPLE_ITEM_PREFIX.length))
          if (!example) return
          if (store.network.nodes.size > 0 || store.network.segments.size > 0) {
            setPendingExample(example)
          } else {
            openExample(store, example, onFitView)
          }
          return
        }
        switch (id) {
          case 'new':
            if (store.network.nodes.size > 0 || store.network.segments.size > 0) {
              setShowNewModal(true)
            } else {
              store.newProject()
              showToast('Nouveau réseau créé', 'info')
            }
            break
          case 'import-json':
            importJSON(store)
            break
          case 'merge-json':
            mergeJSON(store, setMergeOutcome)
            break
          case 'import-osm':
            setShowOsmImport(true)
            break
          case 'sandbox':
            setShowSandbox(true)
            break
          case 'line-between-stations':
            setShowLineBetween(true)
            break
          case 'export-json':
            exportJSON(store)
            showToast('Export JSON téléchargé', 'success')
            break
          case 'export-svg':
            exportSVG(store)
            showToast('Plan SVG vectoriel exporté', 'success')
            break
          case 'export-png':
            exportPNG(store)
            showToast('Image PNG exportée', 'success')
            break
          case 'settings':
            store.openSettings()
            break
        }
      },
    },
    {
      label: 'Édition',
      items: [
        { id: 'undo', label: 'Annuler', shortcut: 'Ctrl+Z', disabled: !store.canUndo },
        { id: 'redo', label: 'Rétablir', shortcut: 'Ctrl+Maj+Z', disabled: !store.canRedo, separatorAfter: true },
        { id: 'delete', label: 'Supprimer', shortcut: 'Suppr', disabled: !hasSelection || store.hasPendingPlacement || store.isNetworkLocked },
        { id: 'parallel', label: 'Créer une voie parallèle', shortcut: store.shortcutLabel('edit.parallelTrack'), disabled: !store.canCreateParallelTrack || store.isNetworkLocked, separatorAfter: true },
        { id: 'select-all', label: 'Tout sélectionner', shortcut: 'Ctrl+A' },
        { id: 'clear', label: 'Tout désélectionner', separatorAfter: true },
        { id: 'reconcile', label: 'Réconcilier les jonctions et aiguillages', shortcut: 'R', disabled: store.isNetworkLocked },
        { id: 'long-rails', label: 'Simplifier en rails longs', disabled: store.isPlayMode || store.isNetworkLocked || store.network.segments.size === 0 },
      ],
      onSelect: (id) => {
        switch (id) {
          case 'undo':
            store.undo()
            break
          case 'redo':
            store.redo()
            break
          case 'delete':
            store.deleteSelection()
            break
          case 'parallel':
            store.createParallelTrackFromSelection()
            break
          case 'select-all':
            store.selectAll()
            break
          case 'clear':
            // A pose in progress is cancelled properly (its lone start node goes with it)
            if (store.hasPendingPlacement) store.cancelInteraction()
            store.clearSelection()
            break
          case 'reconcile':
            store.reconcileTopology()
            showToast('Topologie et aiguillages réconciliés', 'info')
            break
          case 'long-rails': {
            const result = store.simplifyToLongRails()
            if (!result) break
            showToast(
              result.after < result.before
                ? `Réseau simplifié : ${result.before} rails → ${result.after}`
                : 'Aucune enfilade de rails à simplifier',
              result.after < result.before ? 'success' : 'info',
            )
            break
          }
        }
      },
    },
    {
      label: 'Affichage',
      items: [
        { id: 'fit', label: 'Ajuster à la vue', shortcut: store.shortcutLabel('view.fit') },
        { id: 'fit-board', label: 'Cadrer le plateau de réseau', disabled: !store.boardEnabled },
        { id: 'zoom-100', label: 'Zoom par défaut', shortcut: 'Ctrl+0', separatorAfter: true },
        { id: 'toggle-grid', label: 'Grille', checked: store.showGrid },
        { id: 'toggle-snap', label: 'Aimantation', checked: store.snap, shortcut: store.shortcutLabel('view.toggleSnap') },
        { id: 'toggle-dimensions', label: 'Cotes dynamiques', checked: store.showDimensions },
        { id: 'toggle-minimap', label: 'Mini-carte', checked: store.showMinimap },
        { id: 'toggle-signal-blocks', label: 'Cantons', checked: store.signalBlocksVisible },
        { id: 'toggle-signal-reservations', label: 'Réservations (en conduite)', checked: store.showSignalReservations },
        { id: 'toggle-inclination', label: 'Dévers et pentes', checked: store.showInclination },
        { id: 'toggle-driving-view', label: 'Vue de conduite épurée', checked: store.minimalDrivingView },
        { id: 'toggle-dispatcher', label: 'Tableau de l’aiguilleur (en conduite)', checked: store.showDispatcher },
        { id: 'toggle-inspector', label: 'Inspecteur', checked: store.isSidePanelOpen, shortcut: store.shortcutLabel('view.toggleInspector'), separatorAfter: true },
        {
          id: 'theme',
          label: 'Thème',
          submenu: [
            { id: 'theme-auto', label: 'Automatique (système)', checked: store.theme === 'auto' },
            { id: 'theme-light', label: 'Clair', checked: store.theme === 'light' },
            { id: 'theme-dark', label: 'Sombre', checked: store.theme === 'dark' },
          ],
        },
        {
          id: 'console',
          label: 'Console de conduite',
          submenu: [
            { id: 'console-auto', label: 'Automatique', checked: store.consolePreference === 'auto' },
            { id: 'console-band', label: 'Bandeau', checked: store.consolePreference === 'band' },
            { id: 'console-screen', label: 'Écran de bord', checked: store.consolePreference === 'screen' },
            { id: 'console-levers', label: 'Manettes', checked: store.consolePreference === 'levers' },
          ],
        },
      ],
      onSelect: (id) => {
        switch (id) {
          case 'fit':
            onFitView()
            break
          case 'fit-board':
            store.fitBoard()
            showToast('Vue centrée sur le plateau de réseau', 'info')
            break
          case 'zoom-100':
            store.resetZoom()
            break
          case 'toggle-grid':
            store.toggleGrid()
            break
          case 'toggle-snap':
            store.toggleSnap()
            break
          case 'toggle-dimensions':
            store.toggleDimensions()
            break
          case 'toggle-minimap':
            store.toggleMinimap()
            break
          case 'toggle-signal-blocks':
            store.toggleSignalBlocks()
            break
          case 'toggle-signal-reservations':
            store.toggleSignalReservations()
            break
          case 'toggle-inclination':
            store.toggleInclination()
            break
          case 'toggle-driving-view':
            store.toggleMinimalDrivingView()
            break
          case 'toggle-dispatcher':
            store.toggleDispatcher()
            break
          case 'toggle-inspector':
            store.toggleSidePanel()
            break
          case 'theme-auto':
            store.setTheme('auto')
            break
          case 'theme-light':
            store.setTheme('light')
            break
          case 'theme-dark':
            store.setTheme('dark')
            break
          case 'console-auto':
            store.setConsolePreference('auto')
            break
          case 'console-band':
            store.setConsolePreference('band')
            break
          case 'console-screen':
            store.setConsolePreference('screen')
            break
          case 'console-levers':
            store.setConsolePreference('levers')
            break
        }
      },
    },
    {
      label: 'Simulation',
      items: [
        {
          id: 'toggle-play',
          label: store.isPlayMode ? 'Quitter la conduite' : 'Prendre les commandes',
          shortcut: store.shortcutLabel('sim.togglePlay'),
          disabled: !hasTrain,
        },
        { id: 'remote-desk', label: 'Pupitre sur téléphone…', separatorAfter: true },
        { id: 'toggle-train-debug', label: 'Squelette des trains', checked: store.showTrainDebug, shortcut: store.shortcutLabel('train.debug') },
      ],
      onSelect: (id) => {
        if (id === 'toggle-play') store.togglePlayMode()
        else if (id === 'toggle-train-debug') store.toggleTrainDebug()
        else if (id === 'remote-desk') {
          // A new room each time the session is opened; an open one is shown again as it is
          if (!remoteDeskUnavailable()) remote.open()
          setShowRemoteModal(true)
        }
      },
    },
    {
      label: 'Aide',
      items: [
        { id: 'shortcuts', label: 'Raccourcis clavier', separatorAfter: true },
        { id: 'source', label: 'Code source sur GitHub' },
        { id: 'release-notes', label: `Notes de version (v${__APP_VERSION__})`, separatorAfter: true },
        { id: 'about', label: 'À propos et licence' },
      ],
      onSelect: (id) => {
        switch (id) {
          case 'shortcuts':
            setShowShortcutsModal(true)
            break
          case 'source':
            window.open(REPO_URL, '_blank', 'noopener,noreferrer')
            break
          case 'release-notes':
            window.open(RELEASE_NOTES_URL, '_blank', 'noopener,noreferrer')
            break
          case 'about':
            setShowAboutModal(true)
            break
        }
      },
    },
  ]

  return (
    <>
      <div className="top-bar">
        <div className="tb-left">
          {editingName ? (
            <input
              className="tb-name-input"
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName()
                if (e.key === 'Escape') {
                  setNameDraft(store.projectName)
                  setEditingName(false)
                }
              }}
            />
          ) : (
            <button
              className="tb-name"
              onClick={() => {
                setNameDraft(store.projectName)
                setEditingName(true)
              }}
              title="Cliquer pour renommer"
            >
              {store.projectName}
              {store.dirty && (
                <span
                  className={store.autosaveFailed ? 'tb-dirty tb-dirty-unsaved' : 'tb-dirty'}
                  title={
                    store.autosaveFailed
                      ? "Modifications non exportées dans un fichier, et que ce navigateur n'a pas pu enregistrer (projet trop volumineux) : exportez le projet par Fichier ▸ Exporter"
                      : 'Modifications non exportées dans un fichier (enregistrées automatiquement dans ce navigateur)'
                  }
                />
              )}
            </button>
          )}
        </div>
        <MenuBar menus={menus} />
        <div className="tb-right">
          <button
            className="tb-scale"
            onClick={store.openSettings}
            title="Échelle et plateau actifs — Cliquer pour ouvrir les paramètres (Ctrl+,)"
          >
            <span>{store.scalePreset}</span>
            {store.boardEnabled && (
              <span className="tb-scale-board">
                {formatDistance(store.boardWidth, store.unit)} × {formatDistance(store.boardHeight, store.unit)}
              </span>
            )}
          </button>
          <button
            className="tb-icon-btn"
            onClick={store.cycleTheme}
            title={`Thème : ${THEME_LABELS[store.theme]}`}
            aria-label="Changer de thème"
          >
            {store.theme === 'light' && (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
              </svg>
            )}
            {store.theme === 'dark' && (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
            {store.theme === 'auto' && (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <Modal
        isOpen={showNewModal}
        title="Nouveau réseau ferroviaire"
        confirmLabel="Créer un nouveau réseau"
        confirmVariant="danger"
        onClose={() => setShowNewModal(false)}
        onConfirm={() => {
          store.newProject()
          showToast('Nouveau réseau créé', 'info')
        }}
      >
        <p>Voulez-vous réinitialiser le plan actuel ? Toutes les voies non exportées seront effacées.</p>
      </Modal>
      <Modal
        isOpen={pendingExample !== null}
        title={`Ouvrir l'exemple « ${pendingExample?.label ?? ''} »`}
        confirmLabel="Ouvrir l'exemple"
        confirmVariant="danger"
        onClose={() => setPendingExample(null)}
        onConfirm={() => {
          if (pendingExample) openExample(store, pendingExample, onFitView)
        }}
      >
        <p>{pendingExample?.description}</p>
        <p>L'exemple remplace le plan actuel : toutes les voies non exportées seront effacées.</p>
      </Modal>
      {/* Mounted on opening: each import starts from a blank window */}
      {showOsmImport && (
        <Suspense fallback={null}>
          <OsmImportModal store={store} onClose={() => setShowOsmImport(false)} />
        </Suspense>
      )}
      {showSandbox && (
        <Suspense fallback={null}>
          <SandboxModal
            store={store}
            onPhoneDesk={() => {
              if (!remoteDeskUnavailable()) remote.open()
              setShowRemoteModal(true)
            }}
            onClose={() => setShowSandbox(false)}
          />
        </Suspense>
      )}
      {showLineBetween && (
        <Suspense fallback={null}>
          <LineBetweenStationsModal store={store} onClose={() => setShowLineBetween(false)} />
        </Suspense>
      )}
      <Modal
        isOpen={mergeOutcome !== null}
        title="Bilan de la fusion"
        onClose={() => setMergeOutcome(null)}
        closeLabel="Fermer"
        confirmLabel="Cadrer l’ajout"
        onConfirm={mergeOutcome?.addedBox ? () => store.frameBox(mergeOutcome.addedBox!) : undefined}
        dialogClassName="osm-dialog"
      >
        {mergeOutcome && (
          <>
            <Figures figures={mergeReportFigures(mergeOutcome)} wide />
            {mergeReportNotes(mergeOutcome).map((note) => (
              <p className="osm-note" key={note}>
                {note}
              </p>
            ))}
          </>
        )}
      </Modal>
      <AboutModal isOpen={showAboutModal} osmSource={store.osmSource} dataset={store.isNetworkLocked} onClose={() => setShowAboutModal(false)} />
      <RemoteDeskModal store={store} remote={remote} isOpen={showRemoteModal} onClose={() => setShowRemoteModal(false)} />
      <ShortcutsModal store={store} isOpen={showShortcutsModal} onClose={() => setShowShortcutsModal(false)} />
      <SettingsModal
        store={store}
        isOpen={store.isSettingsOpen}
        onClose={store.closeSettings}
      />
    </>
  )
}

/** Menu ids of the example networks: this prefix, then the id of the example */
const EXAMPLE_ITEM_PREFIX = 'example:'

/**
 * Replace the current network with an example. One that carries a camera opens on it — the train
 * to drive, on a line too long to show whole; the others are framed.
 */
async function openExample(store: EditorStore, example: ExampleNetwork, onFitView: () => void): Promise<void> {
  try {
    const project = await loadExample(example)
    store.loadFromData(project)
    if (!project.camera) onFitView()
    showToast(`Exemple « ${example.label} » ouvert`, 'success')
  } catch {
    showToast("Impossible de charger l'exemple", 'error')
  }
}

// --- Import / export helpers (JSON / SVG / PNG) ---

function importJSON(store: EditorStore): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const data = JSON.parse(text)
      store.loadFromData(data)
      showToast('Réseau importé', 'success')
    } catch {
      showToast('Fichier JSON invalide', 'error')
    }
  }
  input.click()
}

/** « Ajouter un JSON au projet… »: the file is merged into the current project instead of replacing it */
function mergeJSON(store: EditorStore, onDone: (outcome: MergeOutcome) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const outcome = store.mergeProjectFile(JSON.parse(text))
      if (outcome) onDone(outcome)
      else showToast('Fusion impossible en conduite ou sur un réseau importé', 'error')
    } catch {
      showToast('Fichier JSON invalide', 'error')
    }
  }
  input.click()
}

function exportJSON(store: EditorStore): void {
  // Same payload as the autosave: one store method builds both
  download(
    JSON.stringify(store.exportProject(), null, 2),
    `${store.projectName.replace(/\s+/g, '-').toLowerCase()}.json`,
    'application/json',
  )
  store.markClean()
}

function exportPNG(store: EditorStore): void {
  const canvas = document.querySelector('.canvas-wrap canvas') as HTMLCanvasElement | null
  if (!canvas) return
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${store.projectName.replace(/\s+/g, '-').toLowerCase()}.png`
    a.click()
    URL.revokeObjectURL(url)
  })
}

function download(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
