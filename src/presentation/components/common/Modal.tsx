import { useEffect, type ReactNode } from 'react'

export interface ModalProps {
  isOpen: boolean
  title: string
  children: ReactNode
  onClose: () => void
  onConfirm?: () => void
  confirmLabel?: string
  confirmVariant?: 'primary' | 'danger'
  closeLabel?: string
}

/**
 * Reusable accessible modal dialog adhering to Figma design principles:
 * - Clarity & Hierarchy: Prominent title, backdrop blur, clear call to actions
 * - Forgiveness: Escape key support, clean dismissal
 */
export function Modal({
  isOpen,
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel = 'Confirmer',
  confirmVariant = 'primary',
  closeLabel = 'Annuler',
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 'var(--z-modal)' }}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">
          <button className="modal-btn modal-btn-secondary" onClick={onClose}>
            {closeLabel}
          </button>
          {onConfirm && (
            <button
              className={`modal-btn modal-btn-${confirmVariant}`}
              onClick={() => {
                onConfirm()
                onClose()
              }}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
