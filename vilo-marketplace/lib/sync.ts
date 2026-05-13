/**
 * Sync approved staging-Sheet rows into the marketplace DB.
 *
 * For each row:
 *   1. Match or create the supplier (by Hebrew name).
 *   2. Map the Hebrew section header (e.g. "פעילות לזוגות") to one of
 *      Vilo's 9 canonical category slugs. ONE Claude call per batch
 *      handles all distinct categories; mapping is cached in-memory.
 *   3. Upsert the service onto the unique-tier composite key from
 *      migration 002.
 *   4. After all rows processed, mark the corresponding Sheet rows
 *      _status='synced'.
 *
 * Errors are per-row: a bad row logs + skips, the rest still sync.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  readStagingRows,
  markRowsSynced,
  type StagingRow,
} from './sheets'

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
export type CategorySlug = (typeof CATEGORY_SLUGS)[number]

export interface SyncStats {
  read: number
  inserted: number
  updated: number
  failed: number
  failures: Array<{ row_id: string; service_name: string | null; reason: string }>
  sheet_url: string | null
}

function getServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Category mapping (Hebrew section header -> canonical slug) ───────

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
  const unique = Array.from(
    new Set(hebrewCategories.filter((c) => c && c.trim()))
  )
  if (unique.length === 0) return {}

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: CATEGORY_MAP_SYSTEM,
    tools: [
      {
        name: 'submit_category_mapping',
        description:
          'Submit the Hebrew-to-slug mapping for every category provided.',
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
    if (slug && (CATEGORY_SLUGS as readonly string[]).includes(slug)) {
      out[h] = slug as CategorySlug
    } else {
      console.warn(`[sync] category "${h}" not mapped, defaulting to "consulting"`)
      out[h] = 'consulting'
    }
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

/** Normalize a Hebrew/English supplier name so that "רות גנאל",
 *  "רות גנאל " and "רות  גנאל" all collapse to the same lookup key.
 *  - NFKC unicode normalization (composed forms, compatibility chars)
 *  - strip Hebrew niqqud / cantillation marks (U+0591..U+05C7)
 *  - collapse any run of whitespace to a single ASCII space
 *  - strip surrounding whitespace
 */
function normalizeSupplierName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[֑-ׇ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function findOrCreateSupplier(
  supabase: SupabaseClient,
  row: StagingRow,
  schemaColumns: { suppliers: Set<string> }
): Promise<{ id: string; created: boolean } | { error: string }> {
  if (!row.supplier_name) {
    return { error: 'row has no supplier_name' }
  }
  const name = normalizeSupplierName(row.supplier_name)
  if (!name) return { error: 'supplier_name normalized to empty string' }

  // Exact-match first (covers everything already canonicalised).
  const { data: existing, error: findErr } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('name', name)
    .limit(1)
    .maybeSingle()

  if (findErr) return { error: `supplier lookup failed: ${findErr.message}` }
  if (existing) return { id: existing.id, created: false }

  // Fallback: case-insensitive match in case the existing row was inserted
  // before normalization landed (legacy seed data, manual inserts). Avoids
  // creating a duplicate supplier for "Ruth Ganel" vs "ruth ganel" etc.
  const { data: ciMatch, error: ciErr } = await supabase
    .from('suppliers')
    .select('id, name')
    .ilike('name', name)
    .limit(1)
    .maybeSingle()
  if (ciErr) return { error: `supplier ilike lookup failed: ${ciErr.message}` }
  if (ciMatch) {
    console.log(
      `[sync] supplier "${row.supplier_name}" matched existing "${ciMatch.name}" via case-insensitive lookup`
    )
    return { id: ciMatch.id, created: false }
  }

  // Build payload using only columns the DB actually has — keeps the sync
  // working when a migration column hasn't landed yet.
  const newSlug = slugify(name) || `supplier-${Date.now()}`
  const payload: Record<string, unknown> = {
    name,
    slug: newSlug,
    is_active: true,
  }
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

  if (createErr) {
    return { error: `supplier create failed: ${createErr.message}` }
  }
  return { id: created.id, created: true }
}

// ── Single-row upsert ────────────────────────────────────────────────

async function upsertOneRow(
  supabase: SupabaseClient,
  row: StagingRow,
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

  // Always-present columns from migration 001.
  const payload: Record<string, unknown> = {
    supplier_id: supplierId,
    service_name: row.service_name || '',
    category_primary: categorySlug,
    category_secondary: row.supplier_category,
    description_short: row.service_description?.slice(0, 200) || null,
    price: row.price_ils,
    min_participants: row.capacity_min,
    max_participants: row.capacity_max,
    duration_minutes: durationMinutes,
    location_type: legacyLocation,
    language: 'he',
    notes: row.supplier_notes,
    is_active: true,
  }

  // Migration-002 columns — only set if the DB has them.
  if (has('service_description')) payload.service_description = row.service_description
  if (has('price_type')) payload.price_type = row.price_type
  if (has('price_min')) payload.price_min = row.price_min
  if (has('price_max')) payload.price_max = row.price_max
  if (has('location_mode')) payload.location_mode = row.location_mode
  if (has('staging_row_id')) payload.staging_row_id = row._row_id

  // Manual upsert: PostgREST's ON CONFLICT can't match the expression-based
  // unique index `services_tier_unique` (it uses COALESCE on min/max
  // participants). SELECT first, then INSERT or UPDATE accordingly.
  //
  // category_secondary in the lookup keeps services with identical name
  // + price + capacity but from different PDF sections (e.g.
  // "יעוץ פרטני להורים — מפגש בודד בקליניקה" appears in both the
  // young-kids and teens sections of Ruth Ganel's catalog) as separate
  // rows instead of collapsing them. Same fix as the extractor's
  // mergeAndValidate.
  let lookup = supabase
    .from('services')
    .select('id')
    .eq('supplier_id', supplierId)
    .eq('service_name', row.service_name || '')
  // .eq() on null doesn't match — use .is() for nulls.
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

  const { data: existing, error: lookupErr } = await lookup
    .limit(1)
    .maybeSingle()
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

/** Discover what columns exist on suppliers + services. PostgREST doesn't
 *  expose information_schema, so we use `select *` on one existing row —
 *  the returned object has all the actual column names as keys. Both
 *  tables have rows from the original seed, so this is cheap + reliable. */
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

  // Suppliers might genuinely be empty on a fresh install. Fall back to the
  // conservative migration-001 column set.
  if (suppliers.size === 0) {
    console.warn('[sync] suppliers had no rows — falling back to mig-001 columns')
    ;['name', 'slug', 'logo_url', 'contact_email', 'description_short', 'is_active'].forEach(
      (c) => suppliers.add(c)
    )
  }
  if (services.size === 0) {
    console.warn('[sync] services had no rows — falling back to mig-001 columns')
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

export async function syncApprovedRows(): Promise<SyncStats> {
  const supabase = getServiceRoleClient()
  const anthropic = new Anthropic({ apiKey: process.env.VILO_ANTHROPIC_KEY })
  const rows = await readStagingRows('approved')
  console.log(`[sync] read ${rows.length} approved rows from Sheet`)

  const stats: SyncStats = {
    read: rows.length,
    inserted: 0,
    updated: 0,
    failed: 0,
    failures: [],
    sheet_url: process.env.SHEETS_STAGING_ID
      ? `https://docs.google.com/spreadsheets/d/${process.env.SHEETS_STAGING_ID}`
      : null,
  }

  if (rows.length === 0) return stats

  // Discover what columns actually exist before writing anything. Avoids
  // hitting "column not found" 36 times when a migration hasn't fully run.
  const schemaColumns = await readSchemaColumns(supabase)
  console.log(
    `[sync] schema: suppliers has ${schemaColumns.suppliers.size} cols, services has ${schemaColumns.services.size} cols`
  )

  // Build the category mapping once per batch — one Claude call total.
  const categoryStrings = rows
    .map((r) => r.supplier_category)
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
  const categoryMap =
    categoryStrings.length > 0
      ? await mapCategoriesToSlugs(anthropic, categoryStrings)
      : {}
  console.log(
    `[sync] category mapping:`,
    Object.entries(categoryMap)
      .map(([h, s]) => `"${h}" -> ${s}`)
      .join(', ')
  )

  // Cache supplier IDs by name across the batch (find-or-create runs
  // once per distinct supplier).
  const supplierCache = new Map<string, string>()
  const syncedRowNumbers: number[] = []

  for (const row of rows) {
    const recordFailure = (reason: string) => {
      stats.failed++
      stats.failures.push({
        row_id: row._row_id,
        service_name: row.service_name,
        reason,
      })
      console.warn(`[sync] row "${row.service_name}" failed: ${reason}`)
    }

    if (!row.supplier_name) {
      recordFailure('missing supplier_name')
      continue
    }
    if (!row.service_name) {
      recordFailure('missing service_name')
      continue
    }

    let supplierId = supplierCache.get(row.supplier_name)
    if (!supplierId) {
      const result = await findOrCreateSupplier(supabase, row, schemaColumns)
      if ('error' in result) {
        recordFailure(result.error)
        continue
      }
      supplierId = result.id
      supplierCache.set(row.supplier_name, supplierId)
    }

    const slug = row.supplier_category
      ? categoryMap[row.supplier_category] || 'consulting'
      : 'consulting'

    const upsertResult = await upsertOneRow(
      supabase,
      row,
      supplierId,
      slug,
      schemaColumns
    )
    if (typeof upsertResult === 'object' && 'error' in upsertResult) {
      recordFailure(upsertResult.error)
      continue
    }
    if (upsertResult === 'updated') stats.updated++
    else stats.inserted++
    syncedRowNumbers.push(row._sheet_row_number)
  }

  // Mark synced rows in the Sheet so a re-run doesn't re-sync them.
  if (syncedRowNumbers.length > 0) {
    try {
      await markRowsSynced(syncedRowNumbers)
      console.log(`[sync] marked ${syncedRowNumbers.length} Sheet rows as synced`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error(`[sync] failed to mark rows synced: ${msg}`)
    }
  }

  console.log(
    `[sync] done: ${stats.inserted} upserted, ${stats.failed} failed of ${stats.read} read`
  )
  return stats
}
