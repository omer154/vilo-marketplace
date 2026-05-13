import { NextResponse } from 'next/server'
import { isCurrentUserAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Lightweight endpoint the public marketplace polls once on mount to
// decide whether to render admin-only affordances (edit pencils on
// cards, an "Edit" button in the modal). Returns boolean only — never
// the user's id or email, so an unauthenticated request just gets
// { isAdmin: false } and proceeds.
export async function GET() {
  const isAdmin = await isCurrentUserAdmin()
  return NextResponse.json({ isAdmin })
}
