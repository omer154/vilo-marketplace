import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { isCurrentUserAdmin } from '@/lib/supabase/server'
import { checkSameOrigin } from '@/lib/csrf'

export const runtime = 'nodejs'

export const IMPORTS_BUCKET = 'imports'

/** Safe lowercase extension from a filename ("רות גנאל.PDF" → "pdf"). */
function safeExt(fileName: string): string {
  const ext = (fileName.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return ext.length >= 1 && ext.length <= 5 ? ext : 'bin'
}

/**
 * POST { fileName } → { path, token }.
 *
 * Issues a one-time signed upload URL so the browser can upload a file
 * DIRECTLY to Supabase Storage (the `imports` bucket), bypassing Vercel's
 * 4.5MB serverless request-body limit. The object key is a random UUID — the
 * real filename rides separately to /api/admin/extract (used for the supplier
 * hint + type detection). The extract route downloads + deletes the object.
 */
export async function POST(request: NextRequest) {
  const csrfErr = checkSameOrigin(request)
  if (csrfErr) {
    return NextResponse.json({ error: `csrf: ${csrfErr}` }, { status: 403 })
  }
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 })
  }

  const body = (await request.json().catch(() => ({}))) as { fileName?: string }
  const fileName = (body.fileName || '').trim()
  if (!fileName) {
    return NextResponse.json({ error: 'missing fileName' }, { status: 400 })
  }

  const path = `pending/${randomUUID()}.${safeExt(fileName)}`
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data, error } = await admin.storage
    .from(IMPORTS_BUCKET)
    .createSignedUploadUrl(path)
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || 'could not create upload url' },
      { status: 500 }
    )
  }

  return NextResponse.json({ path: data.path, token: data.token })
}
