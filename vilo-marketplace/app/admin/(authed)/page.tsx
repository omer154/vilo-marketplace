import Link from 'next/link'
import {
  Database,
  Package,
  Upload,
  RefreshCw,
  Building2,
  Layers,
  Eye,
  CircleDollarSign,
  GaugeCircle,
  Clock,
} from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { CATEGORY_META, completeness } from '@/lib/ui-meta'
import type { CategorySlug, Service } from '@/lib/types'

export const dynamic = 'force-dynamic'

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 60) return 'הרגע'
  if (d < 3600) return `לפני ${Math.floor(d / 60)} דק׳`
  if (d < 86400) return `לפני ${Math.floor(d / 3600)} שע׳`
  return `לפני ${Math.floor(d / 86400)} ימים`
}

export default async function AdminDashboard() {
  const sb = await createSupabaseServerClient()
  const [{ data: suppliers }, { data: services }, { data: recent }] = await Promise.all([
    sb.from('suppliers').select('id, is_active'),
    sb.from('services').select('*'),
    sb
      .from('services')
      .select('id, service_name, updated_at, category_primary, suppliers(name)')
      .order('updated_at', { ascending: false })
      .limit(6),
  ])

  const sup = suppliers || []
  const svc = (services || []) as Service[]
  const activeSvc = svc.filter((s) => s.is_active)
  const onRequest = svc.filter((s) => s.price == null).length
  const compScores = svc.map((s) => completeness(s).score)
  const avgComp = compScores.length ? Math.round(compScores.reduce((a, b) => a + b, 0) / compScores.length) : 0
  const fullyComplete = svc.filter((s) => completeness(s).score === 100).length

  const byCat = new Map<CategorySlug, number>()
  for (const s of svc) byCat.set(s.category_primary, (byCat.get(s.category_primary) || 0) + 1)
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1])
  const maxCat = catRows[0]?.[1] || 1

  // Which catalog fields are most often missing across the catalog.
  const missingTally = new Map<string, number>()
  for (const s of svc) for (const m of completeness(s).missing) missingTally.set(m, (missingTally.get(m) || 0) + 1)
  const topMissing = [...missingTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)

  const stats = [
    { icon: Building2, label: 'ספקים', value: sup.length, sub: `${sup.filter((s) => s.is_active).length} פעילים` },
    { icon: Package, label: 'שירותים', value: svc.length, sub: `${activeSvc.length} פעילים` },
    { icon: Layers, label: 'קטגוריות', value: byCat.size, sub: 'מתוך 9' },
    { icon: CircleDollarSign, label: 'מחיר לפי פנייה', value: onRequest, sub: `${Math.round((onRequest / Math.max(1, svc.length)) * 100)}% מהשירותים` },
    { icon: GaugeCircle, label: 'שלמות נתונים', value: `${avgComp}%`, sub: `${fullyComplete} שירותים מלאים` },
  ]

  const tiles = [
    { href: '/admin/services', icon: Package, title: 'שירותים', body: 'ערוך, הוסף או הסתר שירותים.' },
    { href: '/admin/suppliers', icon: Database, title: 'ספקים', body: 'נהל פרטי ספקים, לוגואים ופרטי קשר.' },
    { href: '/admin/extract', icon: Upload, title: 'ייבוא ממקור חיצוני', body: 'PDF / Word / Excel / קישור לאתר.' },
    { href: '/admin/sync', icon: RefreshCw, title: 'סנכרון מ-Sheet', body: 'דחיפת שורות שאושרו לבסיס הנתונים.' },
  ]

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">לוח בקרה</h1>
        <p className="mt-1 text-sm text-gray-600">מבט-על על הקטלוג. כל שינוי מסונכרן ל-Supabase ומופיע מיידית במרקטפלייס.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(({ icon: Icon, label, value, sub }) => (
          <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Icon className="h-5 w-5" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            <div className="text-xs font-medium text-gray-600">{label}</div>
            <div className="text-[11px] text-gray-400">{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Category breakdown */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">שירותים לפי קטגוריה</h2>
          <div className="space-y-2.5">
            {catRows.map(([slug, count]) => {
              const meta = CATEGORY_META[slug]
              return (
                <div key={slug} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs text-gray-600">{meta?.name_he || slug}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className={`h-full rounded-full ${meta?.bgColor.replace('100', '400') || 'bg-brand-400'}`} style={{ width: `${(count / maxCat) * 100}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-left text-xs font-medium text-gray-700">{count}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Data completeness + recent edits */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">שלמות נתונים</h2>
            <div className="mb-3 flex items-center gap-3">
              <div className="text-3xl font-bold text-gray-900">{avgComp}%</div>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-green-400" style={{ width: `${avgComp}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {topMissing.map(([field, n]) => (
                <span key={field} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
                  {field}: חסר ב-{n}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
              <Clock className="h-4 w-4 text-gray-400" /> שינויים אחרונים
            </h2>
            <ul className="space-y-2">
              {(recent || []).map((r) => {
                // Supabase embeds the related supplier; it can be an object or array.
                const supRel = (r as { suppliers?: { name?: string } | { name?: string }[] }).suppliers
                const supName = Array.isArray(supRel) ? supRel[0]?.name : supRel?.name
                return (
                  <li key={r.id as string} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/admin/services/${r.id}`} className="truncate text-gray-700 hover:text-brand-600">
                      {r.service_name as string}
                      {supName && <span className="text-gray-400"> · {supName}</span>}
                    </Link>
                    <span className="shrink-0 text-xs text-gray-400">{timeAgo(r.updated_at as string)}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">פעולות מהירות</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {tiles.map(({ href, icon: Icon, title, body }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-400 hover:shadow-sm"
            >
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 transition group-hover:bg-gray-900 group-hover:text-white">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="font-medium text-gray-900">{title}</h3>
              <p className="mt-1 text-sm text-gray-600">{body}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
