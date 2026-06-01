// Read-only inspection of the live catalog: counts + gap analysis across the
// 11 canonical fields + enum validity. Run:
//   node --env-file=.env.local scripts/inspect-catalog.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })

const CATS = ['wellbeing', 'teambuilding', 'learning', 'food', 'culture', 'travel', 'sport', 'tech', 'consulting']
const UNITS = ['person', 'group', 'hour', 'project', 'month', 'unit']
const MODES = ['at_client', 'at_provider', 'remote', 'hybrid']

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

const isEmpty = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

const suppliers = await fetchAll('suppliers')
const services = await fetchAll('services')

console.log('=== COUNTS ===')
console.log('suppliers:', suppliers.length, '| active:', suppliers.filter((s) => s.is_active).length)
console.log('services :', services.length, '| active:', services.filter((s) => s.is_active).length)
console.log('avg services/supplier:', (services.length / Math.max(1, suppliers.length)).toFixed(1))

const fields = {
  'category_primary (קטגוריה)': (s) => s.category_primary,
  'service_name (שם השירות)': (s) => s.service_name,
  'duration_minutes (זמן פעילות)': (s) => s.duration_minutes,
  'price (תמחור)': (s) => s.price,
  'pricing_unit (יחידת תמחור)': (s) => s.pricing_unit,
  'location_mode (מיקום)': (s) => s.location_mode,
  'min_participants (מינ׳)': (s) => s.min_participants,
  'max_participants (מקס׳)': (s) => s.max_participants,
  'description_short (תיאור)': (s) => s.description_short,
  'notes (הערות)': (s) => s.notes,
}

console.log('\n=== GAP ANALYSIS (services with empty field) ===')
for (const [name, f] of Object.entries(fields)) {
  const n = services.filter((s) => isEmpty(f(s))).length
  console.log(`  ${name.padEnd(30)} ${String(n).padStart(4)}/${services.length}  (${Math.round((n / Math.max(1, services.length)) * 100)}%)`)
}
const noPrice = services.filter((s) => isEmpty(s.price) && isEmpty(s.price_min) && isEmpty(s.price_max)).length
console.log('  services with NO price at all (price+min+max empty):', noPrice)

console.log('\n=== ENUM VALIDITY ===')
const distinct = (f) => [...new Set(services.map(f).filter((v) => v != null))]
const cats = distinct((s) => s.category_primary)
console.log('category_primary :', JSON.stringify(cats))
console.log('  invalid cats   :', JSON.stringify(cats.filter((c) => !CATS.includes(c))))
const units = distinct((s) => s.pricing_unit)
console.log('pricing_unit     :', JSON.stringify(units), '| invalid:', JSON.stringify(units.filter((u) => !UNITS.includes(u))))
const modes = distinct((s) => s.location_mode)
console.log('location_mode    :', JSON.stringify(modes), '| invalid:', JSON.stringify(modes.filter((m) => !MODES.includes(m))))
const ltypes = distinct((s) => s.location_type)
console.log('location_type    :', JSON.stringify(ltypes))

console.log('\n=== SUPPLIERS ===')
console.log('without logo_url        :', suppliers.filter((s) => isEmpty(s.logo_url)).length)
console.log('without description_short:', suppliers.filter((s) => isEmpty(s.description_short)).length)
console.log('without website         :', suppliers.filter((s) => isEmpty(s.website)).length)

const gapCount = (s) => Object.values(fields).filter((f) => isEmpty(f(s))).length
const gappy = services.map((s) => ({ s, g: gapCount(s) })).filter((x) => x.g >= 3).sort((a, b) => b.g - a.g)
console.log(`\n=== services with >=3 gaps: ${gappy.length} (sample 6) ===`)
for (const { s, g } of gappy.slice(0, 6)) {
  console.log(
    `  [${g}] "${(s.service_name || '').slice(0, 28)}" cat=${s.category_primary} price=${s.price}/${s.pricing_unit} dur=${s.duration_minutes} ppl=${s.min_participants}-${s.max_participants} loc=${s.location_mode} desc="${(s.description_short || '').slice(0, 24)}" notes="${(s.notes || '').slice(0, 24)}"`
  )
}
