'use client'

import { motion } from 'framer-motion'
import { Clock, Users as UsersIcon, Coins, CheckCircle } from 'lucide-react'
import {
  Heart,
  Users,
  BookOpen,
  UtensilsCrossed,
  Palette,
  MapPin,
  Dumbbell,
  Cpu,
  TrendingUp,
} from 'lucide-react'
import { useMarketplaceStore } from '@/store/marketplaceStore'
import type { Service, CategorySlug, PricingUnit } from '@/lib/types'

const CATEGORY_ICON_MAP: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  Heart,
  Users,
  BookOpen,
  UtensilsCrossed,
  Palette,
  MapPin,
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

const AVATAR_COLORS: Record<CategorySlug, string> = {
  wellbeing: 'bg-emerald-500',
  teambuilding: 'bg-blue-500',
  learning: 'bg-violet-500',
  food: 'bg-orange-500',
  culture: 'bg-pink-500',
  travel: 'bg-teal-500',
  sport: 'bg-red-500',
  tech: 'bg-cyan-500',
  consulting: 'bg-amber-500',
}

const PRICING_UNIT_HE: Record<PricingUnit, string> = {
  person: 'לאדם',
  group: 'לקבוצה',
  hour: 'לשעה',
  project: 'לפרויקט',
  month: 'לחודש',
  unit: 'ליחידה',
}

function getInitials(name: string): string {
  const words = name.split(' ')
  if (words.length >= 2) return words[0][0] + words[1][0]
  return name.slice(0, 2)
}

interface SupplierCardProps {
  service: Service
  onClick: () => void
}

export default function SupplierCard({ service, onClick }: SupplierCardProps) {
  const cat = CATEGORY_META[service.category_primary]
  const CatIcon = cat ? CATEGORY_ICON_MAP[cat.icon] : null
  const avatarColor = AVATAR_COLORS[service.category_primary] || 'bg-gray-500'
  const supplierName = service.supplier_name || ''

  const totalBudget = useMarketplaceStore((s) => s.totalBudget)
  const participantsCount = useMarketplaceStore((s) => s.participantsCount)

  const participantsText =
    service.min_participants != null && service.max_participants != null
      ? `${service.min_participants}–${service.max_participants} משתתפים`
      : service.min_participants != null
        ? `מ-${service.min_participants} משתתפים`
        : service.max_participants != null
          ? `עד ${service.max_participants} משתתפים`
          : null

  // Smart context badges
  const showBudgetBadge = totalBudget && service.price != null
  const showParticipantsBadge =
    participantsCount &&
    service.min_participants != null &&
    service.max_participants != null &&
    participantsCount >= service.min_participants &&
    participantsCount <= service.max_participants

  return (
    <motion.div
      whileHover={{ scale: 1.015 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      className="group bg-white rounded-xl border border-gray-100 shadow-card hover:shadow-card-hover transition-all duration-200 cursor-pointer overflow-hidden"
    >
      <div className="p-5 space-y-3">
        {/* Category badge + context badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {cat && (
            <div
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${cat.bgColor} ${cat.textColor}`}
            >
              {CatIcon && <CatIcon className="w-3.5 h-3.5" />}
              {cat.name_he}
            </div>
          )}
          {showBudgetBadge && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
              <CheckCircle className="w-3 h-3" />
              מתאים לתקציב
            </div>
          )}
          {showParticipantsBadge && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
              <CheckCircle className="w-3 h-3" />
              מתאים ל-{participantsCount} משתתפים
            </div>
          )}
        </div>

        {/* Supplier */}
        <div className="flex items-center gap-2">
          {service.supplier_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={service.supplier_logo_url}
              alt={supplierName}
              className="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 shrink-0"
              onError={(e) => {
                // Hide broken images and let CSS show no fallback —
                // the supplier name text right next to it still
                // identifies the vendor.
                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <div
              className={`w-7 h-7 rounded-full ${avatarColor} flex items-center justify-center text-white text-xs font-bold shrink-0`}
            >
              {getInitials(supplierName)}
            </div>
          )}
          <span className="text-xs text-gray-500 truncate">
            {supplierName}
          </span>
        </div>

        {/* Service name */}
        <h3 className="font-semibold text-base text-gray-900 truncate leading-tight">
          {service.service_name}
        </h3>

        {/* Subtitle */}
        {(service.description_short || service.category_secondary) && (
          <p className="text-sm text-gray-500 truncate">
            {service.description_short || service.category_secondary}
          </p>
        )}

        {/* Divider */}
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          {/* Price + Duration row */}
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1 text-gray-700">
              <Coins className="w-3.5 h-3.5 text-gray-400" />
              {service.price != null ? (
                <>
                  <span dir="ltr">
                    &#8362;{service.price.toLocaleString('he-IL')}
                  </span>
                  {service.pricing_unit && (
                    <span className="text-gray-400 text-xs">
                      {PRICING_UNIT_HE[service.pricing_unit]}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-gray-400 italic">מחיר לפי פנייה</span>
              )}
            </span>

            {service.duration_minutes != null && (
              <span className="flex items-center gap-1 text-gray-500 text-xs">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                {service.duration_minutes} דק&apos;
              </span>
            )}
          </div>

          {/* Participants row */}
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <UsersIcon className="w-3.5 h-3.5 text-gray-400" />
            {participantsText ? (
              participantsText
            ) : (
              <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs">
                גמיש
              </span>
            )}
          </div>
        </div>

        {/* Hover CTA */}
        <div className="overflow-hidden">
          <div className="group-hover:opacity-100 group-hover:h-auto opacity-0 h-0 transition-all duration-200 pt-2">
            <span className="text-brand-500 text-sm font-medium">
              לפרטים נוספים &larr;
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
