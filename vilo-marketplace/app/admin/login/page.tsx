'use client'

import { useState, FormEvent } from 'react'
import { Mail, Loader2, CheckCircle2 } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function AdminLoginPage() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    setState('sending')
    setErrorMsg('')

    const supabase = createSupabaseBrowserClient()
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '')

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${appUrl}/api/auth/callback?next=/admin`,
      },
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
            <Mail className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">כניסת מנהל</h1>
          <p className="text-sm text-gray-600">
            הזן את כתובת המייל שלך. נשלח לך קישור חד-פעמי לכניסה.
          </p>
        </div>

        {state === 'sent' ? (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-4">
            <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium">קישור נשלח אל {email}</p>
              <p className="text-emerald-700 mt-1">
                בדוק את המייל ולחץ על הקישור כדי להיכנס. ניתן לסגור את החלון הזה.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                מייל
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={state === 'sending'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:bg-gray-50"
                dir="ltr"
                required
              />
            </div>

            {state === 'error' && (
              <p className="text-sm text-red-600">{errorMsg || 'אירעה שגיאה. נסה שוב.'}</p>
            )}

            <button
              type="submit"
              disabled={state === 'sending' || !email.trim()}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-medium py-2.5 rounded-lg text-sm transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {state === 'sending' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  שולח...
                </>
              ) : (
                'שלח קישור כניסה'
              )}
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
