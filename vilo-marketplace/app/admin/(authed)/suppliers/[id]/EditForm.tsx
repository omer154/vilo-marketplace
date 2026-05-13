'use client'

import { useState, FormEvent, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, CheckCircle2, AlertCircle, Upload, Trash2 } from 'lucide-react'

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

type LogoState =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'error'; message: string }

export default function SupplierEditForm({ row }: { row: SupplierRow }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [logoState, setLogoState] = useState<LogoState>({ kind: 'idle' })
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  const handleLogoFile = async (file: File) => {
    setLogoState({ kind: 'uploading' })
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/admin/suppliers/${row.id}/logo`, {
        method: 'POST',
        body: fd,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      update('logo_url', json.logo_url as string)
      setLogoState({ kind: 'idle' })
      router.refresh()
    } catch (err) {
      setLogoState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleLogoRemove = async () => {
    setLogoState({ kind: 'uploading' })
    try {
      const res = await fetch(`/api/admin/suppliers/${row.id}/logo`, {
        method: 'DELETE',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      update('logo_url', '')
      setLogoState({ kind: 'idle' })
      router.refresh()
    } catch (err) {
      setLogoState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
  }

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

        <Field label="לוגו">
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
              {form.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.logo_url}
                  alt="logo preview"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <span className="text-2xl text-gray-400 font-semibold">
                  {form.name?.[0] || '?'}
                </span>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={logoState.kind === 'uploading'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-900 hover:bg-gray-800 text-white rounded-lg disabled:opacity-50"
                >
                  {logoState.kind === 'uploading' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      מעלה...
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      העלה קובץ
                    </>
                  )}
                </button>
                {form.logo_url && logoState.kind !== 'uploading' && (
                  <button
                    type="button"
                    onClick={handleLogoRemove}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:text-red-700 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    הסר
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleLogoFile(f)
                  }}
                  className="hidden"
                />
              </div>
              <p className="text-xs text-gray-500">
                PNG / JPG / WebP / SVG, עד 2MB. גודל מומלץ ≥ 256×256.
              </p>
              {logoState.kind === 'error' && (
                <p className="text-xs text-red-700 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {logoState.message}
                </p>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                  או הזינו URL חיצוני
                </summary>
                <input
                  type="url"
                  value={form.logo_url}
                  onChange={(e) => update('logo_url', e.target.value)}
                  className="input mt-1"
                  dir="ltr"
                  placeholder="https://..."
                />
              </details>
            </div>
          </div>
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
