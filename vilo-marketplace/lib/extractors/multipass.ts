/**
 * Multi-pass extractor for messy unstructured docs (PDFs primarily).
 *
 * The single-call approach fails when a doc describes many services with
 * many pricing tiers each — output blows past max_tokens, or rate limits
 * cap the per-minute output. This module breaks the work into many small
 * Claude calls, each scoped to a single service:
 *
 *   Pass A (outline):   1 call. "What services exist? Give me name + page
 *                        + section header." Tiny output (~1K tokens).
 *   Pass B (expand):    N calls, parallel-capped. For each stub, slice
 *                        the PDF to a ±1-page window and ask Claude to
 *                        emit all pricing-tier rows for that service.
 *                        Each output is small (~1-2K tokens), so rate
 *                        limits stop biting.
 *   Pass C (validate):  pure JS — dedupe near-identical rows, average
 *                        confidence, fill defaults.
 *
 * Confidence scoring: every Pass B call also returns a per-field 1-5
 * score so the Sheet can surface red/yellow/green dots for review.
 */

import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import type { CatalogRow, ConfidenceScore } from './types'
import { CATALOG_COLUMNS } from './types'

const OUTLINE_MODEL = 'claude-sonnet-4-6' // small output, accuracy matters
const EXPAND_MODEL = 'claude-haiku-4-5'   // bigger volume, cheap+fast
const EXPAND_CONCURRENCY = 4
const EXPAND_MAX_TOKENS = 4096
const OUTLINE_MAX_TOKENS = 4096

interface ServiceStub {
  service_name: string
  page_number: number       // 1-indexed
  section_index: number     // points into outline.sections[]
  preview: string | null
  expected_row_count: number
}

interface DocOutline {
  sections: string[]        // ordered, verbatim, distinct section headers from the PDF
  stubs: ServiceStub[]
}

const OUTLINE_SYSTEM = `אתה סורק מסמך ספק של Vilo Marketplace ומפיק שני פלטים:

1. sections: רשימה מסודרת של כל כותרות הסקציות במסמך, כפי שהן מופיעות בדיוק.
   - שמור על הטקסט verbatim — בלי לערוך, בלי להוסיף, בלי לקצר.
   - כל סקציה מופיעה פעם אחת בלבד, גם אם יש בה כמה שירותים.
   - דוגמה למסמך טיפוסי: ["מתנות לעובדים", "פעילות לזוגות", "פעילות להורים לילדים צעירים", "פעילות להורים למתבגרים (גלאי 12-18)", "פעילות לצוותים/ לעובדים"]

2. stubs: רשימה של השירותים במסמך. כל stub:
   - service_name: שם השירות כפי שמופיע במסמך
   - page_number: העמוד שבו השירות מתחיל (1-indexed)
   - section_index: index לתוך sections[] (0-based). זו הקטגוריה של השירות הזה.
   - preview: משפט אחד שמתאר את השירות
   - expected_row_count: כמה שורות שלב הבא צפוי להחזיר. ספור מדרגות תמחור / וריאציות נפרדות:
       * מחיר אחד = 1
       * 6 רמות (3 בקליניקה + 3 במקום העבודה) = 6
       * "בשבילנו" עם מפגש בודד וסדרה = 2
       * אם השירות אומר "ראה תמחור X" → ספור את אותן וריאציות

כללים קריטיים:
- אל תיצור שורות נפרדות פר מדרגת תמחור — זה לשלב הבא. שירות אחד = stub אחד.
- אל תמציא כותרות סקציה. אם השם בדיוק "מתנות לעובדים" — תחזיר אותו כך, לא "פעילויות לרווחת עובדים".
- כל stub חייב לקבל section_index. אם השירות מופיע באותה סקציה כמו שירות אחר — חייבים אותו section_index.
- שירותים עם אותו שם בסקציות שונות (למשל "יעוץ פרטני להורים" גם בסקציית הילדים הצעירים וגם בסקציית המתבגרים) הם stubs נפרדים עם section_index שונים.`

const EXPAND_SYSTEM = `אתה מחלץ פרטים מלאים של שירות בודד מתוך מסמך ספק.

המסמך שצורף מכיל עמוד אחד או שניים — מיקדנו את התשומה כדי לחסוך טוקנים.
המשתמש כבר זיהה איזה שירות לחלץ; המידע יופיע בהודעה.

הוראות:
- צור שורה נפרדת לכל מדרגת תמחור או וריאציה (מחיר שונה / כמות אנשים שונה / מיקום שונה / חבילת שעות).
- חובה: אם המשתמש אומר "אני מצפה ל-N שורות", מצא בדיוק N וריאציות. אל תאחד אותן לשורה אחת.
- שמור טקסט בעברית verbatim. אל תתרגם.
- price_type: 'fixed' למחיר בודד, 'range' לטווח, 'on_request' אם אין מחיר ספציפי.

שדה location_mode — חובה למלא בכל שורה. אל תחזיר null אלא אם באמת אין שום רמז:
- at_provider = במתחם של הספק (קליניקה / סטודיו / מתקן של הספק)
- at_client = במשרד / במתחם של הלקוח (עובדי הארגון)
- remote = מקוון (זום וכו')
- hybrid = יכול להתקיים בשתיהן, לפי בחירה

דוגמאות (חובה לעקוב!):
- "בקליניקה שלי" / "בקליניקה בגבעת שמואל" / "בקליניקה" → at_provider
- "במקום העבודה" / "במשרד" / "בחצרי הלקוח" / "אצל הלקוח" → at_client
- שורה שמדברת על "מפגש בודד" בלי ציון מקום, אבל יש לה שורה אחרת מפורשת על "במקום העבודה" — אז הראשונה היא at_provider (ברירת המחדל לעובדה הזו).
- הרצאה לעובדים שלא ציינו איפה — בדרך כלל at_client (המרצה מגיע למקום העבודה).
- שיעור עם שני מחירים, אחד "אצל הספק" ואחד "אצל הלקוח" → שתי שורות נפרדות, אחת at_provider ואחת at_client.
- "ניתן לקיים אצלכם או אצלנו" → hybrid
- "בזום" / "מקוון" / "אונליין" → remote

חובה: 95% מהשורות חייבות location_mode לא-null. null זה רק כשבאמת אין שום מידע מהקשר.

- supplier_notes: כל מידע שלא נכנס לשדות אחרים — מע"מ, נסיעות, יחידת תמחור, תיאור התמחיר.
- confidence (לכל שדה): 5 = קראתי בדיוק מהמסמך, 3 = הסקתי הגיוני, 1 = ניחוש.`

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
// Pass A — outline scan
// ──────────────────────────────────────────────────────────────────────

async function outlineScanPdf(
  client: Anthropic,
  pdfBuffer: Buffer,
  label: string
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
            description:
              'Submit the sections and stubs found in the document. Sections is the canonical list of section headers; each stub references one section by index.',
            input_schema: {
              type: 'object',
              properties: {
                sections: {
                  type: 'array',
                  description:
                    'Ordered list of distinct section headers in the document, verbatim.',
                  items: { type: 'string' },
                },
                stubs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      service_name: { type: 'string' },
                      page_number: { type: 'integer' },
                      section_index: {
                        type: 'integer',
                        description:
                          '0-based index into sections[]. The section this service belongs to.',
                      },
                      preview: { type: ['string', 'null'] },
                      expected_row_count: { type: 'integer' },
                    },
                    required: [
                      'service_name',
                      'page_number',
                      'section_index',
                      'expected_row_count',
                    ],
                  },
                },
              },
              required: ['sections', 'stubs'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'submit_outline' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: [
          {
            role: 'user',
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
                text: `מקור: ${label}\n\nקרא את המסמך וצור outline — רשימת כל השירותים שמופיעים. אל תפרק עדיין למדרגות תמחור.`,
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
    throw new Error(`Outline scan: no tool use. stop_reason=${response.stop_reason}`)
  }
  const input = toolUse.input as {
    sections?: string[]
    stubs?: ServiceStub[]
  }
  if (!Array.isArray(input.sections) || !Array.isArray(input.stubs)) {
    throw new Error('Outline scan returned malformed { sections, stubs }.')
  }
  const sections = input.sections
  // Default expected_row_count to 1 if omitted. Clamp section_index to range.
  const stubs = input.stubs.map((s) => ({
    ...s,
    section_index:
      typeof s.section_index === 'number' &&
      s.section_index >= 0 &&
      s.section_index < sections.length
        ? s.section_index
        : 0,
    expected_row_count:
      typeof s.expected_row_count === 'number' && s.expected_row_count > 0
        ? s.expected_row_count
        : 1,
  }))
  console.log(
    `[outline] ${sections.length} sections, ${stubs.length} services`
  )
  return { sections, stubs }
}

// ──────────────────────────────────────────────────────────────────────
// Pass B — expand one service
// ──────────────────────────────────────────────────────────────────────

interface RowWithConfidence extends CatalogRow {
  _confidence?: CatalogRow['_confidence']
}

async function expandServiceFromPdf(
  client: Anthropic,
  pdfBuffer: Buffer,
  stub: ServiceStub,
  sectionHeader: string,
  totalPages: number,
  label: string,
  retryReason: string | null = null
): Promise<RowWithConfidence[]> {
  // Slice to ±1 page window around the stub
  const start = Math.max(1, stub.page_number - 1)
  const end = Math.min(totalPages, stub.page_number + 1)
  const slicedBuffer = await slicePdfPages(pdfBuffer, start, end)

  const response = await withRateLimitRetry(
    () =>
      client.messages.create({
        model: EXPAND_MODEL,
        max_tokens: EXPAND_MAX_TOKENS,
        system: EXPAND_SYSTEM,
        tools: [
          {
            name: 'submit_service_rows',
            description:
              'Submit all catalog rows for the one specific service named in the user message, expanded across pricing tiers.',
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
                              type: ['string', 'null'],
                              enum: [
                                'at_client',
                                'at_provider',
                                'remote',
                                'hybrid',
                                null,
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
                    'One confidence object per row in rows[]. Same indexing as rows.',
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
        tool_choice: { type: 'tool', name: 'submit_service_rows' },
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
                  `מקור: ${label} (עמודים ${start}-${end})\n\n` +
                  `חלץ את כל המדרגות / הגרסאות של השירות הזה:\n` +
                  `- שם: ${stub.service_name}\n` +
                  `- קטגוריה: ${sectionHeader}\n` +
                  (stub.preview ? `- תיאור: ${stub.preview}\n` : '') +
                  `\nאני מצפה לקבל בדיוק ${stub.expected_row_count} שורה(ות). ` +
                  `כל מדרגת תמחור / וריאציה = שורה נפרדת.` +
                  `\nחובה למלא location_mode בכל שורה.` +
                  (retryReason ? `\n\nהערה: ${retryReason}` : ''),
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ] as any,
          },
        ],
      }),
    `expand:${stub.service_name.slice(0, 30)}`
  )

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    console.warn(
      `Expand: no tool use for "${stub.service_name}". stop_reason=${response.stop_reason}`
    )
    return []
  }
  const input = toolUse.input as {
    rows?: CatalogRow[]
    confidence?: Partial<Record<keyof CatalogRow, ConfidenceScore>>[]
  }
  if (!Array.isArray(input.rows)) {
    console.warn(`Expand: no rows for "${stub.service_name}"`)
    return []
  }

  // Pair rows with confidence
  return input.rows.map((row, i) => ({
    ...row,
    _confidence: input.confidence?.[i],
  }))
}

/**
 * Run Pass B and, if the model returned far fewer rows than the stub
 * promised, retry once with explicit feedback about the shortfall.
 * Caps at one retry to keep the call budget bounded.
 */
async function expandWithRetry(
  client: Anthropic,
  pdfBuffer: Buffer,
  stub: ServiceStub,
  sectionHeader: string,
  totalPages: number,
  label: string
): Promise<RowWithConfidence[]> {
  const first = await expandServiceFromPdf(
    client,
    pdfBuffer,
    stub,
    sectionHeader,
    totalPages,
    label
  )
  const expected = Math.max(1, stub.expected_row_count)

  if (first.length >= expected || expected <= 1) {
    return first
  }

  const reason =
    `החזרת ${first.length} שורות אבל המסמך מתאר ${expected} ` +
    `וריאציות שונות (מדרגות תמחור / מיקומים / חבילות). מצא את כולן.`
  console.warn(
    `[expand:${stub.service_name.slice(0, 30)}] short by ${expected - first.length} rows, retrying`
  )
  const second = await expandServiceFromPdf(
    client,
    pdfBuffer,
    stub,
    sectionHeader,
    totalPages,
    label,
    reason
  )
  return second.length > first.length ? second : first
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
  // supplier_category included so that same-named services in different
  // PDF sections (e.g. "יעוץ פרטני להורים" appears in both the young-kids
  // section and the teens section with identical prices) are NOT collapsed
  // by dedup.
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

// ──────────────────────────────────────────────────────────────────────
// Public entry
// ──────────────────────────────────────────────────────────────────────

/**
 * Force every row's supplier_category to be exactly the doc-level
 * section header (canonical, verbatim from Pass A's sections[]). The
 * model can no longer invent per-stub phrasings since it never sees
 * the header as a string — only as an index into the doc-level list.
 */
function pinCategory(
  rows: RowWithConfidence[],
  sectionHeader: string
): RowWithConfidence[] {
  return rows.map((r) => ({ ...r, supplier_category: sectionHeader }))
}

export async function multipassPdf(
  client: Anthropic,
  pdfBuffer: Buffer,
  label: string
): Promise<CatalogRow[]> {
  const outline = await outlineScanPdf(client, pdfBuffer, label)
  if (outline.stubs.length === 0) return []

  const totalPages = (await PDFDocument.load(pdfBuffer)).getPageCount()

  const expanded = await pMap(outline.stubs, EXPAND_CONCURRENCY, async (stub) => {
    const sectionHeader = outline.sections[stub.section_index] ?? 'אחר'
    const rows = await expandWithRetry(
      client,
      pdfBuffer,
      stub,
      sectionHeader,
      totalPages,
      label
    )
    return pinCategory(rows, sectionHeader)
  })

  return mergeAndValidate(expanded.flat())
}
