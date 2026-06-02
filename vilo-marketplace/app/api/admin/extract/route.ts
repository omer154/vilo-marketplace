import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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
// A multi-page PDF (crawled internally into page windows) can take a while.
export const maxDuration = 300

const IMPORTS_BUCKET = 'imports'

// Each source fans out internally (PDF windows / Excel chunks), so keep the
// number of sources processed at once low to bound total in-flight API calls.
const SOURCE_CONCURRENCY = 2

interface SourceStatus {
  label: string
  status: 'done' | 'error'
  rows: number
  error: string | null
}

/** Drop exact-duplicate rows (same supplier + service + price + capacity) — e.g.
 *  a service that straddled two text chunks and got extracted twice, or appears
 *  in more than one source. Distinct pricing tiers stay (price is in the key). */
function dedupeRows(rows: CatalogRow[]): CatalogRow[] {
  const norm = (s: string | null) =>
    (s ?? '').normalize('NFKC').replace(/[֑-ׇ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const seen = new Set<string>()
  const out: CatalogRow[] = []
  for (const r of rows) {
    // Rows with no name at all have no identity to dedupe on — keep them.
    if (!norm(r.service_name) && !norm(r.supplier_name)) {
      out.push(r)
      continue
    }
    const key = [
      norm(r.supplier_name),
      norm(r.service_name),
      r.price_ils ?? '',
      r.capacity_min ?? '',
      r.capacity_max ?? '',
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
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

/** Turn raw file bytes + a filename into an ExtractedSource (or a parse error).
 *  Works the same whether the bytes came from a multipart upload or were
 *  downloaded from Storage. */
async function buildSourceFromBytes(buf: Buffer, fileName: string): Promise<BuildResult> {
  const label = fileName || 'קובץ ללא שם'
  const ext = (label.split('.').pop() || '').toLowerCase()
  const hint = cleanSupplierHint(label)
  try {
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

interface ParsedInput {
  /** File bytes to extract, each with its original display name. */
  files: { buf: Buffer; fileName: string }[]
  text: string
  urls: string[]
  /** Storage object keys to delete once extraction is done. */
  cleanupPaths: string[]
  /** Sources we already know failed before extraction (e.g. download error). */
  preStatuses: SourceStatus[]
}

/** Read the request body, whether it's JSON (Storage paths — the large-file
 *  path that dodges Vercel's 4.5MB body limit) or multipart/form-data
 *  (back-compat: small files, urls-only, text-only). */
async function parseInput(request: NextRequest): Promise<ParsedInput> {
  const out: ParsedInput = { files: [], text: '', urls: [], cleanupPaths: [], preStatuses: [] }
  const ct = request.headers.get('content-type') || ''

  if (ct.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as {
      storagePaths?: { path: string; fileName: string }[]
      text?: string
      urls?: string
    }
    out.text = (body.text ?? '').trim()
    out.urls = parseUrls(body.urls ?? null)

    const paths = Array.isArray(body.storagePaths) ? body.storagePaths : []
    if (paths.length) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!url || !serviceKey) throw new Error('server misconfigured: missing supabase env vars')
      const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
      for (const sp of paths) {
        if (!sp?.path) continue
        out.cleanupPaths.push(sp.path)
        const fileName = sp.fileName || sp.path.split('/').pop() || 'קובץ'
        const { data, error } = await admin.storage.from(IMPORTS_BUCKET).download(sp.path)
        if (error || !data) {
          out.preStatuses.push({
            label: fileName,
            status: 'error',
            rows: 0,
            error: `לא ניתן לטעון את הקובץ מהאחסון (${error?.message ?? 'unknown'})`,
          })
          continue
        }
        out.files.push({ buf: Buffer.from(await data.arrayBuffer()), fileName })
      }
    }
    return out
  }

  // multipart/form-data
  const form = await request.formData()
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  for (const f of files) {
    out.files.push({ buf: Buffer.from(await f.arrayBuffer()), fileName: f.name })
  }
  out.text = ((form.get('text') as string | null) ?? '').trim()
  out.urls = parseUrls(form.get('urls') as string | null)
  return out
}

/** Best-effort delete of temp upload objects after extraction. */
async function cleanupStorage(paths: string[]) {
  if (!paths.length) return
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) return
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    await admin.storage.from(IMPORTS_BUCKET).remove(paths)
  } catch (e) {
    console.warn('[extract] temp cleanup failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * POST — two shapes:
 *  - JSON  { storagePaths:[{path,fileName}], urls?, text? }  (large files,
 *    uploaded browser→Storage first; we download them here). Preferred.
 *  - multipart/form-data  files / urls / text  (back-compat, small bodies).
 *
 * When URLs are present, the pasted text is folded into each website
 * extraction (so prices etc. sync onto the scraped services).
 * Returns { rows, sources: status[], total }.
 */
export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let cleanupPaths: string[] = []
  try {
    let input: ParsedInput
    try {
      input = await parseInput(request)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'בקשה לא תקינה.' },
        { status: 400 }
      )
    }
    cleanupPaths = input.cleanupPaths
    const { files, text, urls } = input

    if (files.length === 0 && !text && urls.length === 0) {
      return NextResponse.json({ error: 'לא נבחרו קבצים, קישורים או טקסט.' }, { status: 400 })
    }

    const sources: ExtractedSource[] = []
    const statuses: SourceStatus[] = [...input.preStatuses]

    // 1) Files → sources (per-file parse failures recorded, never sink the batch).
    const builtFiles = await Promise.all(files.map((f) => buildSourceFromBytes(f.buf, f.fileName)))
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
          const msg = e instanceof Error ? e.message : 'שגיאת חילוץ'
          console.error(`[extract] source "${source.source_label}" failed: ${msg}`)
          return {
            status: { label: source.source_label, status: 'error', rows: 0, error: msg },
            rows: [],
          }
        }
      }
    )

    for (const r of results) statuses.push(r.status)
    const rows = dedupeRows(results.flatMap((r) => r.rows))

    return NextResponse.json({ rows, sources: statuses, total: rows.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('Extract route error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    await cleanupStorage(cleanupPaths)
  }
}
