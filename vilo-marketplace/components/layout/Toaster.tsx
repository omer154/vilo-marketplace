'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Info, CheckCircle2, X } from 'lucide-react'
import { useMarketplaceStore, type ToastEntry } from '@/store/marketplaceStore'

const KIND_STYLE: Record<ToastEntry['kind'], string> = {
  error: 'bg-red-50 border-red-200 text-red-900',
  info: 'bg-gray-50 border-gray-200 text-gray-900',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
}

const KIND_ICON: Record<ToastEntry['kind'], typeof AlertCircle> = {
  error: AlertCircle,
  info: Info,
  success: CheckCircle2,
}

const AUTO_DISMISS_MS = 4000

function ToastCard({ toast }: { toast: ToastEntry }) {
  const dismiss = useMarketplaceStore((s) => s.dismissToast)
  const Icon = KIND_ICON[toast.kind]

  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [toast.id, dismiss])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.18 }}
      className={`pointer-events-auto flex items-start gap-3 border rounded-lg shadow-md px-4 py-3 min-w-[260px] max-w-md text-sm ${KIND_STYLE[toast.kind]}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1 leading-relaxed">{toast.message}</span>
      <button
        onClick={() => dismiss(toast.id)}
        aria-label="סגור הודעה"
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  )
}

export default function Toaster() {
  const toasts = useMarketplaceStore((s) => s.toasts)
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  )
}
