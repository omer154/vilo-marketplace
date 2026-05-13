import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  createSupabaseServerClient,
  getCurrentUser,
} from '@/lib/supabase/server'

export const runtime = 'nodejs'

const BUCKET = 'supplier-logos'
const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
])

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    default:
      return 'bin'
  }
}

async function requireAdminUser(): Promise<{ id: string } | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error || !data) return null
  return { id: user.id }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin_user = await requireAdminUser()
  if (!admin_user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id: supplierId } = await params

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: 'server misconfigured: missing supabase env vars' },
      { status: 500 }
    )
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file field' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty file' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (${(file.size / 1024 / 1024).toFixed(1)}MB, max 2MB)` },
      { status: 413 }
    )
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported type ${file.type} — use png, jpg, webp, or svg` },
      { status: 415 }
    )
  }

  // Deterministic path so re-uploads overwrite — bucket stays tidy and we
  // don't accumulate orphaned old logos. Cache-buster comes from the URL
  // query param we append below, not from the storage key.
  const ext = extFromMime(file.type)
  const objectPath = `suppliers/${supplierId}/logo.${ext}`

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Verify the supplier exists before writing — avoids leaving orphaned
  // objects in the bucket if an admin opens an edit form for a deleted row.
  const { data: sup, error: supErr } = await admin
    .from('suppliers')
    .select('id')
    .eq('id', supplierId)
    .maybeSingle()
  if (supErr || !sup) {
    return NextResponse.json({ error: 'supplier not found' }, { status: 404 })
  }

  // If a prior upload used a different extension, delete it so we don't
  // keep stale png + jpg side by side after a re-upload.
  const otherExts = ['png', 'jpg', 'webp', 'svg'].filter((e) => e !== ext)
  await admin.storage
    .from(BUCKET)
    .remove(otherExts.map((e) => `suppliers/${supplierId}/logo.${e}`))

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(objectPath, buffer, {
      contentType: file.type,
      upsert: true,
      cacheControl: '3600',
    })
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 })
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath)
  // Cache-buster appended so the EditForm's <img> reloads after re-upload
  // even though the path is stable.
  const logoUrl = `${pub.publicUrl}?v=${Date.now()}`

  const { error: updateErr } = await admin
    .from('suppliers')
    .update({ logo_url: logoUrl, updated_by: admin_user.id })
    .eq('id', supplierId)
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ logo_url: logoUrl })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin_user = await requireAdminUser()
  if (!admin_user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id: supplierId } = await params

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 })
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const allExts = ['png', 'jpg', 'webp', 'svg']
  await admin.storage
    .from(BUCKET)
    .remove(allExts.map((e) => `suppliers/${supplierId}/logo.${e}`))

  const { error: updateErr } = await admin
    .from('suppliers')
    .update({ logo_url: null, updated_by: admin_user.id })
    .eq('id', supplierId)
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
