import { useEffect, useState } from 'react'

export interface ToastMessage {
  id: string
  text: string
  type?: 'info' | 'success' | 'warning' | 'error'
  duration?: number
}

type ToastListener = (toast: ToastMessage) => void
const listeners = new Set<ToastListener>()

/** Global helper to show feedback toast notifications (Principe Figma: Feedback visuel immédiat) */
export function showToast(text: string, type: ToastMessage['type'] = 'info', duration = 3000): void {
  const toast: ToastMessage = {
    id: `${Date.now()}-${Math.random()}`,
    text,
    type,
    duration,
  }
  listeners.forEach((fn) => fn(toast))
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(() => {
    const handleToast: ToastListener = (t) => {
      setToasts((prev) => [...prev, t])
      setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== t.id))
      }, t.duration ?? 3000)
    }
    listeners.add(handleToast)
    return () => {
      listeners.delete(handleToast)
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="toast-container" style={{ zIndex: 'var(--z-tooltip)' }}>
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item toast-${toast.type ?? 'info'}`}>
          <span className="toast-icon">
            {toast.type === 'success' && '✓'}
            {toast.type === 'error' && '✕'}
            {toast.type === 'warning' && '⚠'}
            {(!toast.type || toast.type === 'info') && 'ℹ'}
          </span>
          <span className="toast-text">{toast.text}</span>
        </div>
      ))}
    </div>
  )
}
