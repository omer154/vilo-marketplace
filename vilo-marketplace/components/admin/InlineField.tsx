'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, AlertCircle, Pencil } from 'lucide-react'
import { useMarketplaceStore } from '@/store/marketplaceStore'

type FieldType = 'text' | 'textarea' | 'number' | 'select'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface Option {
  value: string
  label: string
}

interface InlineFieldProps {
  /** e.g. `/api/admin/services/<id>` or `/api/admin/suppliers/<id>` */
  endpoint: string
  /** column name, e.g. 'service_name' */
  field: string
  value: string | number | null
  type?: FieldType
  options?: Option[]
  /** Read-mode label when the value is empty (admins always see it; public sees it only if provided). */
  emptyLabel?: string
  prefix?: string
  suffix?: string
  /** Custom read-mode formatter (e.g. number → "1,500"). */
  format?: (v: string | number) => string
  className?: string
  /** Called after a successful save with the new value. */
  onSaved?: (value: string | number | null) => void
  ariaLabel?: string
}

function parseValue(raw: string, type: FieldType): string | number | null {
  const t = raw.trim()
  if (t === '') return null
  if (type === 'number') {
    const n = Number(t.replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return t
}

export default function InlineField({
  endpoint,
  field,
  value,
  type = 'text',
  options,
  emptyLabel,
  prefix,
  suffix,
  format,
  className = '',
  onSaved,
  ariaLabel,
}: InlineFieldProps) {
  const isAdmin = useMarketplaceStore((s) => s.isAdmin)
  const pushToast = useMarketplaceStore((s) => s.pushToast)
  const [current, setCurrent] = useState<string | number | null>(value)
  const [editing, setEditing] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null)

  useEffect(() => {
    setCurrent(value)
  }, [value])

  const isEmpty = current === null || current === undefined || current === ''
  const readText = (() => {
    if (isEmpty) return emptyLabel ?? ''
    if (type === 'select' && options) {
      return options.find((o) => o.value === String(current))?.label ?? String(current)
    }
    if (format) return format(current as string | number)
    return String(current)
  })()

  // Public (non-admin) view: plain text, or nothing when empty and no emptyLabel.
  if (!isAdmin) {
    if (isEmpty && !emptyLabel) return null
    return (
      <span className={className}>
        {!isEmpty && prefix}
        {readText}
        {!isEmpty && suffix}
      </span>
    )
  }

  async function commit(raw: string) {
    const parsed = parseValue(raw, type)
    setEditing(false)
    if (parsed === current) return
    setSaveState('saving')
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: parsed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `שגיאה ${res.status}`)
      setCurrent(parsed)
      onSaved?.(parsed)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 1600)
    } catch (e) {
      setSaveState('error')
      pushToast(e instanceof Error ? e.message : 'השמירה נכשלה', 'error')
      setTimeout(() => setSaveState('idle'), 2600)
    }
  }

  if (editing) {
    const common =
      'rounded-md border border-brand-300 bg-white px-2 py-1 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100'
    if (type === 'select' && options) {
      return (
        <select
          ref={inputRef as React.Ref<HTMLSelectElement>}
          autoFocus
          defaultValue={String(current ?? '')}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setEditing(false)}
          className={common}
          aria-label={ariaLabel || field}
        >
          {isEmpty && <option value="">— בחר —</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    }
    if (type === 'textarea') {
      return (
        <textarea
          ref={inputRef as React.Ref<HTMLTextAreaElement>}
          autoFocus
          rows={3}
          defaultValue={String(current ?? '')}
          onBlur={(e) => commit(e.target.value)}
          className={`${common} w-full resize-y`}
          aria-label={ariaLabel || field}
        />
      )
    }
    return (
      <input
        ref={inputRef as React.Ref<HTMLInputElement>}
        autoFocus
        type={type === 'number' ? 'number' : 'text'}
        defaultValue={String(current ?? '')}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        className={`${common} w-28 max-w-full`}
        aria-label={ariaLabel || field}
      />
    )
  }

  // Admin read mode — editable affordance.
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      title="לחץ לעריכה"
      className="group/edit -mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 text-right align-middle transition-colors hover:bg-brand-50"
    >
      <span className={isEmpty ? 'italic text-gray-400' : className}>
        {!isEmpty && prefix}
        {isEmpty ? emptyLabel ?? 'הוסף' : readText}
        {!isEmpty && suffix}
      </span>
      {saveState === 'saving' && <Loader2 className="h-3 w-3 animate-spin text-brand-500" />}
      {saveState === 'saved' && <Check className="h-3 w-3 text-green-500" />}
      {saveState === 'error' && <AlertCircle className="h-3 w-3 text-red-500" />}
      {saveState === 'idle' && (
        <Pencil className="h-3 w-3 text-brand-400 opacity-0 transition-opacity group-hover/edit:opacity-60" />
      )}
    </button>
  )
}
