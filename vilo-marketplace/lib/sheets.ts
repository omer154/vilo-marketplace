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
  'location',
  'tags',
  'supplier_notes',
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
    fmt(r.location),
    fmt(r.tags),
    fmt(r.supplier_notes),
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
