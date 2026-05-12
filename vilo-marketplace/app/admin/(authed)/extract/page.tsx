'use client'

import { useState, useRef, FormEvent } from 'react'
import { Upload, Link2, FileText, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import type { CatalogRow } from '@/lib/extractors/types'
import { CATALOG_COLUMNS } from '@/lib/extractors/types'

type ResultState =
  | { kind: 'idle' }
  | { kind: 'extracting'; label: string }
  | { kind: 'success'; rows: CatalogRow[]; source_label: string }
  | { kind: 'error'; message: string }

const COL_LABELS_HE: Partial<Record<keyof CatalogRow, string>> = {
  supplier_name: 'ספק',
  supplier_category: 'קטגוריה',
  service_name: 'שירות',
  price_ils: 'מחיר',
  price_type: 'סוג מחיר',
  capacity_min: 'מינ׳ משת׳',
  capacity_max: 'מקס׳ משת׳',
  duration_hours: 'שעות',
  location: 'מיקום',
  tags: 'תגיות',
  supplier_notes: 'הערות',
}

const VISIBLE_COLS: (keyof CatalogRow)[] = [
  'supplier_name',
  'supplier_category',
  'service_name',
  'price_ils',
  'price_type',
  'capacity_min',
  'capacity_max',
  'duration_hours',
  'location',
  'tags',
  'supplier_notes',
]

export default function ExtractPage() {
  const [state, setState] = useState<ResultState>({ kind: 'idle' })
  const [url, setUrl] = useState('')
  const [pastedText, setPastedText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleResponse = async (
    res: Response,
    label: string
  ): Promise<ResultState> => {
    let json: { rows?: CatalogRow[]; error?: string } = {}
    try {
      json = await res.json()
    } catch {
      return { kind: 'error', message: `שגיאת רשת (סטטוס ${res.status})` }
    }
    if (!res.ok) {
      return { kind: 'error', message: json.error || `extraction failed (${res.status})` }
    }
    if (!Array.isArray(json.rows)) {
      return {
        kind: 'error',
        message: 'התשובה מהשרת לא הכילה שורות. נסה שוב או בדוק את הקובץ.',
      }
    }
    return { kind: 'success', rows: json.rows, source_label: label }
  }

  const submitFile = async (file: File) => {
    setState({ kind: 'extracting', label: file.name })
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/admin/extract', {
        method: 'POST',
        body: form,
      })
      setState(await handleResponse(res, file.name))
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
  }

  const submitUrl = async (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setState({ kind: 'extracting', label: url })
    try {
      const res = await fetch('/api/admin/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      setState(await handleResponse(res, url))
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
  }

  const submitText = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = pastedText.trim()
    if (!trimmed) return
    const label = 'טקסט שהודבק'
    setState({ kind: 'extracting', label })
    try {
      const res = await fetch('/api/admin/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, label }),
      })
      setState(await handleResponse(res, label))
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">ייבוא ממקור חיצוני</h1>
        <p className="text-gray-600 text-sm mt-1">
          העלה קובץ (Excel / PDF / Word / טקסט) או הזן קישור לאתר ספק.
          המערכת תחלץ את השירותים לטבלה מובנית.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* File upload */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Upload className="w-5 h-5 text-gray-700" />
            <h2 className="font-medium text-gray-900">העלאת קובץ</h2>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.pdf,.docx,.doc,.txt,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) submitFile(f)
            }}
            disabled={state.kind === 'extracting'}
            className="block w-full text-sm text-gray-600
              file:mr-3 file:py-2 file:px-4
              file:rounded-lg file:border-0
              file:text-sm file:font-medium
              file:bg-gray-900 file:text-white
              hover:file:bg-gray-800
              file:cursor-pointer file:transition
              disabled:opacity-50"
          />
          <p className="text-xs text-gray-500 mt-2">
            תומך: .xlsx, .xls, .pdf, .docx, .doc, .txt, .csv
          </p>
        </div>

        {/* URL */}
        <form
          onSubmit={submitUrl}
          className="bg-white border border-gray-200 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="w-5 h-5 text-gray-700" />
            <h2 className="font-medium text-gray-900">קישור לאתר</h2>
          </div>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/services"
            dir="ltr"
            disabled={state.kind === 'extracting'}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:bg-gray-50"
          />
          <button
            type="submit"
            disabled={state.kind === 'extracting' || !url.trim()}
            className="mt-3 w-full bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            חלץ מהקישור
          </button>
        </form>

        {/* Pasted text */}
        <form
          onSubmit={submitText}
          className="bg-white border border-gray-200 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-gray-700" />
            <h2 className="font-medium text-gray-900">הדבק טקסט</h2>
          </div>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="הדבק כאן רשימת שירותים מאימייל / WhatsApp / מסמך — בכל פורמט."
            disabled={state.kind === 'extracting'}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:bg-gray-50 resize-none"
          />
          <button
            type="submit"
            disabled={state.kind === 'extracting' || !pastedText.trim()}
            className="mt-3 w-full bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            חלץ מהטקסט
          </button>
        </form>
      </div>

      {/* Status */}
      {state.kind === 'extracting' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          <div>
            <p className="font-medium text-blue-900">מחלץ נתונים…</p>
            <p className="text-sm text-blue-700">{state.label}</p>
            <p className="text-xs text-blue-600 mt-1">
              קבצים גדולים יכולים לקחת עד דקה. אל תרענן את הדף.
            </p>
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-900">שגיאה בחילוץ</p>
            <p className="text-sm text-red-700 mt-1 font-mono break-all">
              {state.message}
            </p>
          </div>
        </div>
      )}

      {state.kind === 'success' && Array.isArray(state.rows) && (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-emerald-900">
                חולצו {state.rows.length} שירותים מתוך: {state.source_label}
              </p>
              <p className="text-sm text-emerald-700 mt-1">
                ⚠️ שלב הדחיפה ל-Google Sheet עוד לא מוכן. בינתיים זוהי תצוגה
                מקדימה — בודק שהחילוץ עובד נכון.
              </p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {VISIBLE_COLS.map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2 text-right font-medium text-gray-700 whitespace-nowrap"
                      >
                        {COL_LABELS_HE[col] || col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                    >
                      {VISIBLE_COLS.map((col) => {
                        const v = row[col]
                        return (
                          <td
                            key={col}
                            className="px-3 py-2 text-gray-800 max-w-xs truncate"
                            title={v == null ? '' : String(v)}
                          >
                            {v == null || v === '' ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                              String(v)
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details className="bg-white border border-gray-200 rounded-xl p-4">
            <summary className="text-sm text-gray-600 cursor-pointer">
              הצג JSON גולמי ({CATALOG_COLUMNS.length} שדות לשורה)
            </summary>
            <pre
              dir="ltr"
              className="mt-3 text-xs text-gray-700 overflow-x-auto whitespace-pre"
            >
              {JSON.stringify(state.rows, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
