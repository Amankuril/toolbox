import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDateTime, formatINR, formatPhone } from '@/core/lib/format'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Card } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { Select } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'
import { RowActions } from '@/ui/RowActions'
import { adminApi, adminKeys } from '../api'

const TABS = [
  { value: '', label: 'All' },
  { value: 'placed', label: 'New' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'pending_payment', label: 'Awaiting payment' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function OrdersPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useSearchParamsState()
  const params = {
    page: Number(filters.page ?? 1),
    limit: 20,
    status: filters.status || undefined,
    paymentMethod: filters.paymentMethod || undefined,
    paymentStatus: filters.paymentStatus || undefined,
    q: filters.q || undefined,
  }
  const { data, isLoading } = useQuery({ queryKey: adminKeys.orders(params), queryFn: () => adminApi.orders(params), placeholderData: keepPreviousData })

  return (
    <>
      <PageHeader title="Orders" description="Every order across all vendors." />
      <Card>
        <div className="px-4 pt-2">
          <FilterTabs value={filters.status ?? ''} onChange={(status) => setFilters({ status })} options={TABS} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Order number" />
          <Select value={filters.paymentMethod ?? ''} onChange={(e) => setFilters({ paymentMethod: e.target.value })} className="w-auto">
            <option value="">All payment methods</option>
            <option value="razorpay">Online</option>
            <option value="cod">Cash on delivery</option>
          </Select>
          <Select value={filters.paymentStatus ?? ''} onChange={(e) => setFilters({ paymentStatus: e.target.value })} className="w-auto">
            <option value="">Any payment status</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="refunded">Refunded</option>
            <option value="partially_refunded">Partly refunded</option>
            <option value="failed">Failed</option>
          </Select>
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          empty={{ title: 'No orders found' }}
          columns={[
            { key: 'no', header: 'Order', cell: (o) => <span className="font-medium text-slate-900">{o.orderNumber}</span> },
            {
              key: 'customer',
              header: 'Customer',
              cell: (o) => (
                <div>
                  <p className="text-slate-800">{o.user?.name ?? o.shippingAddress.name}</p>
                  <p className="text-xs text-slate-500">{formatPhone(o.user?.phone)}</p>
                </div>
              ),
            },
            { key: 'items', header: 'Items', cell: (o) => `${o.items.length} line${o.items.length === 1 ? '' : 's'}` },
            { key: 'placed', header: 'Placed', cell: (o) => formatDateTime(o.createdAt) },
            {
              key: 'payment',
              header: 'Payment',
              cell: (o) => (
                <div className="flex flex-col items-start gap-1">
                  <Badge>{o.payment.method === 'cod' ? 'COD' : 'Online'}</Badge>
                  <StatusBadge status={o.payment.status} />
                </div>
              ),
            },
            { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
            {
              key: 'total',
              header: 'Total',
              className: 'text-right',
              cell: (o) => <span className="tabular font-semibold">{formatINR(o.amounts.total)}</span>,
            },
            {
              key: 'actions',
              header: '',
              className: 'w-px',
              cell: (o) => (
                <RowActions
                  label={`Actions for order ${o.orderNumber}`}
                  items={[{ label: 'View order', icon: Eye, onSelect: () => navigate(`/admin/orders/${o._id}`) }]}
                />
              ),
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
      </Card>
    </>
  )
}
