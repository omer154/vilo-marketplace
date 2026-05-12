/**
 * Multi-pass extractor for messy unstructured docs (PDFs primarily).
 *
 * Section-as-unit, not service-as-unit. Three rounds of service-stub
 * extraction kept losing entire services (Pass A's outline missed them,
 * so Pass B never saw them). The new flow asks Pass A only for SECTION
 * BOUNDARIES — header + page range — which are coarse and hard to miss.
 * Then ONE Pass B call per section extracts every service + every
 * pricing tier in that page range.
 *
 *   Pass A — outlineSections(): tiny call, ~500 tokens out. Just sections.
 *   Pass B — expandSection(): one call per section. Sliced PDF, "extract
 *            every service and every pricing tier in this section."
 *            Category for all rows is pinned in JS from the canonical
 *            section header.
 *   Pass C — mergeAndValidate(): pure JS, dedupe, average confidence.
 *
 * Confidence: every Pass B row carries a per-field 1-5 score so the
 * Sheet shows red/yellow/green.
 */

import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import type { CatalogRow, ConfidenceScore } from './types'
import { CATALOG_COLUMNS } from './types'

const OUTLINE_MODEL = 'claude-sonnet-4-6' // small output, accuracy matters
const EXPAND_MODEL = 'claude-haiku-4-5'   // bigger volume, cheap+fast
const EXPAND_CONCURRENCY = 3              // 3 sections in parallel; safe for 8K OPM tier
const EXPAND_MAX_TOKENS = 8000
const OUTLINE_MAX_TOKENS = 2048

interface DocSection {
  header: string
  page_start: number  // 1-indexed inclusive
  page_end: number    // 1-indexed inclusive
}

interface DocOutline {
  sections: DocSection[]
}

const OUTLINE_SYSTEM = `אתה סורק מסמך ספק של Vilo Marketplace ומחזיר את חלוקת הסקציות בלבד.

לכל סקציה החזר:
- header: כותרת הסקציה verbatim כפי שמופיעה במסמך (לדוגמה "מתנות לעובדים", "פעילות לזוגות"). אסור לסכם, לקצר או לרענן.
- page_start: העמוד שבו הכותרת מופיעה במסמך. חובה — חייב להיות העמוד עם הכותרת עצמה. אם הכותרת באמצע עמוד 3, page_start = 3.
- page_end: העמוד האחרון שמכיל תוכן השייך לסקציה (1-indexed, כולל)

כללים קריטיים:
- page_start חייב להיות העמוד עם הכותרת — לא העמוד הראשון של הטבלה. אם בעמוד 1 יש את הכותרת וטבלת המחירים ממשיכה לעמוד 3, page_start = 1, page_end = 3.
- אל תיצור רשימת שירותים. רק סקציות (כותרות גדולות במסמך).
- מסמך טיפוסי בעל 3-7 סקציות.
- שני סקציות יכולות לחלוק עמוד (סקציה A מסתיימת בעמוד 3, סקציה B מתחילה בעמוד 3 → page_start=3 לסקציה B). זה תקין.`

const EXPAND_SYSTEM = `אתה מחלץ את כל השירותים בסקציה אחת ממסמך ספק של Vilo Marketplace.

המסמך שצורף מכיל את העמודים של הסקציה (יכול להכיל גם תוכן של סקציות שכנות — התעלם ממנו).
שם הסקציה ייאמר בהודעת המשתמש — חלץ רק שירותים שייכים לסקציה הזו.

הוראות חילוץ:
- חלץ כל שירות שמופיע בסקציה.
- חובה: לכל שירות עם מדרגות תמחור מרובות — צור שורה לכל מדרגה.
  דוגמאות:
    * "₪500 לשעה במפגש בודד / ₪4800 לבנק של 10 שעות / ₪9000 לבנק של 20 שעות" → 3 שורות.
    * "אם במקום העבודה: ₪650 לשעה / ₪6200 ל-10 שעות / ₪12,000 ל-20 שעות" → עוד 3 שורות (סך הכל 6).
    * "מפגש בודד ₪3000 / סדרה של 3 מפגשים ₪7000" → 2 שורות.
- שמור טקסט בעברית verbatim. אל תתרגם.
- price_type: 'fixed' למחיר בודד, 'range' לטווח, 'on_request' אם אין מחיר ספציפי.

שדה location_mode — חובה למלא בכל שורה. אל תחזיר null:
- at_provider = במתחם של הספק (קליניקה / סטודיו / מתקן של הספק)
- at_client = במשרד / במתחם של הלקוח / במקום העבודה
- remote = מקוון (זום וכו')
- hybrid = יכול להתקיים בשתיהן

ברירת מחדל אם לא ברור במסמך:
- הרצאות / סדנאות / פעילויות לעובדי הארגון → at_client (הספק מגיע למקום העבודה)
- שירותי ייעוץ פרטני "בקליניקה" → at_provider
- שירותי ייעוץ פרטני "במקום העבודה" → at_client
- מוצרים פיזיים / מתנות (משחקים, ערכות) → at_client (העובדים מקבלים אותם בעבודה)

confidence (1-5):
- 5 = הערך מפורש במסמך
- 4 = ברור מהקשר
- 3 = הסקת הגיוני
- 2 = השערה
- 1 = ניחוש (במיוחד אם השתמשת בברירת מחדל)

- supplier_notes: כל מידע נוסף — מע"מ, נסיעות, יחידת תמחור, הערות תמחיר, מספר מפגשים.`

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withRateLimitRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const e = err as { status?: number; headers?: Record<string, string> }
    if (e?.status !== 429) throw err
    const retryAfter = Number(e.headers?.['retry-after']) || 60
    const waitMs = Math.min(retryAfter * 1000 + 1000, 65_000)
    console.warn(`[${label}] Anthropic 429 — sleeping ${waitMs}ms then retrying once.`)
    await sleep(waitMs)
    return await fn()
  }
}

async function pMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++
        if (i >= items.length) break
        results[i] = await fn(items[i], i)
      }
    }
  )
  await Promise.all(workers)
  return results
}

/** Slice a PDF buffer to a page range (inclusive, 1-indexed). */
async function slicePdfPages(
  buffer: Buffer,
  startPage: number,
  endPage: number
): Promise<Buffer> {
  const src = await PDFDocument.load(buffer)
  const total = src.getPageCount()
  const start = Math.max(0, startPage - 1)
  const end = Math.min(total, endPage)
  const dst = await PDFDocument.create()
  const indices = Array.from({ length: end - start }, (_, i) => start + i)
  const pages = await dst.copyPages(src, indices)
  pages.forEach((p) => dst.addPage(p))
  const bytes = await dst.save()
  return Buffer.from(bytes)
}

// ──────────────────────────────────────────────────────────────────────
// Pass A — section outline (just boundaries, no services)
// ──────────────────────────────────────────────────────────────────────

async function outlineSections(
  client: Anthropic,
  pdfBuffer: Buffer,
  label: string,
  totalPages: number
): Promise<DocOutline> {
  const response = await withRateLimitRetry(
    () =>
      client.messages.create({
        model: OUTLINE_MODEL,
        max_tokens: OUTLINE_MAX_TOKENS,
        system: OUTLINE_SYSTEM,
        tools: [
          {
            name: 'submit_outline',
            description: 'Submit the section boundaries found in the document.',
            input_schema: {
              type: 'object',
              properties: {
                sections: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      header: { type: 'string' },
                      page_start: { type: 'integer' },
                      page_end: { type: 'integer' },
                    },
                    required: ['header', 'page_start', 'page_end'],
                  },
                },
              },
              required: ['sections'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'submit_outline' },
        messages: [
          {
            role: 'user',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdfBuffer.toString('base64'),
                },
              },
              {
                type: 'text',
                text: `מקור: ${label} (${totalPages} עמודים)\n\nזהה את הסקציות וטווחי העמודים שלהן.`,
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ] as any,
          },
        ],
      }),
    'outline'
  )

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(`Outline: no tool use. stop_reason=${response.stop_reason}`)
  }
  const input = toolUse.input as { sections?: DocSection[] }
  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    // Fallback: treat whole doc as one section.
    console.warn('[outline] no sections returned — falling back to whole-doc as one section')
    return {
      sections: [{ header: label, page_start: 1, page_end: totalPages }],
    }
  }

  // Clamp page ranges to actual doc and ensure start<=end.
  const sections = input.sections
    .map((s) => ({
      header: String(s.header || '').trim(),
      page_start: Math.max(1, Math.min(totalPages, s.page_start)),
      page_end: Math.max(1, Math.min(totalPages, s.page_end)),
    }))
    .filter((s) => s.header.length > 0 && s.page_start <= s.page_end)

  console.log(
    `[outline] ${sections.length} sections:`,
    sections.map((s) => `"${s.header}" (p${s.page_start}-${s.page_end})`).join(', ')
  )
  return { sections }
}

// ──────────────────────────────────────────────────────────────────────
// Pass B — expand one section into all its rows
// ──────────────────────────────────────────────────────────────────────

interface RowWithConfidence extends CatalogRow {
  _confidence?: CatalogRow['_confidence']
}

async function expandSection(
  client: Anthropic,
  pdfBuffer: Buffer,
  section: DocSection,
  label: string,
  totalPages: number,
  padding = 1
): Promise<RowWithConfidence[]> {
  // ±padding pages of context. Pass A often reports the page range where
  // the content sits but misses the page where the section TITLE appears,
  // and without the title Haiku can't anchor what it's reading.
  const start = Math.max(1, section.page_start - padding)
  const end = Math.min(totalPages, section.page_end + padding)
  const slicedBuffer = await slicePdfPages(pdfBuffer, start, end)
  const tag = `section:${section.header.slice(0, 30)}`
  console.log(
    `[${tag}] attempt with pages ${start}-${end} (Pass A said ${section.page_start}-${section.page_end}, +${padding} padding) — ${slicedBuffer.length} bytes`
  )

  const response = await withRateLimitRetry(
    () =>
      client.messages.create({
        model: EXPAND_MODEL,
        max_tokens: EXPAND_MAX_TOKENS,
        system: EXPAND_SYSTEM,
        tools: [
          {
            name: 'submit_section_rows',
            description:
              'Submit all catalog rows for the section. Multiple pricing tiers of one service = multiple rows.',
            input_schema: {
              type: 'object',
              properties: {
                rows: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: Object.fromEntries(
                      CATALOG_COLUMNS.map((col) => [
                        col,
                        col === 'price_ils' ||
                        col === 'price_min' ||
                        col === 'price_max' ||
                        col === 'capacity_min' ||
                        col === 'capacity_max' ||
                        col === 'duration_hours'
                          ? { type: ['number', 'integer', 'null'] }
                          : col === 'price_type'
                          ? {
                              type: ['string', 'null'],
                              enum: ['fixed', 'on_request', 'range', null],
                            }
                          : col === 'location_mode'
                          ? {
                              // No null in the enum — force the model to choose.
                              type: 'string',
                              enum: [
                                'at_client',
                                'at_provider',
                                'remote',
                                'hybrid',
                              ],
                            }
                          : { type: ['string', 'null'] },
                      ])
                    ),
                    additionalProperties: false,
                  },
                },
                confidence: {
                  type: 'array',
                  description:
                    'One confidence object per row, same indexing as rows.',
                  items: {
                    type: 'object',
                    properties: Object.fromEntries(
                      CATALOG_COLUMNS.map((col) => [
                        col,
                        { type: ['integer', 'null'], enum: [1, 2, 3, 4, 5, null] },
                      ])
                    ),
                    additionalProperties: false,
                  },
                },
              },
              required: ['rows', 'confidence'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'submit_section_rows' },
        messages: [
          {
            role: 'user',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: slicedBuffer.toString('base64'),
                },
              },
              {
                type: 'text',
                text:
                  `מקור: ${label} (סקציה "${section.header}", עמודים ${start}-${end})\n\n` +
                  `חלץ את כל השירותים בסקציה "${section.header}".\n` +
                  `כל מדרגת תמחור / וריאציה = שורה נפרדת.\n` +
                  `חובה למלא location_mode בכל שורה (בחר אחד מ-at_client / at_provider / remote / hybrid — אסור null).`,
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ] as any,
          },
        ],
      }),
    tag
  )

  console.log(
    `[${tag}] response stop_reason=${response.stop_reason}, blocks=[${response.content.map((c) => c.type).join(',')}]`
  )

  if (response.stop_reason === 'max_tokens') {
    console.warn(`[${tag}] hit max_tokens — output may be partial`)
  }

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    console.warn(`[${tag}] no tool_use block returned`)
    return []
  }
  const input = toolUse.input as {
    rows?: CatalogRow[]
    confidence?: Partial<Record<keyof CatalogRow, ConfidenceScore>>[]
  }
  if (!Array.isArray(input.rows)) {
    console.warn(
      `[${tag}] tool_use.input.rows missing or not array. input keys: [${Object.keys(input || {}).join(',')}]`
    )
    return []
  }

  console.log(`[${tag}] ${input.rows.length} rows`)

  return input.rows.map((row, i) => ({
    ...row,
    _confidence: input.confidence?.[i],
  }))
}

/**
 * Section-level retry. If the first attempt returned 0 rows (usually because
 * Pass A's page range missed where the section header lives), retry with
 * wider padding (+2 pages) to almost-guarantee the header is in the slice.
 */
async function expandSectionWithRetry(
  client: Anthropic,
  pdfBuffer: Buffer,
  section: DocSection,
  label: string,
  totalPages: number
): Promise<RowWithConfidence[]> {
  const first = await expandSection(client, pdfBuffer, section, label, totalPages, 1)
  if (first.length > 0) return first

  console.warn(
    `[section:${section.header.slice(0, 30)}] returned 0 rows — retrying with wider page window`
  )
  return expandSection(client, pdfBuffer, section, label, totalPages, 3)
}

// ──────────────────────────────────────────────────────────────────────
// Pass C — merge + validate
// ──────────────────────────────────────────────────────────────────────

function computeConfidenceAvg(
  conf: Partial<Record<keyof CatalogRow, ConfidenceScore>> | undefined
): ConfidenceScore | undefined {
  if (!conf) return undefined
  const vals = Object.values(conf).filter(
    (v): v is ConfidenceScore => v !== null && v !== undefined
  )
  if (vals.length === 0) return undefined
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length
  return Math.round(avg) as ConfidenceScore
}

function rowKey(r: CatalogRow): string {
  // Category included so same-named services from different PDF sections
  // don't collapse. location_mode included so the same service at different
  // venues stays as separate rows.
  return [
    r.supplier_name,
    r.supplier_category,
    r.service_name,
    r.price_ils,
    r.capacity_min,
    r.capacity_max,
    r.location_mode,
  ]
    .map((v) => (v == null ? '' : String(v)))
    .join('|')
    .toLowerCase()
}

export function mergeAndValidate(rows: RowWithConfidence[]): CatalogRow[] {
  const seen = new Map<string, CatalogRow>()
  for (const row of rows) {
    if (!row.service_name) continue
    const key = rowKey(row)
    if (seen.has(key)) continue
    const merged: CatalogRow = {
      ...row,
      _confidence_avg: computeConfidenceAvg(row._confidence),
    }
    seen.set(key, merged)
  }
  return Array.from(seen.values())
}

/** Force every row's supplier_category to the canonical section header. */
function pinCategory(
  rows: RowWithConfidence[],
  sectionHeader: string
): RowWithConfidence[] {
  return rows.map((r) => ({ ...r, supplier_category: sectionHeader }))
}

// ──────────────────────────────────────────────────────────────────────
// Public entry
// ──────────────────────────────────────────────────────────────────────

export async function multipassPdf(
  client: Anthropic,
  pdfBuffer: Buffer,
  label: string
): Promise<CatalogRow[]> {
  const totalPages = (await PDFDocument.load(pdfBuffer)).getPageCount()
  console.log(`[multipass] "${label}" (${totalPages} pages)`)

  const outline = await outlineSections(client, pdfBuffer, label, totalPages)
  if (outline.sections.length === 0) return []

  const expanded = await pMap(
    outline.sections,
    EXPAND_CONCURRENCY,
    async (section) => {
      const rows = await expandSectionWithRetry(
        client,
        pdfBuffer,
        section,
        label,
        totalPages
      )
      return pinCategory(rows, section.header)
    }
  )

  const merged = mergeAndValidate(expanded.flat())
  console.log(
    `[multipass] "${label}" -> ${merged.length} unique rows across ${outline.sections.length} sections`
  )
  return merged
}
