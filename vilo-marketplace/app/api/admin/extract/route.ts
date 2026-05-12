import { NextRequest, NextResponse } from 'next/server'
import { isCurrentUserAdmin } from '@/lib/supabase/server'
import { extractExcel } from '@/lib/extractors/excel'
import { extractPdf } from '@/lib/extractors/pdf'
import { extractDocx } from '@/lib/extractors/docx'
import { extractUrl } from '@/lib/extractors/url'
import { extractText } from '@/lib/extractors/text'
import { normalizeWithClaude } from '@/lib/extractors/normalize'
import type { ExtractedSource } from '@/lib/extractors/types'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') || ''
  let source: ExtractedSource

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: 'no file in upload' }, { status: 400 })
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      const name = file.name.toLowerCase()

      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        source = extractExcel(buffer, file.name)
      } else if (name.endsWith('.pdf')) {
        source = await extractPdf(buffer, file.name)
      } else if (name.endsWith('.docx') || name.endsWith('.doc')) {
        source = await extractDocx(buffer, file.name)
      } else if (name.endsWith('.txt') || name.endsWith('.csv')) {
        source = extractText(buffer.toString('utf-8'), file.name)
      } else {
        return NextResponse.json(
          { error: `unsupported file type: ${file.name}` },
          { status: 400 }
        )
      }
    } else {
      const body = await request.json()
      if (body.url) {
        source = await extractUrl(body.url)
      } else if (body.text) {
        source = extractText(body.text, body.label || 'pasted text')
      } else {
        return NextResponse.json(
          { error: 'expected { url } or { text } in body' },
          { status: 400 }
        )
      }
    }

    const rows = await normalizeWithClaude(source)
    return NextResponse.json({
      source: {
        source_type: source.source_type,
        source_label: source.source_label,
        raw_rows: source.rows?.length ?? null,
        raw_text_chars: source.raw_text?.length ?? null,
      },
      rows,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('Extract route error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
