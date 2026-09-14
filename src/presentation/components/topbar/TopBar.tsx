import { useState } from 'react'
import { Menu, MenuBar, type MenuItem } from './Menu'
import type { EditorStore } from '@application/state/editorStore'
import { exportSVG } from '@infrastructure/export/exportSvg'
import { serializeNetwork } from '@infrastructure/persistence/persistence'
import { computeTrackSections } from '@domain/models/sections'
import { showToast } from '../common/Toast'
import { Modal } from '../common/Modal'

interface TopBarProps {
  store: EditorStore
  onFitView: () => void
}

export function TopBar({ store, onFitView }: TopBarProps) {
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
    { id: 'import-json', label: 'Importer JSON...' },
    { id: 'export-json', label: 'Exporter JSON', separatorAfter: true },
    { id: 'export-svg', label: 'Exporter SVG réaliste (1:87)' },
    { id: 'export-png', label: 'Exporter PNG' },
  ]

  const editItems: MenuItem[] = [
    { id: 'undo', label: 'Annuler', shortcut: 'Ctrl+Z', disabled: !store.canUndo },
    { id: 'redo', label: 'Rétablir', shortcut: 'Ctrl+Shift+Z', disabled: !store.canRedo, separatorAfter: true },
    { id: 'delete', label: 'Supprimer', shortcut: 'Del' },
    { id: 'duplicate', label: 'Dupliquer voie double', shortcut: 'D', disabled: store.selection.nodes.size !== 2 },
    { id: 'select-all', label: 'Tout sélectionner', shortcut: 'Ctrl+A', separatorAfter: true },
    { id: 'reconcile', label: 'Réconcilier les jonctions & aiguillages', shortcut: 'R', separatorAfter: true },
    { id: 'clear', label: 'Désélectionner tout', shortcut: 'Esc' },
  ]

  const viewItems: MenuItem[] = [
    { id: 'fit', label: 'Ajuster à la vue', shortcut: 'F' },
    { id: 'zoom-100', label: 'Zoom 100%', shortcut: 'Ctrl+0', separatorAfter: true },
    { id: 'toggle-grid', label: 'Afficher la grille' },
    { id: 'toggle-snap', label: 'Activer le magnétisme', shortcut: 'G' },
    { id: 'toggle-minimap', label: 'Afficher la mini-carte' },
    { id: 'toggle-inspector', label: 'Panneau latéral de propriétés', shortcut: 'I', separatorAfter: true },
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
          showToast('Nouveau projet initialisé', 'info')
        }
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
            showToast('Projet importé avec succès', 'success')
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
      case 'select-all':
        store.selectAll()
        break
      case 'clear':
        store.clearSelection()
        store.lastNodeId = null
        store.curveState = { phase: 0, startId: null }
        break
    }
  }

  const onViewSelect = (id: string) => {
    switch (id) {
      case 'fit':
        onFitView()
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
      case 'toggle-minimap':
        store.toggleMinimap()
        break
      case 'toggle-inspector':
        store.toggleSidePanel()
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
              {store.dirty && <span className="tb-dirty" title="Modifications non sauvegardées" />}
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
            className="tb-icon-btn"
            onClick={store.cycleTheme}
            title={`Thème : ${store.theme}`}
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
          showToast('Nouveau réseau initialisé', 'info')
        }}
      >
        <p>Voulez-vous réinitialiser le plan actuel ? Toutes les voies non exportées seront effacées.</p>
      </Modal>

      {/* Modal Raccourcis Clavier (Figma Principle: Clarity & Discoverability) */}
      <Modal
        isOpen={showShortcutsModal}
        title="Raccourcis clavier Open-Rail"
        closeLabel="Fermer"
        onClose={() => setShowShortcutsModal(false)}
      >
        <div className="shortcuts-grid">
          <div><span className="shortcut-kbd">V</span></div>
          <div>Outil Sélection</div>

          <div><span className="shortcut-kbd">T</span> ou <span className="shortcut-kbd">N</span></div>
          <div>Poser une voie droite</div>

          <div><span className="shortcut-kbd">C</span></div>
          <div>Poser une courbe</div>

          <div><span className="shortcut-kbd">H</span></div>
          <div>Déplacer la vue (Pan)</div>

          <div><span className="shortcut-kbd">G</span></div>
          <div>Activer / désactiver le magnétisme</div>

          <div><span className="shortcut-kbd">F</span></div>
          <div>Ajuster tout le réseau à la vue</div>

          <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">Z</span></div>
          <div>Annuler (Undo)</div>

          <div><span className="shortcut-kbd">Ctrl</span> + <span className="shortcut-kbd">Shift</span> + <span className="shortcut-kbd">Z</span></div>
          <div>Rétablir (Redo)</div>

          <div><span className="shortcut-kbd">D</span></div>
          <div>Dupliquer la voie en voie double (2 nœuds sélectionnés)</div>

          <div><span className="shortcut-kbd">+</span> / <span className="shortcut-kbd">-</span></div>
          <div>Changer de niveau d'élévation (Pont / Tunnel)</div>

          <div><span className="shortcut-kbd">Tab</span></div>
          <div>Inverser le côté de courbure</div>

          <div><span className="shortcut-kbd">Suppr</span></div>
          <div>Supprimer la sélection</div>

          <div><span className="shortcut-kbd">Échap</span></div>
          <div>Désélectionner / Terminer la pose</div>
        </div>
      </Modal>
    </>
  )
}

// --- Export helpers (JSON / SVG / PNG) ---

function exportJSON(store: EditorStore): void {
  const sections = computeTrackSections(store.network, store.sectionMeta)
  const data = serializeNetwork(store.network, store.projectName, store.camera, store.sectionMeta, store.gridMode, store.gridSpacing, sections)
  download(
    JSON.stringify(data, null, 2),
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
