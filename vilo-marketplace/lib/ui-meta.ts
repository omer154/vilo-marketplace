// Single source of truth for catalog presentation (categories, units, location,
// formatting + completeness). Shared by the card, modal and the supplier
// profile page so every supplier is presented with the exact same vocabulary.
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
import type { CategorySlug, PricingUnit, Service } from '@/lib/types'

export const CATEGORY_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
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

export const CATEGORY_META: Record<
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

export const AVATAR_COLORS: Record<CategorySlug, string> = {
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

export const PRICING_UNIT_HE: Record<PricingUnit, string> = {
  person: 'לאדם',
  group: 'לקבוצה',
  hour: 'לשעה',
  project: 'לפרויקט',
  month: 'לחודש',
  unit: 'ליחידה',
}

/** Options for inline editing of pricing_unit. */
export const PRICING_UNIT_OPTIONS = (Object.keys(PRICING_UNIT_HE) as PricingUnit[]).map((v) => ({
  value: v,
  label: PRICING_UNIT_HE[v],
}))

export const LOCATION_HE: Record<string, string> = {
  at_client: 'מגיעים אליכם',
  at_provider: 'אצל הספק',
  remote: 'מרחוק',
  hybrid: 'גמיש',
  onsite: 'מגיעים אליכם',
  both: 'גמיש',
}

export const LOCATION_MODE_OPTIONS = [
  { value: 'at_client', label: 'מגיעים אליכם' },
  { value: 'at_provider', label: 'אצל הספק' },
  { value: 'remote', label: 'מרחוק' },
  { value: 'hybrid', label: 'גמיש' },
]

export const CATEGORY_OPTIONS = (Object.keys(CATEGORY_META) as CategorySlug[]).map((slug) => ({
  value: slug,
  label: CATEGORY_META[slug].name_he,
}))

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) return words[0][0] + words[1][0]
  return name.slice(0, 2)
}

/** Hebrew "₪1,500 לאדם" / "מחיר לפי פנייה". */
export function formatPrice(service: Pick<Service, 'price' | 'pricing_unit'>): string {
  if (service.price == null) return 'מחיר לפי פנייה'
  const unit = service.pricing_unit ? ` ${PRICING_UNIT_HE[service.pricing_unit]}` : ''
  return `₪${service.price.toLocaleString('he-IL')}${unit}`
}

/** Hebrew participants phrase, or null when flexible/unspecified. */
export function participantsText(
  service: Pick<Service, 'min_participants' | 'max_participants'>
): string | null {
  const { min_participants: mn, max_participants: mx } = service
  if (mn != null && mx != null) return `${mn}–${mx} משתתפים`
  if (mn != null) return `מ-${mn} משתתפים`
  if (mx != null) return `עד ${mx} משתתפים`
  return null
}

/** Hebrew duration phrase, or null when unspecified. */
export function durationText(minutes: number | null | undefined): string | null {
  if (minutes == null) return null
  if (minutes < 60) return `${minutes} דקות`
  const h = minutes / 60
  return Number.isInteger(h) ? `${h} שעות` : `${h.toFixed(1)} שעות`
}

export function locationLabel(service: Pick<Service, 'location_mode' | 'location_type'>): string | null {
  const key = service.location_mode || service.location_type
  if (!key) return null
  return LOCATION_HE[key] || service.location_type || null
}

/**
 * Data-completeness of a service across the user-facing catalog fields, used by
 * admin badges. Required fields (name/category) are always present; this scores
 * the optional ones that legacy rows often miss.
 */
const COMPLETENESS_FIELDS: Array<{ key: keyof Service; label: string }> = [
  { key: 'price', label: 'תמחור' },
  { key: 'duration_minutes', label: 'זמן פעילות' },
  { key: 'min_participants', label: 'כמות מינ׳' },
  { key: 'max_participants', label: 'כמות מקס׳' },
  { key: 'description_short', label: 'תיאור' },
  { key: 'location_mode', label: 'מיקום' },
]

export function completeness(service: Service): { score: number; filled: number; total: number; missing: string[] } {
  const missing: string[] = []
  for (const f of COMPLETENESS_FIELDS) {
    const v = service[f.key]
    if (v === null || v === undefined || v === '') missing.push(f.label)
  }
  const filled = COMPLETENESS_FIELDS.length - missing.length
  return {
    score: Math.round((filled / COMPLETENESS_FIELDS.length) * 100),
    filled,
    total: COMPLETENESS_FIELDS.length,
    missing,
  }
}
