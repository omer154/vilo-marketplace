/**
 * Window-based PDF extractor.
 *
 * Five rounds of section-based extraction (Pass A → Pass B per section)
 * regressed from 34 → 28 → 26 → 15 → ... rows. Three independent
 * audit agents concluded the architecture was wrong, not the patches:
 * Pass A is a probabilistic step used as a deterministic index, so any
 * mistake in its page-range output produces silent zero-row sections.
 *
 * New flow:
 *   1. Mechanical 3-page windows with 1-page overlap. No model in
 *      the segmenter — pure JS, deterministic.
 *   2. extractWindow() — one Haiku call per window. Returns rows with
 *      a `section_header_seen` field per row (the model just reports
 *      what it sees; no global commitment).
 *   3. reconcileSections() — one tiny Sonnet call mapping the set of
 *      observed header strings onto a canonical taxonomy (variations,
 *      typos, or partial captures collapse to the canonical form).
 *   4. Merge in JS with a dedup key that includes supplier_name +
 *      canonical category + duration so legitimately distinct rows
 *      never collide. Overlap-induced duplicates collapse cleanly.
 *
 * Why this wins: missing rows are invisible; duplicates are cheap to
 * fix in JS. Overlap optimizes for the right side of that asymmetry.
 */

import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import type { CatalogRow, ConfidenceScore } from './types'
import { CATALOG_COLUMNS } from './types'

const EXTRACT_MODEL = 'claude-haiku-4-5'
// Haiku, not Sonnet: this tier throttles/overloads Sonnet, and a reconcile
// failure used to kill the whole PDF. Header-mapping is easy enough for Haiku.
const RECONCILE_MODEL = 'claude-haiku-4-5'
// Larger windows (6 pages, 1 overlap) keep a service and its pricing table in
// the same window far more often than 3-page windows did — less service↔price
// fragmentation — and produce ~10 windows for a 50-page doc instead of 25, which
// also eases per-minute rate limits. Only dense PDFs that overflow the single
// holistic pass reach this path, so the bigger per-call payload is acceptable.
const WINDOW_SIZE = 6
const WINDOW_OVERLAP = 1
const WINDOW_CONCURRENCY = 5
const WINDOW_MAX_TOKENS = 12_000
const RECONCILE_MAX_TOKENS = 1_500

const EXTRACT_SYSTEM = `אתה מחלץ שירותים מתוך חלון של מספר עמודים ממסמך ספק של Vilo Marketplace.

חלץ את כל השירותים שנראים בעמודים שצורפו.

חשוב — מה לא לחלץ: רשימת "נושאים אופציונליים", רשימת נושאים/מודולים לבחירה, או פריטים מתוך תפריט בתוך שירות — אינם שירותים בפני עצמם, ואל תיצור שורה לכל אחד מהם. אם השירות שאליו הם שייכים נראה בחלון — סכם אותם בקצרה ב-service_description שלו; אם לא — דלג עליהם. שירות = הצעה נפרדת שניתן להזמין ולתמחר (סדנה, תוכנית, הרצאה, מפגש, חבילה).

הוראות:
- כל מדרגת תמחור / וריאציה = שורה נפרדת.
  דוגמאות:
    * "₪500 מפגש בודד בקליניקה / ₪4800 בנק 10 שעות / ₪9000 בנק 20 שעות" → 3 שורות (כולן at_provider).
    * "במקום העבודה: ₪650 לשעה / ₪6200 ל-10 שעות / ₪12,000 ל-20 שעות" → 3 שורות נוספות (כולן at_client). סך הכל 6 שורות לאותו שירות.
    * "מפגש בודד ₪3000 / סדרה של 3 מפגשים ₪7000" → 2 שורות.
- שמור טקסט בעברית verbatim. אל תתרגם.
- אם שירות מפנה לתמחור של שירות אחר ("ראה תמחור יעוץ זוגי") ושירות זה מופיע באותו חלון — חלץ את אותן וריאציות עם שם השירות הנוכחי. אם השירות המוזכר לא נראה בחלון, החזר שורה אחת עם price_type='on_request' וציין בהערות.

שדה section_header_seen — חובה למלא:
- רשום את כותרת הסקציה הגדולה שנראית במסמך מעל השירות הזה (לדוגמה "מתנות לעובדים", "פעילות לזוגות", "פעילות לצוותים/ לעובדים").
- אם הכותרת לא נראית בעמודים אבל ברור מההקשר באיזו סקציה השירות נמצא — הסק בזהירות.
- אם אין שום דרך לדעת, החזר null.

שדה location_mode — חובה למלא בכל שורה. אסור null:
- at_provider = במתחם של הספק (קליניקה / סטודיו / מתקן של הספק)
- at_client = במשרד / במתחם של הלקוח / במקום העבודה
- remote = מקוון (זום וכו')
- hybrid = יכול להתקיים בשתיהן

ברירות מחדל אם לא ברור במסמך:
- הרצאות / סדנאות / פעילויות לעובדי הארגון → at_client (הספק מגיע למקום העבודה)
- שירותי ייעוץ פרטני "בקליניקה" → at_provider
- שירותי ייעוץ פרטני "במקום העבודה" → at_client
- מוצרים פיזיים / מתנות (משחקים, ערכות) → at_client

price_type: 'fixed' למחיר בודד, 'range' לטווח, 'on_request' אם אין מחיר ספציפי.

pricing_unit — חובה למלא כשיש price_ils. בחר אחד:
- person = המחיר הוא לאדם / למשתתף (לדוגמה "₪80 לאדם", "₪150 למשתתף")
- group = המחיר הוא לקבוצה / לפעילות שלמה (לדוגמה "₪3000 לקבוצה", "₪5000 לפעילות")
- hour = המחיר הוא לשעת עבודה (לדוגמה "₪400 לשעה")
- project = המחיר הוא לפרויקט שלם / לחבילת ליווי
- month = המחיר הוא חודשי
- unit = המחיר הוא ליחידה פיזית (משחק, ערכה, מתנה)
ברירת מחדל: אם לא ברור, נסה להסיק לפי ההקשר. הרצאה לקבוצה → group. ייעוץ פרטני לשעה → hour. מתנה / משחק → unit.

confidence (1-5 לכל שדה):
- 5 = הערך מפורש במסמך
- 4 = ברור מהקשר
- 3 = הסקה הגיונית
- 2 = השערה
- 1 = ניחוש (במיוחד אם השתמשת בברירת מחדל)

supplier_notes: כל מידע נוסף — מע"מ, נסיעות, יחידת תמחור, מספר מפגשים, אילוצים.`

const RECONCILE_SYSTEM = `אתה מנקה רשימה של כותרות סקציה שזוהו במסמך ספק.

קלט: רשימה של מחרוזות שנצפו (אותה סקציה עשויה להופיע פעמים רבות עם הבדלי כתיב או ניסוח).

פלט: מפה observed_to_canonical — לכל מחרוזת שנצפתה, מה הצורה הקנונית שלה.

כללים:
- canonical חייב להיות verbatim מאחת מהמחרוזות בקלט (לא להמציא חדשות).
- אם שתי מחרוזות הן באמת סקציות שונות — נשארות שונות.
- בחר את הצורה הארוכה/המלאה ביותר בתור canonical כשיש ספק.
- מסמך טיפוסי יש 3-7 סקציות קנוניות.`

// ── Utilities ────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Transient Anthropic statuses worth retrying: rate limit + server overload.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529])

async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const e = err as { status?: number; headers?: Record<string, string> }
      if (!RETRYABLE_STATUS.has(e?.status ?? 0) || attempt === attempts) throw err
      const retryAfter = Number(e.headers?.['retry-after'])
      const waitMs = retryAfter
        ? Math.min(retryAfter * 1000 + 1000, 65_000)
        : Math.min(2_000 * 2 ** (attempt - 1) + 500, 20_000)
      console.warn(`[${label}] ${e.status} — retry ${attempt}/${attempts - 1} in ${waitMs}ms`)
      await sleep(waitMs)
    }
  }
  throw lastErr
}

/** Bounded-concurrency parallel map. Errors are logged + skipped per-item;
 *  surviving items still produce results. */
async function pMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  label: string
): Promise<R[]> {
  const results: (R | undefined)[] = new Array(items.length)
  const errors: Array<{ i: number; err: Error }> = []
  let next = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++
        if (i >= items.length) break
        try {
          results[i] = await fn(items[i], i)
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err))
          errors.push({ i, err: e })
          console.error(`[${label}] item ${i} threw: ${e.message}`)
        }
      }
    }
  )
  await Promise.all(workers)
  if (errors.length) {
    console.warn(
      `[${label}] ${errors.length}/${items.length} items failed; continuing with the rest`
    )
  }
  return results.filter((r): r is R => r !== undefined)
}

async function slicePdfPages(
  src: PDFDocument,
  startPage: number,
  endPage: number
): Promise<Buffer> {
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

/** Generate overlapping 3-page windows. */
function makeWindows(
  totalPages: number,
  size: number,
  overlap: number
): Array<[number, number]> {
  if (totalPages <= size) return [[1, totalPages]]
  const step = Math.max(1, size - overlap)
  const windows: Array<[number, number]> = []
  let start = 1
  while (start <= totalPages) {
    const end = Math.min(totalPages, start + size - 1)
    windows.push([start, end])
    if (end >= totalPages) break
    start += step
  }
  return windows
}

// ── Window extraction (Pass 1) ───────────────────────────────────────

interface WindowRow extends CatalogRow {
  /** Set during window extraction; remapped to supplier_category after reconcile. */
  _section_header_seen?: string | null
}

async function extractWindow(
  client: Anthropic,
  sliced: Buffer,
  windowStart: number,
  windowEnd: number,
  label: string
): Promise<WindowRow[]> {
  const tag = `window:${windowStart}-${windowEnd}`
  console.log(`[${tag}] ${sliced.length} bytes`)

  const response = await withRateLimitRetry(
    () =>
      client.messages.create({
        model: EXTRACT_MODEL,
        max_tokens: WINDOW_MAX_TOKENS,
        system: EXTRACT_SYSTEM,
        tools: [
          {
            name: 'submit_window_rows',
            description:
              'Submit all catalog rows visible in the page window. One row per service+pricing-tier+location variant.',
            input_schema: {
              type: 'object',
              properties: {
                rows: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      ...Object.fromEntries(
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
                            : col === 'pricing_unit'
                            ? {
                                type: ['string', 'null'],
                                enum: [
                                  'person',
                                  'group',
                                  'hour',
                                  'project',
                                  'month',
                                  'unit',
                                  null,
                                ],
                              }
                            : col === 'location_mode'
                            ? {
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
                      section_header_seen: { type: ['string', 'null'] },
                    },
                    additionalProperties: false,
                  },
                },
                confidence: {
                  type: 'array',
                  description:
                    'One confidence object per row in rows[]. Same index ordering.',
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
        tool_choice: { type: 'tool', name: 'submit_window_rows' },
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
                  data: sliced.toString('base64'),
                },
              },
              {
                type: 'text',
                text:
                  `מקור: ${label} (עמודים ${windowStart}-${windowEnd})\n\n` +
                  `חלץ את כל השירותים והווריאציות בעמודים האלה. ` +
                  `כל מדרגת תמחור = שורה נפרדת. חובה למלא location_mode (אסור null) ו-section_header_seen בכל שורה.`,
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ] as any,
          },
        ],
      }),
    tag
  )

  console.log(
    `[${tag}] stop_reason=${response.stop_reason}, blocks=[${response.content
      .map((c) => c.type)
      .join(',')}]`
  )
  if (response.stop_reason === 'max_tokens') {
    console.warn(`[${tag}] hit max_tokens — output may be partial`)
  }

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    console.warn(`[${tag}] no tool_use block — content text:`)
    for (const block of response.content) {
      if (block.type === 'text') console.warn(`    ${block.text.slice(0, 200)}`)
    }
    return []
  }

  const input = toolUse.input as {
    rows?: Array<CatalogRow & { section_header_seen?: string | null }>
    confidence?: Partial<Record<keyof CatalogRow, ConfidenceScore>>[]
  }
  if (!Array.isArray(input.rows)) {
    console.warn(
      `[${tag}] tool_use.input.rows missing or not array. input keys: [${Object.keys(input || {}).join(',')}]`
    )
    return []
  }

  if (
    input.confidence &&
    Array.isArray(input.confidence) &&
    input.confidence.length !== input.rows.length
  ) {
    console.warn(
      `[${tag}] confidence/rows length mismatch (${input.confidence.length} vs ${input.rows.length}) — confidence will be undefined for mismatched indices`
    )
  }

  console.log(`[${tag}] ${input.rows.length} rows`)

  return input.rows.map((row, i) => {
    const { section_header_seen, ...rest } = row
    return {
      ...(rest as CatalogRow),
      _section_header_seen: section_header_seen ?? null,
      _confidence: input.confidence?.[i],
    }
  })
}

// ── Section reconciliation (Pass 2) ──────────────────────────────────

async function reconcileSections(
  client: Anthropic,
  observedHeaders: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(observedHeaders.filter((h) => h && h.trim())))
  if (unique.length === 0) return {}
  if (unique.length === 1) return { [unique[0]]: unique[0] }

  console.log(`[reconcile] mapping ${unique.length} distinct observed headers`)

  let response: Anthropic.Message
  try {
    response = await withRateLimitRetry(
    () =>
      client.messages.create({
        model: RECONCILE_MODEL,
        max_tokens: RECONCILE_MAX_TOKENS,
        system: RECONCILE_SYSTEM,
        tools: [
          {
            name: 'submit_mapping',
            description:
              'Submit the observed-to-canonical section header mapping.',
            input_schema: {
              type: 'object',
              properties: {
                mapping: {
                  type: 'object',
                  description:
                    'Each observed header maps to its canonical form. Both must be strings from the input list.',
                  additionalProperties: { type: 'string' },
                },
              },
              required: ['mapping'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'submit_mapping' },
        messages: [
          {
            role: 'user',
            content: `Observed section headers:\n${unique
              .map((h) => `- ${h}`)
              .join('\n')}\n\nReturn the observed_to_canonical mapping.`,
          },
        ],
      }),
    'reconcile'
  )
  } catch (err) {
    console.warn(
      `[reconcile] call failed (${err instanceof Error ? err.message : err}) — using identity mapping`
    )
    return Object.fromEntries(unique.map((h) => [h, h]))
  }

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    console.warn('[reconcile] no tool_use — falling back to identity mapping')
    return Object.fromEntries(unique.map((h) => [h, h]))
  }
  const out = toolUse.input as { mapping?: Record<string, string> }
  if (!out.mapping || typeof out.mapping !== 'object') {
    console.warn('[reconcile] no mapping returned — falling back to identity')
    return Object.fromEntries(unique.map((h) => [h, h]))
  }
  // Defensive: any observed header not in the returned mapping → identity.
  const result: Record<string, string> = {}
  for (const h of unique) result[h] = out.mapping[h] || h
  const canonicalSet = new Set(Object.values(result))
  console.log(
    `[reconcile] ${unique.length} observed → ${canonicalSet.size} canonical: ${Array.from(canonicalSet).map((c) => `"${c}"`).join(', ')}`
  )
  return result
}

// ── Merge + dedup (Pass 3, pure JS) ──────────────────────────────────

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
  // supplier_name + supplier_category + service_name + price + capacity
  // + location + duration. Adding supplier_name closes the cross-supplier
  // collision case the audit found; adding duration distinguishes same-
  // price rows that differ only in hours (the bank-of-10h vs bank-of-20h
  // case where price coincidentally equals another tier's price).
  return [
    r.supplier_name,
    r.supplier_category,
    r.service_name,
    r.price_ils,
    r.capacity_min,
    r.capacity_max,
    r.location_mode,
    r.duration_hours,
  ]
    .map((v) => (v == null ? '' : String(v)))
    .join('|')
    .toLowerCase()
}

export function mergeAndValidate(rows: WindowRow[]): CatalogRow[] {
  const seen = new Map<string, CatalogRow>()
  let dropped = 0
  for (const row of rows) {
    // Keep rows even with null service_name if they have a description or
    // notes — the staging Sheet review pass can repair them.
    if (!row.service_name && !row.service_description && !row.supplier_notes) {
      dropped++
      continue
    }
    const key = rowKey(row)
    if (seen.has(key)) continue
    const merged: CatalogRow = {
      ...row,
      _confidence_avg: computeConfidenceAvg(row._confidence),
    }
    // Strip internal field before returning.
    delete (merged as WindowRow)._section_header_seen
    seen.set(key, merged)
  }
  if (dropped > 0) {
    console.log(`[merge] dropped ${dropped} rows with no name/description/notes`)
  }
  return Array.from(seen.values())
}

// ── Public entry ─────────────────────────────────────────────────────

export async function multipassPdf(
  client: Anthropic,
  pdfBuffer: Buffer,
  label: string
): Promise<CatalogRow[]> {
  // Load the PDF ONCE and reuse it for slicing. Re-loading a large multi-MB PDF
  // per window (≈25 windows for a 50-page doc) was slow + memory-heavy enough to
  // time out / OOM the function — the cause of big PDFs failing.
  const srcDoc = await PDFDocument.load(pdfBuffer)
  const totalPages = srcDoc.getPageCount()
  console.log(`[multipass] "${label}" ${totalPages} pages`)

  const windows = makeWindows(totalPages, WINDOW_SIZE, WINDOW_OVERLAP)
  console.log(
    `[multipass] ${windows.length} windows: ${windows.map(([s, e]) => `${s}-${e}`).join(', ')}`
  )

  // Slice every window up-front, sequentially (cheap CPU work; avoids concurrent
  // pdf-lib access to the shared source doc).
  const slices: Buffer[] = []
  for (const [start, end] of windows) {
    slices.push(await slicePdfPages(srcDoc, start, end))
  }

  // Pass 1: extract every window in parallel (the slow part is the API calls).
  const windowRows = await pMap(
    windows,
    WINDOW_CONCURRENCY,
    ([start, end], i) => extractWindow(client, slices[i], start, end, label),
    'multipass.windows'
  )
  const allRows: WindowRow[] = windowRows.flat()
  console.log(
    `[multipass] window pass produced ${allRows.length} raw rows across ${windows.length} windows`
  )

  if (allRows.length === 0) {
    console.warn('[multipass] window pass produced nothing — bailing')
    return []
  }

  // Pass 2: reconcile section headers.
  const observed = allRows
    .map((r) => r._section_header_seen)
    .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
  const mapping = await reconcileSections(client, observed)

  // Apply canonical category to every row.
  for (const row of allRows) {
    const seen = row._section_header_seen
    if (seen && mapping[seen]) {
      row.supplier_category = mapping[seen]
    } else if (seen) {
      row.supplier_category = seen
    }
  }

  // Pass 3: merge + dedup.
  const merged = mergeAndValidate(allRows)
  console.log(
    `[multipass] "${label}" -> ${merged.length} unique rows after dedup (from ${allRows.length} raw)`
  )
  return merged
}
