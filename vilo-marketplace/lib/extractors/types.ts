/**
 * Per-field confidence on a scale of 1-5.
 *   5 = directly read from a labeled cell / explicit value
 *   3 = inferred reasonably
 *   1 = guessed, almost certainly needs review
 * Surfaced in the Sheet so a human can spot-check low-confidence rows fast.
 */
export type ConfidenceScore = 1 | 2 | 3 | 4 | 5

/**
 * Canonical shape of a row in the master catalog.
 * Every extractor — Excel, PDF, Word, URL, free text — normalizes to this.
 * The Google Sheets staging tab + the DB sync both speak this vocabulary.
 */
export type LocationMode = 'at_client' | 'at_provider' | 'remote' | 'hybrid'

/** What the price is *for*. Mirrors the marketplace PricingUnit but kept
 *  redundantly here so the extractor + sync don't import from app code. */
export type PricingUnit =
  | 'person'
  | 'group'
  | 'hour'
  | 'project'
  | 'month'
  | 'unit'

export interface CatalogRow {
  supplier_id: string | null
  supplier_name: string | null
  supplier_name_en: string | null
  supplier_category: string | null
  supplier_website: string | null
  service_id: string | null
  service_name: string | null
  service_description: string | null
  price_ils: number | null
  price_type: 'fixed' | 'on_request' | 'range' | null
  price_min: number | null
  price_max: number | null
  /** What price_ils / price_min / price_max are charged *per*. Without
   *  this, the marketplace's budget filter treats every synced row as
   *  group-priced, which lets per-person services slip past. */
  pricing_unit: PricingUnit | null
  capacity_min: number | null
  capacity_max: number | null
  duration_hours: number | null
  /**
   * Where the service is delivered. Unambiguous about whose site is whose:
   *   at_client   = at the buyer's workplace / office / venue
   *   at_provider = at the supplier's clinic / studio / venue
   *   remote      = online / over video
   *   hybrid      = either at_client or at_provider, supplier's choice
   * Replaces the old `location` enum (offsite/onsite/flexible/remote) which
   * was constantly inverted by the model.
   */
  location_mode: LocationMode | null
  tags: string | null
  supplier_notes: string | null
  /** Average confidence across populated fields, 1-5. Computed at merge time. */
  _confidence_avg?: ConfidenceScore
  /** Per-field confidence map. Only fields the extractor scored are included. */
  _confidence?: Partial<Record<keyof Omit<CatalogRow, '_confidence' | '_confidence_avg'>, ConfidenceScore>>
}

export const CATALOG_COLUMNS: (keyof CatalogRow)[] = [
  'supplier_id',
  'supplier_name',
  'supplier_name_en',
  'supplier_category',
  'supplier_website',
  'service_id',
  'service_name',
  'service_description',
  'price_ils',
  'price_type',
  'price_min',
  'price_max',
  'pricing_unit',
  'capacity_min',
  'capacity_max',
  'duration_hours',
  'location_mode',
  'tags',
  'supplier_notes',
]

/** Image MIME types Claude vision accepts. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ExtractedSource {
  /** "excel", "pdf", "docx", "doc", "url", "text", "image" — what fed the extractor */
  source_type: 'excel' | 'pdf' | 'docx' | 'doc' | 'url' | 'text' | 'image'
  /** Filename, URL, or "pasted text" — what to show to the user */
  source_label: string
  /** If the source already has tabular rows (Excel/CSV), pass them through */
  rows?: Record<string, unknown>[]
  /** Free text for the LLM to read (Word/URL/text/Excel fallback) */
  raw_text?: string
  /** Raw PDF buffer — sent directly to Claude as a document content block.
   *  Avoids a separate parsing step; Claude handles vision + text natively. */
  pdf_buffer?: Buffer
  /** Image bytes for a photo/scan of a price list/flyer. Claude reads the
   *  Hebrew text in the picture natively (vision) — no OCR step needed. */
  image_buffer?: Buffer
  image_media_type?: ImageMediaType
  /** Supplier-name hint derived from the filename, used to fill supplier_name
   *  when the model leaves it null (one file is usually one supplier). */
  supplier_hint?: string
  /** Extra context the admin pasted alongside a website/file (e.g. prices not
   *  on the page) — folded into the extraction to fill otherwise-missing fields. */
  supplementary_text?: string
}
