'use client'

import { useState, FormEvent } from 'react'
import { Mail, Lock, Loader2, CheckCircle2 } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

const INPUT =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:bg-gray-50'

export default function AdminLoginPage() {
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<'idle' | 'working' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handlePassword(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setState('working')
    setErrorMsg('')
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      setState('error')
      setErrorMsg('מייל או סיסמה שגויים. נסו שוב, או היכנסו עם קישור למייל.')
      return
    }
    // Full navigation so the new session cookie is read by the middleware.
    window.location.assign('/admin')
  }

  async function handleMagic(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setState('working')
    setErrorMsg('')
    const supabase = createSupabaseBrowserClient()
    // Always use the origin the browser is actually on, so the email link returns
    // to THIS site. (A baked-in NEXT_PUBLIC_APP_URL=localhost would otherwise send
    // production users to localhost.) Env var is only a non-browser fallback.
    const appUrl =
      (typeof window !== 'undefined' ? window.location.origin : '') ||
      process.env.NEXT_PUBLIC_APP_URL ||
      ''
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${appUrl}/api/auth/callback?next=/admin` },
    })
    if (error) {
      setState('error')
      setErrorMsg(error.message)
      return
    }
    setState('sent')
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-gray-900 text-white mx-auto flex items-center justify-center">
            {mode === 'password' ? <Lock className="w-5 h-5" /> : <Mail className="w-5 h-5" />}
          </div>
          <h1 className="text-xl font-semibold text-gray-900">כניסת מנהל</h1>
          <p className="text-sm text-gray-600">
            {mode === 'password'
              ? 'הזינו מייל וסיסמה כדי להיכנס.'
              : 'הזינו מייל ונשלח לכם קישור כניסה חד-פעמי.'}
          </p>
        </div>

        {state === 'sent' ? (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-4">
            <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium">קישור נשלח אל {email}</p>
              <p className="text-emerald-700 mt-1">בדקו את המייל ולחצו על הקישור כדי להיכנס.</p>
            </div>
          </div>
        ) : (
          <form onSubmit={mode === 'password' ? handlePassword : handleMagic} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">מייל</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={state === 'working'}
                className={INPUT}
                dir="ltr"
                required
              />
            </div>

            {mode === 'password' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">סיסמה</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={state === 'working'}
                  className={INPUT}
                  dir="ltr"
                  required
                />
              </div>
            )}

            {state === 'error' && <p className="text-sm text-red-600">{errorMsg}</p>}

            <button
              type="submit"
              disabled={
                state === 'working' || !email.trim() || (mode === 'password' && !password)
              }
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-medium py-2.5 rounded-lg text-sm transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {state === 'working' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  רגע...
                </>
              ) : mode === 'password' ? (
                'כניסה'
              ) : (
                'שלח קישור כניסה'
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'password' ? 'magic' : 'password')
                setState('idle')
                setErrorMsg('')
              }}
              className="w-full text-center text-sm text-gray-500 hover:text-gray-900 transition"
            >
              {mode === 'password' ? 'כניסה עם קישור למייל במקום' : 'כניסה עם סיסמה במקום'}
            </button>
          </form>
        )}

        <p className="text-xs text-center text-gray-400 pt-2 border-t border-gray-100">
          רק כתובות מייל שמופיעות בטבלת המנהלים יקבלו גישה לפאנל.
        </p>
      </div>
    </main>
  )
}
