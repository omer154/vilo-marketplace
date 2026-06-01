'use client'

import { useState, FormEvent } from 'react'
import { KeyRound, Loader2, Check } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function ChangePassword() {
  const [pw, setPw] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 6) {
      setState('error')
      setMsg('הסיסמה חייבת להכיל לפחות 6 תווים')
      return
    }
    setState('saving')
    setMsg('')
    const sb = createSupabaseBrowserClient()
    const { error } = await sb.auth.updateUser({ password: pw })
    if (error) {
      setState('error')
      setMsg(error.message)
      return
    }
    setState('saved')
    setMsg('הסיסמה עודכנה בהצלחה')
    setPw('')
    setTimeout(() => setState('idle'), 2500)
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
        <KeyRound className="h-4 w-4 text-gray-400" /> שינוי סיסמה
      </h2>
      <form onSubmit={save} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="סיסמה חדשה (לפחות 6 תווים)"
          dir="ltr"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-gray-900"
        />
        <button
          type="submit"
          disabled={state === 'saving' || pw.length < 6}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'saved' ? <Check className="h-4 w-4" /> : null}
          עדכן סיסמה
        </button>
      </form>
      {msg && (
        <p className={`mt-2 text-xs ${state === 'error' ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>
      )}
    </div>
  )
}
