import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient, getCurrentUser } from '@/lib/supabase/server'
import { checkSameOrigin } from '@/lib/csrf'

export const runtime = 'nodejs'

// PATCH /api/admin/services/[id] — update a single service.
// Body: { is_active?: boolean, price?: number, ... } — only sets the
// fields present in the body. RLS makes sure only authenticated admins
// can update.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfErr = checkSameOrigin(request)
  if (csrfErr) {
    return NextResponse.json({ error: `csrf: ${csrfErr}` }, { status: 403 })
  }
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = await createSupabaseServerClient()
  const { data: adminRow, error: adminErr } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (adminErr || !adminRow) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const ALLOWED = new Set([
    'is_active',
    'price',
    'price_min',
    'price_max',
    'price_type',
    'pricing_unit',
    'min_participants',
    'max_participants',
    'duration_minutes',
    'location_mode',
    'category_primary',
    'category_secondary',
    'service_name',
    'description_short',
    'notes',
  ])
  const update: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k)) update[k] = v
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no allowed fields in body' }, { status: 400 })
  }

  // Stamp the editor. updated_at + version bump happen via the
  // services_audit trigger (migration 002).
  update.updated_by = user.id

  const { error } = await supabase.from('services').update(update).eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

// DELETE /api/admin/services/[id] — permanently remove a single service.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfErr = checkSameOrigin(request)
  if (csrfErr) {
    return NextResponse.json({ error: `csrf: ${csrfErr}` }, { status: 403 })
  }
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = await createSupabaseServerClient()
  const { data: adminRow, error: adminErr } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (adminErr || !adminRow) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 })
  }
  // Service-role client so the delete isn't blocked by a missing RLS delete policy.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { error } = await admin.from('services').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
