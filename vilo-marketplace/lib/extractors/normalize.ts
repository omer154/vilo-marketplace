import Anthropic from '@anthropic-ai/sdk'
import type { CatalogRow, ExtractedSource, ImageMediaType } from './types'
import { CATALOG_COLUMNS } from './types'
import { inferSourceSchema, applySchemaToRows } from './schema-mapper'
import { multipassPdf } from './multipass'

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
המשימה שלך: לחלץ שורות מובנות לקטלוג, אחת לכל שירות (וכל מדרגת תמחור — מספר ספציפי של משתתפים — נחשבת שורה נפרדת).

הנחיות:
- אם נתון חסר — לפני שתחזיר null, סרוק את המקור שלוש פעמים: (1) חפש ערך מפורש ומתויג; (2) חפש מילים נרדפות וראשי תיבות (משך≈זמן פעילות, עלות/עלות≈מחיר, "עד X איש"≈כמות); (3) הסק מההקשר (כותרות, שורות סמוכות, טבלאות). רק אם אחרי שלוש הסריקות הנתון באמת לא קיים — החזר null. null הוא מוצא אחרון, לא ברירת מחדל. לעולם אל תמציא.
- supplier_category חייב להיות אחד מ: ${CATEGORY_VALUES.join(', ')}. נסה לבחור את המתאים ביותר; אם באמת אין התאמה, החזר null.
- price_type: 'fixed' אם יש מחיר בודד, 'range' אם יש טווח (price_min ו-price_max), 'on_request' אם לא מצוין מחיר ספציפי.
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
    throw new Error(
      `Claude returned no structured output. stop_reason=${response.stop_reason}. ` +
        (response.stop_reason === 'max_tokens'
          ? 'הקובץ גדול מדי לחילוץ במהלך אחד. נסה לפצל אותו לקובץ קטן יותר (לדוגמה, ספק אחד בכל קובץ).'
          : 'נסה שוב.')
    )
  }
  const input = toolUse.input as { rows?: CatalogRow[] }
  if (!Array.isArray(input.rows)) {
    throw new Error(
      `התשובה מקלוד הייתה ריקה. stop_reason=${response.stop_reason}. ` +
        'סביר להניח שהמסמך גדול מדי — פצל אותו לקבצים קטנים יותר.'
    )
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

export async function normalizeWithClaude(
  source: ExtractedSource
): Promise<CatalogRow[]> {
  const apiKey = process.env.VILO_ANTHROPIC_KEY
  if (!apiKey) throw new Error('Missing VILO_ANTHROPIC_KEY')

  const client = new Anthropic({ apiKey })

  let rows: CatalogRow[]

  if (source.pdf_buffer) {
    // Multipass for PDFs — outline scan + per-service expansion, ~1-2K
    // tokens output per call. Sidesteps both max_tokens truncation and
    // per-minute rate limits on messy docs (10+ pages, many pricing tiers).
    try {
      rows = await multipassPdf(client, source.pdf_buffer, source.source_label)
    } catch {
      rows = []
    }
    if (rows.length === 0) {
      // The outline scan found no "services" — e.g. a pure pricing-table PDF
      // (tiers by participant count, with no service descriptions). Fall back to
      // a single full-PDF extraction so the price tiers still come through; the
      // consolidate step then attaches them to the matching service.
      rows = await normalizeOne(client, source)
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

  return applySupplierHint(rows, source)
}
