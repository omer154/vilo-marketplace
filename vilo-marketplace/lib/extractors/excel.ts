import * as XLSX from 'xlsx'
import { parseCSVLine } from './csv'
import type { ExtractedSource } from './types'

/**
 * Read an Excel buffer to row objects.
 *
 * Quirk: the user's master catalog.xlsx was exported with each row stored as
 * a single CSV-encoded string in column A (other columns are __EMPTY). We
 * detect that pattern and re-parse the strings as CSV. Normal Excel files
 * with proper columns pass through unchanged.
 */
export function extractExcel(
  buffer: Buffer,
  label: string
): ExtractedSource {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const allRows: Record<string, unknown>[] = []

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: null,
    })
    if (!rows.length) continue

    const keys = Object.keys(rows[0])
    const firstKey = keys[0] ?? ''
    const isCSVEmbedded =
      firstKey.includes(',') &&
      keys.slice(1).every((k) => k.startsWith('__EMPTY'))

    if (isCSVEmbedded) {
      const headers = parseCSVLine(firstKey)
      for (const row of rows) {
        const dataLine = row[firstKey]
        if (!dataLine || typeof dataLine !== 'string') continue
        const values = parseCSVLine(dataLine)
        const out: Record<string, unknown> = {}
        headers.forEach((h, i) => {
          const v = values[i] ?? null
          out[h] = v === '' ? null : v
        })
        allRows.push(out)
      }
    } else {
      // Normal Excel: strip empty rows, keep header-keyed columns as-is.
      for (const row of rows) {
        const hasAny = Object.values(row).some(
          (v) => v !== null && v !== '' && v !== undefined
        )
        if (hasAny) allRows.push(row)
      }
    }
  }

  return {
    source_type: 'excel',
    source_label: label,
    rows: allRows,
  }
}
