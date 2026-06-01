// Catalog standardization migration (data-only; no DDL — every column already exists).
//
// Honest, non-fabricating standardization:
//   1. price_type normalization: price present & type null -> 'fixed';
//      no price at all & type null -> 'on_request' (renders as "מחיר לפי פנייה").
//   2. Supplier enrichment: every supplier missing description_short gets a
//      concise Hebrew summary AI-generated from the services it actually offers
//      (summary of real data, not invented facts) — for premium profile pages.
//
// It does NOT invent prices, durations, or participant counts. Genuine gaps are
// left NULL and handled gracefully by the UI.
//
// Run a preview:   node --env-file=.env.local scripts/standardize-catalog.mjs
// Apply for real:  node --env-file=.env.local scripts/standardize-catalog.mjs --apply
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const APPLY = process.argv.includes('--apply')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const anthropicKey = process.env.VILO_ANTHROPIC_KEY
if (!url || !key) {
  console.error('Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null

const isEmpty = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchAll(table) {
  const out = []
  let from = 0
  const size = 1000
  for (;;) {
    const { data, error } = await sb.from(table).select('*').range(from, from + size - 1)
    if (error) throw error
    out.push(...data)
    if (data.length < size) break
    from += size
  }
  return out
}

console.log(APPLY ? '⚙️  APPLY MODE — writing changes' : '🔍 DRY-RUN — no writes (pass --apply to write)')

const suppliers = await fetchAll('suppliers')
const services = await fetchAll('services')
console.log(`loaded ${suppliers.length} suppliers, ${services.length} services\n`)

// ── 1. price_type normalization ────────────────────────────────────────────
let toFixed = 0
let toOnRequest = 0
for (const s of services) {
  if (!isEmpty(s.price_type)) continue
  if (!isEmpty(s.price)) {
    toFixed++
    if (APPLY) {
      const { error } = await sb.from('services').update({ price_type: 'fixed' }).eq('id', s.id)
      if (error) console.error('  price_type fixed err', s.id, error.message)
    }
  } else if (isEmpty(s.price_min) && isEmpty(s.price_max)) {
    toOnRequest++
    if (APPLY) {
      const { error } = await sb.from('services').update({ price_type: 'on_request' }).eq('id', s.id)
      if (error) console.error('  price_type on_request err', s.id, error.message)
    }
  }
}
console.log(`1) price_type → fixed: ${toFixed} | → on_request: ${toOnRequest}`)

// ── 2. Supplier description enrichment ──────────────────────────────────────
const CAT_HE = {
  wellbeing: 'רווחה', teambuilding: 'גיבוש צוות', learning: 'למידה והעשרה', food: 'קולינריה',
  culture: 'תרבות', travel: 'טיולים', sport: 'ספורט', tech: 'טכנולוגיה', consulting: 'ייעוץ',
}
const bySupplier = new Map()
for (const sv of services) {
  if (!bySupplier.has(sv.supplier_id)) bySupplier.set(sv.supplier_id, [])
  bySupplier.get(sv.supplier_id).push(sv)
}
const needDesc = suppliers.filter((s) => isEmpty(s.description_short))
console.log(`\n2) suppliers needing description: ${needDesc.length}`)

async function describeSupplier(supplier, svcs) {
  const cats = [...new Set(svcs.map((s) => CAT_HE[s.category_primary] || s.category_primary))]
  const sample = svcs.slice(0, 18).map((s) => s.service_name)
  const sys =
    'אתה כותב תיאור תמציתי ומקצועי לספק בקטלוג שירותים ארגוני בעברית. ' +
    'משפט אחד עד שניים (עד 25 מילים), בגוף שלישי, ללא סופרלטיבים מוגזמים. ' +
    'התבסס אך ורק על השירותים שהספק מציע בפועל — אל תמציא עובדות, מחירים או טענות.'
  const user = `שם הספק: ${supplier.name}
תחומים: ${cats.join(', ')}
דוגמאות לשירותים (${svcs.length} בסך הכול): ${sample.join(' · ')}

כתוב תיאור קצר אחד לספק.`
  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 200,
    system: sys,
    messages: [{ role: 'user', content: user }],
  })
  const block = resp.content.find((c) => c.type === 'text')
  return (block?.text || '').trim().replace(/^["׳״']|["׳״']$/g, '').trim()
}

if (!anthropic) {
  console.log('   (no VILO_ANTHROPIC_KEY — skipping description generation)')
} else {
  let done = 0
  for (const sup of needDesc) {
    const svcs = bySupplier.get(sup.id) || []
    if (svcs.length === 0) continue
    try {
      const desc = await describeSupplier(sup, svcs)
      if (desc) {
        console.log(`   • ${sup.name}: ${desc}`)
        if (APPLY) {
          const { error } = await sb.from('suppliers').update({ description_short: desc }).eq('id', sup.id)
          if (error) console.error('     update err', error.message)
        }
        done++
      }
    } catch (e) {
      console.error(`   ✗ ${sup.name}:`, e.message)
    }
    await sleep(900) // gentle on the rate limit
  }
  console.log(`   generated ${done} descriptions`)
}

console.log(`\n${APPLY ? '✅ applied.' : '🔍 dry-run complete. Re-run with --apply to write.'}`)
