import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Search, ExternalLink, Pencil } from 'lucide-react'
import ActiveToggle from '../ActiveToggle'

interface PageProps {
  searchParams: Promise<{ q?: string; active?: string }>
}

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
  updated_at: string | null
  services: Array<{ id: string; is_active: boolean }>
}

export default async function SuppliersListPage({ searchParams }: PageProps) {
  const params = await searchParams
  const q = params.q?.trim() || ''
  const showInactive = params.active === 'all'

  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('suppliers')
    .select(
      'id, name, name_en, slug, website, contact_email, description_short, logo_url, is_active, updated_at, services(id, is_active)',
      { count: 'exact' }
    )
    .order('name', { ascending: true })

  if (q) query = query.ilike('name', `%${q}%`)
  if (!showInactive) query = query.eq('is_active', true)

  const { data, count, error } = await query
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <p className="font-medium text-red-900">שגיאה בטעינת ספקים</p>
        <p className="text-sm text-red-700 mt-1 font-mono">{error.message}</p>
      </div>
    )
  }
  const suppliers = (data as unknown as SupplierRow[]) || []

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">ספקים</h1>
        <p className="text-sm text-gray-500">
          {(count || 0).toLocaleString('he-IL')} ספקים{' '}
          {showInactive ? '(כולל לא פעילים)' : '(פעילים בלבד)'}
        </p>
      </div>

      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-xl p-4"
      >
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs text-gray-600 mb-1">חיפוש</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="שם ספק..."
              className="w-full pr-9 pl-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm text-gray-700 py-2">
            <input
              type="checkbox"
              name="active"
              value="all"
              defaultChecked={showInactive}
              className="rounded"
            />
            הצג גם לא-פעילים
          </label>
        </div>
        <button
          type="submit"
          className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          סנן
        </button>
        {(q || showInactive) && (
          <Link
            href="/admin/suppliers"
            className="text-sm text-gray-600 hover:text-gray-900 py-2 px-3"
          >
            איפוס
          </Link>
        )}
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {suppliers.length === 0 ? (
          <div className="md:col-span-2 bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-400">
            אין ספקים שתואמים את הסינון.
          </div>
        ) : (
          suppliers.map((s) => {
            const totalServices = s.services?.length || 0
            const activeServices =
              s.services?.filter((sv) => sv.is_active).length || 0
            return (
              <div
                key={s.id}
                className={`bg-white border border-gray-200 rounded-xl p-4 ${!s.is_active ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 text-gray-500 font-semibold">
                    {s.name?.[0] || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/admin/suppliers/${s.id}`}
                          className="hover:text-gray-700"
                        >
                          <h2 className="font-medium text-gray-900 truncate hover:underline">
                            {s.name}
                          </h2>
                        </Link>
                        {s.name_en && (
                          <p className="text-xs text-gray-500" dir="ltr">
                            {s.name_en}
                          </p>
                        )}
                      </div>
                      <ActiveToggle
                        table="suppliers"
                        id={s.id}
                        initialActive={s.is_active}
                      />
                    </div>
                    {s.description_short && (
                      <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                        {s.description_short}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-3">
                      <span>
                        {activeServices}/{totalServices} שירותים פעילים
                      </span>
                      {s.website && (
                        <a
                          href={s.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                        >
                          אתר
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {s.contact_email && (
                        <a
                          href={`mailto:${s.contact_email}`}
                          className="text-gray-600 hover:text-gray-900"
                          dir="ltr"
                        >
                          {s.contact_email}
                        </a>
                      )}
                      <Link
                        href={`/admin/suppliers/${s.id}`}
                        className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 ml-auto"
                      >
                        <Pencil className="w-3 h-3" />
                        ערוך
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
