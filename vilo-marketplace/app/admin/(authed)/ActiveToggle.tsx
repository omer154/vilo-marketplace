'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

type Table = 'services' | 'suppliers'

export default function ActiveToggle({
  table,
  id,
  initialActive,
}: {
  table: Table
  id: string
  initialActive: boolean
}) {
  const [active, setActive] = useState(initialActive)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleToggle = async () => {
    const newValue = !active
    setActive(newValue) // optimistic
    setError(null)

    try {
      const res = await fetch(`/api/admin/${table}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: newValue }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      startTransition(() => router.refresh())
    } catch (err) {
      setActive(!newValue) // rollback
      setError(err instanceof Error ? err.message : 'error')
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        className={`relative inline-flex h-5 w-10 items-center rounded-full transition ${active ? 'bg-emerald-500' : 'bg-gray-300'} disabled:opacity-50`}
        title={active ? 'פעיל — לחץ להסתרה' : 'לא פעיל — לחץ להפעלה'}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${active ? 'translate-x-5' : 'translate-x-1'}`}
        />
      </button>
      {pending && <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />}
      {error && (
        <span className="text-xs text-red-600 mr-1" title={error}>
          !
        </span>
      )}
    </div>
  )
}
