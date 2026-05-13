'use client'

import { useState, useRef, FormEvent } from 'react'
import {
  Upload,
  Link2,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react'
import type { CatalogRow } from '@/lib/extractors/types'

type ResultState =
  | { kind: 'idle' }
  | { kind: 'extracting'; label: string }
  | { kind: 'pushing'; label: string; rows_count: number }
  | {
      kind: 'success'
      rows_count: number
      source_label: string
      sheet_url: string
      avg_confidence: number | null
    }
  | {
      kind: 'extracted_no_sheets'
      rows: CatalogRow[]
      source_label: string
      setup_required: string[]
    }
  | { kind: 'error'; message: string; stage: 'extraction' | 'push' }

function avgConfidence(rows: CatalogRow[]): number | null {
  // _confidence_avg's type is the narrow ConfidenceScore (1..5), so the
  // predicate must narrow to that, not to the wider `number`.
  const scored: number[] = []
  for (const r of rows) {
    if (typeof r._confidence_avg === 'number') scored.push(r._confidence_avg)
  }
  if (scored.length === 0) return null
  return scored.reduce((s, v) => s + v, 0) / scored.length
}

export default function ExtractPage() {
  const [state, setState] = useState<ResultState>({ kind: 'idle' })
  const [url, setUrl] = useState('')
  const [pastedText, setPastedText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pushToSheet = async (
    rows: CatalogRow[],
    sourceLabel: string
  ): Promise<ResultState> => {
    setState({ kind: 'pushing', label: sourceLabel, rows_count: rows.length })
    try {
      const res = await fetch('/api/admin/sheets/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, source_label: sourceLabel }),
      })
      const json = await res.json()

      if (res.status === 503 && json.error === 'sheets_not_configured') {
        return {
          kind: 'extracted_no_sheets',
          rows,
          source_label: sourceLabel,
          setup_required: json.required_env || [],
        }
      }
      if (!res.ok) {
        return {
          kind: 'error',
          stage: 'push',
          message: json.error || `push failed (${res.status})`,
        }
      }
      return {
        kind: 'success',
        rows_count: rows.length,
        source_label: sourceLabel,
        sheet_url: json.url,
        avg_confidence: avgConfidence(rows),
      }
    } catch (err) {
      return {
        kind: 'error',
        stage: 'push',
        message: err instanceof Error ? err.message : 'unknown error',
      }
    }
  }

  const handleExtractResponse = async (
    res: Response,
    label: string
  ): Promise<void> => {
    let json: { rows?: CatalogRow[]; error?: string } = {}
    try {
      json = await res.json()
    } catch {
      setState({
        kind: 'error',
        stage: 'extraction',
        message: `שגיאת רשת (סטטוס ${res.status})`,
      })
      return
    }
    if (!res.ok) {
      setState({
        kind: 'error',
        stage: 'extraction',
        message: json.error || `extraction failed (${res.status})`,
      })
      return
    }
    if (!Array.isArray(json.rows)) {
      setState({
        kind: 'error',
        stage: 'extraction',
        message: 'התשובה מהשרת לא הכילה שורות. נסה שוב או בדוק את הקובץ.',
      })
      return
    }
    if (json.rows.length === 0) {
      setState({
        kind: 'error',
        stage: 'extraction',
        message: 'לא נמצאו שירותים במקור הזה. נסה קובץ אחר.',
      })
      return
    }
    setState(await pushToSheet(json.rows, label))
  }

  const submitFile = async (file: File) => {
    setState({ kind: 'extracting', label: file.name })
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/admin/extract', { method: 'POST', body: form })
      await handleExtractResponse(res, file.name)
    } catch (err) {
      setState({
        kind: 'error',
        stage: 'extraction',
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
      await handleExtractResponse(res, url)
    } catch (err) {
      setState({
        kind: 'error',
        stage: 'extraction',
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
      await handleExtractResponse(res, label)
    } catch (err) {
      setState({
        kind: 'error',
        stage: 'extraction',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
  }

  const busy = state.kind === 'extracting' || state.kind === 'pushing'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">ייבוא ממקור חיצוני</h1>
        <p className="text-gray-600 text-sm mt-1">
          העלה קובץ, הזן קישור, או הדבק טקסט. השירותים מחולצים אוטומטית
          ונדחפים ל-Google Sheet לבדיקה לפני סנכרון למרקטפלייס.
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
            disabled={busy}
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
            disabled={busy}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:bg-gray-50"
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
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
            disabled={busy}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:bg-gray-50 resize-none"
          />
          <button
            type="submit"
            disabled={busy || !pastedText.trim()}
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
              קבצים מורכבים (PDF עם הרבה שירותים) יכולים לקחת עד 2 דקות.
            </p>
          </div>
        </div>
      )}

      {state.kind === 'pushing' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          <div>
            <p className="font-medium text-blue-900">דוחף ל-Google Sheet…</p>
            <p className="text-sm text-blue-700">
              {state.rows_count} שורות מתוך: {state.label}
            </p>
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-900">
              {state.stage === 'extraction' ? 'שגיאה בחילוץ' : 'שגיאה בדחיפה ל-Sheet'}
            </p>
            <p className="text-sm text-red-700 mt-1 font-mono break-all">
              {state.message}
            </p>
          </div>
        </div>
      )}

      {state.kind === 'success' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-emerald-900 text-lg">
                ✓ {state.rows_count} שירותים נדחפו ל-Sheet
              </p>
              <p className="text-sm text-emerald-700 mt-1">
                מקור: {state.source_label}
                {state.avg_confidence != null && (
                  <span className="mr-2">
                    · ביטחון ממוצע: {state.avg_confidence.toFixed(1)}/5
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <a
              href={state.sheet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              פתח ב-Google Sheets
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={() => setState({ kind: 'idle' })}
              className="text-sm text-emerald-700 hover:text-emerald-900 px-3 py-2"
            >
              חלץ עוד אחד
            </button>
          </div>
          <p className="text-xs text-emerald-700">
            השורות ב-Sheet ב-status &quot;pending&quot;. בדוק / ערוך אותן שם,
            ואז סמן כ-&quot;approved&quot; כדי שהן יסונכרנו למרקטפלייס.
          </p>
        </div>
      )}

      {state.kind === 'extracted_no_sheets' && (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-amber-900">
                  ✓ חולצו {state.rows.length} שירותים, אבל Google Sheets לא מוגדר עדיין
                </p>
                <p className="text-sm text-amber-700 mt-1">
                  כדי לדחוף שורות אוטומטית, צריך להוסיף ל-.env.local:
                </p>
                <ul className="text-xs font-mono text-amber-800 mt-2 space-y-0.5">
                  {state.setup_required.map((e) => (
                    <li key={e}>· {e}</li>
                  ))}
                </ul>
                <p className="text-sm text-amber-700 mt-2">
                  בקש מקלוד הוראות הגדרה — &quot;תן לי את שלבי ההגדרה של Google Sheets&quot;.
                </p>
              </div>
            </div>
          </div>
          <details className="bg-white border border-gray-200 rounded-xl p-4">
            <summary className="text-sm text-gray-600 cursor-pointer">
              הצג {state.rows.length} שורות שחולצו (JSON)
            </summary>
            <pre
              dir="ltr"
              className="mt-3 text-xs text-gray-700 overflow-x-auto whitespace-pre max-h-96"
            >
              {JSON.stringify(state.rows, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
