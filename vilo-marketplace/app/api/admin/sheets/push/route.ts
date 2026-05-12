import { NextRequest, NextResponse } from 'next/server'
import { isCurrentUserAdmin } from '@/lib/supabase/server'
import {
  appendCatalogRows,
  SheetsNotConfiguredError,
  getSheetsConfig,
} from '@/lib/sheets'
import type { CatalogRow } from '@/lib/extractors/types'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const rows = body.rows as CatalogRow[] | undefined
    const sourceLabel = (body.source_label as string | undefined) || 'unknown'
    if (!Array.isArray(rows)) {
      return NextResponse.json(
        { error: 'expected { rows: CatalogRow[] }' },
        { status: 400 }
      )
    }

    const result = await appendCatalogRows(rows, sourceLabel)
    return NextResponse.json({
      success: true,
      appended: result.appended,
      url: result.url,
    })
  } catch (err) {
    if (err instanceof SheetsNotConfiguredError) {
      return NextResponse.json(
        {
          error: 'sheets_not_configured',
          message: err.message,
          required_env: [
            'GOOGLE_SERVICE_ACCOUNT_JSON',
            'SHEETS_STAGING_ID',
            'SHEETS_STAGING_TAB',
          ],
        },
        { status: 503 }
      )
    }
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('Sheets push error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const config = getSheetsConfig()
  return NextResponse.json({
    configured: config != null,
    spreadsheetId: config?.spreadsheetId,
    tabName: config?.tabName,
  })
}
