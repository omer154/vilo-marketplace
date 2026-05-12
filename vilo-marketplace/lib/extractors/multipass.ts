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
  page_number: number      // 1-indexed
  section_header: string | null
  preview: string | null   // short snippet to help the expand call
}

const OUTLINE_SYSTEM = `אתה סורק מסמכי ספקים של Vilo Marketplace ומחזיר רשימת שירותים.

הוראות:
- החזר כל שירות שמופיע במסמך, כולל גרסאות שונות של אותו שירות (למשל "ייעוץ פרטני" ו"ייעוץ קבוצתי" הם שני שירותים).
- אל תיצור שורות נפרדות לכל מדרגת תמחור — זה נעשה בשלב הבא. שורה אחת לכל שירות (אפילו אם יש לו 5 רמות מחיר).
- page_number = העמוד שבו השירות מתחיל (1-indexed).
- section_header = הכותרת/הקטגוריה שמעליו במסמך (לדוגמה "פעילות לזוגות", "מתנות לעובדים").
- preview = משפט אחד שמתאר את השירות — יעזור לזיהוי בשלב הבא.`

const EXPAND_SYSTEM = `אתה מחלץ פרטים מלאים של שירות בודד מתוך מסמך ספק.

המסמך שצורף מכיל עמוד אחד או שניים — מיקדנו את התשומה כדי לחסוך טוקנים.
המשתמש כבר זיהה איזה שירות לחלץ; המידע יופיע בהודעה.

הוראות:
- צור שורה נפרדת לכל מדרגת תמחור או וריאציה (מחיר שונה / כמות אנשים שונה / מיקום שונה / חבילת שעות).
- שמור טקסט בעברית verbatim. אל תתרגם.
- price_type: 'fixed' למחיר בודד, 'range' לטווח, 'on_request' אם אין מחיר ספציפי.
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
): Promise<ServiceStub[]> {
  const response = await withRateLimitRetry(
    () =>
      client.messages.create({
        model: OUTLINE_MODEL,
        max_tokens: OUTLINE_MAX_TOKENS,
        system: OUTLINE_SYSTEM,
        tools: [
          {
            name: 'submit_outline',
            description: 'Submit the list of distinct services found in the document.',
            input_schema: {
              type: 'object',
              properties: {
                stubs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      service_name: { type: 'string' },
                      page_number: { type: 'integer' },
                      section_header: { type: ['string', 'null'] },
                      preview: { type: ['string', 'null'] },
                    },
                    required: ['service_name', 'page_number'],
                  },
                },
              },
              required: ['stubs'],
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
  const input = toolUse.input as { stubs?: ServiceStub[] }
  if (!Array.isArray(input.stubs)) {
    throw new Error('Outline scan returned no stubs array.')
  }
  return input.stubs
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
  totalPages: number,
  label: string
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
                          : col === 'location'
                          ? {
                              type: ['string', 'null'],
                              enum: ['offsite', 'onsite', 'flexible', 'remote', null],
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
                  (stub.section_header ? `- קטגוריה: ${stub.section_header}\n` : '') +
                  (stub.preview ? `- תיאור: ${stub.preview}\n` : '') +
                  `\nכל מדרגת תמחור / וריאציה = שורה נפרדת.`,
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
  return [
    r.supplier_name,
    r.service_name,
    r.price_ils,
    r.capacity_min,
    r.capacity_max,
    r.location,
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

export async function multipassPdf(
  client: Anthropic,
  pdfBuffer: Buffer,
  label: string
): Promise<CatalogRow[]> {
  const stubs = await outlineScanPdf(client, pdfBuffer, label)
  if (stubs.length === 0) return []

  const totalPages = (await PDFDocument.load(pdfBuffer)).getPageCount()

  const expanded = await pMap(stubs, EXPAND_CONCURRENCY, (stub) =>
    expandServiceFromPdf(client, pdfBuffer, stub, totalPages, label)
  )

  return mergeAndValidate(expanded.flat())
}
