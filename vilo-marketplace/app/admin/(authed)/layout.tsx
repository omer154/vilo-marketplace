import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser, isCurrentUserAdmin } from '@/lib/supabase/server'
import LogoutButton from '../LogoutButton'

export default async function AuthedAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/admin/login')
  }

  const isAdmin = await isCurrentUserAdmin()
  if (!isAdmin) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4 bg-white p-8 rounded-2xl border border-gray-200">
          <h1 className="text-xl font-semibold">אין הרשאת ניהול</h1>
          <p className="text-gray-600 text-sm">
            המשתמש {user.email} מחובר, אבל לא מופיע בטבלת המנהלים.
            פנה למנהל המערכת כדי לקבל גישה.
          </p>
          <LogoutButton />
        </div>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-semibold text-gray-900">
              Vilo Admin
            </Link>
            <nav className="flex gap-4 text-sm text-gray-600">
              <Link href="/admin/services" className="hover:text-gray-900">
                שירותים
              </Link>
              <Link href="/admin/suppliers" className="hover:text-gray-900">
                ספקים
              </Link>
              <Link href="/admin/extract" className="hover:text-gray-900">
                ייבוא
              </Link>
              <Link href="/marketplace" className="hover:text-gray-900">
                מרקטפלייס ↗
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-6">{children}</main>
    </div>
  )
}
