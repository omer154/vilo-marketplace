'use client'

import { useEffect, useRef, useState } from 'react'
import { Trash2, Loader2 } from 'lucide-react'

export type GridColType = 'text' | 'number' | 'select' | 'textarea'

export interface GridCol {
  key: string
  label: string
  type: GridColType
  options?: { value: string; label: string }[]
  width?: string
}

export interface EditableGridProps<T> {
  rows: T[]
  columns: GridCol[]
  /** Stable id for a row (defaults to row.id). */
  rowId?: (row: T) => string | number
  /** Called whenever a cell's value should persist (on edit and on each filled cell). */
  onCommit: (rowId: string | number, colKey: string, value: string | number | null) => void
  onRemoveRow?: (rowId: string | number) => void
  /** Content for the leading (#) column. */
  leading?: (row: T, index: number) => React.ReactNode
  leadingLabel?: string
  /** Row ids currently saving (shows a spinner in the leading cell). */
  savingRowIds?: Set<string | number>
}

function coerce(type: GridColType, raw: string): string | number | null {
  if (type === 'number') {
    const t = raw.replace(/[^\d.\-]/g, '')
    if (t.trim() === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return raw === '' ? null : raw
}

type FillState = { colKey: string; from: number; to: number; value: string | number | null } | null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function EditableGrid<T extends Record<string, any>>({
  rows,
  columns,
  rowId = (r) => r.id,
  onCommit,
  onRemoveRow,
  leading,
  leadingLabel = '#',
  savingRowIds,
}: EditableGridProps<T>) {
  // Internal display copy so typing + fill update instantly. Re-sync ONLY when
  // the set of row ids changes (add/remove row, a fresh extraction) — never on a
  // value commit, or a keystroke would feed back through the parent and reset the
  // cell mid-edit.
  const [data, setData] = useState<T[]>(rows)
  const idSig = rows.map((r) => rowId(r)).join('|')
  useEffect(() => {
    setData(rows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSig])

  const [fill, setFill] = useState<FillState>(null)
  const fillRef = useRef<FillState>(null)
  fillRef.current = fill
  const dataRef = useRef<T[]>(data)
  dataRef.current = data

  // Apply the fill on mouse release anywhere on the page.
  useEffect(() => {
    function onUp() {
      const f = fillRef.current
      if (!f) return
      const lo = Math.min(f.from, f.to)
      const hi = Math.max(f.from, f.to)
      const cur = dataRef.current
      const touched: Array<string | number> = []
      const next = cur.map((row, i) => {
        if (i >= lo && i <= hi) {
          touched.push(rowId(row))
          return { ...row, [f.colKey]: f.value }
        }
        return row
      })
      setData(next)
      touched.forEach((id) => onCommit(id, f.colKey, f.value))
      setFill(null)
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [onCommit, rowId])

  function setCell(index: number, col: GridCol, raw: string) {
    const value = coerce(col.type, raw)
    setData((prev) => prev.map((r, i) => (i === index ? { ...r, [col.key]: value } : r)))
    onCommit(rowId(data[index]), col.key, value)
  }

  function startFill(e: React.MouseEvent, index: number, col: GridCol) {
    e.preventDefault()
    e.stopPropagation()
    const value = (data[index]?.[col.key] ?? null) as string | number | null
    setFill({ colKey: col.key, from: index, to: index, value })
  }

  const inFill = (index: number, colKey: string) => {
    if (!fill || fill.colKey !== colKey) return false
    return index >= Math.min(fill.from, fill.to) && index <= Math.max(fill.from, fill.to)
  }

  const cellBase =
    'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-gray-200 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-100'

  return (
    <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white ${fill ? 'select-none' : ''}`}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-right">
            <th className="px-2 py-2 text-xs font-medium text-gray-400">{leadingLabel}</th>
            {columns.map((c) => (
              <th key={c.key} className={`px-2 py-2 text-xs font-medium text-gray-600 ${c.width || ''}`}>
                {c.label}
              </th>
            ))}
            {onRemoveRow && <th className="px-2 py-2" />}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => {
            const id = rowId(row)
            return (
              <tr
                key={id}
                onMouseEnter={() => fill && setFill((f) => (f ? { ...f, to: idx } : f))}
                className="border-b border-gray-100 last:border-0 hover:bg-gray-50/40"
              >
                <td className="px-2 py-1.5 text-center text-xs text-gray-300">
                  {savingRowIds?.has(id) ? (
                    <Loader2 className="mx-auto h-3 w-3 animate-spin text-brand-400" />
                  ) : (
                    leading?.(row, idx) ?? idx + 1
                  )}
                </td>
                {columns.map((c) => {
                  const v = row[c.key]
                  const val = v === null || v === undefined ? '' : String(v)
                  return (
                    <td
                      key={c.key}
                      className={`group/cell relative px-1.5 py-1 ${inFill(idx, c.key) ? 'bg-brand-50 ring-1 ring-inset ring-brand-300' : ''}`}
                    >
                      {c.type === 'select' ? (
                        <select value={val} onChange={(e) => setCell(idx, c, e.target.value)} className={cellBase}>
                          <option value="">—</option>
                          {c.options!.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : c.type === 'textarea' ? (
                        <textarea
                          value={val}
                          rows={1}
                          onChange={(e) => setCell(idx, c, e.target.value)}
                          className={`${cellBase} resize-y`}
                        />
                      ) : (
                        <input
                          type={c.type === 'number' ? 'number' : 'text'}
                          value={val}
                          dir={c.type === 'number' ? 'ltr' : 'rtl'}
                          onChange={(e) => setCell(idx, c, e.target.value)}
                          className={cellBase}
                        />
                      )}
                      {/* Excel-style fill handle: drag down/up the column to copy this value. */}
                      <span
                        role="button"
                        tabIndex={-1}
                        title="גררו כדי להעתיק את הערך לשורות נוספות"
                        onMouseDown={(e) => startFill(e, idx, c)}
                        className="absolute bottom-0.5 left-0.5 h-2.5 w-2.5 cursor-crosshair rounded-[2px] bg-brand-500 opacity-0 ring-2 ring-white transition-opacity group-hover/cell:opacity-100"
                      />
                    </td>
                  )
                })}
                {onRemoveRow && (
                  <td className="px-1.5 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => onRemoveRow(id)}
                      title="מחק שורה"
                      className="text-gray-300 transition hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
