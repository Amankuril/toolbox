import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { useState } from 'react'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatINR, formatNumber, formatRelative } from '@/core/lib/format'
import { OfferBreakdown, QuoteRequestFacts, QuoteStatus, QuoteTimeline } from '@/modules/shared/quotes'
import { Card, Skeleton } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { DescriptionList, PageHeader } from '@/ui/PageHeader'
import { RowActions } from '@/ui/RowActions'
import { SearchField } from '@/ui/SearchField'
import { adminApi, adminKeys } from '../api'

const TABS = [
  { value: '', label: 'All' },
  { value: 'requested', label: 'Awaiting seller' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'declined', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
]

/** Read-only oversight: buyers and sellers act on quotes, admins watch for stuck or abusive threads. */
export default function QuotesPage() {
  const [filters, setFilters] = useSearchParamsState()
  const [viewing, setViewing] = useState(null)
  const params = { page: Number(filters.page ?? 1), limit: 20, status: filters.status || undefined, q: filters.q || undefined }
  const { data, isLoading } = useQuery({ queryKey: adminKeys.quotes(params), queryFn: () => adminApi.quotes(params), placeholderData: keepPreviousData })

  return (
    <>
      <PageHeader title="Bulk quotes" description="Quote requests between buyers and sellers for large quantities." />
      <Card>
        <div className="px-4 pt-2">
          <FilterTabs value={filters.status ?? ''} onChange={(status) => setFilters({ status })} options={TABS} counts={data?.meta?.counts} />
        </div>
        <div className="border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Quote number or product" />
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          empty={{ title: 'No quote requests', description: 'Buyers can request a quote on products for large quantities.' }}
          columns={[
            {
              key: 'number',
              header: 'Request',
              cell: (q) => (
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{q.number}</p>
                  <p className="max-w-56 truncate text-xs text-slate-500">{q.product.name}</p>
                </div>
              ),
            },
            { key: 'buyer', header: 'Buyer', cell: (q) => q.buyer?.businessName ?? q.buyer?.name ?? '—' },
            { key: 'seller', header: 'Seller', cell: (q) => q.vendor?.store?.name ?? '—' },
            { key: 'qty', header: 'Qty', className: 'text-right', cell: (q) => <span className="tabular">{formatNumber(q.quantity)}</span> },
            {
              key: 'offer',
              header: 'Offer / unit',
              className: 'text-right',
              cell: (q) => <span className="tabular">{q.offer ? formatINR(q.offer.unitPrice) : '—'}</span>,
            },
            { key: 'status', header: 'Status', cell: (q) => <QuoteStatus status={q.status} /> },
            { key: 'updated', header: 'Updated', cell: (q) => <span className="text-slate-500">{formatRelative(q.updatedAt)}</span> },
            {
              key: 'actions',
              header: '',
              className: 'w-px',
              cell: (q) => <RowActions label={`Actions for ${q.number}`} items={[{ label: 'View details', icon: Eye, onSelect: () => setViewing(q._id) }]} />,
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
      </Card>
      <QuoteDialog id={viewing} onClose={() => setViewing(null)} />
    </>
  )
}

function QuoteDialog({ id, onClose }) {
  const { data: q, isLoading } = useQuery({ queryKey: adminKeys.quote(id), queryFn: () => adminApi.quote(id), enabled: Boolean(id) })
  return (
    <Dialog open={Boolean(id)} onOpenChange={(v) => !v && onClose()} title={q ? `Quote ${q.number}` : 'Quote'} size="lg">
      {isLoading || !q ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="flex flex-col gap-5">
          <QuoteStatus status={q.status} className="self-start" />
          <QuoteRequestFacts quote={q} />
          <OfferBreakdown quote={q} />
          {q.declineReason && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">Declined: {q.declineReason}</p>}
          <DescriptionList
            items={[
              ['Buyer', q.buyer?.name],
              ['Business', q.buyer?.businessName],
              ['GSTIN', q.buyer?.gstin],
              ['Seller', q.vendor?.store?.name],
            ]}
          />
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">History</h3>
            <QuoteTimeline history={q.history} />
          </div>
        </div>
      )}
    </Dialog>
  )
}
