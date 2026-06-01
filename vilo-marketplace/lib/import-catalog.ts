/**
 * Import reviewed catalog rows DIRECTLY into the marketplace DB.
 *
 * This is the in-app alternative to the old extract → Google-Sheets → approve →
 * sync round-trip. The admin extracts (batch), reviews/edits the rows in the
 * browser, then imports here in one click. The per-row logic — category
 * mapping, supplier find-or-create, tier upsert, schema-aware column writes —
 * mirrors lib/sync.ts so both paths behave identically; this one just reads its
 * rows from the request body instead of a Sheet.
 *
 * Errors are per-row: a bad row logs + skips, the rest still import.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { CatalogRow } from './extractors/types'

const CATEGORY_SLUGS = [
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
type CategorySlug = (typeof CATEGORY_SLUGS)[number]

export interface ImportStats {
  read: number
  inserted: number
  updated: number
  failed: number
  suppliers_created: number
  failures: Array<{ service_name: string | null; reason: string }>
}

function getServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Category mapping (Hebrew section header → canonical slug) ─────────

const CATEGORY_MAP_SYSTEM = `You map Hebrew supplier-catalog section headers onto Vilo Marketplace's 9 canonical category slugs.

Valid slugs:
- wellbeing — wellness, mindfulness, mental health, parent counseling, couples therapy, personal growth
- teambuilding — team events, group activities, social gatherings, team challenges
- learning — workshops, lectures, training, education
- food — culinary, cooking, dining, catering
- culture — art, music, creativity, performance
- travel — outdoor trips, hiking, adventure
- sport — fitness, athletics, movement, self-defense
- tech — AI, programming, technology
- consulting — business advice, organizational development

Pick the single best slug for each Hebrew header. If it could fit multiple, pick the most prominent. Never invent slugs outside the list.`

async function mapCategoriesToSlugs(
  anthropic: Anthropic,
  hebrewCategories: string[]
): Promise<Record<string, CategorySlug>> {
  const unique = Array.from(new Set(hebrewCategories.filter((c) => c && c.trim())))
  if (unique.length === 0) return {}

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: CATEGORY_MAP_SYSTEM,
    tools: [
      {
        name: 'submit_category_mapping',
        description: 'Submit the Hebrew-to-slug mapping for every category provided.',
        input_schema: {
          type: 'object',
          properties: {
            mapping: {
              type: 'object',
              additionalProperties: { type: 'string', enum: [...CATEGORY_SLUGS] },
            },
          },
          required: ['mapping'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_category_mapping' },
    messages: [
      {
        role: 'user',
        content: `Map each Hebrew section header to one slug:\n${unique
          .map((c) => `- ${c}`)
          .join('\n')}`,
      },
    ],
  })

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Category mapping: no tool_use in response')
  }
  const input = toolUse.input as { mapping?: Record<string, string> }
  if (!input.mapping) throw new Error('Category mapping: empty result')

  const out: Record<string, CategorySlug> = {}
  for (const h of unique) {
    const slug = input.mapping[h]
    out[h] =
      slug && (CATEGORY_SLUGS as readonly string[]).includes(slug)
        ? (slug as CategorySlug)
        : 'consulting'
  }
  return out
}

// ── Supplier matching / creation ─────────────────────────────────────

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9א-ת]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/** Collapse whitespace + niqqud so name variants resolve to one supplier. */
function normalizeSupplierName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[֑-ׇ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function findOrCreateSupplier(
  supabase: SupabaseClient,
  row: CatalogRow,
  schemaColumns: { suppliers: Set<string> }
): Promise<{ id: string; created: boolean } | { error: string }> {
  if (!row.supplier_name) return { error: 'row has no supplier_name' }
  const name = normalizeSupplierName(row.supplier_name)
  if (!name) return { error: 'supplier_name normalized to empty string' }

  const { data: existing, error: findErr } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('name', name)
    .limit(1)
    .maybeSingle()
  if (findErr) return { error: `supplier lookup failed: ${findErr.message}` }
  if (existing) return { id: existing.id, created: false }

  const { data: ciMatch, error: ciErr } = await supabase
    .from('suppliers')
    .select('id, name')
    .ilike('name', name)
    .limit(1)
    .maybeSingle()
  if (ciErr) return { error: `supplier ilike lookup failed: ${ciErr.message}` }
  if (ciMatch) return { id: ciMatch.id, created: false }

  const newSlug = slugify(name) || `supplier-${Date.now()}`
  const payload: Record<string, unknown> = { name, slug: newSlug, is_active: true }
  if (schemaColumns.suppliers.has('name_en') && row.supplier_name_en) {
    payload.name_en = row.supplier_name_en
  }
  if (schemaColumns.suppliers.has('website') && row.supplier_website) {
    payload.website = row.supplier_website
  }

  const { data: created, error: createErr } = await supabase
    .from('suppliers')
    .insert(payload)
    .select('id')
    .single()
  if (createErr) return { error: `supplier create failed: ${createErr.message}` }
  return { id: created.id, created: true }
}

// ── Single-row upsert ────────────────────────────────────────────────

async function upsertOneRow(
  supabase: SupabaseClient,
  row: CatalogRow,
  supplierId: string,
  categorySlug: CategorySlug,
  schemaColumns: { services: Set<string> }
): Promise<'inserted' | 'updated' | { error: string }> {
  const durationMinutes =
    row.duration_hours != null ? Math.round(row.duration_hours * 60) : null
  const legacyLocation =
    row.location_mode === 'at_client'
      ? 'onsite'
      : row.location_mode === 'remote'
      ? 'remote'
      : row.location_mode === 'hybrid'
      ? 'both'
      : row.location_mode === 'at_provider'
      ? 'onsite'
      : null

  const has = (col: string) => schemaColumns.services.has(col)

  const payload: Record<string, unknown> = {
    supplier_id: supplierId,
    service_name: row.service_name || '',
    category_primary: categorySlug,
    category_secondary: row.supplier_category,
    description_short: row.service_description?.slice(0, 200) || null,
    price: row.price_ils,
    pricing_unit: row.pricing_unit,
    min_participants: row.capacity_min,
    max_participants: row.capacity_max,
    duration_minutes: durationMinutes,
    location_type: legacyLocation,
    language: 'he',
    notes: row.supplier_notes,
    is_active: true,
  }
  if (has('service_description')) payload.service_description = row.service_description
  if (has('price_type')) payload.price_type = row.price_type
  if (has('price_min')) payload.price_min = row.price_min
  if (has('price_max')) payload.price_max = row.price_max
  if (has('location_mode')) payload.location_mode = row.location_mode

  // Manual upsert on the (supplier, name, capacity, category_secondary) tier key.
  let lookup = supabase
    .from('services')
    .select('id')
    .eq('supplier_id', supplierId)
    .eq('service_name', row.service_name || '')
  lookup =
    row.capacity_min == null
      ? lookup.is('min_participants', null)
      : lookup.eq('min_participants', row.capacity_min)
  lookup =
    row.capacity_max == null
      ? lookup.is('max_participants', null)
      : lookup.eq('max_participants', row.capacity_max)
  lookup =
    row.supplier_category == null || row.supplier_category === ''
      ? lookup.is('category_secondary', null)
      : lookup.eq('category_secondary', row.supplier_category)

  const { data: existing, error: lookupErr } = await lookup.limit(1).maybeSingle()
  if (lookupErr) return { error: `lookup failed: ${lookupErr.message}` }

  if (existing) {
    const { error: updateErr } = await supabase
      .from('services')
      .update(payload)
      .eq('id', existing.id)
    if (updateErr) return { error: `update failed: ${updateErr.message}` }
    return 'updated'
  }

  const { error: insertErr } = await supabase.from('services').insert(payload)
  if (insertErr) return { error: `insert failed: ${insertErr.message}` }
  return 'inserted'
}

/** Discover which columns exist on suppliers + services (PostgREST has no
 *  information_schema, so read one row and look at its keys). */
async function readSchemaColumns(
  supabase: SupabaseClient
): Promise<{ suppliers: Set<string>; services: Set<string> }> {
  const [suppRes, svcRes] = await Promise.all([
    supabase.from('suppliers').select('*').limit(1),
    supabase.from('services').select('*').limit(1),
  ])
  const suppliers = new Set<string>(
    suppRes.data && suppRes.data[0] ? Object.keys(suppRes.data[0]) : []
  )
  const services = new Set<string>(
    svcRes.data && svcRes.data[0] ? Object.keys(svcRes.data[0]) : []
  )
  if (suppliers.size === 0) {
    ;['name', 'slug', 'logo_url', 'contact_email', 'description_short', 'is_active'].forEach((c) =>
      suppliers.add(c)
    )
  }
  if (services.size === 0) {
    ;[
      'supplier_id',
      'service_name',
      'category_primary',
      'category_secondary',
      'description_short',
      'min_participants',
      'max_participants',
      'duration_minutes',
      'price',
      'pricing_unit',
      'notes',
      'is_active',
      'language',
      'location_type',
    ].forEach((c) => services.add(c))
  }
  return { suppliers, services }
}

// ── Orchestrator ─────────────────────────────────────────────────────

/** Import a batch of reviewed catalog rows into suppliers + services. */
export async function importCatalogRows(rows: CatalogRow[]): Promise<ImportStats> {
  const supabase = getServiceRoleClient()
  const anthropic = new Anthropic({ apiKey: process.env.VILO_ANTHROPIC_KEY })

  const stats: ImportStats = {
    read: rows.length,
    inserted: 0,
    updated: 0,
    failed: 0,
    suppliers_created: 0,
    failures: [],
  }
  if (rows.length === 0) return stats

  const schemaColumns = await readSchemaColumns(supabase)

  const categoryStrings = rows
    .map((r) => r.supplier_category)
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
  const categoryMap =
    categoryStrings.length > 0 ? await mapCategoriesToSlugs(anthropic, categoryStrings) : {}

  const supplierCache = new Map<string, string>()

  for (const row of rows) {
    const fail = (reason: string) => {
      stats.failed++
      stats.failures.push({ service_name: row.service_name, reason })
      console.warn(`[import] row "${row.service_name}" failed: ${reason}`)
    }

    if (!row.supplier_name) {
      fail('missing supplier_name')
      continue
    }
    if (!row.service_name) {
      fail('missing service_name')
      continue
    }

    let supplierId = supplierCache.get(row.supplier_name)
    if (!supplierId) {
      const result = await findOrCreateSupplier(supabase, row, schemaColumns)
      if ('error' in result) {
        fail(result.error)
        continue
      }
      supplierId = result.id
      if (result.created) stats.suppliers_created++
      supplierCache.set(row.supplier_name, supplierId)
    }

    const slug = row.supplier_category
      ? categoryMap[row.supplier_category] || 'consulting'
      : 'consulting'

    const result = await upsertOneRow(supabase, row, supplierId, slug, schemaColumns)
    if (typeof result === 'object' && 'error' in result) {
      fail(result.error)
      continue
    }
    if (result === 'updated') stats.updated++
    else stats.inserted++
  }

  console.log(
    `[import] ${stats.inserted} inserted, ${stats.updated} updated, ${stats.failed} failed, ${stats.suppliers_created} new suppliers`
  )
  return stats
}
