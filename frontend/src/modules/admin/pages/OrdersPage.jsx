import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { useBranding } from '@/core/settings/usePublicSettings'
import { formatDateTime, formatINR, formatPhone } from '@/core/lib/format'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Card } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination, pageSize } from '@/ui/DataTable'
import { Select } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'
import { RowActions } from '@/ui/RowActions'
import { CreateOrderButton, PaymentLinksButton } from '@/modules/shared/manualOrders'
import { WhatsAppButton } from '@/modules/shared/whatsapp'
import { useAdminAccess } from '../access'
import { adminApi, adminKeys } from '../api'
import { CashCollectedButton } from '../CashCollected'
import { DateRangeFilter, dateBounds } from '@/ui/Filters'

const PAYMENT_SHORT = { cod: 'COD', razorpay: 'Online', partial: 'Part paid', offline: 'Offline', wallet: 'Wallet' }

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
  const { siteName } = useBranding()
  const { can } = useAdminAccess()
  const [filters, setFilters] = useSearchParamsState()
  const params = {
    page: Number(filters.page ?? 1),
    limit: pageSize(filters.limit),
    status: filters.status || undefined,
    paymentMethod: filters.paymentMethod || undefined,
    paymentStatus: filters.paymentStatus || undefined,
    q: filters.q || undefined,
    vendor: filters.vendor || undefined,
    source: filters.source || undefined,
    ...dateBounds(filters),
  }
  const { data: sellers } = useQuery({ queryKey: adminKeys.vendors({ status: 'approved', limit: 100 }), queryFn: () => adminApi.vendors({ status: 'approved', limit: 100 }), staleTime: 5 * 60_000 })
  const { data, isLoading } = useQuery({ queryKey: adminKeys.orders(params), queryFn: () => adminApi.orders(params), placeholderData: keepPreviousData })

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order across all vendors."
        actions={
          <>
            <PaymentLinksButton client={adminApi.manualOrders} root={adminKeys.all} siteName={siteName} />
            <CreateOrderButton client={adminApi.manualOrders} root={adminKeys.all} siteName={siteName} onCreated={(o) => navigate(`/admin/orders/${o._id}`)} />
          </>
        }
      />
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
            <option value="partial">Part payment</option>
            <option value="offline">Paid offline</option>
            <option value="wallet">Wallet</option>
          </Select>
          <Select value={filters.paymentStatus ?? ''} onChange={(e) => setFilters({ paymentStatus: e.target.value })} className="w-auto">
            <option value="">Any payment status</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="refunded">Refunded</option>
            <option value="partially_refunded">Partly refunded</option>
            <option value="failed">Failed</option>
          </Select>
          <Select value={filters.vendor ?? ''} onChange={(e) => setFilters({ vendor: e.target.value })} className="w-auto max-w-56">
            <option value="">All sellers</option>
            {(sellers?.items ?? []).map((v) => (
              <option key={v._id} value={v._id}>
                {v.store?.name}
              </option>
            ))}
          </Select>
          <Select value={filters.source ?? ''} onChange={(e) => setFilters({ source: e.target.value })} className="w-auto">
            <option value="">Any source</option>
            <option value="checkout">Storefront checkout</option>
            <option value="manual">Created in a panel</option>
            <option value="link">Payment link</option>
          </Select>
          <DateRangeFilter label="Placed" from={filters.from} to={filters.to} onChange={setFilters} />
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
                  <p className="flex items-center gap-1 text-xs text-slate-500">
                    {formatPhone(o.user?.phone ?? o.shippingAddress.phone)}
                    <WhatsAppButton
                      phone={o.user?.phone ?? o.shippingAddress.phone}
                      text={`Hi ${(o.user?.name ?? o.shippingAddress.name).split(' ')[0]}, this is ${siteName} about your order ${o.orderNumber}.`}
                      className="size-6"
                    />
                  </p>
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
                  <Badge>{PAYMENT_SHORT[o.payment.method] ?? 'Online'}</Badge>
                  <StatusBadge status={o.payment.status} />
                  {can('orders', 'manage') && <CashCollectedButton order={o} size="xs" className="mt-0.5" />}
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
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} onLimitChange={(limit) => setFilters({ limit })} />
      </Card>
    </>
  )
}
