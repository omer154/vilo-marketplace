'use client'

import { useState } from 'react'
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react'

interface SyncStats {
  read: number
  inserted: number
  updated: number
  failed: number
  failures: Array<{ row_id: string; service_name: string | null; reason: string }>
  sheet_url: string | null
}

type SyncState =
  | { kind: 'idle' }
  | { kind: 'syncing' }
  | { kind: 'done'; stats: SyncStats }
  | { kind: 'error'; message: string }

export default function SyncPage() {
  const [state, setState] = useState<SyncState>({ kind: 'idle' })

  const runSync = async () => {
    setState({ kind: 'syncing' })
    try {
      const res = await fetch('/api/admin/sync/sheet', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setState({
          kind: 'error',
          message: json.error || `sync failed (${res.status})`,
        })
        return
      }
      setState({ kind: 'done', stats: json.stats })
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
        <h1 className="text-2xl font-semibold text-gray-900">
          סנכרון מ-Google Sheet למרקטפלייס
        </h1>
        <p className="text-gray-600 text-sm mt-1">
          הכפתור למטה קורא את כל השורות ב-Sheet שמסומנות{' '}
          <code className="bg-gray-100 px-1 rounded">_status=approved</code> ודוחף
          אותן לבסיס הנתונים. שירותים חדשים נוספים, ספקים שלא קיימים נוצרים.
          אחרי סנכרון מוצלח, השורות ב-Sheet מסומנות{' '}
          <code className="bg-gray-100 px-1 rounded">_status=synced</code>.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 text-gray-700" />
          </div>
          <div className="flex-1">
            <h2 className="font-medium text-gray-900">
              סנכרון של שורות מאושרות
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              ודא שעמודת{' '}
              <code className="bg-gray-100 px-1 rounded">_status</code> ב-Sheet
              מכילה <code className="bg-gray-100 px-1 rounded">approved</code>{' '}
              עבור כל שורה שאתה רוצה לסנכרן. אחרת השורות נשארות ב-pending.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={runSync}
          disabled={state.kind === 'syncing'}
          className="w-full bg-gray-900 hover:bg-gray-800 text-white font-medium py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {state.kind === 'syncing' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              מסנכרן...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              הרץ סנכרון
            </>
          )}
        </button>
      </div>

      {state.kind === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-900">שגיאה בסנכרון</p>
            <p className="text-sm text-red-700 mt-1 font-mono break-all">
              {state.message}
            </p>
          </div>
        </div>
      )}

      {state.kind === 'done' && (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-emerald-900 text-lg">
                  הסנכרון הסתיים
                </p>
                <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
                  <div>
                    <div className="text-emerald-700">נקראו</div>
                    <div className="text-2xl font-semibold text-emerald-900">
                      {state.stats.read}
                    </div>
                  </div>
                  <div>
                    <div className="text-emerald-700">סונכרנו</div>
                    <div className="text-2xl font-semibold text-emerald-900">
                      {state.stats.inserted + state.stats.updated}
                    </div>
                  </div>
                  <div>
                    <div className="text-emerald-700">נכשלו</div>
                    <div className="text-2xl font-semibold text-emerald-900">
                      {state.stats.failed}
                    </div>
                  </div>
                </div>
                {state.stats.sheet_url && (
                  <a
                    href={state.stats.sheet_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-emerald-700 hover:text-emerald-900 mt-3"
                  >
                    פתח ב-Google Sheets
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {state.stats.failures.length > 0 && (
            <details
              open
              className="bg-amber-50 border border-amber-200 rounded-xl p-4"
            >
              <summary className="cursor-pointer text-sm font-medium text-amber-900">
                {state.stats.failures.length} שורות נכשלו — פרטים
              </summary>
              <ul className="mt-3 space-y-2 text-sm">
                {state.stats.failures.map((f, i) => (
                  <li
                    key={i}
                    className="border-r-2 border-amber-400 pr-3 py-1"
                  >
                    <div className="font-medium text-amber-900">
                      {f.service_name || '(no service name)'}
                    </div>
                    <div className="text-amber-700 text-xs font-mono">
                      {f.reason}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
