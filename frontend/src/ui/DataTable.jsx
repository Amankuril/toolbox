import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { formatNumber } from '@/core/lib/format'
import { safeStorage } from '@/core/lib/storage'
import { Button } from './Button'
import { EmptyState, Skeleton } from './Card'

/**
 * @param {{ columns: { key: string, header: string, className?: string, cell: (row) => any }[], rows?: any[], loading?: boolean,
 *   empty?: { title: string, description?: string, action?: any }, onRowClick?: (row) => void, rowKey?: (row) => string }} props
 */
export function DataTable({ columns, rows, loading, empty, onRowClick, rowKey = (r) => r._id }) {
  if (!loading && !rows?.length) {
    return <EmptyState icon={Inbox} title={empty?.title ?? 'Nothing here yet'} description={empty?.description} action={empty?.action} />
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-300">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-4 py-3 text-[0.7rem] font-semibold tracking-[0.07em] text-slate-600 uppercase', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading
            ? Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3.5">
                      <Skeleton className="h-4 w-full max-w-40" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('align-middle transition-colors', onRowClick && 'cursor-pointer hover:bg-slate-50/70')}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3.5', c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  )
}

export const PAGE_SIZES = [10, 20, 25, 50, 100]
const PAGE_SIZE_KEY = 'panel:page-size'

/** Rows per page: the list's own choice (URL), else the size this browser picked last on any list, else `fallback`. */
export function pageSize(value, fallback = 20) {
  const n = Number(value ?? safeStorage.get(PAGE_SIZE_KEY, fallback))
  return PAGE_SIZES.includes(n) ? n : fallback
}

/** Pages, plus a rows-per-page picker when `onLimitChange` is given (the choice carries over to other lists). */
export function Pagination({ meta, onPageChange, onLimitChange, className }) {
  if (!meta) return null
  const { page, totalPages, total, limit } = meta
  const canResize = onLimitChange && total > PAGE_SIZES[0]
  if (totalPages <= 1 && !canResize) return null
  const from = total ? (page - 1) * limit + 1 : 0
  const to = Math.min(page * limit, total)
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm text-slate-600', className)}>
      <span className="flex items-center gap-3">
        <span className="tabular">
          {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
        </span>
        {canResize && (
          <label className="flex items-center gap-1.5 text-xs">
            Rows per page
            <select
              value={limit}
              onChange={(e) => {
                const next = Number(e.target.value)
                safeStorage.set(PAGE_SIZE_KEY, next)
                onLimitChange(next)
              }}
              className="h-8 rounded-md border border-slate-300 bg-white px-1.5 text-sm text-slate-800"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </span>
      <div className={cn('flex items-center gap-1', totalPages <= 1 && 'invisible')}>
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="tabular px-2">
          {page} / {totalPages}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
