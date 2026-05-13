/**
 * Fast path for structured tabular input (Excel/CSV).
 *
 * Why this exists: row-by-row LLM normalization for a 688-row catalog
 * generates ~80K output tokens and trips low-tier Anthropic rate limits
 * (8K OPM). For tabular sources with consistent columns, we only need
 * ONE LLM call to learn the schema mapping, then transform every row
 * in pure JS.
 *
 * Falls back to the per-row LLM path (see normalize.ts) for
 * unstructured input (PDF/Word/URL/free text) where each row could be
 * a different shape.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { CatalogRow } from './types'
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

const PRICING_UNIT_VALUES = [
  'person',
  'group',
  'hour',
  'project',
  'month',
  'unit',
] as const

const LOCATION_VALUES = ['at_client', 'at_provider', 'remote', 'hybrid'] as const

const SCHEMA_SYSTEM = `You're mapping a third-party data source onto Vilo Marketplace's canonical service catalog schema.

You'll see the source's column headers and a sample of rows. Produce three mappings:

1. column_mappings: source column name -> one of Vilo's catalog fields, or "IGNORE" if no good match.
   Valid catalog fields: ${CATALOG_COLUMNS.join(', ')}
   "IGNORE" is fine — not every column needs to map.

2. category_mappings: any string the source uses to indicate a category -> one of Vilo's category slugs.
   Valid slugs: ${CATEGORY_VALUES.join(', ')}
   The source's category column may use Hebrew or English. Map each distinct value you see.

3. pricing_unit_mappings: any string the source uses for "price per X" -> one of Vilo's pricing units.
   Valid units: ${PRICING_UNIT_VALUES.join(', ')}
   The source may use Hebrew (קבוצה, שעה, אדם, פרויקט, חודש, יחידה) or English. Map each distinct value.

4. location_mappings (optional): any string -> one of: ${LOCATION_VALUES.join(', ')}.
   Semantics:
     at_provider = at the supplier's clinic / studio / venue
     at_client   = at the buyer's office / workplace
     remote      = online / video
     hybrid      = either, supplier's choice
   Hebrew examples: "בקליניקה" -> at_provider, "במקום העבודה" -> at_client.
   If the source has no location column, return {}.

5. duration_parser: if the source's duration column is text like "60-75 דק'" or "1.5 hours",
   give a short regex or instruction we can apply. If the column is already numeric, return "numeric".
   If the source has no duration column, return null.

Be thorough — every distinct value you see in the sample should be mapped. The mappings will be applied to all 688 rows.`

export interface SourceSchema {
  column_mappings: Record<string, string>
  category_mappings: Record<string, string>
  pricing_unit_mappings: Record<string, string>
  location_mappings: Record<string, string>
  duration_parser: string | null
}

export async function inferSourceSchema(
  client: Anthropic,
  headers: string[],
  sampleRows: Record<string, unknown>[],
  sourceLabel: string
): Promise<SourceSchema> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: SCHEMA_SYSTEM,
    tools: [
      {
        name: 'submit_schema',
        description: 'Submit the source schema mapping.',
        input_schema: {
          type: 'object',
          properties: {
            column_mappings: {
              type: 'object',
              description:
                'Map of source column name -> canonical field name (or "IGNORE").',
              additionalProperties: { type: 'string' },
            },
            category_mappings: {
              type: 'object',
              description: 'Map of source category value -> canonical slug.',
              additionalProperties: {
                type: 'string',
                enum: [...CATEGORY_VALUES],
              },
            },
            pricing_unit_mappings: {
              type: 'object',
              description: 'Map of source pricing-unit value -> canonical unit.',
              additionalProperties: {
                type: 'string',
                enum: [...PRICING_UNIT_VALUES],
              },
            },
            location_mappings: {
              type: 'object',
              description:
                'Optional. Map of source location string -> canonical location.',
              additionalProperties: {
                type: 'string',
                enum: [...LOCATION_VALUES],
              },
            },
            duration_parser: {
              type: ['string', 'null'],
              description:
                '"numeric" if duration column is already a number; otherwise a short note (e.g. "minutes" or "hours"); null if no duration column.',
            },
          },
          required: [
            'column_mappings',
            'category_mappings',
            'pricing_unit_mappings',
            'location_mappings',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_schema' },
    messages: [
      {
        role: 'user',
        content: `Source: ${sourceLabel}
Column headers: ${headers.join(' | ')}

Sample rows (first 8):
${JSON.stringify(sampleRows.slice(0, 8), null, 2)}`,
      },
    ],
  })

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(`Schema inference returned no tool use. stop_reason=${response.stop_reason}`)
  }
  return toolUse.input as SourceSchema
}

/** Try to extract a number from a string like "60-75 דק'" or "1.5 hours". */
function parseDurationToHours(val: unknown, parser: string | null): number | null {
  if (val == null) return null
  if (typeof val === 'number') {
    // Could be in minutes or hours depending on the source. Heuristic:
    // values > 12 are probably minutes, < 12 probably hours.
    if (parser === 'numeric' || parser === 'hours') {
      return val > 24 ? val / 60 : val
    }
    if (parser === 'minutes') return val / 60
    return val > 24 ? val / 60 : val
  }
  const s = String(val)
  // Extract first number(s)
  const range = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/)
  if (range) {
    const avg = (parseFloat(range[1]) + parseFloat(range[2])) / 2
    return s.match(/דק|min/i) ? avg / 60 : avg
  }
  const single = s.match(/(\d+(?:\.\d+)?)/)
  if (single) {
    const n = parseFloat(single[1])
    return s.match(/דק|min/i) ? n / 60 : n
  }
  return null
}

function toNumber(val: unknown): number | null {
  if (val == null || val === '') return null
  if (typeof val === 'number') return val
  const n = Number(String(val).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function toInt(val: unknown): number | null {
  const n = toNumber(val)
  return n == null ? null : Math.round(n)
}

function toStr(val: unknown): string | null {
  if (val == null) return null
  const s = String(val).trim()
  return s === '' ? null : s
}

/**
 * Apply an inferred schema to every row of a source. Pure JS, no LLM call.
 * Tolerant to missing columns and unmapped values.
 */
export function applySchemaToRows(
  rows: Record<string, unknown>[],
  schema: SourceSchema
): CatalogRow[] {
  const out: CatalogRow[] = []

  for (const row of rows) {
    const r: Partial<CatalogRow> = {}

    for (const [srcCol, rawVal] of Object.entries(row)) {
      const targetField = schema.column_mappings[srcCol]
      if (!targetField || targetField === 'IGNORE') continue

      switch (targetField) {
        case 'supplier_id':
        case 'supplier_name':
        case 'supplier_name_en':
        case 'supplier_website':
        case 'service_id':
        case 'service_name':
        case 'service_description':
        case 'tags':
        case 'supplier_notes':
          r[targetField] = toStr(rawVal)
          break
        case 'supplier_category': {
          const s = toStr(rawVal)
          if (s) {
            const mapped = schema.category_mappings[s]
            // mapped may itself be null if Claude declined; keep raw string as fallback
            r.supplier_category = mapped || s
          }
          break
        }
        case 'price_ils':
        case 'price_min':
        case 'price_max':
          r[targetField] = toNumber(rawVal)
          break
        case 'capacity_min':
        case 'capacity_max':
          r[targetField] = toInt(rawVal)
          break
        case 'duration_hours':
          r.duration_hours = parseDurationToHours(rawVal, schema.duration_parser)
          break
        case 'location_mode': {
          const s = toStr(rawVal)
          if (s) {
            const mapped = schema.location_mappings[s]
            if (mapped) r.location_mode = mapped as CatalogRow['location_mode']
          }
          break
        }
        case 'price_type': {
          const s = toStr(rawVal)?.toLowerCase()
          if (s === 'fixed' || s === 'on_request' || s === 'range') {
            r.price_type = s
          }
          break
        }
        default:
          break
      }
    }

    // If we extracted a price and no explicit price_type, infer one.
    if (r.price_ils != null && !r.price_type) r.price_type = 'fixed'

    // Map any pricing-unit-like value through the LLM-suggested mappings
    // into CatalogRow.pricing_unit. The marketplace's budget filter
    // depends on this — a synced per-person row with pricing_unit=NULL
    // gets compared against the *total* budget instead of per-person.
    for (const rawVal of Object.values(row)) {
      const mapped = schema.pricing_unit_mappings[String(rawVal)]
      if (!mapped) continue
      if (
        mapped === 'person' ||
        mapped === 'group' ||
        mapped === 'hour' ||
        mapped === 'project' ||
        mapped === 'month' ||
        mapped === 'unit'
      ) {
        r.pricing_unit = mapped
        break
      }
    }

    // Backfill every catalog column with null so callers don't need to
    // probe for missing keys.
    const full: CatalogRow = {
      supplier_id: r.supplier_id ?? null,
      supplier_name: r.supplier_name ?? null,
      supplier_name_en: r.supplier_name_en ?? null,
      supplier_category: r.supplier_category ?? null,
      supplier_website: r.supplier_website ?? null,
      service_id: r.service_id ?? null,
      service_name: r.service_name ?? null,
      service_description: r.service_description ?? null,
      price_ils: r.price_ils ?? null,
      pricing_unit: r.pricing_unit ?? null,
      price_type: r.price_type ?? null,
      price_min: r.price_min ?? null,
      price_max: r.price_max ?? null,
      capacity_min: r.capacity_min ?? null,
      capacity_max: r.capacity_max ?? null,
      duration_hours: r.duration_hours ?? null,
      location_mode: r.location_mode ?? null,
      tags: r.tags ?? null,
      supplier_notes: r.supplier_notes ?? null,
    }

    // Drop rows that are entirely empty (defensive — happens if a sheet
    // has trailing blank lines).
    const hasAny = Object.values(full).some((v) => v !== null && v !== '')
    if (hasAny) out.push(full)
  }

  return out
}
