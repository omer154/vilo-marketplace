'use client'

import { motion } from 'framer-motion'
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
  LayoutGrid,
} from 'lucide-react'
import { useMarketplaceStore } from '@/store/marketplaceStore'
import type { CategorySlug } from '@/lib/types'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
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

const CATEGORIES: {
  slug: CategorySlug
  name_he: string
  icon: string
}[] = [
  { slug: 'wellbeing', name_he: 'וולנס ובריאות', icon: 'Heart' },
  { slug: 'teambuilding', name_he: 'גיבוש וחברה', icon: 'Users' },
  { slug: 'learning', name_he: 'למידה והעשרה', icon: 'BookOpen' },
  { slug: 'food', name_he: 'אוכל ואירוח', icon: 'UtensilsCrossed' },
  { slug: 'culture', name_he: 'תרבות ויצירה', icon: 'Palette' },
  { slug: 'travel', name_he: 'טיולים ואתגר', icon: 'MapPin' },
  { slug: 'sport', name_he: 'ספורט ופעילות', icon: 'Dumbbell' },
  { slug: 'tech', name_he: 'טכנולוגיה ו-AI', icon: 'Cpu' },
  { slug: 'consulting', name_he: 'ייעוץ ופיתוח', icon: 'TrendingUp' },
]

export default function CategoryPills() {
  const activeCategories = useMarketplaceStore((s) => s.activeCategories)
  const setFilter = useMarketplaceStore((s) => s.setFilter)

  const isAllSelected = activeCategories.length === 0

  const toggleCategory = (slug: CategorySlug) => {
    if (activeCategories.includes(slug)) {
      setFilter(
        'activeCategories',
        activeCategories.filter((c) => c !== slug)
      )
    } else {
      setFilter('activeCategories', [...activeCategories, slug])
    }
  }

  const selectAll = () => {
    setFilter('activeCategories', [])
  }

  return (
    <div className="sticky top-16 z-30 bg-white border-b border-gray-100">
      <div className="flex items-center gap-2 px-6 py-3 overflow-x-auto scrollbar-none">
        {/* "All" pill */}
        <button
          onClick={selectAll}
          className="relative shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors"
        >
          {isAllSelected && (
            <motion.div
              layoutId="activePill"
              className="absolute inset-0 bg-brand-500 rounded-full"
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          )}
          <span
            className={`relative z-10 flex items-center gap-1.5 ${
              isAllSelected ? 'text-white' : 'text-gray-700'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            הכל
          </span>
        </button>

        {CATEGORIES.map((cat) => {
          const Icon = ICON_MAP[cat.icon]
          const isActive = activeCategories.includes(cat.slug)

          return (
            <button
              key={cat.slug}
              onClick={() => toggleCategory(cat.slug)}
              className="relative shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors"
            >
              {isActive && (
                <motion.div
                  layoutId="activePill"
                  className="absolute inset-0 bg-brand-500 rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span
                className={`relative z-10 flex items-center gap-1.5 ${
                  isActive
                    ? 'text-white'
                    : 'text-gray-700 hover:bg-gray-100 rounded-full'
                }`}
              >
                {Icon && <Icon className="w-4 h-4" />}
                {cat.name_he}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
