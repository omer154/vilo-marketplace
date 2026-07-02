import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { isCurrentUserAdmin } from '@/lib/supabase/server'
import { servicesToXlsx, type ExportRow } from '@/lib/export-services-xlsx'

export const runtime = 'nodejs'
export const maxDuration = 60

const SELECT =
  'service_name, category_primary, category_secondary, price, price_min, price_max, pricing_unit, price_type, min_participants, max_participants, duration_minutes, location_mode, location_type, description_short, notes, is_active, supplier_id, suppliers(name)'

type Raw = Omit<ExportRow, 'supplier_name'> & {
  supplier_id: string
  suppliers: { name: string } | null
}

/** PostgREST caps rows per request (~1000); page through everything. */
async function fetchAll(
  sb: SupabaseClient,
  supplierId: string | null,
  includeInactive: boolean
): Promise<Raw[]> {
  const out: Raw[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('services').select(SELECT)
    if (supplierId) q = q.eq('supplier_id', supplierId)
    if (!includeInactive) q = q.eq('is_active', true)
    // Deterministic within a supplier; cross-supplier order fixed in JS below.
    q = q
      .order('supplier_id', { ascending: true })
      .order('category_primary', { ascending: true })
      .order('service_name', { ascending: true })
      .range(from, from + PAGE - 1)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const batch = (data as unknown as Raw[]) || []
    out.push(...batch)
    if (batch.length < PAGE) break
  }
  return out
}

function fname(name: string): string {
  // ASCII fallback + UTF-8 for Hebrew filenames.
  return `attachment; filename="services.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * GET /api/admin/services/export
 *   ?supplier=<id>  — one supplier's services (else all).
 *   ?active=all     — include inactive (default: active only, as marketplace).
 * Returns an RTL .xlsx, ordered supplier → category → service name.
 */
export async function GET(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 })
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const supplierId = request.nextUrl.searchParams.get('supplier')
  const includeInactive = request.nextUrl.searchParams.get('active') === 'all'

  let raw: Raw[]
  try {
    raw = await fetchAll(sb, supplierId, includeInactive)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'export failed' },
      { status: 500 }
    )
  }

  const rows: ExportRow[] = raw.map((r) => ({ ...r, supplier_name: r.suppliers?.name ?? null }))
  // Marketplace grouping: supplier name → category → service name.
  rows.sort(
    (a, b) =>
      (a.supplier_name ?? '').localeCompare(b.supplier_name ?? '', 'he') ||
      (a.category_primary ?? '').localeCompare(b.category_primary ?? '', 'he') ||
      (a.service_name ?? '').localeCompare(b.service_name ?? '', 'he')
  )

  const supplierName = supplierId ? rows[0]?.supplier_name ?? 'ספק' : null
  const buf = servicesToXlsx(rows, supplierName ? supplierName.slice(0, 28) : 'כל השירותים')
  const label = supplierName ? `שירותים - ${supplierName}` : 'שירותים - כל הספקים'

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': fname(`${label}.xlsx`),
      'Cache-Control': 'no-store',
    },
  })
}
