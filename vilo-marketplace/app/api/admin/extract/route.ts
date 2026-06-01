import { NextRequest, NextResponse } from 'next/server'
import { isCurrentUserAdmin } from '@/lib/supabase/server'
import { extractExcel } from '@/lib/extractors/excel'
import { extractPdf } from '@/lib/extractors/pdf'
import { extractDocx } from '@/lib/extractors/docx'
import { extractText } from '@/lib/extractors/text'
import { extractUrl } from '@/lib/extractors/url'
import { extractImage, imageMediaType } from '@/lib/extractors/image'
import { normalizeWithClaude } from '@/lib/extractors/normalize'
import type { CatalogRow, ExtractedSource } from '@/lib/extractors/types'

export const runtime = 'nodejs'
// A batch of several multi-page PDFs / crawled sites can take a while.
export const maxDuration = 300

// Each source fans out internally (PDF windows / Excel chunks), so keep the
// number of sources processed at once low to bound total in-flight API calls.
const SOURCE_CONCURRENCY = 2

interface SourceStatus {
  label: string
  status: 'done' | 'error'
  rows: number
  error: string | null
}

/** Bounded-concurrency map (index order preserved). */
async function pMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) break
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/** Derive a supplier-name hint from a filename ("רות-גנאל.pdf" → "רות גנאל"). */
function cleanSupplierHint(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
}

function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u)
    return p.protocol === 'http:' || p.protocol === 'https:'
  } catch {
    return false
  }
}

/** Split the urls field (newline/comma/space separated) into valid http URLs. */
function parseUrls(raw: string | null): string[] {
  if (!raw) return []
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ).filter(isHttpUrl)
}

type BuildResult = { label: string; source?: ExtractedSource; error?: string }

/** Turn one uploaded file into an ExtractedSource, or record a parse error. */
async function buildFileSource(file: File): Promise<BuildResult> {
  const label = file.name || 'קובץ ללא שם'
  const ext = (label.split('.').pop() || '').toLowerCase()
  const hint = cleanSupplierHint(label)
  try {
    const buf = Buffer.from(await file.arrayBuffer())

    if (ext === 'xlsx' || ext === 'xls') {
      return { label, source: { ...extractExcel(buf, label), supplier_hint: hint } }
    }
    if (ext === 'pdf') {
      return { label, source: { ...(await extractPdf(buf, label)), supplier_hint: hint } }
    }
    if (ext === 'docx' || ext === 'doc') {
      return { label, source: { ...(await extractDocx(buf, label)), supplier_hint: hint } }
    }
    if (ext === 'csv' || ext === 'txt') {
      return { label, source: { ...extractText(buf.toString('utf8'), label), supplier_hint: hint } }
    }
    const media = imageMediaType(ext)
    if (media) {
      return { label, source: { ...extractImage(buf, label, media), supplier_hint: hint } }
    }
    return { label, error: `סוג קובץ לא נתמך: .${ext}` }
  } catch (e) {
    return { label, error: e instanceof Error ? e.message : 'שגיאת קריאת קובץ' }
  }
}

/**
 * POST (multipart/form-data): `files` (0..N) + `urls` (optional, newline-sep)
 * + `text` (optional). When URLs are present, the pasted text is folded into
 * each website extraction (so prices etc. sync onto the scraped services).
 * Returns { rows: CatalogRow[], sources: status[], total } — every source's
 * rows merged, ready for the admin to review and import.
 */
export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'בקשה לא תקינה (נדרש multipart/form-data).' }, { status: 400 })
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  const text = ((form.get('text') as string | null) ?? '').trim()
  const urls = parseUrls(form.get('urls') as string | null)

  if (files.length === 0 && !text && urls.length === 0) {
    return NextResponse.json({ error: 'לא נבחרו קבצים, קישורים או טקסט.' }, { status: 400 })
  }

  const sources: ExtractedSource[] = []
  const statuses: SourceStatus[] = []

  // 1) Files → sources (per-file parse failures recorded, never sink the batch).
  const builtFiles = await Promise.all(files.map(buildFileSource))
  for (const b of builtFiles) {
    if (b.source) sources.push(b.source)
    else statuses.push({ label: b.label, status: 'error', rows: 0, error: b.error ?? 'שגיאה' })
  }

  // 2) URLs → sources. The pasted text rides along as supplementary context
  //    (website↔text sync) so prices not on the page still land on the rows.
  const builtUrls = await Promise.all(
    urls.map(async (u): Promise<BuildResult> => {
      try {
        const source = await extractUrl(u)
        if (text) source.supplementary_text = text
        return { label: u, source }
      } catch (e) {
        return { label: u, error: e instanceof Error ? e.message : 'שגיאת קריאת אתר' }
      }
    })
  )
  let urlSourceCount = 0
  for (const b of builtUrls) {
    if (b.source) {
      sources.push(b.source)
      urlSourceCount++
    } else {
      statuses.push({ label: b.label, status: 'error', rows: 0, error: b.error ?? 'שגיאה' })
    }
  }

  // 3) Pasted text → its own source ONLY when it wasn't folded into a website.
  if (text && urlSourceCount === 0) sources.push(extractText(text, 'טקסט שהודבק'))

  if (sources.length === 0) {
    return NextResponse.json({ rows: [], sources: statuses, total: 0 })
  }

  // Extract every source concurrently; per-source failures captured, not thrown.
  const results = await pMap(
    sources,
    SOURCE_CONCURRENCY,
    async (source): Promise<{ status: SourceStatus; rows: CatalogRow[] }> => {
      try {
        const rows = await normalizeWithClaude(source)
        return {
          status: { label: source.source_label, status: 'done', rows: rows.length, error: null },
          rows,
        }
      } catch (e) {
        return {
          status: {
            label: source.source_label,
            status: 'error',
            rows: 0,
            error: e instanceof Error ? e.message : 'שגיאת חילוץ',
          },
          rows: [],
        }
      }
    }
  )

  for (const r of results) statuses.push(r.status)
  const rows = results.flatMap((r) => r.rows)

  return NextResponse.json({ rows, sources: statuses, total: rows.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('Extract route error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
