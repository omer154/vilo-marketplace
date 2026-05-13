/**
 * One-shot backfill for services.pricing_unit.
 *
 * Background:
 *   The extractor + sync didn't capture pricing_unit until this session.
 *   Every row synced before then has pricing_unit = NULL in the DB,
 *   which makes the marketplace's budget filter treat per-person
 *   services as group-priced (wrong).
 *
 * Strategy:
 *   1. Read every service row where pricing_unit IS NULL.
 *   2. For each, ask Haiku to infer the unit from service_name + price
 *      + notes + category_secondary. Cheap call (~200 input tokens),
 *      one structured tool output per row.
 *   3. UPDATE the row with the inferred unit. Skip the row only if
 *      the model returned a non-enum value.
 *
 * Run from project root (one-time):
 *   node --env-file=.env.local scripts/backfill-pricing-unit.mjs
 *
 * Add --dry-run to see what would change without writing:
 *   node --env-file=.env.local scripts/backfill-pricing-unit.mjs --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const DRY_RUN = process.argv.includes('--dry-run')
// Haiku tier-1 cap = 50 requests/min. Send 8 per batch and wait 12s
// between batches → ~40 req/min, comfortably under the ceiling. The
// dry-run hit 429s on >half the rows with no throttle, so this is the
// minimum viable pace.
const BATCH_SIZE = 8
const BATCH_DELAY_MS = 12_000
const MODEL = 'claude-haiku-4-5'

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

const PRICING_UNITS = ['person', 'group', 'hour', 'project', 'month', 'unit']

const SYSTEM = `אתה מסיק יחידת תמחור (pricing_unit) לפעילות שירות מהמרקטפלייס של Vilo.

הבחר תמיד אחד מהערכים הבאים:
- person — המחיר הוא לאדם / למשתתף ("₪80 לאדם", "₪150 לעובד")
- group — המחיר הוא לקבוצה / פעילות שלמה ("₪3000 לקבוצה", "₪5000 לפעילות")
- hour — המחיר הוא לשעת עבודה ("₪400 לשעה")
- project — המחיר הוא לחבילת ליווי / פרויקט שלם
- month — המחיר הוא חודשי
- unit — המחיר הוא ליחידה פיזית (משחק, ערכה, מתנה, מארז)

אם לא ברור מהטקסט, בחר לפי ברירת המחדל הסבירה ביותר:
- הרצאות / סדנאות / פעילויות לעובדים → group
- ייעוץ פרטני לשעה → hour
- ייעוץ / ליווי ארוך טווח → project
- מתנות / משחקים / ערכות → unit
- אם price נמוך (פחות מ-300) ו-category קשורה למתנות → unit
- ספק deal — group`

function getEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing ${name}`)
  return v
}

async function inferOne(client, row) {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: SYSTEM,
    tools: [
      {
        name: 'submit_pricing_unit',
        description: 'Submit the inferred pricing_unit for one service row.',
        input_schema: {
          type: 'object',
          properties: {
            pricing_unit: { type: 'string', enum: PRICING_UNITS },
            reason: {
              type: 'string',
              description: 'משפט קצר: למה בחרת ביחידה זו (לרישום בלוג)',
            },
          },
          required: ['pricing_unit', 'reason'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_pricing_unit' },
    messages: [
      {
        role: 'user',
        content: `שירות:
שם: ${row.service_name || '(ללא שם)'}
תת-קטגוריה: ${row.category_secondary || '—'}
מחיר: ${row.price != null ? `₪${row.price}` : 'לא ידוע'}
הערות: ${row.notes || '—'}

הסק pricing_unit.`,
      },
    ],
  })
  const tool = r.content.find((c) => c.type === 'tool_use')
  if (!tool || tool.type !== 'tool_use') return null
  const out = tool.input
  if (!PRICING_UNITS.includes(out.pricing_unit)) return null
  return { unit: out.pricing_unit, reason: out.reason }
}

async function main() {
  const supabase = createClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  )
  const anthropic = new Anthropic({ apiKey: getEnv('VILO_ANTHROPIC_KEY') })

  const { data: rows, error } = await supabase
    .from('services')
    .select(
      'id, service_name, category_secondary, price, notes, supplier_id, suppliers(name)'
    )
    .is('pricing_unit', null)
    .eq('is_active', true)
    .order('supplier_id', { ascending: true })

  if (error) {
    console.error('select error:', error.message)
    process.exit(1)
  }
  console.log(`found ${rows.length} services with pricing_unit IS NULL`)
  if (rows.length === 0) {
    console.log('nothing to do — exiting')
    return
  }

  let inferred = 0
  let updated = 0
  let skipped = 0
  const byUnit = {}

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    if (i > 0) {
      console.log(`(throttle ${BATCH_DELAY_MS / 1000}s before next batch)`)
      await sleep(BATCH_DELAY_MS)
    }
    const batch = rows.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (row) => {
        try {
          const out = await inferOne(anthropic, row)
          return { row, out }
        } catch (e) {
          return {
            row,
            out: null,
            err: e instanceof Error ? e.message : String(e),
          }
        }
      })
    )

    for (const { row, out, err } of results) {
      if (err) {
        console.warn(`✗ ${row.id} ${row.service_name?.slice(0, 40)} — ${err}`)
        skipped++
        continue
      }
      if (!out) {
        console.warn(`? ${row.id} ${row.service_name?.slice(0, 40)} — no inference`)
        skipped++
        continue
      }
      inferred++
      byUnit[out.unit] = (byUnit[out.unit] || 0) + 1
      const tag = DRY_RUN ? '[dry]' : '✓'
      const supplierName = row.suppliers?.name || ''
      console.log(
        `${tag} ${supplierName.padEnd(14)} ${(row.service_name || '').slice(0, 42).padEnd(42)} ${row.price ?? '—'.toString().padStart(5)} → ${out.unit}`
      )
      if (!DRY_RUN) {
        const { error: updErr } = await supabase
          .from('services')
          .update({ pricing_unit: out.unit })
          .eq('id', row.id)
        if (updErr) {
          console.error(`  update failed: ${updErr.message}`)
          skipped++
        } else {
          updated++
        }
      }
    }
  }

  console.log('\n--- summary ---')
  console.log(`total IS NULL: ${rows.length}`)
  console.log(`inferred:      ${inferred}`)
  console.log(`updated:       ${DRY_RUN ? '(dry run — 0)' : updated}`)
  console.log(`skipped:       ${skipped}`)
  console.log(`distribution:`, byUnit)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
