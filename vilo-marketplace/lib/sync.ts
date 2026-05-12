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

async function findOrCreateSupplier(
  supabase: SupabaseClient,
  row: StagingRow
): Promise<{ id: string; created: boolean } | { error: string }> {
  if (!row.supplier_name) {
    return { error: 'row has no supplier_name' }
  }
  const name = row.supplier_name.trim()

  // Try to find an existing supplier by exact name match.
  const { data: existing, error: findErr } = await supabase
    .from('suppliers')
    .select('id')
    .eq('name', name)
    .limit(1)
    .maybeSingle()

  if (findErr) return { error: `supplier lookup failed: ${findErr.message}` }
  if (existing) return { id: existing.id, created: false }

  // No match — create a new supplier.
  const newSlug = slugify(name) || `supplier-${Date.now()}`
  const { data: created, error: createErr } = await supabase
    .from('suppliers')
    .insert({
      name,
      slug: newSlug,
      name_en: row.supplier_name_en,
      website: row.supplier_website,
      is_active: true,
    })
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
  categorySlug: CategorySlug
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
      ? 'onsite' // best-effort legacy mapping; staging row carries the real value via location_mode
      : null

  const payload = {
    supplier_id: supplierId,
    service_name: row.service_name || '',
    category_primary: categorySlug,
    category_secondary: row.supplier_category, // keep verbatim Hebrew for UX
    description_short: row.service_description?.slice(0, 200) || null,
    service_description: row.service_description,
    price: row.price_ils,
    price_type: row.price_type,
    price_min: row.price_min,
    price_max: row.price_max,
    pricing_unit: null, // future: derive from supplier_notes
    min_participants: row.capacity_min,
    max_participants: row.capacity_max,
    duration_minutes: durationMinutes,
    location_mode: row.location_mode,
    location_type: legacyLocation,
    language: 'he',
    notes: row.supplier_notes,
    staging_row_id: row._row_id,
    is_active: true,
  }

  // Composite-key upsert. Migration 002 created services_tier_unique on
  // (supplier_id, service_name, COALESCE(min_participants,-1), COALESCE(max_participants,-1)).
  const { error } = await supabase.from('services').upsert(payload, {
    onConflict: 'supplier_id,service_name,min_participants,max_participants',
  })

  if (error) return { error: `upsert failed: ${error.message}` }

  // upsert doesn't tell us insert vs update; we don't strictly need to
  // distinguish. Treat as inserted for the stats — it's a close
  // approximation good enough for the UI.
  return 'inserted'
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
      const result = await findOrCreateSupplier(supabase, row)
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

    const upsertResult = await upsertOneRow(supabase, row, supplierId, slug)
    if (typeof upsertResult === 'object' && 'error' in upsertResult) {
      recordFailure(upsertResult.error)
      continue
    }
    stats.inserted++
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
