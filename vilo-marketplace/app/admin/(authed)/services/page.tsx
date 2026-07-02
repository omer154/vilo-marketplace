import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Search, ChevronRight, ChevronLeft, Pencil } from 'lucide-react'
import ActiveToggle from '../ActiveToggle'

const PAGE_SIZE = 50

const CATEGORY_LABELS: Record<string, string> = {
  wellbeing: 'וולנס',
  teambuilding: 'גיבוש',
  learning: 'למידה',
  food: 'אוכל',
  culture: 'תרבות',
  travel: 'טיולים',
  sport: 'ספורט',
  tech: 'טכנולוגיה',
  consulting: 'ייעוץ',
}

const LOCATION_LABELS: Record<string, string> = {
  at_client: 'אצל הלקוח',
  at_provider: 'אצל הספק',
  remote: 'מקוון',
  hybrid: 'גמיש',
  onsite: 'אצל הלקוח (legacy)',
  remote_legacy: 'מקוון',
  both: 'גמיש (legacy)',
}

interface PageProps {
  searchParams: Promise<{
    q?: string
    cat?: string
    active?: string
    page?: string
  }>
}

interface ServiceRow {
  id: string
  service_name: string
  category_primary: string | null
  category_secondary: string | null
  price: number | null
  price_min: number | null
  price_max: number | null
  min_participants: number | null
  max_participants: number | null
  duration_minutes: number | null
  location_mode: string | null
  location_type: string | null
  is_active: boolean
  updated_at: string | null
  staging_row_id: string | null
  supplier_id: string
  suppliers: { name: string } | null
}

export default async function ServicesListPage({ searchParams }: PageProps) {
  const params = await searchParams
  const q = params.q?.trim() || ''
  const cat = params.cat || ''
  const showInactive = params.active === 'all'
  const page = Math.max(0, Number(params.page) || 0)

  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('services')
    .select(
      'id, service_name, category_primary, category_secondary, price, price_min, price_max, min_participants, max_participants, duration_minutes, location_mode, location_type, is_active, updated_at, staging_row_id, supplier_id, suppliers(name)',
      { count: 'exact' }
    )

  if (q) query = query.ilike('service_name', `%${q}%`)
  if (cat) query = query.eq('category_primary', cat)
  if (!showInactive) query = query.eq('is_active', true)

  query = query
    .order('updated_at', { ascending: false, nullsFirst: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

  const { data, count, error } = await query
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <p className="font-medium text-red-900">שגיאה בטעינת שירותים</p>
        <p className="text-sm text-red-700 mt-1 font-mono">{error.message}</p>
      </div>
    )
  }
  const services = (data as unknown as ServiceRow[]) || []
  const total = count || 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const baseFilters = (overrides: Record<string, string | undefined>) => {
    const s = new URLSearchParams()
    if (q) s.set('q', q)
    if (cat) s.set('cat', cat)
    if (showInactive) s.set('active', 'all')
    if (page > 0) s.set('page', String(page))
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) s.delete(k)
      else s.set(k, v)
    }
    return s.toString()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">שירותים</h1>
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-500">
            {total.toLocaleString('he-IL')} שירותים{' '}
            {showInactive ? '(כולל לא פעילים)' : '(פעילים בלבד)'}
          </p>
          <a
            href={`/api/admin/services/export${showInactive ? '?active=all' : ''}`}
            download
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            ⬇ ייצא לאקסל
          </a>
        </div>
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
              placeholder="שם שירות..."
              className="w-full pr-9 pl-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
        </div>
        <div className="min-w-[180px]">
          <label className="block text-xs text-gray-600 mb-1">קטגוריה</label>
          <select
            name="cat"
            defaultValue={cat}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          >
            <option value="">כל הקטגוריות</option>
            {Object.entries(CATEGORY_LABELS).map(([slug, label]) => (
              <option key={slug} value={slug}>
                {label}
              </option>
            ))}
          </select>
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
        {(q || cat || showInactive) && (
          <Link
            href="/admin/services"
            className="text-sm text-gray-600 hover:text-gray-900 py-2 px-3"
          >
            איפוס
          </Link>
        )}
        <a
          href={`/api/admin/services/export${showInactive ? '?active=all' : ''}`}
          download
          className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
        >
          ⬇ ייצא לאקסל ({total.toLocaleString('he-IL')})
        </a>
      </form>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-right font-medium text-gray-700">שירות</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">ספק</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">קטגוריה</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">מחיר</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">משתתפים</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">מיקום</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">פעיל?</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700"></th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-12 text-center text-gray-400"
                  >
                    אין שירותים שתואמים את הסינון.
                  </td>
                </tr>
              ) : (
                services.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${!s.is_active ? 'opacity-50' : ''}`}
                  >
                    <td className="px-3 py-2 text-gray-900 max-w-md">
                      <Link
                        href={`/admin/services/${s.id}`}
                        className="block hover:text-gray-700"
                      >
                        <div className="font-medium truncate" title={s.service_name}>
                          {s.service_name || '—'}
                        </div>
                        {s.category_secondary && (
                          <div className="text-xs text-gray-500 truncate">
                            {s.category_secondary}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {s.suppliers?.name || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {s.category_primary
                        ? CATEGORY_LABELS[s.category_primary] || s.category_primary
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-900 whitespace-nowrap">
                      {s.price != null
                        ? `₪${Number(s.price).toLocaleString('he-IL')}`
                        : s.price_min != null && s.price_max != null
                        ? `₪${s.price_min}–${s.price_max}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                      {s.min_participants != null || s.max_participants != null
                        ? `${s.min_participants ?? '?'}–${s.max_participants ?? '?'}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                      {LOCATION_LABELS[s.location_mode || s.location_type || ''] ||
                        s.location_mode ||
                        s.location_type ||
                        '—'}
                    </td>
                    <td className="px-3 py-2">
                      <ActiveToggle
                        table="services"
                        id={s.id}
                        initialActive={s.is_active}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/admin/services/${s.id}`}
                        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        ערוך
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-2">
          <span className="text-sm text-gray-600">
            עמוד {page + 1} מתוך {totalPages}
          </span>
          <div className="flex gap-2">
            <Link
              href={`/admin/services?${baseFilters({ page: page > 0 ? String(page - 1) : undefined })}`}
              className={`text-sm px-3 py-1.5 rounded-lg border border-gray-200 inline-flex items-center gap-1 ${page === 0 ? 'opacity-30 pointer-events-none' : 'hover:bg-gray-50'}`}
            >
              <ChevronRight className="w-4 h-4" />
              קודם
            </Link>
            <Link
              href={`/admin/services?${baseFilters({ page: String(page + 1) })}`}
              className={`text-sm px-3 py-1.5 rounded-lg border border-gray-200 inline-flex items-center gap-1 ${page + 1 >= totalPages ? 'opacity-30 pointer-events-none' : 'hover:bg-gray-50'}`}
            >
              הבא
              <ChevronLeft className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
