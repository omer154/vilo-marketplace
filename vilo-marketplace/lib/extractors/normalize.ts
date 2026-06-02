import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import type { CatalogRow, ExtractedSource, ImageMediaType } from './types'
import { CATALOG_COLUMNS } from './types'
import { inferSourceSchema, applySchemaToRows } from './schema-mapper'
import { multipassPdf } from './multipass'

// At/under this page count we try a single holistic pass (full cross-page
// context). Above it, the one-call output would truncate (the doc has too many
// services to emit at once) AND it wastes a large PDF-input call before falling
// back — so big PDFs skip straight to the windowed extractor.
const HOLISTIC_MAX_PAGES = 30

/**
 * Above this row count, structured sources (Excel/CSV) take the fast path:
 * one LLM call to infer the column mapping, then pure JS to transform all
 * rows. Below this, the per-row LLM call is faster than two round trips.
 */
const STRUCTURED_FAST_PATH_THRESHOLD = 10

const CATEGORY_VALUES = [
  'wellbeing',
  'teambuilding',
  'learning',
  'food',
  'culture',
  'travel',
  'sport',
  'tech',
  'consulting',
] as const

const SYSTEM_PROMPT = `אתה עוזר חילוץ נתונים של פלטפורמת Vilo Marketplace.
המשתמש העלה קובץ או הזין תוכן שמתאר שירותים של ספק/ספקים.
המשימה שלך: לחלץ שורות מובנות לקטלוג, אחת לכל שירות (וכל מדרגת תמחור — מספר משתתפים, משך זמן, או מספר מפגשים — נחשבת שורה נפרדת).

מה נחשב שירות ומה לא — חשוב מאוד, קרא בעיון:
- שירות = הצעה נפרדת שניתן להזמין ולתמחר (סדנה, תוכנית ליווי, הרצאה, מפגש, חבילה, מוצר).
- רשימת "נושאים אופציונליים", רשימת נושאים/מודולים לבחירה, פריטים מתוך תפריט, או תתי-נושאים בתוך שירות — אלה אינם שירותים בפני עצמם. אל תיצור להם שורות נפרדות. סכם אותם בתוך ה-service_description של השירות שאליו הם שייכים (לדוגמה: "נושאים לבחירה: תקשורת בינאישית, ניהול קונפליקטים, קבלת החלטות..."). יצירת שורה לכל נושא ברשימה היא טעות חמורה.
- חיבור מחירים לשירות: טבלת מחירים מופיעה לעיתים בעמוד/חלק נפרד מתיאור השירות. חבר כל מחיר לשירות הנכון לפי שם השירות שמופיע בטבלה או בכותרת מעליה. כל שילוב של משך זמן / מספר מפגשים / מספר משתתפים עם מחיר = שורה נפרדת עם אותו שם שירות (עם duration_hours / capacity_min/max / price_ils מתאימים). דוגמה: "תכנית ליווי קבוצתית — 5 מפגשים × 3 שעות — 21,500₪" ו-"5 מפגשים × 2 שעות — 19,000₪" = שתי שורות לאותו שירות, עם duration_hours=3 ו-duration_hours=2.
- אל תשאיר שירות ללא מחיר אם המחיר קיים במסמך (גם אם בעמוד אחר). ואל תיצור גם שורה חסרת-מחיר וגם שורה עם-מחיר לאותו שירות — רק את השורה/שורות עם המחיר.

הנחיות:
- אם נתון חסר — לפני שתחזיר null, סרוק את המקור שלוש פעמים: (1) חפש ערך מפורש ומתויג; (2) חפש מילים נרדפות וראשי תיבות (משך≈זמן פעילות, עלות/עלות≈מחיר, "עד X איש"≈כמות); (3) הסק מההקשר (כותרות, שורות סמוכות, טבלאות). רק אם אחרי שלוש הסריקות הנתון באמת לא קיים — החזר null. null הוא מוצא אחרון, לא ברירת מחדל. לעולם אל תמציא.
- supplier_category חייב להיות אחד מ: ${CATEGORY_VALUES.join(', ')}. נסה לבחור את המתאים ביותר; אם באמת אין התאמה, החזר null.
- price_type: 'fixed' אם יש מחיר בודד, 'range' אם יש טווח (price_min ו-price_max), 'on_request' אם לא מצוין מחיר ספציפי.
- pricing_unit (חובה כשיש מחיר) — בחר אך ורק אחד מהערכים הבאים, אל תכתוב מילה אחרת: person (המחיר לאדם/למשתתף), group (המחיר לקבוצה / למפגש / לפעילות שלמה), hour (המחיר לשעה), project (המחיר לתוכנית / סדרה / חבילה שלמה), month (חודשי), unit (ליחידה / מוצר). מיפוי: "סדרה"/"תוכנית"/"חבילה" → project ; "מפגש"/"סדנה"/"יום הדרכה" במחיר אחד לקבוצה → group ; מחיר לאדם → person.
- location_mode: 'at_provider' = במתחם של הספק (קליניקה / סטודיו), 'at_client' = במשרד / במתחם של הלקוח, 'remote' = מקוון, 'hybrid' = שתי האפשרויות אפשריות. בחר את המתאים ביותר.
- duration_hours: בשעות (לדוגמה 1.5 לשעה וחצי).
- אם השירות מציע כמה מדרגות תמחור (לדוגמה: עד 20 איש 1000 ש"ח, 21-40 איש 1500 ש"ח), צור שורה נפרדת לכל מדרגה עם capacity_min/max ו-price_ils מתאימים.
- supplier_notes: כל מידע נוסף שלא נכנס לשדות אחרים — מיקומים, אילוצים, הערות מחיר, מע"מ.
- tags: רשימת תגיות מופרדות בפסיק (לדוגמה: "גיבוש, חוף, גלישה").
- שמור על שמות בעברית כפי שהם, אל תתרגם.`

// How many input rows to send Claude per request. Larger means fewer round
// trips; smaller means each call is faster and less likely to hit
// max_tokens. 25 has been a good sweet spot for the master catalog.
const CHUNK_SIZE = 25

// Cap on concurrent Claude calls. 688-row catalog = 28 chunks; running all
// 28 in parallel risks 429s from Anthropic's per-minute rate limits.
// 5 concurrent ≈ ~6 sequential batches, ~60s total walltime — well under
// the route's maxDuration.
const MAX_CONCURRENCY = 5

// A scraped page / long document can describe MANY services (e.g. a directory of
// 50 escape rooms). Extracting them all in one call blows past max_tokens, so
// split long raw text into chunks and extract each — keeping every call small.
const RAW_TEXT_CHUNK_THRESHOLD = 12_000
const RAW_TEXT_CHUNK_SIZE = 8_000

/** Split text into ~maxLen-char chunks, breaking on a space near the boundary. */
function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    let end = Math.min(i + maxLen, text.length)
    if (end < text.length) {
      const sp = text.lastIndexOf(' ', end)
      if (sp > i + maxLen * 0.6) end = sp
    }
    chunks.push(text.slice(i, end))
    i = end
  }
  return chunks
}

/** Run `fn` over `items` with bounded concurrency. Preserves index order. */
async function pMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = nextIndex++
      if (i >= items.length) break
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

const TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    rows: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          supplier_id: { type: ['string', 'null'] },
          supplier_name: { type: ['string', 'null'] },
          supplier_name_en: { type: ['string', 'null'] },
          supplier_category: {
            type: ['string', 'null'],
            enum: [...CATEGORY_VALUES, null],
          },
          supplier_website: { type: ['string', 'null'] },
          service_id: { type: ['string', 'null'] },
          service_name: { type: ['string', 'null'] },
          service_description: { type: ['string', 'null'] },
          price_ils: { type: ['number', 'null'] },
          price_type: {
            type: ['string', 'null'],
            enum: ['fixed', 'on_request', 'range', null],
          },
          price_min: { type: ['number', 'null'] },
          price_max: { type: ['number', 'null'] },
          capacity_min: { type: ['integer', 'null'] },
          capacity_max: { type: ['integer', 'null'] },
          duration_hours: { type: ['number', 'null'] },
          location_mode: {
            type: ['string', 'null'],
            enum: ['at_client', 'at_provider', 'remote', 'hybrid', null],
          },
          tags: { type: ['string', 'null'] },
          supplier_notes: { type: ['string', 'null'] },
        },
        required: CATALOG_COLUMNS,
      },
    },
  },
  required: ['rows'],
}

/** Wait `ms` milliseconds. */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Transient Anthropic statuses worth retrying: rate limit + server overload.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529])

/** Retry an async fn on transient Anthropic errors (429 / 5xx / overloaded) with
 *  backoff. Honors retry-after for 429s. */
async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
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
      console.warn(`Anthropic ${e.status} — retry ${attempt}/${attempts - 1} in ${waitMs}ms`)
      await sleep(waitMs)
    }
  }
  throw lastErr
}

async function normalizeOne(
  client: Anthropic,
  source: ExtractedSource,
  rowsChunk?: Record<string, unknown>[],
  textChunk?: string
): Promise<CatalogRow[]> {
  // Build content blocks. For PDFs we send the raw buffer as a `document`
  // block — Claude reads it natively (text, tables, images). For
  // everything else we paste structured rows or raw text.
  type AnthropicContent =
    | { type: 'text'; text: string }
    | {
        type: 'document'
        source: { type: 'base64'; media_type: 'application/pdf'; data: string }
      }
    | {
        type: 'image'
        source: { type: 'base64'; media_type: ImageMediaType; data: string }
      }

  const messageContent: AnthropicContent[] = []
  const header = `מקור: ${source.source_label} (סוג: ${source.source_type})`

  if (source.image_buffer && source.image_media_type) {
    // Photo/scan of a price list → Claude reads the Hebrew text via vision.
    messageContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: source.image_media_type,
        data: source.image_buffer.toString('base64'),
      },
    })
    messageContent.push({
      type: 'text',
      text:
        `${header}\n\nקרא את התמונה המצורפת (כולל טקסט סרוק/מצולם בעברית) וחלץ ממנה את כל השירותים.\n` +
        `שמור על הטקסט בעברית כפי שהוא מופיע. אם יש מדרגות תמחור — צור שורה לכל מדרגה.`,
    })
  } else if (source.pdf_buffer) {
    messageContent.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: source.pdf_buffer.toString('base64'),
      },
    })
    messageContent.push({
      type: 'text',
      text:
        `${header}\n\nקרא את ה-PDF המצורף וחלץ ממנו את כל השירותים.\n` +
        `שמור על הטקסט בעברית כפי שהוא מופיע. אם יש מדרגות תמחור — צור שורה לכל מדרגה.`,
    })
  } else if (rowsChunk && rowsChunk.length) {
    messageContent.push({
      type: 'text',
      text:
        `${header}\n\nשורות מובנות מהמקור (${rowsChunk.length} שורות):\n` +
        JSON.stringify(rowsChunk, null, 2),
    })
  } else if (textChunk) {
    messageContent.push({
      type: 'text',
      text: `${header}\n\nתוכן (קטע מתוך אתר/מסמך):\n${textChunk}`,
    })
  } else if (source.raw_text) {
    messageContent.push({
      type: 'text',
      text: `${header}\n\nטקסט גולמי:\n${source.raw_text.slice(0, 80_000)}`,
    })
  } else {
    throw new Error('Extractor produced no rows, no raw_text, no image, and no pdf_buffer')
  }

  // Extra context the admin pasted alongside the source (e.g. prices not on the
  // website) — used to fill fields the primary source is missing.
  if (source.supplementary_text) {
    messageContent.push({
      type: 'text',
      text:
        `מידע נוסף שסיפק המשתמש על הספק — שלב אותו עם המקור והשלם איתו שדות חסרים ` +
        `(במיוחד מחירים, יחידות תמחור, כמויות וזמני פעילות):\n${source.supplementary_text.slice(0, 20_000)}`,
    })
  }

  // Haiku 4.5 instead of Sonnet 4.6 because:
  //   1. The user's tier caps Sonnet at 8K output tokens/min — too tight
  //      for a multi-page supplier PDF in one call.
  //   2. Haiku has substantially higher per-minute output budget at the
  //      same tier and is plenty capable for structured tool-use
  //      extraction.
  //   3. Cheaper per token, so re-runs are easier on the budget.
  // Sonnet stays for the schema-mapper.ts call where quality matters
  // most and the output is tiny.
  const response = await withRateLimitRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: 'submit_catalog_rows',
          description:
            'Submit the extracted catalog rows. One row per service, per pricing tier.',
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_catalog_rows' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: messageContent as any }],
    })
  )

  if (response.stop_reason === 'max_tokens') {
    console.warn(
      `Claude hit max_tokens. input rows=${rowsChunk?.length ?? 'n/a'}, raw_text chars=${source.raw_text?.length ?? 'n/a'}.`
    )
  }

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    // Degrade gracefully — never hard-fail the whole source. Usually max_tokens
    // on one dense call; the windowed/chunked paths avoid it. Logged for diagnosis.
    console.warn(
      `[normalizeOne] no structured output (stop_reason=${response.stop_reason}); returning 0 rows for this call.`
    )
    return []
  }
  const input = toolUse.input as { rows?: CatalogRow[] }
  if (!Array.isArray(input.rows)) {
    console.warn(
      `[normalizeOne] tool_use had no rows array (stop_reason=${response.stop_reason}); returning 0 rows.`
    )
    return []
  }
  return input.rows
}

/**
 * Public entry point. If the source has structured rows, chunk into
 * CHUNK_SIZE-row batches and process in parallel. Otherwise (PDF/Word/URL
 * raw text), one call.
 */
/** Fill supplier_name from the filename hint when the model left it null
 *  (one uploaded file is almost always a single supplier). */
function applySupplierHint(rows: CatalogRow[], source: ExtractedSource): CatalogRow[] {
  const hint = source.supplier_hint?.trim()
  if (!hint) return rows
  return rows.map((r) =>
    r.supplier_name == null || r.supplier_name === ''
      ? { ...r, supplier_name: hint }
      : r
  )
}

/**
 * Format-priced catalogs: some suppliers price every topic the SAME way — by
 * session length, not per topic (e.g. ANY 1.5h session ₪3,150 / 3h workshop
 * ₪4,320 / full day ₪6,300). They list the topics in one place and a single
 * format-price table elsewhere, so extraction yields many PRICELESS topic rows
 * plus a few generic priced "tier" rows (one per duration). The model can't
 * reliably emit the full topic×format cross-product (it truncates), so we do it
 * deterministically here: each topic becomes one priced row per format tier, so
 * every topic is individually bookable and filterable by budget + duration.
 *
 * Runs PER SOURCE (one PDF) so one catalog's tiers never leak onto another's
 * topics. Triggers only on the clear pattern, leaving normal per-service
 * catalogs (where rows already carry their own price) untouched.
 */
export function applyFormatPricing(rows: CatalogRow[]): CatalogRow[] {
  const priceless = rows.filter(
    (r) => r.price_ils == null && r.price_min == null && !!r.service_name?.trim()
  )
  const pricedWithDur = rows.filter((r) => r.price_ils != null && r.duration_hours != null)

  // One tier per distinct duration (cheapest price for that duration) → ~3 tiers.
  const byDur = new Map<number, CatalogRow>()
  for (const r of pricedWithDur) {
    const d = r.duration_hours as number
    const cur = byDur.get(d)
    if (!cur || (r.price_ils as number) < (cur.price_ils as number)) byDur.set(d, r)
  }
  const tiers = [...byDur.values()].sort(
    (a, b) => (a.duration_hours as number) - (b.duration_hours as number)
  )

  // Specific trigger: a real topic menu (many priceless) + a small by-duration
  // price scheme, with clearly more topics than tiers. Otherwise leave as-is.
  if (
    priceless.length < 6 ||
    tiers.length < 2 ||
    tiers.length > 5 ||
    priceless.length < 2 * tiers.length
  ) {
    return rows
  }

  // Everything that is neither a priceless topic nor a by-duration tier row
  // passes through untouched (the tiers are absorbed into every topic).
  const pricelessSet = new Set(priceless)
  const tierSet = new Set(pricedWithDur)
  const passthrough = rows.filter((r) => !pricelessSet.has(r) && !tierSet.has(r))

  const expanded: CatalogRow[] = []
  for (const topic of priceless) {
    for (const tier of tiers) {
      expanded.push({
        ...topic,
        price_ils: tier.price_ils,
        price_type: 'fixed',
        price_min: null,
        price_max: null,
        pricing_unit: tier.pricing_unit ?? 'group',
        duration_hours: tier.duration_hours,
        capacity_min: topic.capacity_min ?? tier.capacity_min,
        capacity_max: topic.capacity_max ?? tier.capacity_max,
      })
    }
  }
  console.log(
    `[format-pricing] ${priceless.length} topics × ${tiers.length} tiers → ${expanded.length} priced rows`
  )
  return [...passthrough, ...expanded]
}

/**
 * One holistic Haiku call over the WHOLE PDF (sent as a native document block).
 * Unlike the windowed extractor it sees the entire document at once, so pricing
 * tables attach to the service they price and "optional topics" lists collapse
 * into the description instead of exploding into one row each. Returns the rows
 * plus whether the model truncated (max_tokens); the caller falls back to
 * windowing only when the doc is too dense to fit a single response.
 */
async function extractPdfHolistic(
  client: Anthropic,
  source: ExtractedSource
): Promise<{ rows: CatalogRow[]; truncated: boolean }> {
  if (!source.pdf_buffer) return { rows: [], truncated: false }
  type Content =
    | { type: 'text'; text: string }
    | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  const content: Content[] = [
    {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: source.pdf_buffer.toString('base64'),
      },
    },
    {
      type: 'text',
      text:
        `מקור: ${source.source_label}\n\nקרא את כל ה-PDF המצורף וחלץ ממנו את כל השירותים האמיתיים.\n` +
        `זכור: רשימת "נושאים אופציונליים" / מודולים / נושאים לבחירה אינה שירותים — סכם אותה ב-service_description, אל תיצור שורה לכל נושא. ` +
        `חבר כל טבלת מחירים לשירות הנכון (גם אם היא בעמוד אחר); כל מדרגת משך/כמות/מחיר = שורה נפרדת לאותו שירות. שמור על העברית כפי שהיא.`,
    },
  ]
  if (source.supplementary_text) {
    content.push({
      type: 'text',
      text: `מידע נוסף מהמשתמש (שלב אותו, במיוחד מחירים):\n${source.supplementary_text.slice(0, 20_000)}`,
    })
  }

  const response = await withRateLimitRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: 'submit_catalog_rows',
          description: 'Submit the extracted catalog rows. One row per service, per pricing tier.',
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_catalog_rows' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: content as any }],
    })
  )

  const truncated = response.stop_reason === 'max_tokens'
  const toolUse = response.content.find((c) => c.type === 'tool_use')
  const input = (toolUse && toolUse.type === 'tool_use' ? toolUse.input : {}) as { rows?: CatalogRow[] }
  const rows = Array.isArray(input.rows) ? input.rows : []
  console.log(
    `[holistic] "${source.source_label}" stop=${response.stop_reason} rows=${rows.length}${truncated ? ' (TRUNCATED)' : ''}`
  )
  return { rows, truncated }
}

export async function normalizeWithClaude(
  source: ExtractedSource
): Promise<CatalogRow[]> {
  const apiKey = process.env.VILO_ANTHROPIC_KEY
  if (!apiKey) throw new Error('Missing VILO_ANTHROPIC_KEY')

  const client = new Anthropic({ apiKey })

  let rows: CatalogRow[]

  if (source.pdf_buffer) {
    // Count pages cheaply to pick the strategy.
    let pageCount = 0
    try {
      pageCount = (await PDFDocument.load(source.pdf_buffer)).getPageCount()
    } catch {
      pageCount = 0
    }

    // Small/medium PDF → one holistic pass preserves cross-page context (a
    // pricing table on page 8 attaches to its service on page 2; "optional
    // topics" fold into the description instead of becoming rows). A big PDF
    // would truncate that single response, so it skips straight to windowing.
    let holistic = { rows: [] as CatalogRow[], truncated: false }
    if (pageCount === 0 || pageCount <= HOLISTIC_MAX_PAGES) {
      holistic = await extractPdfHolistic(client, source).catch(() => ({
        rows: [] as CatalogRow[],
        truncated: true,
      }))
    }

    if (holistic.rows.length > 0 && !holistic.truncated) {
      rows = holistic.rows
    } else {
      // Dense/large doc → windowed extraction for throughput; the route's
      // consolidate step then stitches prices onto services and folds topics.
      let windowed: CatalogRow[] = []
      try {
        windowed = await multipassPdf(client, source.pdf_buffer, source.source_label)
      } catch {
        windowed = []
      }
      rows = windowed.length >= holistic.rows.length ? windowed : holistic.rows
    }
  } else if (source.image_buffer) {
    // Photo/scan → single Haiku vision call.
    rows = await normalizeOne(client, source)
  } else if (source.rows && source.rows.length >= STRUCTURED_FAST_PATH_THRESHOLD) {
    // Fast path: structured input with consistent columns. One LLM call to
    // learn the schema, then pure-JS row transformation.
    const headers = Object.keys(source.rows[0] ?? {})
    const schema = await inferSourceSchema(
      client,
      headers,
      source.rows,
      source.source_label
    )
    rows = applySchemaToRows(source.rows, schema)
  } else if (source.rows && source.rows.length > CHUNK_SIZE) {
    // Slow path: many structured rows → chunk + parallelize.
    const chunks: Record<string, unknown>[][] = []
    for (let i = 0; i < source.rows.length; i += CHUNK_SIZE) {
      chunks.push(source.rows.slice(i, i + CHUNK_SIZE))
    }
    const results = await pMap(chunks, MAX_CONCURRENCY, (chunk) =>
      normalizeOne(client, source, chunk)
    )
    rows = results.flat()
  } else if (source.raw_text && source.raw_text.length > RAW_TEXT_CHUNK_THRESHOLD) {
    // Long scraped text (a directory page, a big document) → chunk + parallelize
    // so each call stays well under max_tokens.
    const chunks = chunkText(source.raw_text, RAW_TEXT_CHUNK_SIZE)
    const results = await pMap(chunks, MAX_CONCURRENCY, (chunk) =>
      normalizeOne(client, source, undefined, chunk)
    )
    rows = results.flat()
  } else {
    // Free text or a small number of structured rows → one call.
    rows = await normalizeOne(client, source, source.rows)
  }

  return applySupplierHint(applyFormatPricing(rows), source)
}
