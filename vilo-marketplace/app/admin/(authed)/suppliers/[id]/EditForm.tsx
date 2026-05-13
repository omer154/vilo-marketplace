'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react'

interface SupplierRow {
  id: string
  name: string
  name_en: string | null
  slug: string
  website: string | null
  contact_email: string | null
  description_short: string | null
  logo_url: string | null
  is_active: boolean
}

export default function SupplierEditForm({ row }: { row: SupplierRow }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: row.name || '',
    name_en: row.name_en || '',
    slug: row.slug || '',
    website: row.website || '',
    contact_email: row.contact_email || '',
    description_short: row.description_short || '',
    logo_url: row.logo_url || '',
  })

  const update = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setState('saving')
    setError(null)
    try {
      const body = {
        name: form.name.trim() || null,
        name_en: form.name_en.trim() || null,
        slug: form.slug.trim() || null,
        website: form.website.trim() || null,
        contact_email: form.contact_email.trim() || null,
        description_short: form.description_short.trim() || null,
        logo_url: form.logo_url.trim() || null,
      }
      const res = await fetch(`/api/admin/suppliers/${row.id}`, {
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="שם (עברית)">
            <input
              type="text"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              className="input"
              required
            />
          </Field>
          <Field label="שם (אנגלית)">
            <input
              type="text"
              value={form.name_en}
              onChange={(e) => update('name_en', e.target.value)}
              className="input"
              dir="ltr"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Slug (חלק מה-URL)">
            <input
              type="text"
              value={form.slug}
              onChange={(e) => update('slug', e.target.value)}
              className="input"
              dir="ltr"
            />
          </Field>
          <Field label="אתר">
            <input
              type="url"
              value={form.website}
              onChange={(e) => update('website', e.target.value)}
              className="input"
              dir="ltr"
              placeholder="https://..."
            />
          </Field>
        </div>

        <Field label="מייל ליצירת קשר">
          <input
            type="email"
            value={form.contact_email}
            onChange={(e) => update('contact_email', e.target.value)}
            className="input"
            dir="ltr"
          />
        </Field>

        <Field label="תיאור קצר">
          <textarea
            value={form.description_short}
            onChange={(e) => update('description_short', e.target.value)}
            rows={3}
            className="input resize-y"
            placeholder="משפט-שניים שמתארים את הספק"
          />
        </Field>

        <Field label="לוגו (URL — Phase 2d יוסיף העלאת קובץ)">
          <input
            type="url"
            value={form.logo_url}
            onChange={(e) => update('logo_url', e.target.value)}
            className="input"
            dir="ltr"
            placeholder="https://..."
          />
          {form.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.logo_url}
              alt="logo preview"
              className="mt-2 w-16 h-16 rounded-lg object-cover border border-gray-200"
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          )}
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
