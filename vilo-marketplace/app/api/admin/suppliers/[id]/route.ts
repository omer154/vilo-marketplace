import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getCurrentUser } from '@/lib/supabase/server'
import { checkSameOrigin } from '@/lib/csrf'

export const runtime = 'nodejs'

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
    'name',
    'name_en',
    'slug',
    'website',
    'contact_email',
    'description_short',
    'logo_url',
    'cancellation_terms_url',
  ])
  const update: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k)) update[k] = v
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no allowed fields in body' }, { status: 400 })
  }

  // If the admin is changing the slug, make sure another supplier isn't
  // already on that slug. The DB has a UNIQUE constraint on slug, so a
  // collision would 500 with a cryptic message — catching it here lets
  // us return a clean 409 with a useful error.
  if (typeof update.slug === 'string' && update.slug.length > 0) {
    const newSlug = update.slug.trim()
    const { data: clash } = await supabase
      .from('suppliers')
      .select('id')
      .eq('slug', newSlug)
      .neq('id', id)
      .maybeSingle()
    if (clash) {
      return NextResponse.json(
        { error: `slug "${newSlug}" is already used by another supplier` },
        { status: 409 }
      )
    }
    update.slug = newSlug
  }

  // Stamp the editor. updated_at + version bump happen via the
  // suppliers_audit trigger (migration 002).
  update.updated_by = user.id

  const { error } = await supabase.from('suppliers').update(update).eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
