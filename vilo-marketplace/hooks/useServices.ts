'use client'

import { useState, useEffect, useRef } from 'react'
import { useMarketplaceStore } from '@/store/marketplaceStore'
import type { Service } from '@/lib/types'

export function useServices() {
  const [services, setServices] = useState<Service[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [relaxed, setRelaxed] = useState(false)
  const [strictCount, setStrictCount] = useState(0)

  const activeCategories = useMarketplaceStore((s) => s.activeCategories)
  const totalBudget = useMarketplaceStore((s) => s.totalBudget)
  const participantsCount = useMarketplaceStore((s) => s.participantsCount)
  const locationTypes = useMarketplaceStore((s) => s.locationTypes)
  const searchQuery = useMarketplaceStore((s) => s.searchQuery)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      setIsLoading(true)
      setError(null)
      setRelaxed(false)
      setStrictCount(0)

      try {
        const locationFilter =
          locationTypes.length === 3 || locationTypes.length === 0
            ? null
            : locationTypes.length === 1
              ? locationTypes[0]
              : null

        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: searchQuery || '',
            categories:
              activeCategories.length > 0 ? activeCategories : null,
            total_budget: totalBudget || null,
            participants: participantsCount || null,
            location: locationFilter,
          }),
        })

        if (!res.ok) {
          throw new Error('Search request failed')
        }

        const data = await res.json()
        setRelaxed(data.relaxed || false)
        setStrictCount(data.strictCount || 0)
        setServices(
          (data.results || []).map((row: Record<string, unknown>) => ({
            id: row.id,
            supplier_id: row.supplier_id,
            supplier_name: row.supplier_name,
            supplier_logo_url: row.supplier_logo_url ?? null,
            service_name: row.service_name,
            category_primary: row.category_primary,
            category_secondary: row.category_secondary,
            description_short: row.description_short,
            price: row.price != null ? Number(row.price) : null,
            pricing_unit: row.pricing_unit,
            min_participants: row.min_participants,
            max_participants: row.max_participants,
            duration_minutes: row.duration_minutes,
            location_type: row.location_type || 'onsite',
            location_mode: (row.location_mode as string | null) ?? null,
            language: 'he',
            tags: null,
            notes: row.notes,
            is_active: true,
          }))
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsLoading(false)
      }
    }, 300)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [activeCategories, totalBudget, participantsCount, locationTypes, searchQuery])

  return { services, isLoading, error, total: services.length, relaxed, strictCount }
}
