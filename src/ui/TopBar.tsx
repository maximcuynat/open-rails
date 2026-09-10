import { useState } from 'react'
import { Menu, MenuBar, type MenuItem } from './Menu'
import type { EditorStore } from './store'

interface TopBarProps {
  store: EditorStore
  onFitView: () => void
}

export function TopBar({ store, onFitView }: TopBarProps) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(store.projectName)

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
    { id: 'new', label: 'New' },
    { id: 'export-json', label: 'Export JSON' },
    { id: 'export-svg', label: 'Export SVG', separatorAfter: true },
    { id: 'export-png', label: 'Export PNG' },
  ]

  const editItems: MenuItem[] = [
    { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', disabled: true },
    { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: true, separatorAfter: true },
    { id: 'delete', label: 'Delete', shortcut: 'Del' },
    { id: 'duplicate', label: 'Duplicate', shortcut: 'Ctrl+D', disabled: true },
    { id: 'select-all', label: 'Select all', shortcut: 'Ctrl+A', disabled: true, separatorAfter: true },
    { id: 'clear', label: 'Clear selection', shortcut: 'Esc' },
  ]

  const viewItems: MenuItem[] = [
    { id: 'fit', label: 'Fit to view', shortcut: 'F' },
    { id: 'zoom-100', label: 'Zoom 100%', shortcut: 'Ctrl+0', separatorAfter: true },
    { id: 'toggle-grid', label: 'Toggle grid' },
    { id: 'toggle-snap', label: 'Toggle snap', shortcut: 'G' },
    { id: 'toggle-minimap', label: 'Toggle minimap', separatorAfter: true },
  ]

  const helpItems: MenuItem[] = [
    { id: 'shortcuts', label: 'Keyboard shortcuts' },
  ]

  const onFileSelect = (id: string) => {
    switch (id) {
      case 'new':
        // Future: confirm if dirty
        window.location.reload()
        break
      case 'export-json':
        exportJSON(store)
        break
      case 'export-svg':
        exportSVG(store)
        break
      case 'export-png':
        exportPNG(store)
        break
    }
  }

  const onEditSelect = (id: string) => {
    switch (id) {
      case 'delete':
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
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
    }
  }

  const onHelpSelect = (id: string) => {
    if (id === 'shortcuts') {
      alert(
        'Shortcuts:\n\nV — Select\nN — Place node\nC — Curve\nH — Pan\nG — Toggle snap\nF — Fit to view\nCtrl+0 — Reset zoom\nDel — Delete selection\nEsc — Clear / cancel',
      )
    }
  }

  return (
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
            title="Click to rename"
          >
            {store.projectName}
            {store.dirty && <span className="tb-dirty" title="Unsaved changes" />}
          </button>
        )}
      </div>
      <MenuBar>
        <Menu label="File" items={fileItems} onSelect={onFileSelect} />
        <Menu label="Edit" items={editItems} onSelect={onEditSelect} />
        <Menu label="View" items={viewItems} onSelect={onViewSelect} />
        <Menu label="Help" items={helpItems} onSelect={onHelpSelect} />
      </MenuBar>
      <div className="tb-right">
        <button
          className="tb-icon-btn"
          onClick={store.cycleTheme}
          title={`Theme: ${store.theme}`}
          aria-label="Toggle theme"
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
  )
}

// --- Export helpers (JSON / SVG / PNG) ---

function exportJSON(store: EditorStore): void {
  const net = store.network
  const data = {
    version: 1,
    name: store.projectName,
    nodes: [...net.nodes.values()].map((n) => ({ id: n.id, x: n.pos.x, y: n.pos.y })),
    segments: [...net.segments.values()].map((s) => ({
      id: s.id,
      from: s.from,
      to: s.to,
      kind: s.kind,
      via: s.via ? { x: s.via.x, y: s.via.y } : undefined,
    })),
  }
  download(
    JSON.stringify(data, null, 2),
    `${store.projectName.replace(/\s+/g, '-').toLowerCase()}.json`,
    'application/json',
  )
  store.markClean()
}

function exportSVG(store: EditorStore): void {
  const net = store.network
  if (net.nodes.size === 0) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of net.nodes.values()) {
    minX = Math.min(minX, n.pos.x)
    minY = Math.min(minY, n.pos.y)
    maxX = Math.max(maxX, n.pos.x)
    maxY = Math.max(maxY, n.pos.y)
  }
  const pad = 10
  const w = maxX - minX + pad * 2
  const h = maxY - minY + pad * 2
  const ox = minX - pad
  const oy = minY - pad

  const paths: string[] = []
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) continue
    if (seg.kind === 'curve' && seg.via) {
      paths.push(`M${a.pos.x - ox},${a.pos.y - oy} Q${seg.via.x - ox},${seg.via.y - oy} ${b.pos.x - ox},${b.pos.y - oy}`)
    } else {
      paths.push(`M${a.pos.x - ox},${a.pos.y - oy} L${b.pos.x - ox},${b.pos.y - oy}`)
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <g fill="none" stroke="currentColor" stroke-width="1">
    ${paths.map((p) => `<path d="${p}" />`).join('\n    ')}
  </g>
</svg>`
  download(svg, `${store.projectName.replace(/\s+/g, '-').toLowerCase()}.svg`, 'image/svg+xml')
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
