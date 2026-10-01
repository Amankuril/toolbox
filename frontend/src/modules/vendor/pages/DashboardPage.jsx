import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, IndianRupee, Package, PackagePlus, ShoppingBag, Truck } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { formatCompactINR, formatDate, formatINR, formatNumber } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { ColumnChart } from '@/ui/ColumnChart'
import { DataTable } from '@/ui/DataTable'
import { PageHeader, StatCard } from '@/ui/PageHeader'
import { useVendor, vendorApi, vendorKeys } from '../api'

export default function VendorDashboardPage() {
  const vendor = useVendor()
  const navigate = useNavigate()
  const approved = vendor?.status === 'approved'
  const { data, isLoading } = useQuery({ queryKey: vendorKeys.dashboard, queryFn: vendorApi.dashboard, enabled: approved })

  if (!approved) {
    return (
      <>
        <PageHeader title={`Welcome, ${vendor?.contactName?.split(' ')[0] ?? ''}`} description="Here's what happens next." />
        <Card>
          <CardBody className="grid gap-6 md:grid-cols-3">
            {[
              { n: 1, title: 'Complete setup', text: 'Business, address, bank and documents.', done: vendor?.onboarding?.isComplete },
              { n: 2, title: 'Get approved', text: 'We verify your GST and bank details.', done: false },
              { n: 3, title: 'List products', text: 'Add tools, machinery and spare parts.', done: false },
            ].map((s) => (
              <div key={s.n} className="flex gap-3">
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${s.done ? 'bg-accent text-accent-fg' : 'bg-slate-100 text-slate-600'}`}
                >
                  {s.n}
                </span>
                <div>
                  <p className="font-medium text-slate-900">{s.title}</p>
                  <p className="text-sm text-slate-500">{s.text}</p>
                </div>
              </div>
            ))}
          </CardBody>
          {['onboarding', 'rejected'].includes(vendor?.status) && (
            <div className="border-t border-slate-100 px-5 py-4">
              <Button asChild>
                <Link to="/vendor/onboarding">{vendor.status === 'rejected' ? 'Update your details' : 'Continue setup'}</Link>
              </Button>
            </div>
          )}
        </Card>
      </>
    )
  }

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

  const toShip = (data.itemsByStatus.pending ?? 0) + (data.itemsByStatus.confirmed ?? 0) + (data.itemsByStatus.packed ?? 0)

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={vendor.store?.name}
        actions={
          <Button asChild>
            <Link to="/vendor/products/new">
              <PackagePlus /> Add product
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sales, last 30 days"
          value={formatINR(data.last30Days.revenue, { whole: true })}
          hint={`${formatNumber(data.last30Days.units)} units sold`}
          icon={IndianRupee}
        />
        <StatCard label="Orders, last 30 days" value={formatNumber(data.last30Days.orders)} icon={ShoppingBag} tone="accent" to="/vendor/orders" />
        <StatCard
          label="To ship"
          value={formatNumber(toShip)}
          hint="Items awaiting dispatch"
          icon={Truck}
          tone={toShip ? 'warning' : 'neutral'}
          to="/vendor/orders?status=pending"
        />
        <StatCard
          label="Live products"
          value={formatNumber(data.productsByStatus.active ?? 0)}
          hint={data.productsByStatus.pending ? `${data.productsByStatus.pending} awaiting approval` : undefined}
          icon={Package}
          tone="neutral"
          to="/vendor/products"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Daily sales" description="Your item sales for the last 14 days." />
          <CardBody>
            <ColumnChart
              title="Your daily sales, last 14 days"
              data={data.dailySales.map((d) => ({
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
          <CardHeader title="Low stock" description="Live products with 5 or fewer units" />
          {data.lowStock.length ? (
            <ul className="divide-y divide-slate-100">
              {data.lowStock.map((p) => (
                <li key={p._id}>
                  <Link to={`/vendor/products/${p._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <Thumb src={p.image?.url} className="size-10 shrink-0 rounded-md border border-slate-200" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{p.name}</span>
                    <span className={`tabular inline-flex items-center gap-1 text-sm font-semibold ${p.stock === 0 ? 'text-red-600' : 'text-amber-700'}`}>
                      {p.stock === 0 && <AlertTriangle className="size-3.5" />}
                      {p.stock}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <p className="text-sm text-slate-500">All live products are well stocked.</p>
            </CardBody>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent orders"
          action={
            <Link to="/vendor/orders" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          }
        />
        <DataTable
          rows={data.recentOrders}
          onRowClick={(o) => navigate(`/vendor/orders/${o._id}`)}
          empty={{ title: 'No orders yet', description: 'When customers buy your products, orders show up here.' }}
          columns={[
            { key: 'no', header: 'Order', cell: (o) => <span className="font-medium text-slate-900">{o.orderNumber}</span> },
            { key: 'date', header: 'Placed', cell: (o) => formatDate(o.createdAt) },
            { key: 'items', header: 'Items', cell: (o) => formatNumber(o.amounts.itemCount) },
            { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.items[0]?.status} /> },
            {
              key: 'total',
              header: 'Your total',
              className: 'text-right',
              cell: (o) => <span className="tabular font-semibold">{formatINR(o.amounts.subtotal)}</span>,
            },
          ]}
        />
      </Card>
    </>
  )
}
