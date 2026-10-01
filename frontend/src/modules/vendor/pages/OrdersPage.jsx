import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDateTime, formatINR, formatNumber } from '@/core/lib/format'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Card } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { PageHeader } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'
import { vendorApi, vendorKeys } from '../api'

const TABS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'New' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'packed', label: 'Packed' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
]

/** Summarises the vendor's line statuses on an order, e.g. "2 shipped · 1 pending". */
function lineSummary(items) {
  const counts = items.reduce((acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }), {})
  const entries = Object.entries(counts)
  return entries.length === 1 ? (
    <StatusBadge status={entries[0][0]} />
  ) : (
    <span className="text-xs text-slate-600">{entries.map(([s, n]) => `${n} ${s}`).join(' · ')}</span>
  )
}

export default function VendorOrdersPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useSearchParamsState()
  const params = { page: Number(filters.page ?? 1), limit: 20, status: filters.status || undefined, q: filters.q || undefined }
  const { data, isLoading } = useQuery({ queryKey: vendorKeys.orders(params), queryFn: () => vendorApi.orders(params), placeholderData: keepPreviousData })

  return (
    <>
      <PageHeader title="Orders" description="Orders containing your products. Confirm, pack and ship each item." />
      <Card>
        <div className="px-4 pt-2">
          <FilterTabs value={filters.status ?? ''} onChange={(status) => setFilters({ status })} options={TABS} />
        </div>
        <div className="border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Order number" />
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          onRowClick={(o) => navigate(`/vendor/orders/${o._id}`)}
          empty={{
            title: 'No orders here',
            description: filters.status ? 'Nothing with this status right now.' : 'Orders show up as soon as customers buy your products.',
          }}
          columns={[
            { key: 'no', header: 'Order', cell: (o) => <span className="font-medium text-slate-900">{o.orderNumber}</span> },
            { key: 'placed', header: 'Placed', cell: (o) => formatDateTime(o.createdAt) },
            { key: 'ship', header: 'Ship to', cell: (o) => `${o.shippingAddress.city}, ${o.shippingAddress.state}` },
            { key: 'items', header: 'Units', className: 'text-right', cell: (o) => <span className="tabular">{formatNumber(o.amounts.itemCount)}</span> },
            { key: 'payment', header: 'Payment', cell: (o) => <Badge>{o.payment.method === 'cod' ? 'COD' : 'Prepaid'}</Badge> },
            { key: 'status', header: 'Items', cell: (o) => lineSummary(o.items) },
            {
              key: 'total',
              header: 'Your total',
              className: 'text-right',
              cell: (o) => <span className="tabular font-semibold">{formatINR(o.amounts.subtotal)}</span>,
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
      </Card>
    </>
  )
}
