'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react'

interface ServiceRow {
  id: string
  service_name: string | null
  category_primary: string | null
  category_secondary: string | null
  description_short: string | null
  service_description: string | null
  price: number | null
  price_type: string | null
  price_min: number | null
  price_max: number | null
  min_participants: number | null
  max_participants: number | null
  duration_minutes: number | null
  location_mode: string | null
  notes: string | null
  is_active: boolean
}

const CATEGORY_OPTIONS: Array<{ slug: string; label: string }> = [
  { slug: 'wellbeing', label: 'וולנס' },
  { slug: 'teambuilding', label: 'גיבוש' },
  { slug: 'learning', label: 'למידה' },
  { slug: 'food', label: 'אוכל' },
  { slug: 'culture', label: 'תרבות' },
  { slug: 'travel', label: 'טיולים' },
  { slug: 'sport', label: 'ספורט' },
  { slug: 'tech', label: 'טכנולוגיה' },
  { slug: 'consulting', label: 'ייעוץ' },
]

const LOCATION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'at_client', label: 'אצל הלקוח' },
  { value: 'at_provider', label: 'אצל הספק' },
  { value: 'remote', label: 'מקוון' },
  { value: 'hybrid', label: 'גמיש' },
]

const PRICE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'fixed', label: 'מחיר קבוע' },
  { value: 'range', label: 'טווח' },
  { value: 'on_request', label: 'לפי פנייה' },
]

function num(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default function ServiceEditForm({ row }: { row: ServiceRow }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    service_name: row.service_name || '',
    category_primary: row.category_primary || '',
    price: row.price != null ? String(row.price) : '',
    price_type: row.price_type || '',
    price_min: row.price_min != null ? String(row.price_min) : '',
    price_max: row.price_max != null ? String(row.price_max) : '',
    min_participants:
      row.min_participants != null ? String(row.min_participants) : '',
    max_participants:
      row.max_participants != null ? String(row.max_participants) : '',
    duration_minutes:
      row.duration_minutes != null ? String(row.duration_minutes) : '',
    location_mode: row.location_mode || '',
    notes: row.notes || '',
  })

  const update = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setState('saving')
    setError(null)
    try {
      const body = {
        service_name: form.service_name.trim() || null,
        category_primary: form.category_primary || null,
        price: num(form.price),
        price_type: form.price_type || null,
        price_min: num(form.price_min),
        price_max: num(form.price_max),
        min_participants: num(form.min_participants),
        max_participants: num(form.max_participants),
        duration_minutes: num(form.duration_minutes),
        location_mode: form.location_mode || null,
        notes: form.notes.trim() || null,
      }
      const res = await fetch(`/api/admin/services/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setState('saved')
      router.refresh()
      setTimeout(() => setState('idle'), 2500)
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'unknown error')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <Field label="שם שירות">
          <input
            type="text"
            value={form.service_name}
            onChange={(e) => update('service_name', e.target.value)}
            className="input"
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="קטגוריה">
            <select
              value={form.category_primary}
              onChange={(e) => update('category_primary', e.target.value)}
              className="input"
            >
              <option value="">—</option>
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="מיקום">
            <select
              value={form.location_mode}
              onChange={(e) => update('location_mode', e.target.value)}
              className="input"
            >
              <option value="">—</option>
              {LOCATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="מחיר (₪)">
            <input
              type="number"
              step="0.01"
              value={form.price}
              onChange={(e) => update('price', e.target.value)}
              className="input"
            />
          </Field>
          <Field label="סוג מחיר">
            <select
              value={form.price_type}
              onChange={(e) => update('price_type', e.target.value)}
              className="input"
            >
              <option value="">—</option>
              {PRICE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="משך (דקות)">
            <input
              type="number"
              value={form.duration_minutes}
              onChange={(e) => update('duration_minutes', e.target.value)}
              className="input"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="מחיר מינ׳">
            <input
              type="number"
              step="0.01"
              value={form.price_min}
              onChange={(e) => update('price_min', e.target.value)}
              className="input"
            />
          </Field>
          <Field label="מחיר מקס׳">
            <input
              type="number"
              step="0.01"
              value={form.price_max}
              onChange={(e) => update('price_max', e.target.value)}
              className="input"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="מינ׳ משתתפים">
            <input
              type="number"
              value={form.min_participants}
              onChange={(e) => update('min_participants', e.target.value)}
              className="input"
            />
          </Field>
          <Field label="מקס׳ משתתפים">
            <input
              type="number"
              value={form.max_participants}
              onChange={(e) => update('max_participants', e.target.value)}
              className="input"
            />
          </Field>
        </div>

        <Field label="הערות">
          <textarea
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            rows={3}
            className="input resize-y"
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state === 'saving'}
          className="bg-gray-900 hover:bg-gray-800 text-white font-medium px-5 py-2.5 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
        >
          {state === 'saving' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              שומר...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              שמור שינויים
            </>
          )}
        </button>

        {state === 'saved' && (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            נשמר
          </div>
        )}
        {state === 'error' && (
          <div className="flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          line-height: 1.25rem;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          background-color: white;
          color: #111827;
        }
        :global(.input:focus) {
          outline: none;
          border-color: transparent;
          box-shadow: 0 0 0 2px #111827;
        }
        :global(.input:disabled) {
          background-color: #f9fafb;
        }
      `}</style>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  )
}
