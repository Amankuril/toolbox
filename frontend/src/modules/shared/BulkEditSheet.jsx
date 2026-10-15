import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, RotateCcw, Save, Sheet as SheetIcon, X } from 'lucide-react'
import { Dialog as RDialog } from 'radix-ui'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { GST_RATES } from '@/core/lib/constants'
import { formatNumber } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Card'

const PAGE_SIZE = 50
const rupees = (paise) => (paise == null ? '' : String(paise / 100))
const hasVariants = (p) => p.variants?.length > 0
const tracked = (p) => p.inventory?.trackQuantity !== false

/** Parsers turn a cell's text into what the API takes, or throw a message for the cell. */
const parse = {
  text: (s) => s.trim(),
  required: (s) => {
    if (!s.trim()) throw new Error('Required')
    return s.trim()
  },
  money: (s) => {
    const n = Number(s.replace(/[₹,\s]/g, ''))
    if (!s.trim() || !Number.isFinite(n) || n <= 0) throw new Error('Enter an amount')
    return Math.round(n * 100)
  },
  int:
    (min) =>
    (s) => {
      const n = Number(s.replace(/[,\s]/g, ''))
      if (!s.trim() || !Number.isInteger(n) || n < min) throw new Error(min ? `Whole number, ${min} or more` : 'Whole number')
      return n
    },
  gst: (s) => {
    if (s === '') return null
    const n = Number(String(s).replace('%', ''))
    if (!GST_RATES.includes(n)) throw new Error(`One of ${GST_RATES.join(', ')}`)
    return n
  },
  hsn: (s) => {
    const v = s.trim()
    if (v && !/^(\d{4}|\d{6}|\d{8})$/.test(v)) throw new Error('4, 6 or 8 digits')
    return v || null
  },
  bool: (v) => v === true || v === 'true' || v === '1' || /^(yes|y|on)$/i.test(String(v)),
}

/**
 * Editable columns. `get` reads the product's current value as cell text; `key` is the field the bulk API takes;
 * `locked` says why a cell can't be edited for this product.
 */
const COLUMNS = [
  { id: 'name', label: 'Product name', key: 'name', width: 'min-w-64', pinned: true, get: (p) => p.name, parse: parse.required },
  { id: 'sku', label: 'SKU', key: 'sku', width: 'w-32', get: (p) => p.sku ?? '', parse: parse.text, placeholder: 'Auto' },
  { id: 'brand', label: 'Brand', key: 'brand', width: 'w-32', get: (p) => p.brand ?? '', parse: parse.text },
  {
    id: 'mrp',
    label: 'MRP (₹)',
    key: 'mrp',
    width: 'w-28',
    numeric: true,
    get: (p) => rupees(p.pricing.mrp),
    parse: parse.money,
    locked: (p) => hasVariants(p) && 'Priced per variant',
  },
  {
    id: 'price',
    label: 'Price (₹)',
    key: 'price',
    width: 'w-28',
    numeric: true,
    get: (p) => rupees(p.pricing.price),
    parse: parse.money,
    locked: (p) => hasVariants(p) && 'Priced per variant',
  },
  {
    id: 'stock',
    label: 'Stock',
    key: 'stock',
    width: 'w-24',
    numeric: true,
    get: (p) => (tracked(p) ? String(p.inventory.stock ?? 0) : ''),
    parse: parse.int(0),
    locked: (p) => (hasVariants(p) ? 'Stock per variant' : !tracked(p) && 'Not tracked'),
  },
  { id: 'moq', label: 'Min. order', key: 'moq', width: 'w-24', numeric: true, get: (p) => String(p.inventory.moq ?? 1), parse: parse.int(1) },
  {
    id: 'gst',
    label: 'GST %',
    key: 'gstRate',
    width: 'w-32',
    kind: 'select',
    get: (p) => (p.taxInherit?.gst || p.pricing.gstRate == null ? '' : String(p.pricing.gstRate)),
    parse: parse.gst,
  },
  {
    id: 'hsn',
    label: 'HSN/SAC',
    key: 'hsnCode',
    width: 'w-28',
    get: (p) => (p.taxInherit?.hsn ? '' : (p.hsnCode ?? '')),
    parse: parse.hsn,
    placeholder: (p) => (p.taxInherit?.hsn && p.hsnCode ? p.hsnCode : 'Category'),
  },
  { id: 'available', label: 'Available', key: 'available', width: 'w-24', kind: 'bool', get: (p) => p.inventory.available !== false, parse: parse.bool },
]

/** Server error paths ('pricing.price', 'hsnCode', 'inventory.stock'…) → column ids. */
const PATH_TO_COLUMN = { price: 'price', mrp: 'mrp', gstRate: 'gst', hsnCode: 'hsn', stock: 'stock', moq: 'moq', sku: 'sku', name: 'name', brand: 'brand', available: 'available' }
const columnOfPath = (path) => PATH_TO_COLUMN[String(path ?? '').split('.').pop()]

/**
 * Spreadsheet-style editor for many products at once: type over cells, move with Enter / arrow keys,
 * paste a block straight from Excel or Google Sheets, then save every changed row in one go.
 * Rows that fail stay highlighted with the reason; the rest are saved.
 *
 * @param {{ open: boolean, onOpenChange: (open: boolean) => void, filters: object, queryKey: any[],
 *   load: (params: object) => Promise<{ items: any[], meta: any }>, save: (items: object[]) => Promise<{ updated: any[], failed: any[] }>,
 *   onSaved?: () => void, showVendor?: boolean, reviewNote?: string }} props
 */
export function BulkEditSheet({ open, onOpenChange, ...props }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50" />
        {open && <SheetBody {...props} onClose={() => onOpenChange(false)} />}
      </RDialog.Portal>
    </RDialog.Root>
  )
}

function SheetBody({ filters, queryKey, load, save, onSaved, onClose, showVendor, reviewNote }) {
  const [page, setPage] = useState(1)
  const params = { ...filters, page, limit: PAGE_SIZE }
  const { data, isLoading, isFetching } = useQuery({ queryKey: [...queryKey, params], queryFn: () => load(params), placeholderData: keepPreviousData })
  // Saved rows replace the loaded ones, so the sheet shows what the server stored.
  const [savedRows, setSavedRows] = useState({})
  const rows = (data?.items ?? []).map((p) => savedRows[p._id] ?? p)
  // Edits by product id and column id; values are cell text (booleans for checkboxes).
  const [edits, setEdits] = useState({})
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const grid = useRef(null)

  const valueOf = (p, col) => edits[p._id]?.[col.id] ?? col.get(p)
  const isChanged = (p, col) => edits[p._id]?.[col.id] !== undefined && String(edits[p._id][col.id]) !== String(col.get(p))
  const changedRows = rows.filter((p) => COLUMNS.some((c) => isChanged(p, c)))
  const changedCells = rows.reduce((n, p) => n + COLUMNS.filter((c) => isChanged(p, c)).length, 0)
  const dirty = changedCells > 0

  const setCell = (id, colId, value) => {
    setEdits((e) => ({ ...e, [id]: { ...e[id], [colId]: value } }))
    setErrors((e) => {
      if (!e[id]?.cells?.[colId]) return e
      const { [colId]: _drop, ...cells } = e[id].cells
      return { ...e, [id]: { ...e[id], cells } }
    })
  }

  const editable = (p, col) => !col.locked?.(p)

  /** Focus the cell at row r, column c (skipping nothing; locked cells are focusable but read-only). */
  const focusCell = (r, c) => {
    const el = grid.current?.querySelector(`[data-cell="${r}:${c}"]`)
    if (el) {
      el.focus()
      el.select?.()
    }
  }

  const onKeyDown = (e, r, c) => {
    const isSelect = e.target.tagName === 'SELECT'
    const atStart = e.target.selectionStart === 0 && e.target.selectionEnd === 0
    const atEnd = e.target.value != null && e.target.selectionStart === String(e.target.value).length
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !isSelect)) {
      e.preventDefault()
      focusCell(e.shiftKey ? r - 1 : r + 1, c)
    } else if (e.key === 'ArrowUp' && !isSelect) {
      e.preventDefault()
      focusCell(r - 1, c)
    } else if (e.key === 'ArrowLeft' && (atStart || e.target.type === 'checkbox')) {
      e.preventDefault()
      focusCell(r, c - 1)
    } else if (e.key === 'ArrowRight' && (atEnd || e.target.type === 'checkbox')) {
      e.preventDefault()
      focusCell(r, c + 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setCell(rows[r]._id, COLUMNS[c].id, COLUMNS[c].get(rows[r]))
    }
  }

  /** A block copied from a spreadsheet fills cells to the right and below, like pasting in Excel. */
  const onPaste = (e, r, c) => {
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n')
    let filled = 0
    lines.forEach((line, i) => {
      const p = rows[r + i]
      if (!p) return
      line.split('\t').forEach((raw, j) => {
        const col = COLUMNS[c + j]
        if (!col || !editable(p, col)) return
        const value = col.kind === 'bool' ? parse.bool(raw.trim()) : col.kind === 'select' ? raw.trim().replace('%', '') : raw.trim()
        setCell(p._id, col.id, value)
        filled += 1
      })
    })
    if (filled) toast.success(`Pasted ${formatNumber(filled)} cells`)
  }

  const discard = () => {
    setEdits({})
    setErrors({})
  }

  const submit = async () => {
    const items = []
    const clientErrors = {}
    for (const p of changedRows) {
      const item = { _id: p._id }
      for (const col of COLUMNS) {
        if (!isChanged(p, col) || !editable(p, col)) continue
        try {
          item[col.key] = col.parse(edits[p._id][col.id])
        } catch (err) {
          clientErrors[p._id] = { message: 'Fix the highlighted cells', cells: { ...clientErrors[p._id]?.cells, [col.id]: err.message } }
        }
      }
      if (Object.keys(item).length > 1) items.push(item)
    }
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors)
      toast.error('Some cells need fixing before saving')
      return
    }
    if (!items.length) return

    setSaving(true)
    try {
      const result = await save(items)
      const updated = Object.fromEntries(result.updated.map((p) => [p._id, p]))
      setSavedRows((s) => ({ ...s, ...updated }))
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => !updated[id])))
      const serverErrors = {}
      for (const f of result.failed) {
        const cells = {}
        for (const d of f.details ?? []) {
          const col = columnOfPath(d.path)
          if (col) cells[col] = d.message
        }
        serverErrors[f._id] = { message: f.message, cells }
      }
      setErrors(serverErrors)
      if (result.updated.length) onSaved?.()
      if (result.failed.length) {
        toast.error(`${result.updated.length} saved, ${result.failed.length} need attention`, { description: 'Hover a red row to see why.' })
      } else {
        toast.success(`Saved ${formatNumber(result.updated.length)} product${result.updated.length === 1 ? '' : 's'}`)
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const close = () => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    onClose()
  }

  const meta = data?.meta

  return (
    <RDialog.Content
      onEscapeKeyDown={(e) => {
        e.preventDefault()
        // Inside a cell, Escape undoes that cell (see onKeyDown); elsewhere it closes the sheet.
        if (!document.activeElement?.dataset?.cell) close()
      }}
      onInteractOutside={(e) => e.preventDefault()}
      className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl focus:outline-none sm:inset-4"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <SheetIcon className="size-5 text-primary" />
        <div className="min-w-0 flex-1">
          <RDialog.Title className="font-display text-lg font-bold text-slate-900">Bulk edit products</RDialog.Title>
          <RDialog.Description className="text-xs text-slate-500">
            Type over any cell, or paste a block from Excel. Enter and the arrow keys move between cells; Esc undoes a cell.
            {reviewNote ? ` ${reviewNote}` : ''}
          </RDialog.Description>
        </div>
        <span className={cn('text-sm', dirty ? 'font-semibold text-amber-700' : 'text-slate-500')} aria-live="polite">
          {dirty ? `${formatNumber(changedCells)} change${changedCells === 1 ? '' : 's'} in ${changedRows.length} product${changedRows.length === 1 ? '' : 's'}` : 'No changes'}
        </span>
        <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={discard}>
          <RotateCcw /> Discard
        </Button>
        <Button size="sm" loading={saving} disabled={!dirty} onClick={submit}>
          <Save /> Save all
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>
          <X />
        </Button>
      </div>

      <div ref={grid} className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-slate-100">
            <tr>
              <th scope="col" className="sticky left-0 z-30 w-12 border-r border-b border-slate-300 bg-slate-100 px-2 py-2 text-right text-xs font-semibold text-slate-500">
                #
              </th>
              <th scope="col" className="sticky left-12 z-30 w-14 border-r border-b border-slate-300 bg-slate-100" aria-label="Photo" />
              {COLUMNS.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn(
                    'border-r border-b border-slate-300 px-2 py-2 text-left text-xs font-semibold whitespace-nowrap text-slate-700',
                    c.width,
                    c.numeric && 'text-right',
                    c.pinned && 'sticky left-26 z-30 bg-slate-100',
                  )}
                >
                  {c.label}
                </th>
              ))}
              {showVendor && <th scope="col" className="border-b border-slate-300 px-2 py-2 text-left text-xs font-semibold text-slate-700">Seller</th>}
              <th scope="col" className="border-b border-slate-300 px-2 py-2 text-left text-xs font-semibold text-slate-700">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 8 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={COLUMNS.length + 3} className="border-b border-slate-200 p-2">
                      <Skeleton className="h-6 w-full" />
                    </td>
                  </tr>
                ))
              : rows.map((p, r) => {
                  const rowError = errors[p._id]
                  return (
                    <tr key={p._id} className={cn('group', rowError && 'bg-red-50/60')} title={rowError?.message}>
                      <td
                        className={cn(
                          'tabular sticky left-0 z-10 border-r border-b border-slate-200 px-2 text-right text-xs text-slate-500',
                          rowError ? 'bg-red-100 font-semibold text-red-700' : 'bg-slate-50',
                        )}
                      >
                        {(page - 1) * PAGE_SIZE + r + 1}
                      </td>
                      <td className="sticky left-12 z-10 border-r border-b border-slate-200 bg-white p-1">
                        <Thumb src={p.images?.[0]?.url} className="size-8 rounded border border-slate-200" />
                      </td>
                      {COLUMNS.map((col, c) => (
                        <Cell
                          key={col.id}
                          col={col}
                          product={p}
                          value={valueOf(p, col)}
                          changed={isChanged(p, col)}
                          error={rowError?.cells?.[col.id]}
                          locked={col.locked?.(p)}
                          cellId={`${r}:${c}`}
                          onChange={(v) => setCell(p._id, col.id, v)}
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                          onPaste={(e) => onPaste(e, r, c)}
                        />
                      ))}
                      {showVendor && (
                        <td className="max-w-40 truncate border-b border-slate-200 px-2 text-xs text-slate-600">{p.vendor?.store?.name ?? '—'}</td>
                      )}
                      <td className="border-b border-slate-200 px-2 whitespace-nowrap">
                        <StatusBadge status={p.status} />
                        {rowError && !Object.keys(rowError.cells ?? {}).length && <p className="mt-0.5 max-w-56 text-xs text-red-700">{rowError.message}</p>}
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
        {!isLoading && !rows.length && <p className="py-16 text-center text-sm text-slate-500">No products match the current filters.</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-sm text-slate-600">
        <span className="tabular">
          {meta ? `${formatNumber(meta.total ? (page - 1) * PAGE_SIZE + 1 : 0)}–${formatNumber(Math.min(page * PAGE_SIZE, meta.total))} of ${formatNumber(meta.total)} products` : ' '}
          {isFetching && !isLoading && ' · loading…'}
        </span>
        {meta?.totalPages > 1 && (
          <div className="flex items-center gap-2">
            {dirty && <span className="text-xs text-amber-700">Save or discard to change page</span>}
            <Button variant="outline" size="icon-sm" disabled={page <= 1 || dirty} onClick={() => setPage(page - 1)} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="tabular">
              {page} / {meta.totalPages}
            </span>
            <Button variant="outline" size="icon-sm" disabled={page >= meta.totalPages || dirty} onClick={() => setPage(page + 1)} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
    </RDialog.Content>
  )
}

function Cell({ col, product, value, changed, error, locked, cellId, onChange, onKeyDown, onPaste }) {
  const base = cn(
    'block h-9 w-full bg-transparent px-2 text-sm text-slate-900 outline-none focus:relative focus:z-10 focus:bg-white focus:ring-2 focus:ring-primary focus:ring-inset',
    col.numeric && 'tabular text-right',
  )
  const shared = { 'data-cell': cellId, onKeyDown, onPaste, 'aria-label': `${col.label}, ${product.name}`, 'aria-invalid': Boolean(error) || undefined }
  return (
    <td
      title={error ?? (locked || undefined)}
      className={cn(
        'border-r border-b border-slate-200 p-0',
        col.width,
        // Stays in view while scrolling sideways, after the row number and photo columns.
        col.pinned && 'sticky left-26 z-10 bg-white',
        changed && 'bg-amber-50',
        error && 'bg-red-100 ring-1 ring-red-400 ring-inset',
        locked && 'bg-slate-50',
      )}
    >
      {locked ? (
        <input {...shared} readOnly value="" placeholder={locked} className={cn(base, 'cursor-not-allowed text-xs italic placeholder:text-slate-400')} />
      ) : col.kind === 'bool' ? (
        <label className="flex h-9 items-center justify-center">
          <input {...shared} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
        </label>
      ) : col.kind === 'select' ? (
        <select {...shared} value={value} onChange={(e) => onChange(e.target.value)} className={cn(base, 'pr-1')}>
          <option value="">Category{product.taxInherit?.gst && product.pricing.gstRate != null ? ` (${product.pricing.gstRate}%)` : ''}</option>
          {GST_RATES.map((rate) => (
            <option key={rate} value={String(rate)}>
              {rate}%
            </option>
          ))}
        </select>
      ) : (
        <input
          {...shared}
          value={value}
          inputMode={col.numeric ? 'decimal' : undefined}
          placeholder={typeof col.placeholder === 'function' ? col.placeholder(product) : col.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          className={cn(base, 'placeholder:text-slate-400')}
        />
      )}
    </td>
  )
}
