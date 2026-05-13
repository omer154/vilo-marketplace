'use client'

import { useCallback, useRef } from 'react'
import { Calculator } from 'lucide-react'
import { useMarketplaceStore } from '@/store/marketplaceStore'
import type { LocationMode } from '@/lib/types'

const LOCATION_OPTIONS: { value: LocationMode; label: string }[] = [
  { value: 'at_client', label: 'מגיעים אליכם' },
  { value: 'at_provider', label: 'אצל הספק' },
  { value: 'remote', label: 'מרחוק' },
  { value: 'hybrid', label: 'גמיש' },
]

export default function Sidebar() {
  const totalBudget = useMarketplaceStore((s) => s.totalBudget)
  const participantsCount = useMarketplaceStore((s) => s.participantsCount)
  const locationModes = useMarketplaceStore((s) => s.locationModes)
  const setFilter = useMarketplaceStore((s) => s.setFilter)
  const clearFilters = useMarketplaceStore((s) => s.clearFilters)

  const budgetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const participantsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const budgetPerPerson =
    totalBudget && participantsCount
      ? Math.round(totalBudget / participantsCount)
      : null

  const handleBudgetChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      if (budgetTimerRef.current) clearTimeout(budgetTimerRef.current)
      budgetTimerRef.current = setTimeout(() => {
        setFilter('totalBudget', val ? parseInt(val, 10) : null)
      }, 300)
    },
    [setFilter]
  )

  const handleParticipantsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      if (participantsTimerRef.current)
        clearTimeout(participantsTimerRef.current)
      participantsTimerRef.current = setTimeout(() => {
        setFilter('participantsCount', val ? parseInt(val, 10) : null)
      }, 300)
    },
    [setFilter]
  )

  const toggleLocation = (loc: LocationMode) => {
    if (locationModes.includes(loc)) {
      const next = locationModes.filter((l) => l !== loc)
      if (next.length > 0) setFilter('locationModes', next)
    } else {
      setFilter('locationModes', [...locationModes, loc])
    }
  }

  return (
    <div className="p-5 space-y-6">
      <h3 className="text-sm font-semibold text-gray-900">סינון חכם</h3>

      {/* Total Budget */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">
          תקציב כולל לפעילות (&#8362;)
        </label>
        <input
          type="number"
          min={0}
          step={500}
          placeholder="למשל: 10,000"
          defaultValue={totalBudget ?? ''}
          onChange={handleBudgetChange}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-right outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
        />
      </div>

      {/* Participants */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">
          מספר משתתפים
        </label>
        <input
          type="number"
          min={1}
          placeholder="כמה אנשים?"
          defaultValue={participantsCount ?? ''}
          onChange={handleParticipantsChange}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-right outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
        />
      </div>

      {/* Smart calculation display */}
      {budgetPerPerson && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700">
            <Calculator className="w-3.5 h-3.5" />
            חישוב חכם
          </div>
          <p className="text-sm text-blue-800">
            תקציב לאדם:{' '}
            <span dir="ltr" className="font-semibold">
              &#8362;{budgetPerPerson.toLocaleString('he-IL')}
            </span>
          </p>
          <p className="text-xs text-blue-600">
            מסנן שירותים שמתאימים לתקציב הכולל
          </p>
        </div>
      )}

      {/* Location */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">מיקום</label>
        <div className="space-y-1.5">
          {LOCATION_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={locationModes.includes(opt.value)}
                onChange={() => toggleLocation(opt.value)}
                className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
              />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Clear */}
      <button
        onClick={clearFilters}
        className="text-brand-500 text-sm underline hover:text-brand-600 transition-colors"
      >
        נקה הכל
      </button>
    </div>
  )
}
