import { NextResponse } from 'next/server'
import { isCurrentUserAdmin } from '@/lib/supabase/server'
import { syncApprovedRows } from '@/lib/sync'
import { SheetsNotConfiguredError } from '@/lib/sheets'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const stats = await syncApprovedRows()
    return NextResponse.json({ success: true, stats })
  } catch (err) {
    if (err instanceof SheetsNotConfiguredError) {
      return NextResponse.json(
        { error: 'sheets_not_configured', message: err.message },
        { status: 503 }
      )
    }
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('Sync route error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
