import { useState } from 'react'
import { Menu, MenuBar, type MenuItem } from './Menu'
import type { EditorStore, ThemeMode } from '@application/state/editorStore'
import { exportSVG } from '@infrastructure/export/exportSvg'
import { showToast } from '../common/Toast'
import { Modal } from '../common/Modal'
import { SettingsModal } from '../settings/SettingsModal'
import { formatDistance } from '@domain/models/units'
import { chordLabel, type ActionId } from '@application/keybindings/keybindings'

const THEME_LABELS: Record<ThemeMode, string> = {
  auto: 'automatique (système)',
  light: 'clair',
  dark: 'sombre',
}

interface TopBarProps {
  store: EditorStore
  onFitView: () => void
}

export function TopBar({ store, onFitView }: TopBarProps) {
  /** Every key assigned to an action, for the shortcuts dialog */
  const keys = (action: ActionId) => {
    const chords = store.keybindings[action].filter((c) => c !== null)
    if (chords.length === 0) return '—'
    return chords.map((c, i) => (
      <span key={i}>
        {i > 0 && ' ou '}
        <span className="shortcut-kbd">{chordLabel(c, store.keyLabels)}</span>
      </span>
    ))
  }
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(store.projectName)
  const [showNewModal, setShowNewModal] = useState(false)
  const [showShortcutsModal, setShowShortcutsModal] = useState(false)

  const commitName = () => {
    setEditingName(false)
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== store.projectName) {
      store.setProjectName(trimmed)
    } else {
      setNameDraft(store.projectName)
    }
  }

  const fileItems: MenuItem[] = [
    { id: 'new', label: 'Nouveau réseau' },
    { id: 'settings', label: 'Paramètres du réseau (Échelles, Unités)...', shortcut: 'Ctrl+,', separatorAfter: true },
    { id: 'import-json', label: 'Importer JSON...' },
    { id: 'export-json', label: 'Exporter JSON', separatorAfter: true },
    { id: 'export-svg', label: 'Exporter SVG réaliste (1:87)' },
    { id: 'export-png', label: 'Exporter PNG' },
  ]

  const editItems: MenuItem[] = [
    { id: 'undo', label: 'Annuler', shortcut: 'Ctrl+Z', disabled: !store.canUndo },
    { id: 'redo', label: 'Rétablir', shortcut: 'Ctrl+Maj+Z', disabled: !store.canRedo, separatorAfter: true },
    { id: 'delete', label: 'Supprimer', shortcut: 'Suppr' },
    { id: 'duplicate', label: 'Créer une voie parallèle', shortcut: store.shortcutLabel('edit.parallelTrack'), disabled: !store.canCreateParallelTrack },
    { id: 'select-all', label: 'Tout sélectionner', shortcut: 'Ctrl+A', separatorAfter: true },
    { id: 'reconcile', label: 'Réconcilier les jonctions & aiguillages', shortcut: 'R', separatorAfter: true },
    { id: 'clear', label: 'Désélectionner tout' },
  ]

  const viewItems: MenuItem[] = [
    { id: 'fit', label: 'Ajuster à la vue', shortcut: store.shortcutLabel('view.fit') },
    { id: 'fit-board', label: 'Cadrer le plateau de réseau', disabled: !store.boardEnabled },
    { id: 'zoom-100', label: 'Zoom par défaut', shortcut: 'Ctrl+0', separatorAfter: true },
    { id: 'toggle-grid', label: store.showGrid ? 'Masquer la grille' : 'Afficher la grille' },
    { id: 'toggle-snap', label: store.snap ? 'Désactiver l’aimantation' : 'Activer l’aimantation', shortcut: store.shortcutLabel('view.toggleSnap') },
    { id: 'toggle-dimensions', label: store.showDimensions ? 'Masquer les cotes dynamiques' : 'Afficher les cotes dynamiques' },
    { id: 'toggle-minimap', label: store.showMinimap ? 'Masquer la mini-carte' : 'Afficher la mini-carte' },
    { id: 'toggle-inspector', label: store.isSidePanelOpen ? 'Masquer l’inspecteur' : 'Afficher l’inspecteur', shortcut: store.shortcutLabel('view.toggleInspector'), separatorAfter: true },
    { id: 'open-settings', label: 'Paramètres & Échelles...', shortcut: 'Ctrl+,' },
  ]

  const helpItems: MenuItem[] = [
    { id: 'shortcuts', label: 'Raccourcis clavier' },
  ]

  const onFileSelect = (id: string) => {
    switch (id) {
      case 'new':
        if (store.network.nodes.size > 0 || store.network.segments.size > 0) {
          setShowNewModal(true)
        } else {
          store.newProject()
          showToast('Nouveau réseau créé', 'info')
        }
        break
      case 'settings':
        store.openSettings()
        break
      case 'import-json': {
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
        break
      }
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
    }
  }

  const onEditSelect = (id: string) => {
    switch (id) {
      case 'undo':
        store.undo()
        break
      case 'redo':
        store.redo()
        break
      case 'reconcile':
        store.reconcileTopology()
        showToast('Topologie et aiguillages réconciliés', 'info')
        break
      case 'delete':
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
        break
      case 'duplicate':
        if (!store.createParallelTrackFromSelection()) {
          showToast('Sélectionnez une voie ou deux nœuds pour créer une voie parallèle', 'info')
        }
        break
      case 'select-all':
        store.selectAll()
        break
      case 'clear':
        // A pose in progress is cancelled properly (its lone start node goes with it)
        if (store.hasPendingPlacement) store.cancelInteraction()
        store.clearSelection()
        break
    }
  }

  const onViewSelect = (id: string) => {
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
        showToast(store.showDimensions ? 'Cotes dynamiques affichées' : 'Cotes dynamiques masquées', 'info')
        break
      case 'toggle-minimap':
        store.toggleMinimap()
        break
      case 'toggle-inspector':
        store.toggleSidePanel()
        break
      case 'open-settings':
        store.openSettings()
        break
    }
  }

  const onHelpSelect = (id: string) => {
    if (id === 'shortcuts') {
      setShowShortcutsModal(true)
    }
  }

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
                  className="tb-dirty"
                  title="Modifications non exportées dans un fichier (enregistrées automatiquement dans ce navigateur)"
                />
              )}
            </button>
          )}
        </div>
        <MenuBar>
          <Menu label="Fichier" items={fileItems} onSelect={onFileSelect} />
          <Menu label="Édition" items={editItems} onSelect={onEditSelect} />
          <Menu label="Affichage" items={viewItems} onSelect={onViewSelect} />
          <Menu label="Aide" items={helpItems} onSelect={onHelpSelect} />
        </MenuBar>
        <div className="tb-right">
          <button
            onClick={store.openSettings}
            title="Échelle et plateau actifs — Cliquer pour ouvrir les paramètres"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 8px',
              borderRadius: '4px',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              color: 'var(--ink)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              marginRight: '2px',
            }}
          >
            <span>{store.scalePreset}</span>
            {store.boardEnabled && (
              <span style={{ opacity: 0.75, fontWeight: 400 }}>
                {formatDistance(store.boardWidth, store.unit)} × {formatDistance(store.boardHeight, store.unit)}
              </span>
            )}
          </button>
          <button
            className="tb-icon-btn"
            onClick={store.openSettings}
            title="Paramètres du réseau & Échelles ferroviaires (Ctrl+,)"
            aria-label="Paramètres"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
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

      {/* Modal Nouveau Réseau (Figma Principle: Forgiveness) */}
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

      {/* Modal Raccourcis Clavier (Figma Principle: Clarity & Discoverability) */}
      <Modal
        isOpen={showShortcutsModal}
        title="Raccourcis clavier Open Rails"
        closeLabel="Fermer"
        onClose={() => setShowShortcutsModal(false)}
      >
        <div className="shortcuts-grid">
          <div className="shortcuts-section" style={{ gridColumn: '1 / -1', fontWeight: 700, marginTop: '6px' }}>Outils</div>
          <div>{keys('tool.select')}</div>
          <div>Sélection et déplacement</div>
          <div>{keys('tool.place')}</div>
          <div>Voie droite</div>
          <div>{keys('tool.curve')}</div>
          <div>Voie courbe</div>
          <div>{keys('tool.turnout')}</div>
          <div>Aiguillage</div>
          <div>{keys('tool.split')}</div>
          <div>Ciseaux (scinder une voie)</div>
          <div>{keys('tool.measure')}</div>
          <div>Règle (mesurer)</div>
          <div>{keys('tool.pan')}</div>
          <div>Déplacer la vue</div>
          <div>{keys('tool.locomotive')}</div>
          <div>Trains (pose et sélection)</div>
          <div className="shortcuts-section" style={{ gridColumn: '1 / -1', fontWeight: 700, marginTop: '6px' }}>Pose des voies</div>
          <div><span className="shortcut-kbd">0</span>–<span className="shortcut-kbd">9</span> puis <span className="shortcut-kbd">Entrée</span></div>
          <div>Saisir la longueur exacte de la voie droite en cours</div>
          <div><span className="shortcut-kbd">Tab</span></div>
          <div>Continuer en courbe depuis le nœud de la voie droite en cours ; changer de côté (courbe, aiguillage)</div>
          <div><span className="shortcut-kbd">Maj</span> + clic</div>
          <div>Poser une voie double</div>
          <div>{keys('edit.paramDecrease')} / {keys('edit.paramIncrease')}</div>
          <div>Rayon précédent / suivant (courbe, aiguillage)</div>
          <div>Clic droit</div>
          <div>Terminer la pose en cours</div>
          <div><span className="shortcut-kbd">Échap</span></div>
          <div>Annuler la pose en cours, puis revenir à l’outil Sélection</div>
          <div className="shortcuts-section" style={{ gridColumn: '1 / -1', fontWeight: 700, marginTop: '6px' }}>Édition</div>
          <div>{keys('edit.toggleJunction')}</div>
          <div>Basculer l’aiguillage sélectionné</div>
          <div>{keys('edit.parallelTrack')}</div>
          <div>Créer une voie parallèle à la sélection</div>
          <div><span className="shortcut-kbd">R</span></div>
          <div>Réconcilier les jonctions et aiguillages</div>
          <div><span className="shortcut-kbd">Suppr</span> ou <span className="shortcut-kbd">Retour arrière</span></div>
          <div>Supprimer la sélection</div>
          <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">A</span></div>
          <div>Tout sélectionner</div>
          <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">Z</span></div>
          <div>Annuler</div>
          <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">Maj</span> + <span className="shortcut-kbd">Z</span> ou <span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">Y</span></div>
          <div>Rétablir</div>
          <div className="shortcuts-section" style={{ gridColumn: '1 / -1', fontWeight: 700, marginTop: '6px' }}>Trains</div>
          <div><span className="shortcut-kbd">R</span> ou <span className="shortcut-kbd">Tab</span></div>
          <div>Inverser le sens du véhicule à poser</div>
          <div><span className="shortcut-kbd">Suppr</span></div>
          <div>Supprimer le véhicule sélectionné</div>
          <div>{keys('train.debug')}</div>
          <div>Afficher / masquer le squelette des trains</div>
          <div className="shortcuts-section" style={{ gridColumn: '1 / -1', fontWeight: 700, marginTop: '6px' }}>Affichage</div>
          <div><span className="shortcut-kbd">Espace</span> + glisser</div>
          <div>Déplacer la vue</div>
          <div>{keys('view.fit')}</div>
          <div>Ajuster tout le réseau à la vue</div>
          <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">0</span></div>
          <div>Zoom par défaut</div>
          <div>{keys('view.toggleSnap')}</div>
          <div>Activer / désactiver l’aimantation</div>
          <div>{keys('view.toggleInspector')}</div>
          <div>Afficher / masquer l’inspecteur</div>
          <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">,</span> ou <span className="shortcut-kbd">,</span></div>
          <div>Paramètres du réseau (échelles, unités)</div>
          <div className="shortcuts-section" style={{ gridColumn: '1 / -1', fontWeight: 700, marginTop: '6px' }}>Conduite</div>
          <div>{keys('sim.togglePlay')}</div>
          <div>Entrer en mode conduite / le quitter</div>
          <div>{keys('drive.exit')} ou <span className="shortcut-kbd">Échap</span></div>
          <div>Quitter la conduite</div>
          <div>{keys('drive.notchUp')}</div>
          <div>Manipulateur : un cran vers la traction</div>
          <div>{keys('drive.notchDown')}</div>
          <div>Manipulateur : un cran vers le frein</div>
          <div>{keys('drive.reverserForward')}</div>
          <div>Inverseur vers l’avant</div>
          <div>{keys('drive.reverserBackward')}</div>
          <div>Inverseur vers l’arrière</div>
          <div>{keys('drive.emergencyBrake')}</div>
          <div>Arrêt d’urgence</div>
          <div>{keys('drive.steerLeft')} / {keys('drive.steerRight')}</div>
          <div>Orienter le prochain aiguillage</div>
          <div style={{ gridColumn: '1 / -1', marginTop: '6px', opacity: 0.8 }}>
            Les touches de conduite et d’outils se modifient dans les paramètres (Ctrl + ,).
          </div>
        </div>
      </Modal>
      <SettingsModal
        store={store}
        isOpen={store.isSettingsOpen}
        onClose={store.closeSettings}
      />
    </>
  )
}

// --- Export helpers (JSON / SVG / PNG) ---

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
