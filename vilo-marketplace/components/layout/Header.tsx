'use client'

import { Search, Sparkles, Loader2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useMarketplaceStore } from '@/store/marketplaceStore'

export default function Header() {
  const setFilter = useMarketplaceStore((s) => s.setFilter)
  const applyAIFilters = useMarketplaceStore((s) => s.applyAIFilters)
  const openConcierge = useMarketplaceStore((s) => s.openConcierge)
  const [searchValue, setSearchValue] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setSearchValue(value)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setFilter('searchQuery', value)
      }, 300)
    },
    [setFilter]
  )

  const handleAISearch = useCallback(async () => {
    if (!searchValue.trim()) return
    setIsExtracting(true)

    try {
      const res = await fetch('/api/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchValue.trim() }),
      })

      if (res.ok) {
        const intent = await res.json()
        applyAIFilters({
          categories: intent.categories?.length ? intent.categories : undefined,
          total_budget: intent.total_budget ?? undefined,
          participants: intent.participants ?? undefined,
          location: intent.location ?? undefined,
          query: intent.free_query || searchValue.trim(),
          explanation: `חיפוש AI: "${searchValue.trim()}"`,
        })
      } else {
        setFilter('searchQuery', searchValue.trim())
      }
    } catch {
      setFilter('searchQuery', searchValue.trim())
    } finally {
      setIsExtracting(false)
    }
  }, [searchValue, applyAIFilters, setFilter])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAISearch()
      }
    },
    [handleAISearch]
  )

  return (
    <header className="sticky top-0 z-40 h-16 bg-brand-900 text-white">
      <div className="flex items-center h-full px-6 gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center font-bold text-sm">
            V
          </div>
          <span className="text-lg font-semibold tracking-tight">
            Vilo Marketplace
          </span>
        </div>

        {/* AI-Powered Search */}
        <div className="flex-1 max-w-md mx-auto relative">
          {isExtracting ? (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 animate-spin" />
          ) : (
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          )}
          <input
            type="text"
            value={searchValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="חיפוש AI — תארו מה אתם מחפשים ולחצו Enter..."
            className="w-full bg-white/10 border border-white/20 rounded-lg pr-10 pl-4 py-2 text-sm text-white placeholder-gray-400 outline-none focus:bg-white/15 focus:border-white/30 transition-colors text-right"
          />
        </div>

        {/* Concierge Button */}
        <button
          onClick={() => openConcierge()}
          className="shrink-0 flex items-center gap-2 bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          <span>קונסיירז&apos; AI</span>
        </button>
      </div>
    </header>
  )
}
