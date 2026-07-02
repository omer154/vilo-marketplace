'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Coins,
  Clock,
  Users as UsersIcon,
  MapPin,
  Mail,
  Globe,
  Layers,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
  Camera,
  FileText,
} from 'lucide-react'
import { useMarketplaceStore } from '@/store/marketplaceStore'
import AdminProbe from '@/components/layout/AdminProbe'
import InlineField, { InlineEditContext } from '@/components/admin/InlineField'
import SupplierModal from '@/components/marketplace/SupplierModal'
import type { CategorySlug, Service, Supplier } from '@/lib/types'
import {
  CATEGORY_META,
  CATEGORY_ICON_MAP,
  CATEGORY_OPTIONS,
  AVATAR_COLORS,
  LOCATION_MODE_OPTIONS,
  PRICING_UNIT_OPTIONS,
  getInitials,
  participantsText,
  durationText,
  locationLabel,
  completeness,
} from '@/lib/ui-meta'
import EditableGrid, { type GridCol } from '@/components/admin/EditableGrid'

/** Prepend https:// to a bare pasted link so it works as an absolute href. */
const externalHref = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)

// Columns for the admin services table (drag-fill bulk editing).
const SERVICE_COLS: GridCol[] = [
  { key: 'service_name', label: 'שם השירות', type: 'text', width: 'min-w-[170px]' },
  { key: 'category_primary', label: 'קטגוריה', type: 'select', options: CATEGORY_OPTIONS, width: 'min-w-[120px]' },
  { key: 'price', label: 'מחיר ₪', type: 'number', width: 'min-w-[90px]' },
  { key: 'pricing_unit', label: 'יחידה', type: 'select', options: PRICING_UNIT_OPTIONS, width: 'min-w-[110px]' },
  { key: 'min_participants', label: 'מ־', type: 'number', width: 'min-w-[64px]' },
  { key: 'max_participants', label: 'עד', type: 'number', width: 'min-w-[64px]' },
  { key: 'duration_minutes', label: 'דק׳', type: 'number', width: 'min-w-[70px]' },
  { key: 'location_mode', label: 'מיקום', type: 'select', options: LOCATION_MODE_OPTIONS, width: 'min-w-[110px]' },
  { key: 'description_short', label: 'תיאור', type: 'textarea', width: 'min-w-[220px]' },
  { key: 'notes', label: 'הערות', type: 'textarea', width: 'min-w-[160px]' },
  {
    key: 'is_active',
    label: 'מצב',
    type: 'select',
    options: [
      { value: 'true', label: 'מוצג' },
      { value: 'false', label: 'מוסתר' },
    ],
    width: 'min-w-[90px]',
  },
]

/** Admin-only spreadsheet view of a supplier's services, with drag-to-fill.
 *  Each committed cell PATCHes that service (debounced); fill commits many at once. */
function ServicesTable({ services }: { services: Service[] }) {
  const pushToast = useMarketplaceStore((s) => s.pushToast)
  const [saving, setSaving] = useState<Set<string | number>>(new Set())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // is_active rendered as a string so the select binds. Local state so edits +
  // row deletions reflect immediately (the services prop doesn't change on save).
  const [list, setList] = useState(() => services.map((s) => ({ ...s, is_active: String(s.is_active) })))

  async function patch(id: string, colKey: string, value: string | number | null) {
    const body: Record<string, unknown> =
      colKey === 'is_active' ? { is_active: value === 'true' } : { [colKey]: value }
    setSaving((s) => new Set(s).add(id))
    try {
      const res = await fetch(`/api/admin/services/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'שגיאה')
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'השמירה נכשלה', 'error')
    } finally {
      setSaving((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }

  function commit(id: string | number, colKey: string, value: string | number | null) {
    setList((prev) => prev.map((r) => (r.id === id ? { ...r, [colKey]: value } : r)))
    const key = `${id}:${colKey}`
    const existing = timers.current.get(key)
    if (existing) clearTimeout(existing)
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key)
        void patch(String(id), colKey, value)
      }, 400)
    )
  }

  async function remove(id: string | number) {
    if (typeof window !== 'undefined' && !window.confirm('למחוק את השירות לצמיתות? לא ניתן לשחזר.')) return
    setSaving((s) => new Set(s).add(id))
    try {
      const res = await fetch(`/api/admin/services/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'שגיאה')
      setList((prev) => prev.filter((r) => r.id !== id))
      pushToast('השירות נמחק', 'success')
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'המחיקה נכשלה', 'error')
    } finally {
      setSaving((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }

  return (
    <EditableGrid
      rows={list}
      columns={SERVICE_COLS}
      rowId={(r) => r.id}
      onCommit={commit}
      onRemoveRow={remove}
      savingRowIds={saving}
    />
  )
}

/** Avatar that, for admins, doubles as a click-to-upload logo editor. */
function LogoBlock({
  supplier,
  isAdmin,
  avatarColor,
}: {
  supplier: Supplier
  isAdmin: boolean
  avatarColor: string
}) {
  const pushToast = useMarketplaceStore((s) => s.pushToast)
  const [logo, setLogo] = useState<string | null>(supplier.logo_url)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/admin/suppliers/${supplier.id}/logo`, { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'העלאה נכשלה')
      setLogo(json.logo_url)
      pushToast('הלוגו עודכן', 'success')
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'העלאה נכשלה', 'error')
    } finally {
      setUploading(false)
    }
  }

  const inner = logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt={supplier.name} className="h-20 w-20 rounded-2xl border border-gray-100 bg-white object-cover shadow-card" />
  ) : (
    <div className={`flex h-20 w-20 items-center justify-center rounded-2xl ${avatarColor} text-2xl font-bold text-white shadow-card`}>
      {getInitials(supplier.name)}
    </div>
  )

  if (!isAdmin) return <div className="shrink-0">{inner}</div>

  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => inputRef.current?.click()} title="החלף לוגו" className="group relative block rounded-2xl">
        {inner}
        <span className="absolute inset-0 flex items-center justify-center rounded-2xl text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </div>
  )
}

function SupplierVisibilityToggle({ supplier }: { supplier: Supplier }) {
  const pushToast = useMarketplaceStore((s) => s.pushToast)
  const [active, setActive] = useState(supplier.is_active)
  const [pending, setPending] = useState(false)
  async function toggle() {
    const next = !active
    setActive(next)
    setPending(true)
    try {
      const res = await fetch(`/api/admin/suppliers/${supplier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'שגיאה')
      pushToast(next ? 'הספק מוצג במרקטפלייס' : 'הספק הוסתר מהמרקטפלייס', 'success')
    } catch (e) {
      setActive(!next)
      pushToast(e instanceof Error ? e.message : 'השמירה נכשלה', 'error')
    } finally {
      setPending(false)
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : active ? (
        <Eye className="h-4 w-4" />
      ) : (
        <EyeOff className="h-4 w-4" />
      )}
      {active ? 'מוצג' : 'מוסתר'}
    </button>
  )
}

function StatChip({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-xl bg-white/80 px-3 py-1.5 text-sm text-gray-700 shadow-sm ring-1 ring-gray-100">
      <Icon className="h-4 w-4 text-brand-500" />
      {children}
    </div>
  )
}

function ServiceCard({ service, onOpen, editable }: { service: Service; onOpen: () => void; editable: boolean }) {
  // `editable` already folds in admin + edit-intent; the body gates on it.
  const isAdmin = editable
  const ep = `/api/admin/services/${service.id}`
  const cat = CATEGORY_META[service.category_primary]
  const CatIcon = cat ? CATEGORY_ICON_MAP[cat.icon] : null
  const comp = completeness(service)
  const ppl = participantsText(service)
  const dur = durationText(service.duration_minutes)
  const loc = locationLabel(service)

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      onClick={isAdmin ? undefined : onOpen}
      className={`flex flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover ${
        isAdmin ? '' : 'cursor-pointer'
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        {cat && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${cat.bgColor} ${cat.textColor}`}
          >
            {CatIcon && <CatIcon className="h-3.5 w-3.5" />}
            {isAdmin ? (
              <InlineField endpoint={ep} field="category_primary" value={service.category_primary} type="select" options={CATEGORY_OPTIONS} />
            ) : (
              cat.name_he
            )}
          </span>
        )}
        {isAdmin && (
          <span
            title={comp.missing.length ? `חסר: ${comp.missing.join(', ')}` : 'מלא'}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              comp.score === 100 ? 'bg-green-50 text-green-600' : comp.score >= 60 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
            }`}
          >
            {comp.score}% מלא
          </span>
        )}
      </div>

      <h3 className="mb-1 text-base font-semibold leading-tight text-gray-900">
        <InlineField endpoint={ep} field="service_name" value={service.service_name} className="font-semibold text-gray-900" />
      </h3>

      <div className="mb-3 text-sm text-gray-500">
        <InlineField
          endpoint={ep}
          field="description_short"
          value={service.description_short}
          type="textarea"
          emptyLabel={isAdmin ? 'הוסף תיאור' : undefined}
          className="text-sm text-gray-500"
        />
      </div>

      <div className="mt-auto space-y-2 border-t border-gray-100 pt-3 text-sm">
        <div className="flex items-center gap-1.5 text-gray-700">
          <Coins className="h-4 w-4 shrink-0 text-gray-400" />
          {service.price != null || isAdmin ? (
            <span className="inline-flex items-center gap-1">
              <InlineField endpoint={ep} field="price" value={service.price} type="number" prefix="₪" format={(v) => Number(v).toLocaleString('he-IL')} emptyLabel="לפי פנייה" className="font-medium text-gray-900" />
              {(service.price != null || isAdmin) && (
                <InlineField endpoint={ep} field="pricing_unit" value={service.pricing_unit} type="select" options={PRICING_UNIT_OPTIONS} className="text-xs text-gray-400" />
              )}
            </span>
          ) : (
            <span className="italic text-gray-400">מחיר לפי פנייה</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-gray-600">
          <Clock className="h-4 w-4 shrink-0 text-gray-400" />
          {isAdmin ? (
            <span className="inline-flex items-center gap-1">
              <InlineField endpoint={ep} field="duration_minutes" value={service.duration_minutes} type="number" suffix=" דק׳" emptyLabel="לא צוין" />
            </span>
          ) : (
            <span>{dur || 'משך גמיש'}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-gray-600">
          <UsersIcon className="h-4 w-4 shrink-0 text-gray-400" />
          {isAdmin ? (
            <span className="inline-flex items-center gap-1">
              <InlineField endpoint={ep} field="min_participants" value={service.min_participants} type="number" emptyLabel="מינ׳" />
              <span className="text-gray-300">–</span>
              <InlineField endpoint={ep} field="max_participants" value={service.max_participants} type="number" emptyLabel="מקס׳" />
              <span className="text-xs text-gray-400">משתתפים</span>
            </span>
          ) : (
            <span>{ppl || 'כמות גמישה'}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-gray-600">
          <MapPin className="h-4 w-4 shrink-0 text-gray-400" />
          {isAdmin ? (
            <InlineField endpoint={ep} field="location_mode" value={service.location_mode || null} type="select" options={LOCATION_MODE_OPTIONS} emptyLabel="מיקום" />
          ) : (
            <span>{loc || 'גמיש'}</span>
          )}
        </div>

        {(service.notes || isAdmin) && (
          <div className="rounded-lg bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
            <InlineField endpoint={ep} field="notes" value={service.notes} type="textarea" emptyLabel={isAdmin ? 'הוסף הערה' : undefined} className="text-xs text-amber-800" />
          </div>
        )}
      </div>
    </motion.div>
  )
}

export default function SupplierProfile({
  supplier,
  services,
  editable = false,
}: {
  supplier: Supplier
  services: Service[]
  /** Edit-intent from the URL (?edit=1, added only by the admin "ערוך בעמוד"
   *  link). Plain marketplace browsing passes false → fully read-only. */
  editable?: boolean
}) {
  // Editing requires BOTH a signed-in admin AND explicit edit-intent. So an
  // admin browsing the public marketplace sees a read-only page; editing is
  // reached only via the admin area's "ערוך בעמוד". `isAdmin` below therefore
  // means "edit mode on" — the whole body already gates affordances on it.
  const isAdmin = useMarketplaceStore((s) => s.isAdmin) && editable
  const supEp = `/api/admin/suppliers/${supplier.id}`
  const [selected, setSelected] = useState<Service | null>(null)
  const [view, setView] = useState<'cards' | 'table'>('cards')

  // Derived stats (computed from real services — never fabricated).
  const cats = [...new Set(services.map((s) => s.category_primary))] as CategorySlug[]
  const prices = services.map((s) => s.price).filter((p): p is number => p != null)
  const priceRange =
    prices.length > 0
      ? prices.length === 1 || Math.min(...prices) === Math.max(...prices)
        ? `₪${Math.min(...prices).toLocaleString('he-IL')}`
        : `₪${Math.min(...prices).toLocaleString('he-IL')}–₪${Math.max(...prices).toLocaleString('he-IL')}`
      : null
  const locations = [...new Set(services.map((s) => locationLabel(s)).filter(Boolean))]
  const avatarColor = cats[0] ? AVATAR_COLORS[cats[0]] : 'bg-brand-500'

  // Group services by category for a clean, consistent layout.
  const byCat = new Map<CategorySlug, Service[]>()
  for (const s of services) {
    if (!byCat.has(s.category_primary)) byCat.set(s.category_primary, [])
    byCat.get(s.category_primary)!.push(s)
  }

  return (
    <InlineEditContext.Provider value={isAdmin}>
    <div className="min-h-screen bg-slate-50">
      <AdminProbe />

      {/* Hero header */}
      <header className="relative overflow-hidden border-b border-gray-100 bg-gradient-to-bl from-brand-50 via-white to-white">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
          {/* Back link follows how you arrived: editing (from the admin
              suppliers list) → back there; plain browsing → back to marketplace. */}
          <Link
            href={isAdmin ? '/admin/suppliers' : '/marketplace'}
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-brand-600"
          >
            <ArrowRight className="h-4 w-4" />
            {isAdmin ? 'חזרה לכל הספקים' : 'חזרה למרקטפלייס'}
          </Link>

          {!supplier.is_active && (
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600">
              <EyeOff className="h-3.5 w-3.5" /> ספק זה מוסתר מהמרקטפלייס
            </div>
          )}

          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            {/* Logo / avatar — click to upload when admin */}
            <LogoBlock supplier={supplier} isAdmin={isAdmin} avatarColor={avatarColor} />

            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                  <InlineField endpoint={supEp} field="name" value={supplier.name} className="font-bold text-gray-900" />
                </h1>
                {isAdmin && <SupplierVisibilityToggle supplier={supplier} />}
              </div>

              {(supplier.name_en || isAdmin) && (
                <p className="mt-0.5 text-sm text-gray-400" dir="ltr">
                  <InlineField
                    endpoint={supEp}
                    field="name_en"
                    value={supplier.name_en ?? null}
                    emptyLabel={isAdmin ? 'Add English name' : undefined}
                    className="text-sm text-gray-400"
                  />
                </p>
              )}

              <p className="mt-2 max-w-2xl text-gray-600">
                <InlineField endpoint={supEp} field="description_short" value={supplier.description_short} type="textarea" emptyLabel={isAdmin ? 'הוסף תיאור לספק' : undefined} className="text-gray-600" />
              </p>

              {/* Specialty chips */}
              <div className="mt-4 flex flex-wrap gap-2">
                {cats.map((c) => {
                  const meta = CATEGORY_META[c]
                  const Icon = meta ? CATEGORY_ICON_MAP[meta.icon] : null
                  return (
                    <span key={c} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${meta.bgColor} ${meta.textColor}`}>
                      {Icon && <Icon className="h-3.5 w-3.5" />}
                      {meta.name_he}
                    </span>
                  )
                })}
              </div>

              {/* Stat chips */}
              <div className="mt-4 flex flex-wrap gap-2">
                <StatChip icon={Layers}>{services.length} שירותים</StatChip>
                {priceRange && <StatChip icon={Coins}>{priceRange}</StatChip>}
                {locations.length > 0 && <StatChip icon={MapPin}>{locations.join(' · ')}</StatChip>}
              </div>

              {/* Admin / contact row */}
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600">
                {(supplier.website || isAdmin) && (
                  <span className="inline-flex items-center gap-1.5">
                    <Globe className="h-4 w-4 text-gray-400" />
                    <InlineField endpoint={supEp} field="website" value={supplier.website ?? null} emptyLabel={isAdmin ? 'הוסף אתר' : undefined} />
                  </span>
                )}
                {(supplier.contact_email || isAdmin) && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-gray-400" />
                    <InlineField endpoint={supEp} field="contact_email" value={supplier.contact_email} emptyLabel={isAdmin ? 'הוסף אימייל' : undefined} />
                  </span>
                )}
                {/* Cancellation & order-change terms — set by admin, shown to all
                    on the header and on every service. */}
                {(supplier.cancellation_terms_url || isAdmin) && (
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-gray-400" />
                    {isAdmin ? (
                      <InlineField
                        endpoint={supEp}
                        field="cancellation_terms_url"
                        value={supplier.cancellation_terms_url ?? null}
                        emptyLabel="צרף קישור לתנאי ביטול ושינוי הזמנה"
                        className="text-gray-600"
                        ariaLabel="תנאי ביטול ושינוי הזמנה"
                      />
                    ) : (
                      <a
                        href={externalHref(supplier.cancellation_terms_url ?? '')}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-600 underline-offset-2 hover:underline"
                      >
                        תנאי ביטול ושינוי הזמנה
                      </a>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Services */}
      <main className="mx-auto max-w-5xl px-4 py-8">
        {isAdmin && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-2.5 text-sm text-brand-700">
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              מצב ניהול פעיל — לחצו על שדה כדי לערוך; בתצוגת טבלה אפשר לגרור ערך לשורות רבות בבת אחת.
            </span>
            <div className="flex items-center gap-2">
              <a
                href={`/api/admin/services/export?supplier=${supplier.id}`}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
              >
                ⬇ ייצא לאקסל
              </a>
              <span className="inline-flex overflow-hidden rounded-lg border border-brand-200">
                <button
                  type="button"
                  onClick={() => setView('cards')}
                  className={`px-3 py-1 text-xs font-medium transition ${view === 'cards' ? 'bg-brand-600 text-white' : 'bg-white text-brand-700 hover:bg-brand-50'}`}
                >
                  כרטיסיות
                </button>
                <button
                  type="button"
                  onClick={() => setView('table')}
                  className={`px-3 py-1 text-xs font-medium transition ${view === 'table' ? 'bg-brand-600 text-white' : 'bg-white text-brand-700 hover:bg-brand-50'}`}
                >
                  טבלה
                </button>
              </span>
            </div>
          </div>
        )}

        {isAdmin && view === 'table' ? (
          <ServicesTable services={services} />
        ) : services.length === 0 ? (
          <p className="py-12 text-center text-gray-400">לא נמצאו שירותים פעילים לספק זה.</p>
        ) : (
          [...byCat.entries()].map(([c, svcs]) => {
            const meta = CATEGORY_META[c]
            const Icon = meta ? CATEGORY_ICON_MAP[meta.icon] : null
            return (
              <section key={c} className="mb-8">
                <div className="mb-3 flex items-center gap-2">
                  {Icon && (
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${meta.bgColor} ${meta.textColor}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                  )}
                  <h2 className="text-lg font-bold text-gray-800">{meta.name_he}</h2>
                  <span className="text-sm text-gray-400">({svcs.length})</span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {svcs.map((s) => (
                    <ServiceCard key={s.id} service={s} onOpen={() => setSelected(s)} editable={isAdmin} />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </main>

      {selected && (
        <SupplierModal
          service={{
            ...selected,
            supplier_name: supplier.name,
            supplier_logo_url: supplier.logo_url,
            supplier_cancellation_terms_url: supplier.cancellation_terms_url ?? null,
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
    </InlineEditContext.Provider>
  )
}
