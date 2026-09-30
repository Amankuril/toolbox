import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { formatNumber } from '@/core/lib/format'
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
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase', c.className)}>
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
                  className={cn('align-middle transition-colors', onRowClick && 'cursor-pointer hover:bg-slate-50')}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3', c.className)}>
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

export function Pagination({ meta, onPageChange, className }) {
  if (!meta || meta.totalPages <= 1) return null
  const { page, totalPages, total, limit } = meta
  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)
  return (
    <div className={cn('flex items-center justify-between gap-4 px-4 py-3 text-sm text-slate-600', className)}>
      <span className="tabular">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex items-center gap-1">
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
