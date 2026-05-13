import { NextRequest, NextResponse } from 'next/server'
import { isCurrentUserAdmin, createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isCurrentUserAdmin())) {
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
  ])
  const update: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k)) update[k] = v
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no allowed fields in body' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('suppliers').update(update).eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
