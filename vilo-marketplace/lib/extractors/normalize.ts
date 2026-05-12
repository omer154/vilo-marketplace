import Anthropic from '@anthropic-ai/sdk'
import type { CatalogRow, ExtractedSource } from './types'
import { CATALOG_COLUMNS } from './types'
import { inferSourceSchema, applySchemaToRows } from './schema-mapper'

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
- אם נתון חסר — החזר null, אל תמציא.
- supplier_category חייב להיות אחד מ: ${CATEGORY_VALUES.join(', ')}. נסה לבחור את המתאים ביותר; אם באמת אין התאמה, החזר null.
- price_type: 'fixed' אם יש מחיר בודד, 'range' אם יש טווח (price_min ו-price_max), 'on_request' אם לא מצוין מחיר ספציפי.
- location: 'offsite' = במתחם הספק, 'onsite' = במשרד הלקוח, 'flexible' = שניהם, 'remote' = מקוון. בחר את המתאים ביותר.
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
          location: {
            type: ['string', 'null'],
            enum: ['offsite', 'onsite', 'flexible', 'remote', null],
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

/** Retry an async fn once on Anthropic 429. Waits for the suggested retry
 *  window or 65s, whichever is shorter. */
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const e = err as { status?: number; headers?: Record<string, string> }
    if (e?.status !== 429) throw err
    const retryAfter = Number(e.headers?.['retry-after']) || 60
    const waitMs = Math.min(retryAfter * 1000 + 1000, 65_000)
    console.warn(`Anthropic 429 — sleeping ${waitMs}ms then retrying once.`)
    await sleep(waitMs)
    return await fn()
  }
}

async function normalizeOne(
  client: Anthropic,
  source: ExtractedSource,
  rowsChunk?: Record<string, unknown>[]
): Promise<CatalogRow[]> {
  let userContent = `מקור: ${source.source_label} (סוג: ${source.source_type})\n\n`

  if (rowsChunk && rowsChunk.length) {
    userContent += `שורות מובנות מהמקור (${rowsChunk.length} שורות):\n`
    userContent += JSON.stringify(rowsChunk, null, 2)
  } else if (source.raw_text) {
    userContent += `טקסט גולמי:\n${source.raw_text.slice(0, 80_000)}`
  } else {
    throw new Error('Extractor produced no rows and no raw_text')
  }

  // Cap output at 7K to stay under the 8K-tokens-per-minute tier cap on a
  // single call. Real-world supplier PDFs (5-30 services) fit easily.
  // For very large unstructured inputs, the user will see a clear
  // "max_tokens — split the file" error instead of a silent truncation.
  const response = await withRateLimitRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 7000,
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
      messages: [{ role: 'user', content: userContent }],
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
export async function normalizeWithClaude(
  source: ExtractedSource
): Promise<CatalogRow[]> {
  const apiKey = process.env.VILO_ANTHROPIC_KEY
  if (!apiKey) throw new Error('Missing VILO_ANTHROPIC_KEY')

  const client = new Anthropic({ apiKey })

  // Fast path: structured input with consistent columns. One LLM call to
  // learn the schema, then pure-JS row transformation. Avoids per-row
  // token spend that trips low-tier rate limits at scale.
  if (source.rows && source.rows.length >= STRUCTURED_FAST_PATH_THRESHOLD) {
    const headers = Object.keys(source.rows[0] ?? {})
    const schema = await inferSourceSchema(
      client,
      headers,
      source.rows,
      source.source_label
    )
    return applySchemaToRows(source.rows, schema)
  }

  // Slow path: free text OR a small number of structured rows (likely a
  // sample where the per-row cost is small enough). Chunk + parallelize.
  if (source.rows && source.rows.length > CHUNK_SIZE) {
    const chunks: Record<string, unknown>[][] = []
    for (let i = 0; i < source.rows.length; i += CHUNK_SIZE) {
      chunks.push(source.rows.slice(i, i + CHUNK_SIZE))
    }
    const results = await pMap(chunks, MAX_CONCURRENCY, (chunk) =>
      normalizeOne(client, source, chunk)
    )
    return results.flat()
  }

  return normalizeOne(client, source, source.rows)
}
