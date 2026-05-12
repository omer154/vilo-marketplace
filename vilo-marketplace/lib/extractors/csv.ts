/**
 * RFC-4180-ish CSV line parser. Handles quoted fields, escaped quotes (""),
 * and commas inside quotes. Returns array of strings.
 */
export function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0

  while (i < line.length) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i += 2
      } else if (ch === '"') {
        inQuotes = false
        i++
      } else {
        current += ch
        i++
      }
    } else {
      if (ch === '"' && current === '') {
        inQuotes = true
        i++
      } else if (ch === ',') {
        result.push(current)
        current = ''
        i++
      } else {
        current += ch
        i++
      }
    }
  }
  result.push(current)
  return result
}
