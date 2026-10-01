import { useQuery } from '@tanstack/react-query'
import { ArrowRight, FolderTree, IndianRupee, Package, ShoppingBag, Store, Users } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { formatCompactINR, formatDate, formatINR, formatNumber, formatRelative } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { ColumnChart } from '@/ui/ColumnChart'
import { DataTable } from '@/ui/DataTable'
import { PageHeader, StatCard } from '@/ui/PageHeader'
import { adminApi, adminKeys } from '../api'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: adminKeys.dashboard, queryFn: adminApi.dashboard })

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </>
    )
  }

  const { totals, last30Days, pendingApprovals: pending, dailySales, recentOrders } = data
  const pendingTotal = pending.vendors + pending.products + pending.categories

  return (
    <>
      <PageHeader title="Dashboard" description="Marketplace activity at a glance." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sales, last 30 days"
          value={formatINR(last30Days.gmv, { whole: true })}
          hint={`${formatNumber(last30Days.orders)} orders`}
          icon={IndianRupee}
        />
        <StatCard label="Orders" value={formatNumber(totals.orders)} hint="All time" icon={ShoppingBag} tone="accent" to="/admin/orders" />
        <StatCard
          label="Vendors"
          value={formatNumber(totals.vendors)}
          hint={`${formatNumber(data.vendorsByStatus.approved ?? 0)} approved · ${formatNumber(totals.products)} products`}
          icon={Store}
          tone="neutral"
          to="/admin/vendors"
        />
        <StatCard label="Customers" value={formatNumber(totals.users)} hint="Registered buyers" icon={Users} tone="neutral" to="/admin/customers" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Daily sales" description="Order value for the last 14 days, excluding cancelled and unpaid orders." />
          <CardBody>
            <ColumnChart
              title="Daily sales, last 14 days"
              data={dailySales.map((d) => ({
                label: new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                value: d.revenue,
                detail: `${d.orders} order${d.orders === 1 ? '' : 's'}`,
              }))}
              formatValue={(v) => formatINR(v, { whole: true })}
              formatTick={formatCompactINR}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Needs review" description={pendingTotal ? `${pendingTotal} item(s) waiting for approval` : 'You are all caught up'} />
          <ul className="divide-y divide-slate-100">
            {[
              { label: 'Vendor applications', count: pending.vendors, to: '/admin/vendors?status=pending_review', icon: Store },
              { label: 'Products', count: pending.products, to: '/admin/products?status=pending', icon: Package },
              { label: 'Categories', count: pending.categories, to: '/admin/categories?status=pending', icon: FolderTree },
            ].map((row) => (
              <li key={row.label}>
                <Link to={row.to} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-slate-50">
                  <span className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-600">
                    <row.icon className="size-4" />
                  </span>
                  <span className="flex-1 text-sm font-medium text-slate-800">{row.label}</span>
                  <span
                    className={`tabular rounded-full px-2.5 py-0.5 text-sm font-semibold ${row.count ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {row.count}
                  </span>
                  <ArrowRight className="size-4 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent orders"
          action={
            <Link to="/admin/orders" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          }
        />
        <DataTable
          rows={recentOrders}
          onRowClick={(o) => navigate(`/admin/orders/${o._id}`)}
          empty={{ title: 'No orders yet', description: 'Orders will appear here as customers check out.' }}
          columns={[
            { key: 'no', header: 'Order', cell: (o) => <span className="font-medium text-slate-900">{o.orderNumber}</span> },
            { key: 'customer', header: 'Customer', cell: (o) => o.user?.name ?? '—' },
            { key: 'date', header: 'Placed', cell: (o) => <span title={formatDate(o.createdAt)}>{formatRelative(o.createdAt)}</span> },
            { key: 'pay', header: 'Payment', cell: (o) => <StatusBadge status={o.payment.status} /> },
            { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
            {
              key: 'total',
              header: 'Total',
              className: 'text-right',
              cell: (o) => <span className="tabular font-semibold">{formatINR(o.amounts.total)}</span>,
            },
          ]}
        />
      </Card>
    </>
  )
}
