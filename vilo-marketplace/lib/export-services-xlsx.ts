import * as XLSX from 'xlsx'

/** A service row joined with its supplier name, ready for export. */
export interface ExportRow {
  supplier_name: string | null
  service_name: string | null
  category_primary: string | null
  category_secondary: string | null
  price: number | null
  price_min: number | null
  price_max: number | null
  pricing_unit: string | null
  price_type: string | null
  min_participants: number | null
  max_participants: number | null
  duration_minutes: number | null
  location_mode: string | null
  location_type: string | null
  description_short: string | null
  notes: string | null
  is_active: boolean
}

const CAT: Record<string, string> = {
  wellbeing: 'וולנס ובריאות',
  teambuilding: 'גיבוש וחברה',
  learning: 'למידה והעשרה',
  food: 'אוכל ואירוח',
  culture: 'תרבות ויצירה',
  travel: 'טיולים ואתגר',
  sport: 'ספורט ופעילות',
  tech: 'טכנולוגיה',
  consulting: 'ייעוץ ופיתוח',
}
const LOC: Record<string, string> = {
  at_client: 'אצל הלקוח',
  at_provider: 'אצל הספק',
  remote: 'מקוון',
  hybrid: 'גמיש',
  onsite: 'אצל הלקוח',
  both: 'גמיש',
}
const UNIT: Record<string, string> = {
  person: 'לאדם',
  group: 'לקבוצה',
  hour: 'לשעה',
  project: 'לפרויקט',
  month: 'לחודש',
  unit: 'ליחידה',
}
const PRICE_TYPE: Record<string, string> = {
  fixed: 'מחיר קבוע',
  on_request: 'לפי פנייה',
  range: 'טווח',
}

/** Build an RTL .xlsx workbook (single sheet) from service rows, in the given
 *  order. Columns mirror the full admin table. Returns a Node Buffer. */
export function servicesToXlsx(rows: ExportRow[], sheetName = 'שירותים'): Buffer {
  const data = rows.map((r, i) => ({
    '#': i + 1,
    ספק: r.supplier_name ?? '',
    'שם השירות': r.service_name ?? '',
    קטגוריה: r.category_primary ? CAT[r.category_primary] ?? r.category_primary : '',
    'קטגוריית משנה': r.category_secondary ?? '',
    'מחיר ₪':
      r.price != null
        ? r.price
        : r.price_min != null || r.price_max != null
        ? `${r.price_min ?? ''}-${r.price_max ?? ''}`
        : '',
    'יחידת מחיר': r.pricing_unit ? UNIT[r.pricing_unit] ?? r.pricing_unit : '',
    'סוג מחיר': r.price_type ? PRICE_TYPE[r.price_type] ?? r.price_type : '',
    'מ׳ משתתפים': r.min_participants ?? '',
    'עד משתתפים': r.max_participants ?? '',
    'משך (דק׳)': r.duration_minutes ?? '',
    מיקום: LOC[r.location_mode || r.location_type || ''] ?? r.location_mode ?? '',
    תיאור: r.description_short ?? '',
    הערות: r.notes ?? '',
    פעיל: r.is_active ? 'כן' : 'לא',
  }))

  // json_to_sheet with an empty array still needs a header row.
  const ws =
    data.length > 0
      ? XLSX.utils.json_to_sheet(data)
      : XLSX.utils.aoa_to_sheet([
          ['#', 'ספק', 'שם השירות', 'קטגוריה', 'קטגוריית משנה', 'מחיר ₪', 'יחידת מחיר',
           'סוג מחיר', 'מ׳ משתתפים', 'עד משתתפים', 'משך (דק׳)', 'מיקום', 'תיאור', 'הערות', 'פעיל'],
        ])
  ws['!cols'] = [
    { wch: 5 }, { wch: 22 }, { wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 12 },
    { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 14 },
    { wch: 55 }, { wch: 32 }, { wch: 7 },
  ]

  const wb = XLSX.utils.book_new()
  wb.Workbook = { Views: [{ RTL: true }] }
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
