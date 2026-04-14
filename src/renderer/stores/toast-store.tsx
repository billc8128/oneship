import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type ToastVariant = 'info' | 'success' | 'warning' | 'danger'

export interface Toast {
  id: string
  message: string
  variant: ToastVariant
  expiresAt: number
}

interface ToastContextValue {
  toasts: Toast[]
  show: (message: string, variant?: ToastVariant, durationMs?: number) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DEFAULT_DURATION_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback((message: string, variant: ToastVariant = 'info', durationMs = DEFAULT_DURATION_MS) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const expiresAt = Date.now() + durationMs
    setToasts((previous) => [...previous, { id, message, variant, expiresAt }])
  }, [])

  useEffect(() => {
    if (toasts.length === 0) return

    const now = Date.now()
    const nextExpiry = Math.min(...toasts.map((toast) => toast.expiresAt))
    const delay = Math.max(0, nextExpiry - now)

    const timer = setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.expiresAt > Date.now()))
    }, delay)

    return () => clearTimeout(timer)
  }, [toasts])

  return (
    <ToastContext.Provider value={{ toasts, show, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used inside a ToastProvider')
  }
  return context
}
