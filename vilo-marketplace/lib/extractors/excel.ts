import * as XLSX from 'xlsx'
import { parseCSVLine } from './csv'
import type { ExtractedSource } from './types'

/** Count non-empty cells in a raw (array) row. */
function nonEmpty(row: unknown[]): number {
  return row.filter((c) => c !== null && c !== '' && c !== undefined).length
}

/**
 * Read an Excel buffer to row objects — robust to two messy real-world layouts:
 *
 *  1. CSV-embedded: each row is one comma-joined string in column A (the old
 *     master-catalog export). Detected when no sheet has multi-column rows.
 *
 *  2. Preamble/notes rows ABOVE the real header row, and/or multiple sheets —
 *     so the true column headers (e.g. "שם הסדנא", "מחיר...", "משך הסדנא") are
 *     NOT in row 1. We find the header row (first row with ≥2 filled cells) and
 *     key the data off it, per sheet. Without this the headers came out as
 *     "__EMPTY"/a stray note sentence, and every field that isn't price/name
 *     (duration, capacity, unit) was silently dropped.
 */
export function extractExcel(buffer: Buffer, label: string): ExtractedSource {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const allRows: Record<string, unknown>[] = []

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      blankrows: false,
    }) as unknown[][]
    if (!matrix.length) continue

    const multiColRows = matrix.filter((r) => nonEmpty(r) >= 2).length

    if (multiColRows >= 2) {
      // Tabular sheet. The header is the first row with ≥2 filled cells; any
      // single-cell rows above it are preamble/notes and are skipped.
      const headerIdx = matrix.findIndex((r) => nonEmpty(r) >= 2)
      const headerRow = matrix[headerIdx]
      const headers = headerRow.map((h, i) =>
        h == null || String(h).trim() === '' ? `col${i + 1}` : String(h).trim()
      )
      for (let i = headerIdx + 1; i < matrix.length; i++) {
        const row = matrix[i]
        if (nonEmpty(row) < 2) continue // skip note / single-cell rows between data
        const obj: Record<string, unknown> = {}
        headers.forEach((h, j) => {
          const v = row[j]
          obj[h] = v === '' || v === undefined ? null : v
        })
        allRows.push(obj)
      }
    } else {
      // CSV-embedded: each data row is a single comma-joined string. Use the
      // first comma-bearing cell as the header line, the rest as data.
      const headerCell = matrix
        .flat()
        .find((c): c is string => typeof c === 'string' && c.includes(','))
      if (typeof headerCell !== 'string') continue
      const headers = parseCSVLine(headerCell)
      for (const r of matrix) {
        const cell = r.find((c): c is string => typeof c === 'string' && c.includes(','))
        if (typeof cell !== 'string' || cell === headerCell) continue
        const values = parseCSVLine(cell)
        const obj: Record<string, unknown> = {}
        headers.forEach((h, i) => {
          const v = values[i] ?? null
          obj[h] = v === '' ? null : v
        })
        allRows.push(obj)
      }
    }
  }

  return { source_type: 'excel', source_label: label, rows: allRows }
}
