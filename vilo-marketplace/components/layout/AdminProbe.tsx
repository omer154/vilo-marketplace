'use client'

import { useEffect } from 'react'
import { useMarketplaceStore } from '@/store/marketplaceStore'

/** Mounted once at the top of the marketplace tree. Hits /api/admin/me to
 *  decide whether the current viewer is a signed-in admin, and stores
 *  the answer in the marketplace store so cards + modal can render
 *  inline edit affordances. Renders nothing. Failures fall back to
 *  "not an admin" — no toasts, no error UI: anonymous users hit this
 *  every page load. */
export default function AdminProbe() {
  const setIsAdmin = useMarketplaceStore((s) => s.setIsAdmin)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/me')
      .then((r) => (r.ok ? r.json() : { isAdmin: false }))
      .then((j) => {
        if (!cancelled) setIsAdmin(Boolean(j.isAdmin))
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [setIsAdmin])

  return null
}
