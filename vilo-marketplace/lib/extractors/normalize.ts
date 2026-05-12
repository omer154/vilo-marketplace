import Anthropic from '@anthropic-ai/sdk'
import type { CatalogRow, ExtractedSource } from './types'
import { CATALOG_COLUMNS } from './types'

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

export async function normalizeWithClaude(
  source: ExtractedSource
): Promise<CatalogRow[]> {
  const apiKey = process.env.VILO_ANTHROPIC_KEY
  if (!apiKey) throw new Error('Missing VILO_ANTHROPIC_KEY')

  const client = new Anthropic({ apiKey })

  // Build a single user message from whatever the extractor handed us.
  let userContent = `מקור: ${source.source_label} (סוג: ${source.source_type})\n\n`
  if (source.rows && source.rows.length) {
    userContent += `שורות מובנות מהמקור (${source.rows.length} שורות):\n`
    // Cap at 200 rows per request to keep tokens reasonable. The /api route
    // can chunk if needed.
    const sample = source.rows.slice(0, 200)
    userContent += JSON.stringify(sample, null, 2)
  } else if (source.raw_text) {
    userContent += `טקסט גולמי:\n${source.raw_text.slice(0, 80_000)}`
  } else {
    throw new Error('Extractor produced no rows and no raw_text')
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: 'submit_catalog_rows',
        description:
          'Submit the extracted catalog rows. One row per service, per pricing tier.',
        input_schema: {
          type: 'object',
          properties: {
            rows: {
              type: 'array',
              items: {
                type: 'object',
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
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_catalog_rows' },
    messages: [{ role: 'user', content: userContent }],
  })

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return tool use')
  }
  const input = toolUse.input as { rows: CatalogRow[] }
  return input.rows
}
