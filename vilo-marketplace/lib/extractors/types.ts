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
  capacity_min: number | null
  capacity_max: number | null
  duration_hours: number | null
  location: 'offsite' | 'onsite' | 'flexible' | 'remote' | null
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
  'capacity_min',
  'capacity_max',
  'duration_hours',
  'location',
  'tags',
  'supplier_notes',
]

export interface ExtractedSource {
  /** "excel", "pdf", "docx", "url", "text" — what fed the extractor */
  source_type: 'excel' | 'pdf' | 'docx' | 'url' | 'text'
  /** Filename, URL, or "pasted text" — what to show to the user */
  source_label: string
  /** If the source already has tabular rows (Excel/CSV), pass them through */
  rows?: Record<string, unknown>[]
  /** Free text for the LLM to read (Word/URL/text/Excel fallback) */
  raw_text?: string
  /** Raw PDF buffer — sent directly to Claude as a document content block.
   *  Avoids a separate parsing step; Claude handles vision + text natively. */
  pdf_buffer?: Buffer
}
