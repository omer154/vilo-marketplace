/**
 * Google Sheets staging buffer.
 *
 * Every extraction lands here first. The user reviews / edits in the
 * Sheet, then Phase 2's "sync to DB" promotes approved rows. Until
 * sync, nothing hits the public marketplace.
 *
 * Auth via service account: a single JSON key in the
 * GOOGLE_SERVICE_ACCOUNT_JSON env var. The target Sheet must be shared
 * (Editor) with the service account's email.
 */

import { google, sheets_v4 } from 'googleapis'
import type { CatalogRow } from './extractors/types'

const SHEET_HEADERS = [
  '_status',
  '_confidence_avg',
  '_source',
  '_extracted_at',
  '_row_id',
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
  'location_mode',
  'tags',
  'supplier_notes',
  // pricing_unit added 2026-05-13 so the budget filter on the
  // marketplace works for synced rows. Appended at the end so existing
  // staging rows (which lack this column) keep their column alignment.
  'pricing_unit',
] as const

export interface SheetsConfig {
  spreadsheetId: string
  tabName: string
}

export class SheetsNotConfiguredError extends Error {
  constructor() {
    super('Sheets not configured — set GOOGLE_SERVICE_ACCOUNT_JSON, SHEETS_STAGING_ID, SHEETS_STAGING_TAB.')
    this.name = 'SheetsNotConfiguredError'
  }
}

export function getSheetsConfig(): SheetsConfig | null {
  const id = process.env.SHEETS_STAGING_ID
  const tab = process.env.SHEETS_STAGING_TAB || 'staging'
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !id) return null
  return { spreadsheetId: id, tabName: tab }
}

function getServiceAccountCredentials(): Record<string, string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new SheetsNotConfiguredError()
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${err instanceof Error ? err.message : 'unknown'}`
    )
  }
}

async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  const credentials = getServiceAccountCredentials()
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

/** Ensure the staging tab exists and has the expected header row. */
async function ensureHeaderRow(
  sheets: sheets_v4.Sheets,
  config: SheetsConfig
): Promise<void> {
  // Read row 1 of the tab
  const range = `${config.tabName}!1:1`
  let existing: string[] | undefined
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range,
    })
    existing = (res.data.values?.[0] as string[]) || []
  } catch (err) {
    const e = err as { code?: number; message?: string }
    // If the tab doesn't exist, create it.
    if (e.code === 400 && /Unable to parse range/i.test(e.message || '')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: config.tabName },
              },
            },
          ],
        },
      })
      existing = []
    } else {
      throw err
    }
  }

  // If the existing header row already matches, nothing to do.
  const expected = [...SHEET_HEADERS]
  const matches =
    existing &&
    existing.length >= expected.length &&
    expected.every((h, i) => existing![i] === h)
  if (matches) return

  // Otherwise write our expected headers into row 1.
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: `${config.tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [expected] },
  })
}

function fmt(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return String(v)
  return String(v)
}

/**
 * One staging-Sheet row as read back, with both the catalog fields and
 * the meta columns (_status, _row_id, …) the sync needs to identify and
 * mark it.
 */
export interface StagingRow extends CatalogRow {
  _status: string
  _row_id: string
  _source: string
  _extracted_at: string
  /** 1-indexed Sheet row number (header is row 1, first data row is 2). */
  _sheet_row_number: number
}

function parseCell(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function parseNumber(v: unknown): number | null {
  const s = parseCell(v)
  if (s == null) return null
  const n = Number(s.replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function parseInt32(v: unknown): number | null {
  const n = parseNumber(v)
  return n == null ? null : Math.round(n)
}

/**
 * Read every row whose _status matches the filter. Default: 'approved'.
 * Returns the rows + their 1-indexed Sheet row numbers (so the sync can
 * later mark them synced by row number).
 */
export async function readStagingRows(
  statusFilter: string = 'approved'
): Promise<StagingRow[]> {
  const config = getSheetsConfig()
  if (!config) throw new SheetsNotConfiguredError()

  const sheets = await getSheetsClient()
  // Read all data — header + body. A2:Z is generous enough for our 23
  // headers; tighter range if we grow it.
  const range = `${config.tabName}!A1:Z`
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range,
  })
  const data = res.data.values as string[][] | undefined
  if (!data || data.length === 0) return []

  const headers = data[0] as string[]
  const headerIndex = (name: string) => headers.indexOf(name)
  const statusCol = headerIndex('_status')
  if (statusCol === -1) {
    throw new Error(`Sheet missing _status column. Headers: ${headers.join(', ')}`)
  }

  const get = (row: string[], name: string) => {
    const i = headerIndex(name)
    return i === -1 ? null : row[i]
  }

  const out: StagingRow[] = []
  for (let i = 1; i < data.length; i++) {
    const row = data[i] || []
    const status = parseCell(row[statusCol])?.toLowerCase()
    if (status !== statusFilter.toLowerCase()) continue

    out.push({
      _sheet_row_number: i + 1, // 1-indexed; row 1 is header so first data row is 2
      _status: status || '',
      _row_id: parseCell(get(row, '_row_id')) || `row-${i + 1}`,
      _source: parseCell(get(row, '_source')) || '',
      _extracted_at: parseCell(get(row, '_extracted_at')) || '',
      supplier_id: parseCell(get(row, 'supplier_id')),
      supplier_name: parseCell(get(row, 'supplier_name')),
      supplier_name_en: parseCell(get(row, 'supplier_name_en')),
      supplier_category: parseCell(get(row, 'supplier_category')),
      supplier_website: parseCell(get(row, 'supplier_website')),
      service_id: parseCell(get(row, 'service_id')),
      service_name: parseCell(get(row, 'service_name')),
      service_description: parseCell(get(row, 'service_description')),
      price_ils: parseNumber(get(row, 'price_ils')),
      price_type: (() => {
        const v = parseCell(get(row, 'price_type'))?.toLowerCase()
        if (v === 'fixed' || v === 'on_request' || v === 'range') return v
        return null
      })(),
      pricing_unit: (() => {
        const v = parseCell(get(row, 'pricing_unit'))?.toLowerCase()
        if (
          v === 'person' ||
          v === 'group' ||
          v === 'hour' ||
          v === 'project' ||
          v === 'month' ||
          v === 'unit'
        )
          return v
        return null
      })(),
      price_min: parseNumber(get(row, 'price_min')),
      price_max: parseNumber(get(row, 'price_max')),
      capacity_min: parseInt32(get(row, 'capacity_min')),
      capacity_max: parseInt32(get(row, 'capacity_max')),
      duration_hours: parseNumber(get(row, 'duration_hours')),
      location_mode: (() => {
        const v = parseCell(get(row, 'location_mode'))?.toLowerCase()
        if (v === 'at_client' || v === 'at_provider' || v === 'remote' || v === 'hybrid')
          return v
        return null
      })(),
      tags: parseCell(get(row, 'tags')),
      supplier_notes: parseCell(get(row, 'supplier_notes')),
    })
  }
  return out
}

/** Flip _status to 'synced' on the given Sheet row numbers. */
export async function markRowsSynced(sheetRowNumbers: number[]): Promise<void> {
  if (sheetRowNumbers.length === 0) return
  const config = getSheetsConfig()
  if (!config) throw new SheetsNotConfiguredError()

  const sheets = await getSheetsClient()
  // Batch all the cell writes. _status is column A.
  const requests = sheetRowNumbers.map((rowNum) => ({
    range: `${config.tabName}!A${rowNum}`,
    values: [['synced']],
  }))
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: requests,
    },
  })
}

/** Append catalog rows to the staging Sheet. Returns the spreadsheet URL. */
export async function appendCatalogRows(
  rows: CatalogRow[],
  sourceLabel: string
): Promise<{ appended: number; url: string }> {
  const config = getSheetsConfig()
  if (!config) throw new SheetsNotConfiguredError()
  if (rows.length === 0) {
    return {
      appended: 0,
      url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`,
    }
  }

  const sheets = await getSheetsClient()
  await ensureHeaderRow(sheets, config)

  const now = new Date().toISOString()
  const values = rows.map((r) => [
    'pending',
    r._confidence_avg != null ? String(r._confidence_avg) : '',
    sourceLabel,
    now,
    crypto.randomUUID(),
    fmt(r.supplier_id),
    fmt(r.supplier_name),
    fmt(r.supplier_name_en),
    fmt(r.supplier_category),
    fmt(r.supplier_website),
    fmt(r.service_id),
    fmt(r.service_name),
    fmt(r.service_description),
    fmt(r.price_ils),
    fmt(r.price_type),
    fmt(r.price_min),
    fmt(r.price_max),
    fmt(r.capacity_min),
    fmt(r.capacity_max),
    fmt(r.duration_hours),
    fmt(r.location_mode),
    fmt(r.tags),
    fmt(r.supplier_notes),
    fmt(r.pricing_unit),
  ])

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.tabName}!A2`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  })

  return {
    appended: rows.length,
    url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`,
  }
}
