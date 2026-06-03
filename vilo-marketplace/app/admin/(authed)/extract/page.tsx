'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Upload,
  Link2,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Sparkles,
  Image as ImageIcon,
  ArrowLeft,
  Database,
} from 'lucide-react'
import type { CatalogRow } from '@/lib/extractors/types'
import EditableGrid, { type GridCol } from '@/components/admin/EditableGrid'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

// ── Editable-cell config (DB enums, Hebrew labels) ───────────────────
const PRICING_UNITS = [
  { value: 'person', label: 'לאדם' },
  { value: 'group', label: 'לקבוצה' },
  { value: 'hour', label: 'לשעה' },
  { value: 'project', label: 'לפרויקט' },
  { value: 'month', label: 'לחודש' },
  { value: 'unit', label: 'ליחידה' },
]
const PRICE_TYPES = [
  { value: 'fixed', label: 'מחיר קבוע' },
  { value: 'on_request', label: 'לפי פנייה' },
  { value: 'range', label: 'טווח' },
]
const LOCATION_MODES = [
  { value: 'at_client', label: 'אצל הלקוח' },
  { value: 'at_provider', label: 'אצל הספק' },
  { value: 'remote', label: 'מקוון' },
  { value: 'hybrid', label: 'גמיש' },
]

type ColType = 'text' | 'number' | 'select' | 'textarea'
interface ColDef {
  key: keyof CatalogRow
  label: string
  type: ColType
  options?: { value: string; label: string }[]
  width: string
}
const COLS: ColDef[] = [
  { key: 'supplier_name', label: 'ספק', type: 'text', width: 'min-w-[150px]' },
  { key: 'service_name', label: 'שם השירות', type: 'text', width: 'min-w-[170px]' },
  { key: 'supplier_category', label: 'קטגוריה', type: 'text', width: 'min-w-[120px]' },
  { key: 'price_ils', label: 'מחיר ₪', type: 'number', width: 'min-w-[90px]' },
  { key: 'pricing_unit', label: 'יחידה', type: 'select', options: PRICING_UNITS, width: 'min-w-[110px]' },
  { key: 'price_type', label: 'סוג מחיר', type: 'select', options: PRICE_TYPES, width: 'min-w-[110px]' },
  { key: 'capacity_min', label: 'מ־', type: 'number', width: 'min-w-[64px]' },
  { key: 'capacity_max', label: 'עד', type: 'number', width: 'min-w-[64px]' },
  { key: 'duration_hours', label: 'שעות', type: 'number', width: 'min-w-[64px]' },
  { key: 'location_mode', label: 'מיקום', type: 'select', options: LOCATION_MODES, width: 'min-w-[110px]' },
  { key: 'service_description', label: 'תיאור', type: 'textarea', width: 'min-w-[220px]' },
  { key: 'supplier_notes', label: 'הערות', type: 'textarea', width: 'min-w-[170px]' },
]

interface SourceStatus {
  label: string
  status: 'done' | 'error'
  rows: number
  error: string | null
}
interface ImportStats {
  read: number
  inserted: number
  updated: number
  failed: number
  suppliers_created: number
  failures: Array<{ service_name: string | null; reason: string }>
}

type EditableRow = CatalogRow & { _key: number }
let _keyCounter = 1

function blankRow(): EditableRow {
  return {
    _key: _keyCounter++,
    supplier_id: null,
    supplier_name: '',
    supplier_name_en: null,
    supplier_category: null,
    supplier_website: null,
    service_id: null,
    service_name: '',
    service_description: null,
    price_ils: null,
    price_type: null,
    price_min: null,
    price_max: null,
    pricing_unit: null,
    capacity_min: null,
    capacity_max: null,
    duration_hours: null,
    location_mode: null,
    tags: null,
    supplier_notes: null,
  }
}

const ACCEPT = '.xlsx,.xls,.pdf,.docx,.doc,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif'

function isImageName(name: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(name)
}

export default function ExtractPage() {
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('')
  const [urls, setUrls] = useState('')
  const [batchSupplier, setBatchSupplier] = useState('')
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [phase, setPhase] = useState<
    'idle' | 'extracting' | 'consolidating' | 'review' | 'importing' | 'done' | 'error'
  >('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [rows, setRows] = useState<EditableRow[]>([])
  const [stats, setStats] = useState<ImportStats | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return
    const incoming = Array.from(list)
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size))
      return [...prev, ...incoming.filter((f) => !seen.has(f.name + f.size))]
    })
  }, [])

  const removeFile = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i))

  const hasInput = files.length > 0 || text.trim() !== '' || urls.trim() !== ''

  async function runExtract() {
    if (!hasInput) return
    setPhase('extracting')
    setErrorMsg('')
    setSources([])
    setRows([])

    setUploadingLabel(null)
    const hasUrls = urls.trim() !== ''
    const hasText = text.trim() !== ''
    const supplier = batchSupplier.trim()

    const browser = createSupabaseBrowserClient()

    // Upload a file DIRECTLY to Supabase Storage via a one-time signed URL.
    // This bypasses Vercel's 4.5MB function-body limit entirely — the extract
    // route then downloads the file server-side. Returns the object path.
    async function uploadToStorage(file: File): Promise<{ path: string; fileName: string }> {
      const r = await fetch('/api/admin/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `שגיאת הכנה להעלאה (${r.status})`)
      const { error } = await browser.storage.from('imports').uploadToSignedUrl(j.path, j.token, file)
      if (error) throw new Error(error.message || 'שגיאת העלאה לאחסון')
      return { path: j.path, fileName: file.name }
    }

    async function callExtract(
      payload: Record<string, unknown>
    ): Promise<{ rows: CatalogRow[]; sources?: SourceStatus[] }> {
      const res = await fetch('/api/admin/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `שגיאה ${res.status}`)
      return {
        rows: Array.isArray(json.rows) ? json.rows : [],
        sources: Array.isArray(json.sources) ? json.sources : undefined,
      }
    }

    // Heavy sources are extracted one request each (stable, no whole-batch 500).
    // Files upload to Storage first, then extract by path. Pasted text is its
    // own source so its prices materialize as rows; the merge step syncs them.
    type Job = { label: string; run: () => Promise<{ rows: CatalogRow[]; sources?: SourceStatus[] }> }
    const jobs: Job[] = []
    files.forEach((f) =>
      jobs.push({
        label: f.name,
        run: async () => {
          setUploadingLabel(f.name)
          const sp = await uploadToStorage(f)
          setUploadingLabel(null)
          return callExtract({ storagePaths: [sp] })
        },
      })
    )
    if (hasUrls) jobs.push({ label: 'אתרים', run: () => callExtract({ urls: urls.trim() }) })
    if (hasText) jobs.push({ label: 'טקסט שהודבק', run: () => callExtract({ text: text.trim() }) })

    const acc: CatalogRow[] = []
    const stat: SourceStatus[] = []
    for (const job of jobs) {
      try {
        const { rows: r, sources: srcs } = await job.run()
        acc.push(...r)
        if (srcs && srcs.length) stat.push(...srcs)
        else stat.push({ label: job.label, status: 'done', rows: r.length, error: null })
      } catch (e) {
        setUploadingLabel(null)
        stat.push({ label: job.label, status: 'error', rows: 0, error: e instanceof Error ? e.message : 'שגיאת רשת' })
      }
      setSources([...stat])
    }

    // Merge + sync: unify the supplier and tidy the rows (relabel tier rows onto
    // their workshop, fold individual cocktails into descriptions, dedup). The
    // prices already live in the extracted rows, so this step only polishes them.
    let finalRows = acc
    const doneCount = stat.filter((s) => s.status === 'done').length
    const needConsolidate = acc.length > 0 && (supplier !== '' || doneCount > 1)
    if (needConsolidate) {
      setPhase('consolidating')
      try {
        const res = await fetch('/api/admin/consolidate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: acc, supplierName: supplier || null }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.ok && Array.isArray(json.rows) && json.rows.length > 0) finalRows = json.rows
      } catch {
        // keep the un-merged rows on failure — the prices are already in them
      }
    }

    // Deterministic guarantee: an explicit supplier name always wins.
    if (supplier) finalRows = finalRows.map((r) => ({ ...r, supplier_name: supplier }))

    setRows(finalRows.map((r) => ({ ...r, _key: _keyCounter++ })))
    if (finalRows.length === 0) {
      setErrorMsg(
        stat.some((s) => s.status === 'error')
          ? 'החילוץ נכשל עבור המקורות. בדקו את הפירוט למטה ונסו שוב.'
          : 'לא נמצאו שירותים במקורות שסיפקתם.'
      )
    }
    setPhase('review')
  }


  async function runImport() {
    const clean: CatalogRow[] = rows
      .filter((r) => (r.supplier_name && r.supplier_name.trim()) || (r.service_name && r.service_name.trim()))
      .map((r) => {
        const copy = { ...r } as { _key?: number }
        delete copy._key
        return copy as CatalogRow
      })
    if (clean.length === 0) {
      setErrorMsg('אין שורות לייבוא. כל שורה צריכה לפחות שם ספק ושם שירות.')
      return
    }
    setPhase('importing')
    setErrorMsg('')
    // Replace mode: only when the admin both named a supplier AND ticked the box.
    const replaceSupplierName =
      replaceExisting && batchSupplier.trim() ? batchSupplier.trim() : null
    try {
      const res = await fetch('/api/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: clean, replaceSupplierName }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMsg(json.error || `שגיאה ${res.status}`)
        setPhase('review')
        return
      }
      setStats(json.stats)
      setPhase('done')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'שגיאת רשת')
      setPhase('review')
    }
  }

  function reset() {
    setFiles([])
    setText('')
    setUrls('')
    setBatchSupplier('')
    setReplaceExisting(false)
    setRows([])
    setSources([])
    setStats(null)
    setErrorMsg('')
    setUploadingLabel(null)
    setPhase('idle')
  }

  const doneRows = sources.filter((s) => s.status === 'done').reduce((n, s) => n + s.rows, 0)
  const errorSources = sources.filter((s) => s.status === 'error')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">ייבוא חכם ממקורות חיצוניים</h1>
        <p className="mt-1 text-sm text-gray-600">
          העלו כמה קבצים יחד (PDF, Excel, Word, תמונות/צילומי מחירונים), הדביקו טקסט, או הזינו קישורים —
          הכל במהלך אחד. ה-AI מחלץ את כל השירותים, אתם בודקים ומתקנים, ולוחצים ייבוא ישירות למרקטפלייס.
        </p>
      </div>

      {/* ───────── INPUT (idle / extracting) ───────── */}
      {(phase === 'idle' || phase === 'extracting' || phase === 'error') && (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <label className="mb-1 block text-sm font-medium text-gray-800">
              שם הספק <span className="font-normal text-gray-400">(אופציונלי, מומלץ כשהכול ספק אחד)</span>
            </label>
            <input
              type="text"
              value={batchSupplier}
              onChange={(e) => setBatchSupplier(e.target.value)}
              placeholder="אם כל הקבצים והטקסט שייכים לספק אחד — כתבו את שמו כאן, וכל השורות יאוחדו תחתיו"
              disabled={phase === 'extracting'}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50"
            />
            <p className="mt-1.5 text-xs text-gray-500">
              כל השירותים יאוחדו תחת הספק הזה, וכל מחיר/מידע מהטקסט שתדביקו יסונכרן אל השירותים הנכונים.
            </p>

            {/* Replace mode — for re-importing a supplier's corrected data without
                duplicates. Requires a supplier name so we know whose catalog to replace. */}
            <label
              className={`mt-3 flex items-start gap-2 rounded-lg border p-2.5 transition-colors ${
                batchSupplier.trim()
                  ? 'cursor-pointer border-amber-200 bg-amber-50/60'
                  : 'cursor-not-allowed border-gray-100 bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={replaceExisting && batchSupplier.trim() !== ''}
                disabled={batchSupplier.trim() === '' || phase === 'extracting'}
                onChange={(e) => setReplaceExisting(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300"
              />
              <span className={`text-xs leading-snug ${batchSupplier.trim() ? 'text-amber-900' : 'text-gray-400'}`}>
                <span className="font-semibold">החלף את כל השירותים הקיימים של הספק</span> — לתיקון נתונים: מסתיר את השירותים הקיימים של הספק ובונה אותם מחדש מהמקורות, בלי כפילויות (הישנים מוסתרים — ניתן לשחזר).
                {batchSupplier.trim() === '' && ' הזינו שם ספק כדי להפעיל.'}
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Files (multi + drag/drop + images) */}
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                addFiles(e.dataTransfer.files)
              }}
              className={`rounded-xl border-2 border-dashed p-5 transition-colors ${
                dragOver ? 'border-brand-400 bg-brand-50/50' : 'border-gray-300 bg-white'
              }`}
            >
              <div className="mb-3 flex items-center gap-2">
                <Upload className="h-5 w-5 text-gray-700" />
                <h2 className="font-medium text-gray-900">קבצים ותמונות</h2>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={phase === 'extracting'}
                className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
              >
                בחרו קבצים
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              />
              <p className="mt-2 text-center text-xs text-gray-500">או גררו לכאן · אפשר כמה יחד</p>
              <p className="mt-1 text-center text-[11px] text-gray-400">
                xlsx · pdf · docx · doc · csv · txt · png · jpg · webp
              </p>

              {files.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {files.map((f, i) => (
                    <li
                      key={f.name + i}
                      className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700"
                    >
                      {isImageName(f.name) ? (
                        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-brand-500" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      )}
                      <span className="flex-1 truncate" title={f.name}>
                        {f.name}
                      </span>
                      <button type="button" onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* URLs */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-3 flex items-center gap-2">
                <Link2 className="h-5 w-5 text-gray-700" />
                <h2 className="font-medium text-gray-900">קישורים לאתרים</h2>
              </div>
              <textarea
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                placeholder={'https://supplier-a.co.il\nhttps://supplier-b.co.il'}
                dir="ltr"
                rows={4}
                disabled={phase === 'extracting'}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50"
              />
              <p className="mt-2 text-xs text-gray-500">קישור בכל שורה. הטקסט שמשמאל יושלם אל תוך האתרים.</p>
            </div>

            {/* Pasted text */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-5 w-5 text-gray-700" />
                <h2 className="font-medium text-gray-900">הדבקת טקסט</h2>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="הדביקו רשימת שירותים מאימייל / WhatsApp / מסמך — בכל פורמט."
                rows={4}
                disabled={phase === 'extracting'}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50"
              />
              <p className="mt-2 text-xs text-gray-500">אם הזנתם גם קישור — הטקסט ישמש להשלמת מחירים וכמויות.</p>
            </div>
          </div>

          {errorMsg && phase === 'error' && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div>
                <p className="font-medium text-red-900">שגיאה בחילוץ</p>
                <p className="mt-1 font-mono text-sm text-red-700">{errorMsg}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runExtract}
              disabled={!hasInput || phase === 'extracting'}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === 'extracting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {phase === 'extracting' ? 'מחלץ…' : 'חלץ נתונים'}
            </button>
            {hasInput && phase !== 'extracting' && (
              <button type="button" onClick={reset} className="text-sm text-gray-500 hover:text-gray-900">
                נקה
              </button>
            )}
          </div>

          {phase === 'extracting' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <div>
                  <p className="font-medium text-blue-900">
                    {uploadingLabel ? `מעלה קובץ: ${uploadingLabel}…` : 'מחלץ נתונים — כל מקור בתורו…'}
                  </p>
                  <p className="mt-1 text-xs text-blue-600">
                    {uploadingLabel
                      ? 'מעלה את הקובץ לאחסון מאובטח (תומך גם בקבצים גדולים). אל תסגרו את החלון.'
                      : 'כל קובץ/מקור מעובד בנפרד כדי לשמור על יציבות. אל תסגרו את החלון.'}
                  </p>
                </div>
              </div>
              {sources.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {sources.map((s, i) => (
                    <span
                      key={i}
                      title={s.error || ''}
                      className={`inline-flex max-w-xs items-center gap-1.5 truncate rounded-full px-3 py-1 text-xs ${
                        s.status === 'done' ? 'bg-gray-100 text-gray-700' : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {s.status === 'done' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                      )}
                      <span className="truncate">{s.label}</span>
                      <span className="text-gray-400">· {s.status === 'done' ? `${s.rows} שורות` : 'נכשל'}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ───────── MERGE / SYNC ───────── */}
      {phase === 'consolidating' && (
        <div className="space-y-3">
          {sources.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {sources.map((s, i) => (
                <span
                  key={i}
                  title={s.error || ''}
                  className={`inline-flex max-w-xs items-center gap-1.5 truncate rounded-full px-3 py-1 text-xs ${
                    s.status === 'done' ? 'bg-gray-100 text-gray-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {s.status === 'done' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  )}
                  <span className="truncate">{s.label}</span>
                  <span className="text-gray-400">· {s.status === 'done' ? `${s.rows} שורות` : 'נכשל'}</span>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4">
            <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
            <div>
              <p className="font-medium text-violet-900">מאחד ומסנכרן נתונים…</p>
              <p className="mt-1 text-xs text-violet-600">
                מאחד את הספק ומשייך מחירים ומידע מהטקסט אל השירותים הנכונים.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ───────── REVIEW ───────── */}
      {(phase === 'review' || phase === 'importing') && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              <div>
                <p className="font-semibold text-emerald-900">חולצו {rows.length} שירותים מוכנים לבדיקה</p>
                <p className="text-sm text-emerald-700">
                  ערכו כל תא ישירות בטבלה. הקטגוריה תמופה אוטומטית לאחת מ-9 הקטגוריות בעת הייבוא.
                </p>
                {replaceExisting && batchSupplier.trim() !== '' && (
                  <p className="mt-1 text-sm font-medium text-amber-700">
                    ⚠️ מצב החלפה פעיל — בעת הייבוא, השירותים הקיימים של «{batchSupplier.trim()}» יוסתרו ויוחלפו בשורות שכאן.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runImport}
                disabled={phase === 'importing' || rows.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {phase === 'importing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                {phase === 'importing' ? 'מייבא…' : `ייבא ${rows.length} למרקטפלייס`}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={phase === 'importing'}
                className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
              >
                התחל מחדש
              </button>
            </div>
          </div>

          {/* per-source status */}
          {sources.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {sources.map((s, i) => (
                <span
                  key={i}
                  title={s.error || ''}
                  className={`inline-flex max-w-xs items-center gap-1.5 truncate rounded-full px-3 py-1 text-xs ${
                    s.status === 'done' ? 'bg-gray-100 text-gray-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {s.status === 'done' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  )}
                  <span className="truncate">{s.label}</span>
                  <span className="text-gray-400">· {s.status === 'done' ? `${s.rows} שורות` : 'נכשל'}</span>
                </span>
              ))}
            </div>
          )}

          {errorMsg && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <p className="font-mono text-sm text-red-700">{errorMsg}</p>
            </div>
          )}

          {/* editable table */}
          {rows.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white py-12 text-center text-gray-400">
              לא חולצו שורות. {errorSources.length > 0 && 'בדקו את שגיאות המקורות למעלה.'}
            </p>
          ) : (
            <EditableGrid
              rows={rows}
              columns={COLS as GridCol[]}
              rowId={(r) => r._key}
              onCommit={(id, colKey, value) =>
                setRows((prev) => prev.map((r) => (r._key === id ? { ...r, [colKey]: value } : r)))
              }
              onRemoveRow={(id) => setRows((prev) => prev.filter((r) => r._key !== id))}
            />
          )}

          {phase === 'review' && rows.length > 0 && (
            <button
              type="button"
              onClick={() => setRows((p) => [...p, blankRow()])}
              className="text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              + הוסף שורה ידנית
            </button>
          )}
        </>
      )}

      {/* ───────── DONE ───────── */}
      {phase === 'done' && stats && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600" />
              <div className="flex-1">
                <p className="text-lg font-semibold text-emerald-900">הייבוא הושלם בהצלחה</p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="שירותים חדשים" value={stats.inserted} tone="emerald" />
                  <Stat label="שירותים עודכנו" value={stats.updated} tone="blue" />
                  <Stat label="ספקים חדשים" value={stats.suppliers_created} tone="violet" />
                  <Stat label="נכשלו" value={stats.failed} tone={stats.failed ? 'red' : 'gray'} />
                </div>
              </div>
            </div>

            {stats.failures.length > 0 && (
              <details className="mt-4 rounded-lg bg-white/70 p-3">
                <summary className="cursor-pointer text-sm text-amber-700">הצג {stats.failures.length} שורות שנכשלו</summary>
                <ul className="mt-2 space-y-1 text-xs text-gray-600">
                  {stats.failures.map((f, i) => (
                    <li key={i}>
                      <span className="font-medium">{f.service_name || '(ללא שם)'}</span> — {f.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/marketplace"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
              >
                צפה במרקטפלייס
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <Link
                href="/admin/suppliers"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                ניהול ספקים
              </Link>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                ייבא עוד
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'blue' | 'violet' | 'red' | 'gray' }) {
  const tones: Record<string, string> = {
    emerald: 'text-emerald-700',
    blue: 'text-blue-700',
    violet: 'text-violet-700',
    red: 'text-red-600',
    gray: 'text-gray-400',
  }
  return (
    <div className="rounded-xl bg-white p-3 text-center shadow-sm">
      <div className={`text-2xl font-bold ${tones[tone]}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}
