import { NextRequest, NextResponse } from 'next/server'
import { isCurrentUserAdmin } from '@/lib/supabase/server'
import { checkSameOrigin } from '@/lib/csrf'
import { importCatalogRows } from '@/lib/import-catalog'
import type { CatalogRow } from '@/lib/extractors/types'

export const runtime = 'nodejs'
// Large catalogs (a topic × several duration tiers) can be 200+ rows. The
// importer parallelizes the per-row upserts, but keep generous headroom.
export const maxDuration = 300

/**
 * POST /api/admin/import — write reviewed catalog rows straight into the DB.
 * Body: { rows: CatalogRow[] }. Returns { success, stats }.
 */
export async function POST(request: NextRequest) {
  const csrfErr = checkSameOrigin(request)
  if (csrfErr) {
    return NextResponse.json({ error: `csrf: ${csrfErr}` }, { status: 403 })
  }
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const rows = body?.rows
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: 'expected { rows: CatalogRow[] }' }, { status: 400 })
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'no rows to import' }, { status: 400 })
  }
  if (rows.length > 2000) {
    return NextResponse.json({ error: 'too many rows in one import (max 2000)' }, { status: 400 })
  }

  try {
    const stats = await importCatalogRows(rows as CatalogRow[])
    return NextResponse.json({ success: true, stats })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('Import route error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
