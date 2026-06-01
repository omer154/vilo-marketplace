'use client'

import { useState } from 'react'
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
} from 'lucide-react'
import { useMarketplaceStore } from '@/store/marketplaceStore'
import AdminProbe from '@/components/layout/AdminProbe'
import InlineField from '@/components/admin/InlineField'
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

function ServiceCard({ service }: { service: Service }) {
  const isAdmin = useMarketplaceStore((s) => s.isAdmin)
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
      className="flex flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover"
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

export default function SupplierProfile({ supplier, services }: { supplier: Supplier; services: Service[] }) {
  const isAdmin = useMarketplaceStore((s) => s.isAdmin)
  const supEp = `/api/admin/suppliers/${supplier.id}`

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
    <div className="min-h-screen bg-slate-50">
      <AdminProbe />

      {/* Hero header */}
      <header className="relative overflow-hidden border-b border-gray-100 bg-gradient-to-bl from-brand-50 via-white to-white">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
          <Link href="/marketplace" className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-brand-600">
            <ArrowRight className="h-4 w-4" />
            חזרה למרקטפלייס
          </Link>

          {!supplier.is_active && (
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600">
              <EyeOff className="h-3.5 w-3.5" /> ספק זה מוסתר מהמרקטפלייס
            </div>
          )}

          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            {/* Logo / avatar */}
            {supplier.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={supplier.logo_url} alt={supplier.name} className="h-20 w-20 shrink-0 rounded-2xl border border-gray-100 bg-white object-cover shadow-card" />
            ) : (
              <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl ${avatarColor} text-2xl font-bold text-white shadow-card`}>
                {getInitials(supplier.name)}
              </div>
            )}

            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                  <InlineField endpoint={supEp} field="name" value={supplier.name} className="font-bold text-gray-900" />
                </h1>
                {isAdmin && <SupplierVisibilityToggle supplier={supplier} />}
              </div>

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
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Services */}
      <main className="mx-auto max-w-5xl px-4 py-8">
        {isAdmin && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-2.5 text-sm text-brand-700">
            <Sparkles className="h-4 w-4" />
            מצב ניהול פעיל — לחצו על כל שדה כדי לערוך אותו; השינויים נשמרים אוטומטית.
          </div>
        )}

        {services.length === 0 ? (
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
                    <ServiceCard key={s.id} service={s} />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </main>
    </div>
  )
}
