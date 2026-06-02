import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { isCurrentUserAdmin } from '@/lib/supabase/server'
import { checkSameOrigin } from '@/lib/csrf'
import { CATALOG_COLUMNS, type CatalogRow } from '@/lib/extractors/types'

export const runtime = 'nodejs'
// Same budget as /extract: a ~120-row Haiku merge can run >90s under tier
// throttling and used to 504. It still degrades gracefully (returns un-merged
// rows), but the extra headroom lets the merge actually finish.
export const maxDuration = 300

// Above this many rows we skip the AI merge (output would risk max_tokens) and
// just apply the deterministic supplier-name override. Raised once extraction
// stopped over-producing rows (topic-list explosion fixed) so real catalogs now
// land well under it and DO get merged/price-synced.
const AI_MERGE_ROW_CAP = 160

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
          supplier_category: { type: ['string', 'null'] },
          supplier_website: { type: ['string', 'null'] },
          service_id: { type: ['string', 'null'] },
          service_name: { type: ['string', 'null'] },
          service_description: { type: ['string', 'null'] },
          price_ils: { type: ['number', 'null'] },
          price_type: { type: ['string', 'null'], enum: ['fixed', 'on_request', 'range', null] },
          price_min: { type: ['number', 'null'] },
          price_max: { type: ['number', 'null'] },
          pricing_unit: {
            type: ['string', 'null'],
            enum: ['person', 'group', 'hour', 'project', 'month', 'unit', null],
          },
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

const SYSTEM_PROMPT = `אתה מאחד ומסנכרן קטלוג שירותים עבור Vilo Marketplace — לכל סוג ספק (סדנאות, קייטרינג, הרצאות, חדרי בריחה, אטרקציות, ייעוץ ועוד).
קיבלת: (1) שורות שירות שכבר חולצו מכמה קבצים/אתרים, (2) טקסט חופשי שהמשתמש סיפק (בדרך כלל מחירון או מידע משלים), ולעיתים (3) שם ספק מפורש.

המשימה — להחזיר רשימת שירותים אחת, נקייה ומאוחדת:
- שם ספק: אם סופק שם ספק מפורש — כל השורות חייבות לקבל אותו שם בדיוק. אחרת — אחֵד וריאציות כמעט-זהות של שם הספק לשם אחד עקבי (לדוגמה "דני בוי", "דני בוי קוקטיילס", "סדנאות קוקטיילים" → שם אחד). לעולם אל תשאיר שם ספק שמקורו בשם קובץ.
- סנכרון מחירים: שלב את המחירים מהטקסט החופשי לתוך השירות המתאים. מחירון לפי מספר משתתפים = מדרגות תמחור: צור שורה לכל מדרגה עם capacity_min=capacity_max=מספר המשתתפים ו-price_ils=המחיר, pricing_unit='group', price_type='fixed', על השירות הרלוונטי. אם יש מחיר-לאדם לאחר הנחה — שורה עם pricing_unit='person'.
- שירותים שמופיעים רק בטקסט (לדוגמה "בר לאירועים" עם מינימום מחיר/כמות) — צור עבורם שורה אם אינם קיימים כבר.
- אל תזרוק מידע מחיר: הערות כמו כולל/לא כולל מע"מ, עלות הגעה/נסיעות, תוספות, מקדמה ואזורי שירות — שמור ב-supplier_notes או ב-service_description של השורה הרלוונטית.
- פריטים בודדים מתוך תפריט/רשימה (מנות, קוקטיילים, פריטי מוצר וכו') שאין להם מחיר עצמאי — חובה לסכם אותם לתוך ה-service_description של השירות הרלוונטי (לדוגמה רשימת הקוקטיילים נכנסת לתיאור הסדנה/הבר). אל תחזיר אותם כשורות שירות נפרדות.
- "נושאים אופציונליים" / רשימת נושאים / מודולים לבחירה אינם שירותים — מזג אותם לתוך ה-service_description של השירות שאליו הם שייכים, ואל תשאיר אותם כשורות נפרדות.
- אם אותו שירות מופיע גם כשורה חסרת-מחיר וגם כשורה עם מחיר (כי המחיר חולץ מטבלת מחירים נפרדת) — מזג לשורה אחת עם המחיר. אל תשאיר את השורה חסרת-המחיר ככפילות.
- אחֵד כפילויות אמיתיות; שמור שירותים ומדרגות תמחור שונים באמת.
- supplier_category: תן ערך עקבי לשירותים מאותו סוג של אותו ספק (לדוגמה כל מדרגות הסדנה תחת אותה קטגוריה). אל תמציא קטגוריות חדשות.
- שמור טקסט בעברית verbatim. אל תמציא נתונים שאינם במקור. החזר את כל השירותים.`

function applySupplierOverride(rows: CatalogRow[], name: string | null): CatalogRow[] {
  if (!name) return rows
  return rows.map((r) => ({ ...r, supplier_name: name }))
}

export async function POST(request: NextRequest) {
  const csrfErr = checkSameOrigin(request)
  if (csrfErr) return NextResponse.json({ error: `csrf: ${csrfErr}` }, { status: 403 })
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const inputRows: CatalogRow[] = Array.isArray(body?.rows) ? body.rows : []
  const supplierName: string | null =
    typeof body?.supplierName === 'string' && body.supplierName.trim()
      ? body.supplierName.trim()
      : null
  const freeText: string | null =
    typeof body?.freeText === 'string' && body.freeText.trim() ? body.freeText.trim() : null

  if (inputRows.length === 0 && !freeText) {
    return NextResponse.json({ rows: applySupplierOverride(inputRows, supplierName) })
  }

  // Too many rows to safely round-trip through one model call → deterministic path only.
  if (inputRows.length > AI_MERGE_ROW_CAP) {
    return NextResponse.json({ rows: applySupplierOverride(inputRows, supplierName) })
  }

  const apiKey = process.env.VILO_ANTHROPIC_KEY
  if (!apiKey) {
    // No key — never lose data; just unify the supplier name.
    return NextResponse.json({ rows: applySupplierOverride(inputRows, supplierName) })
  }

  try {
    const client = new Anthropic({ apiKey })
    const parts: string[] = []
    if (supplierName) parts.push(`שם הספק (חובה להחיל על כל השורות): ${supplierName}`)
    parts.push(
      `שורות שחולצו מכל המקורות (JSON, ${inputRows.length} שורות):\n${JSON.stringify(inputRows, null, 2)}`
    )
    if (freeText) parts.push(`טקסט חופשי / מחירון שהמשתמש סיפק:\n${freeText.slice(0, 20_000)}`)
    parts.push(
      `קטגוריות-משנה תקפות אינן מוגבלות, אך category_primary (אם תשתמש) חייבת להיות אחת מ: ${CATEGORY_VALUES.join(', ')}.`
    )

    const response = await client.messages.create({
      // Haiku, not Sonnet: the user's tier throttles Sonnet output to ~8K
      // tokens/min, which made this regenerate-all-rows call time out (504).
      // Haiku has a far higher per-minute output budget and is plenty capable here.
      model: 'claude-haiku-4-5',
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: 'submit_merged_rows',
          description: 'Submit the unified, price-synced catalog rows.',
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_merged_rows' },
      messages: [{ role: 'user', content: parts.join('\n\n') }],
    })

    const toolUse = response.content.find((c) => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      // Model didn't return structured output — fall back, never lose the rows.
      return NextResponse.json({ rows: applySupplierOverride(inputRows, supplierName) })
    }
    const out = toolUse.input as { rows?: CatalogRow[] }
    const merged = Array.isArray(out.rows) && out.rows.length > 0 ? out.rows : inputRows
    // Guard against real price LOSS only — NOT against row consolidation. A good
    // merge legitimately has fewer rows (folded menu items, deduped equal-price
    // tiers); only fall back to the raw rows if a distinct price value the model
    // was given went missing from the result.
    const priceSet = (rs: CatalogRow[]) =>
      new Set(rs.filter((r) => r.price_ils != null).map((r) => r.price_ils))
    const before = priceSet(inputRows)
    const after = priceSet(merged)
    const lostPrice = [...before].some((p) => !after.has(p))
    const safe = lostPrice ? inputRows : merged
    console.log(
      `[consolidate] in=${inputRows.length} out=${merged.length} prices ${before.size}->${after.size}${lostPrice ? ' REJECTED(price lost) kept raw' : ' used merged'}`
    )
    // Belt-and-suspenders: re-apply the explicit supplier name in case the model drifted.
    return NextResponse.json({ rows: applySupplierOverride(safe, supplierName) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('Consolidate route error:', message)
    // On any failure, return the un-merged rows (with supplier override) so the
    // admin still gets their data to review.
    return NextResponse.json({ rows: applySupplierOverride(inputRows, supplierName) })
  }
}
