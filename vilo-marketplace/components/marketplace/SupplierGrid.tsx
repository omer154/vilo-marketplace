'use client'

import { motion } from 'framer-motion'
import {
  Search,
  Sparkles,
  Users,
  Heart,
  BookOpen,
  UtensilsCrossed,
  Dumbbell,
  Info,
  AlertCircle,
} from 'lucide-react'
import SupplierCard from './SupplierCard'
import SupplierModal from './SupplierModal'
import { useMarketplaceStore } from '@/store/marketplaceStore'
import { useServices } from '@/hooks/useServices'
import type { CategorySlug } from '@/lib/types'

const QUICK_OPTIONS: { label: string; icon: React.ReactNode; category: CategorySlug }[] = [
  { label: 'גיבוש וחברה', icon: <Users className="w-5 h-5" />, category: 'teambuilding' },
  { label: 'וולנס ובריאות', icon: <Heart className="w-5 h-5" />, category: 'wellbeing' },
  { label: 'למידה והעשרה', icon: <BookOpen className="w-5 h-5" />, category: 'learning' },
  { label: 'אוכל ואירוח', icon: <UtensilsCrossed className="w-5 h-5" />, category: 'food' },
  { label: 'פעילות ספורטיבית', icon: <Dumbbell className="w-5 h-5" />, category: 'sport' },
]

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5 space-y-3 animate-pulse">
      <div className="w-24 h-6 bg-gray-200 rounded-full" />
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-gray-200" />
        <div className="w-20 h-4 bg-gray-200 rounded" />
      </div>
      <div className="w-full h-5 bg-gray-200 rounded" />
      <div className="w-3/4 h-4 bg-gray-200 rounded" />
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <div className="w-32 h-4 bg-gray-200 rounded" />
        <div className="w-24 h-4 bg-gray-200 rounded" />
      </div>
    </div>
  )
}

function AIWelcomeBanner() {
  const openConcierge = useMarketplaceStore((s) => s.openConcierge)
  const openConciergeWithCategory = useMarketplaceStore(
    (s) => s.openConciergeWithCategory
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-l from-brand-500/5 via-blue-50 to-brand-500/5 border border-blue-100 rounded-2xl p-8 mb-6"
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-6 h-6 text-brand-500" />
        <h2 className="text-xl font-bold text-gray-900">
          מה תרצו לחגוג עם הצוות שלכם היום?
        </h2>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        בחרו קטגוריה או תארו בחופשיות מה אתם מחפשים
      </p>

      <div className="flex flex-wrap gap-2 mb-5">
        {QUICK_OPTIONS.map((opt) => (
          <button
            key={opt.category}
            onClick={() => openConciergeWithCategory(opt.category)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-brand-500 hover:text-brand-600 hover:bg-brand-50 transition-all"
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>

      <button
        onClick={() => openConcierge()}
        className="flex items-center gap-2 text-brand-500 text-sm font-medium hover:text-brand-600 transition-colors"
      >
        <Sparkles className="w-4 h-4" />
        או דברו עם הקונסיירז&apos; AI שלנו
      </button>
    </motion.div>
  )
}

function RelaxedSearchBanner({ strictCount, totalCount }: { strictCount: number; totalCount: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3"
    >
      <Info className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-medium text-amber-800">
          {strictCount > 0
            ? `נמצאו ${strictCount} שירותים שמתאימים בדיוק לפילטרים שלך. מציגים גם ${totalCount - strictCount} אפשרויות נוספות בקטגוריה.`
            : 'לא נמצאה התאמה מדויקת לכל הפילטרים. מציגים את כל השירותים בקטגוריה שביקשת.'}
        </p>
        <p className="text-xs text-amber-600 mt-1">
          מומלץ לאמת תמחור ומספר משתתפים ישירות מול הספקים.
        </p>
      </div>
    </motion.div>
  )
}

export default function SupplierGrid() {
  const { services, isLoading, error, relaxed, strictCount } = useServices()
  const selectedService = useMarketplaceStore((s) => s.selectedService)
  const setSelectedService = useMarketplaceStore((s) => s.setSelectedService)
  const activeCategories = useMarketplaceStore((s) => s.activeCategories)
  const totalBudget = useMarketplaceStore((s) => s.totalBudget)
  const searchQuery = useMarketplaceStore((s) => s.searchQuery)
  const aiSearchLabel = useMarketplaceStore((s) => s.aiSearchLabel)

  const hasActiveFilters =
    activeCategories.length > 0 || totalBudget != null || searchQuery !== ''

  return (
    <>
      {/* AI Welcome Banner — shown when no filters active */}
      {!hasActiveFilters && !isLoading && <AIWelcomeBanner />}

      {/* AI search label */}
      {aiSearchLabel && (
        <div className="flex items-center gap-2 mb-4 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2">
          <Sparkles className="w-4 h-4 text-brand-500" />
          <span className="text-sm text-blue-800">{aiSearchLabel}</span>
        </div>
      )}

      {/* Relaxed search banner — when fallback kicked in */}
      {!isLoading && relaxed && services.length > 0 && (
        <RelaxedSearchBanner strictCount={strictCount} totalCount={services.length} />
      )}

      {/* Results count */}
      {!isLoading && (
        <p className="text-sm text-gray-500 mb-4">
          מציג {services.length} תוצאות
        </p>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Error state — surfaces /api/search failures explicitly so users
          don't misread an outage as an empty result set. */}
      {!isLoading && error && (
        <div
          className="flex items-start gap-3 py-8 px-5 bg-red-50 border border-red-200 rounded-xl"
          role="alert"
        >
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-red-900 mb-1">
              לא הצלחנו לטעון את התוצאות
            </h3>
            <p className="text-sm text-red-700">
              נסו שוב בעוד רגע, או דברו עם הקונסיירז&apos; שלנו.
            </p>
            <p className="text-xs text-red-600 mt-2 font-mono" dir="ltr">
              {error}
            </p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && services.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            לא נמצאו תוצאות
          </h3>
          <p className="text-sm text-gray-500 max-w-sm">
            נסו לשנות את הפילטרים או שאלו את הקונסיירז&apos; שלנו
          </p>
        </div>
      )}

      {/* Grid */}
      {!isLoading && services.length > 0 && (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: {
              transition: { staggerChildren: 0.04 },
            },
          }}
        >
          {services.map((service) => (
            <motion.div
              key={service.id}
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.3 }}
            >
              <SupplierCard
                service={service}
                onClick={() => setSelectedService(service)}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Modal */}
      {selectedService && (
        <SupplierModal
          service={selectedService}
          onClose={() => setSelectedService(null)}
        />
      )}
    </>
  )
}
