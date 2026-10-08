import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Eye, FileText } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDate, formatINR, formatNumber, formatRelative } from '@/core/lib/format'
import { QuoteStatus } from '@/modules/shared/quotes'
import { Thumb } from '@/ui/Brand'
import { Card, EmptyState } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { PageHeader } from '@/ui/PageHeader'
import { RowActions } from '@/ui/RowActions'
import { SearchField } from '@/ui/SearchField'
import { useSeller } from '../seller'

const TABS = [
  { value: 'requested', label: 'New requests' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'all', label: 'All' },
]

export default function VendorQuotesPage() {
  const seller = useSeller()
  const navigate = useNavigate()
  const [filters, setFilters] = useSearchParamsState({ status: 'requested' })
  const params = {
    page: Number(filters.page ?? 1),
    limit: 20,
    status: filters.status === 'all' ? undefined : filters.status || undefined,
    q: filters.q || undefined,
  }
  const { data, isLoading } = useQuery({ queryKey: seller.keys.quotes(params), queryFn: () => seller.api.quotes(params), placeholderData: keepPreviousData })
  const nothingYet = !isLoading && data?.meta?.total === 0 && !filters.q && !Object.keys(data?.meta?.counts ?? {}).length

  return (
    <>
      <PageHeader title="Quote requests" description="Buyers asking for a price on large quantities. Reply with a price and how long it's valid." />
      {nothingYet ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No quote requests yet"
            description="Buyers see a “Request a quote” option on your products for large quantities. You can change the threshold per product."
          />
        </Card>
      ) : (
        <Card>
          <div className="px-4 pt-2">
            <FilterTabs value={filters.status ?? ''} onChange={(status) => setFilters({ status })} options={TABS} counts={data?.meta?.counts} />
          </div>
          <div className="border-b border-slate-100 p-4">
            <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Request number or product" />
          </div>
          <DataTable
            loading={isLoading}
            rows={data?.items}
            empty={{ title: 'Nothing here', description: 'No requests with this status.' }}
            columns={[
              {
                key: 'product',
                header: 'Request',
                cell: (q) => (
                  <div className="flex items-center gap-3">
                    <Thumb src={q.product.image} className="size-10 shrink-0 rounded-md border border-slate-200" />
                    <div className="min-w-0">
                      <p className="max-w-64 truncate font-medium text-slate-900">{q.product.name}</p>
                      <p className="text-xs text-slate-500">{q.number}</p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'buyer',
                header: 'Buyer',
                cell: (q) => (
                  <div>
                    <p className="text-slate-800">{q.buyer?.businessName ?? q.buyer?.name}</p>
                    <p className="text-xs text-slate-500">Pincode {q.pincode}</p>
                  </div>
                ),
              },
              { key: 'qty', header: 'Quantity', className: 'text-right', cell: (q) => <span className="tabular font-medium">{formatNumber(q.quantity)}</span> },
              {
                key: 'target',
                header: 'Target / unit',
                className: 'text-right',
                cell: (q) => <span className="tabular text-slate-600">{q.targetUnitPrice ? formatINR(q.targetUnitPrice) : '—'}</span>,
              },
              { key: 'needed', header: 'Needed by', cell: (q) => (q.requiredBy ? formatDate(q.requiredBy) : 'Flexible') },
              { key: 'status', header: 'Status', cell: (q) => <QuoteStatus status={q.status} /> },
              { key: 'updated', header: 'Updated', cell: (q) => <span className="text-slate-500">{formatRelative(q.updatedAt)}</span> },
              {
                key: 'actions',
                header: '',
                className: 'w-px',
                cell: (q) => (
                  <RowActions
                    items={[
                      {
                        label: q.status === 'requested' ? 'Reply with a quote' : 'View',
                        icon: Eye,
                        onSelect: () => navigate(`${seller.base}/quotes/${q._id}`),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
          <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
        </Card>
      )}
    </>
  )
}
