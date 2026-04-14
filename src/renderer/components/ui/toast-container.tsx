import { X } from 'lucide-react'
import { useToast, type ToastVariant } from '../../stores/toast-store'

const variantStyles: Record<ToastVariant, string> = {
  info: 'bg-surface border-border text-espresso',
  success: 'bg-surface border-success/40 text-espresso',
  warning: 'bg-surface border-warning/40 text-espresso',
  danger: 'bg-surface border-danger/40 text-espresso',
}

const variantAccent: Record<ToastVariant, string> = {
  info: 'bg-muted',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

export function ToastContainer() {
  const { toasts, dismiss } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-3 min-w-[240px] max-w-sm px-4 py-3 rounded-xl shadow-card border ${variantStyles[toast.variant]}`}
        >
          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${variantAccent[toast.variant]}`} />
          <p className="flex-1 font-body text-sm leading-snug">{toast.message}</p>
          <button
            onClick={() => dismiss(toast.id)}
            className="text-muted hover:text-secondary transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
