'use client'

import Link from 'next/link'
import { useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Clock, Users, Coins, MapPin, Pencil, Building2, ArrowLeft } from 'lucide-react'
import { useMarketplaceStore } from '@/store/marketplaceStore'
import {
  Heart,
  Users as UsersGroup,
  BookOpen,
  UtensilsCrossed,
  Palette,
  MapPin as MapPinIcon,
  Dumbbell,
  Cpu,
  TrendingUp,
} from 'lucide-react'
import type { Service, CategorySlug, PricingUnit } from '@/lib/types'

const CATEGORY_ICON_MAP: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  Heart,
  Users: UsersGroup,
  BookOpen,
  UtensilsCrossed,
  Palette,
  MapPin: MapPinIcon,
  Dumbbell,
  Cpu,
  TrendingUp,
}

const CATEGORY_META: Record<
  CategorySlug,
  { name_he: string; icon: string; bgColor: string; textColor: string }
> = {
  wellbeing: { name_he: 'וולנס ובריאות', icon: 'Heart', bgColor: 'bg-emerald-100', textColor: 'text-emerald-700' },
  teambuilding: { name_he: 'גיבוש וחברה', icon: 'Users', bgColor: 'bg-blue-100', textColor: 'text-blue-700' },
  learning: { name_he: 'למידה והעשרה', icon: 'BookOpen', bgColor: 'bg-violet-100', textColor: 'text-violet-700' },
  food: { name_he: 'אוכל ואירוח', icon: 'UtensilsCrossed', bgColor: 'bg-orange-100', textColor: 'text-orange-700' },
  culture: { name_he: 'תרבות ויצירה', icon: 'Palette', bgColor: 'bg-pink-100', textColor: 'text-pink-700' },
  travel: { name_he: 'טיולים ואתגר', icon: 'MapPin', bgColor: 'bg-teal-100', textColor: 'text-teal-700' },
  sport: { name_he: 'ספורט ופעילות', icon: 'Dumbbell', bgColor: 'bg-red-100', textColor: 'text-red-700' },
  tech: { name_he: 'טכנולוגיה ו-AI', icon: 'Cpu', bgColor: 'bg-cyan-100', textColor: 'text-cyan-700' },
  consulting: { name_he: 'ייעוץ ופיתוח', icon: 'TrendingUp', bgColor: 'bg-amber-100', textColor: 'text-amber-700' },
}

const PRICING_UNIT_HE: Record<PricingUnit, string> = {
  person: 'לאדם',
  group: 'לקבוצה',
  hour: 'לשעה',
  project: 'לפרויקט',
  month: 'לחודש',
  unit: 'ליחידה',
}

const LOCATION_HE: Record<string, string> = {
  onsite: 'באתר הלקוח',
  remote: 'מרחוק',
  both: 'גמיש',
  // Newer location_mode values (migration 002). Surfaced here so the
  // richer at_client / at_provider distinction reaches the user.
  at_client: 'מגיעים אליכם',
  at_provider: 'אצל הספק',
  hybrid: 'גמיש — אצלכם או אצל הספק',
}

interface SupplierModalProps {
  service: Service
  onClose: () => void
}

export default function SupplierModal({ service, onClose }: SupplierModalProps) {
  const cat = CATEGORY_META[service.category_primary]
  const CatIcon = cat ? CATEGORY_ICON_MAP[cat.icon] : null
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = `service-${service.id}-title`
  const isAdmin = useMarketplaceStore((s) => s.isAdmin)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // Trap Tab inside the dialog so screen-reader / keyboard users
      // can't accidentally tab into the background page while the
      // modal is open.
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)

    // Lock background scroll without jumping to top. iOS / mobile Safari
    // will scroll to top on overflow:hidden unless we fix the body
    // position with the current scrollY offset, then restore it on close.
    const scrollY = window.scrollY
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    }
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'

    // Move focus into the dialog and remember where it came from so we
    // can restore it on close (a11y baseline for any modal).
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    firstFocusable?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prev.overflow
      document.body.style.position = prev.position
      document.body.style.top = prev.top
      document.body.style.width = prev.width
      window.scrollTo(0, scrollY)
      previousFocusRef.current?.focus?.()
    }
  }, [handleKeyDown])

  const participantsText =
    service.min_participants != null && service.max_participants != null
      ? `${service.min_participants}–${service.max_participants}`
      : service.min_participants != null
        ? `מ-${service.min_participants}`
        : service.max_participants != null
          ? `עד ${service.max_participants}`
          : 'גמיש'

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center pt-20 px-4"
        onClick={onClose}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="bg-white rounded-2xl max-w-2xl w-full p-8 shadow-2xl relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="סגור"
            className="absolute top-4 left-4 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>

          {/* Category badge */}
          {cat && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${cat.bgColor} ${cat.textColor} mb-4`}
            >
              {CatIcon && <CatIcon className="w-4 h-4" />}
              {cat.name_he}
            </div>
          )}

          {/* Title */}
          <h2 id={titleId} className="text-2xl font-bold text-gray-900 mb-2">
            {service.service_name}
          </h2>

          {/* Supplier row — links through to the full supplier profile page */}
          <Link
            href={`/supplier/${service.supplier_id}`}
            className="group -mx-1 mb-4 inline-flex items-center gap-2 rounded-lg px-1 py-1 transition-colors hover:bg-brand-50"
          >
            {service.supplier_logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={service.supplier_logo_url}
                alt={service.supplier_name || ''}
                className="w-8 h-8 rounded-full object-cover bg-white border border-gray-100 shrink-0"
                onError={(e) => {
                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
            <span className="text-sm text-gray-600 group-hover:text-brand-700">
              {service.supplier_name}
              {service.category_secondary && ` · ${service.category_secondary}`}
            </span>
            <ArrowLeft className="h-3.5 w-3.5 text-brand-400 opacity-70 transition-opacity group-hover:opacity-100" />
          </Link>

          {/* Service description */}
          {service.description_short && (
            <p className="mb-6 leading-relaxed text-gray-600">{service.description_short}</p>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-gray-50 rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                <Coins className="w-3.5 h-3.5" />
                מחיר
              </div>
              <div className="font-semibold text-gray-900">
                {service.price != null ? (
                  <>
                    <span dir="ltr">
                      &#8362;{service.price.toLocaleString('he-IL')}
                    </span>
                    {service.pricing_unit && (
                      <span className="text-sm text-gray-500 mr-1">
                        {PRICING_UNIT_HE[service.pricing_unit]}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-gray-400 italic text-sm">
                    מחיר לפי פנייה
                  </span>
                )}
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                <Clock className="w-3.5 h-3.5" />
                משך
              </div>
              <div className="font-semibold text-gray-900">
                {service.duration_minutes
                  ? `${service.duration_minutes} דקות`
                  : 'לא צוין'}
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                <Users className="w-3.5 h-3.5" />
                משתתפים
              </div>
              <div className="font-semibold text-gray-900">
                {participantsText}
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                <MapPin className="w-3.5 h-3.5" />
                מיקום
              </div>
              <div className="font-semibold text-gray-900">
                {/* Prefer the richer location_mode (at_client / at_provider /
                    remote / hybrid) when available, fall back to the legacy
                    location_type for un-migrated rows. */}
                {LOCATION_HE[service.location_mode || ''] ||
                  LOCATION_HE[service.location_type] ||
                  service.location_type}
              </div>
            </div>
          </div>

          {/* Notes */}
          {service.notes && (
            <div className="bg-amber-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-amber-800">{service.notes}</p>
            </div>
          )}

          {/* CTAs */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={
                service.supplier_name
                  ? `mailto:info@vilo.co.il?subject=פנייה בנוגע ל${service.service_name} - ${service.supplier_name}`
                  : undefined
              }
              className="block flex-1 text-center bg-brand-500 hover:bg-brand-600 text-white rounded-xl py-3 font-medium transition-colors"
            >
              לפרטים נוספים פנו ל-Vilo
            </a>
            <Link
              href={`/supplier/${service.supplier_id}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-200 bg-white px-4 py-3 font-medium text-brand-700 transition-colors hover:bg-brand-50"
            >
              <Building2 className="h-4 w-4" />
              עמוד הספק
            </Link>
            {isAdmin && (
              <Link
                href={`/admin/services/${service.id}`}
                aria-label="ערוך שירות"
                title="ערוך שירות (אדמין)"
                className="inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl px-4 py-3 font-medium transition-colors"
              >
                <Pencil className="w-4 h-4" />
                ערוך
              </Link>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
