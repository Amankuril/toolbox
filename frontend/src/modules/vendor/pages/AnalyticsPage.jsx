import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, Eye, IndianRupee, Percent, ShoppingBag, Users } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/core/lib/cn'
import { formatCompactINR, formatINR, formatNumber } from '@/core/lib/format'
import { Thumb } from '@/ui/Brand'
import { Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { ColumnChart } from '@/ui/ColumnChart'
import { SegmentedControl } from '@/ui/Controls'
import { PageHeader, StatCard } from '@/ui/PageHeader'
import { useSeller } from '../seller'

const PERIODS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
]
const SOURCE_LABEL = { direct: 'Direct / typed', whatsapp: 'WhatsApp', google: 'Google', facebook: 'Facebook', instagram: 'Instagram', other: 'Other sites' }
const PAYMENT_LABEL = { razorpay: 'Paid online', cod: 'Cash on delivery', partial: 'Part payment', offline: 'Paid offline', wallet: 'Wallet' }
const STATUS_LABEL = { pending: 'New', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' }

const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** "+12.5% vs previous 30 days", coloured by direction (with an arrow, never colour alone). */
function Change({ change, days, invert = false }) {
  if (change == null) return <span className="text-slate-500">No earlier data to compare</span>
  const up = change >= 0
  const good = invert ? !up : up
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-semibold', good ? 'text-emerald-700' : 'text-red-700')}>
      <Icon className="size-3.5" /> {Math.abs(change)}% <span className="font-normal text-slate-500">vs previous {days} days</span>
    </span>
  )
}

/** Share bars for a small breakdown (traffic sources, payment mix…), largest first. */
function Breakdown({ rows, format = formatNumber }) {
  const total = rows.reduce((s, r) => s + r.value, 0)
  if (!total) return <p className="py-6 text-center text-sm text-slate-500">Nothing yet in this period.</p>
  return (
    <ul className="flex flex-col gap-3">
      {[...rows]
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((r) => (
          <li key={r.label} className="text-sm">
            <div className="mb-1 flex justify-between gap-3">
              <span className="text-slate-700">{r.label}</span>
              <span className="tabular text-slate-900">
                {format(r.value)} <span className="text-slate-500">· {Math.round((r.value / total) * 100)}%</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${(r.value / total) * 100}%` }} />
            </div>
          </li>
        ))}
    </ul>
  )
}

/** Store analytics: sales, orders, customers and storefront visits for this seller (or the house store). */
export default function AnalyticsPage() {
  const seller = useSeller()
  const [days, setDays] = useState(30)
  const { data, isLoading } = useQuery({
    queryKey: [...seller.keys.all, 'analytics', days],
    queryFn: () => seller.api.analytics({ days }),
    placeholderData: keepPreviousData,
  })
  const t = data?.totals

  return (
    <>
      <PageHeader
        title="Store analytics"
        description="How your store is doing: sales, orders, customers, and who visits your store and product pages."
        actions={<SegmentedControl value={days} onChange={setDays} options={PERIODS} size="sm" />}
      />
      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Revenue" icon={IndianRupee} value={formatCompactINR(t.revenue.value)} hint={<Change change={t.revenue.change} days={days} />} />
            <StatCard label="Orders" icon={ShoppingBag} value={formatNumber(t.orders.value)} hint={<Change change={t.orders.change} days={days} />} />
            <StatCard label="Avg. order value" icon={IndianRupee} value={formatINR(t.avgOrderValue.value, { whole: true })} hint={<Change change={t.avgOrderValue.change} days={days} />} />
            <StatCard label="Units sold" icon={ShoppingBag} value={formatNumber(t.units.value)} hint={<Change change={t.units.change} days={days} />} />
            <StatCard label="Visitors" icon={Users} value={formatNumber(t.visitors.value)} hint={<Change change={t.visitors.change} days={days} />} />
            <StatCard label="Page views" icon={Eye} value={formatNumber(t.views.value)} hint={<Change change={t.views.change} days={days} />} />
            <StatCard
              label="Conversion rate"
              icon={Percent}
              value={t.conversionRate.value == null ? '—' : `${t.conversionRate.value}%`}
              hint={t.conversionRate.value == null ? 'Orders per visitor, once you have visitors' : <Change change={t.conversionRate.change} days={days} />}
            />
            <StatCard
              label="Customers"
              icon={Users}
              value={formatNumber(t.customers.value)}
              hint={`${formatNumber(t.customers.returning)} returning · ${formatNumber(t.customers.value - t.customers.returning)} new`}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Revenue per day" description={`Last ${days} days, cancelled items excluded`} />
              <CardBody>
                <ColumnChart
                  title="Revenue per day"
                  data={data.daily.map((d) => ({ label: dayLabel(d.date), value: d.revenue, detail: `${d.orders} order${d.orders === 1 ? '' : 's'}` }))}
                  formatValue={(v) => formatINR(v, { whole: true })}
                  formatTick={formatCompactINR}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Visitors per day" description="People who opened your store or product pages" />
              <CardBody>
                <ColumnChart
                  title="Visitors per day"
                  data={data.daily.map((d) => ({ label: dayLabel(d.date), value: d.visitors, detail: `${formatNumber(d.views)} page views` }))}
                  formatValue={formatNumber}
                />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Top products" description="Best sellers in this period, with how often their page was viewed" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-[0.7rem] font-semibold tracking-[0.07em] text-slate-600 uppercase">
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3 text-right">Views</th>
                    <th className="px-4 py-3 text-right">Orders</th>
                    <th className="px-4 py-3 text-right">Units</th>
                    <th className="px-4 py-3 text-right">Revenue</th>
                    <th className="px-4 py-3 text-right">Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.topProducts.length ? (
                    data.topProducts.map((p) => (
                      <tr key={p._id}>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-3">
                            <Thumb src={p.image} className="size-9 shrink-0 rounded border border-slate-200" />
                            <span className="line-clamp-2 font-medium text-slate-900">{p.name}</span>
                          </span>
                        </td>
                        <td className="tabular px-4 py-3 text-right">{formatNumber(p.views)}</td>
                        <td className="tabular px-4 py-3 text-right">{formatNumber(p.orders)}</td>
                        <td className="tabular px-4 py-3 text-right">{formatNumber(p.units)}</td>
                        <td className="tabular px-4 py-3 text-right font-semibold">{formatINR(p.revenue, { whole: true })}</td>
                        <td className="tabular px-4 py-3 text-right">{p.conversion == null ? '—' : `${p.conversion}%`}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No sales in this period yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Where visitors come from" />
              <CardBody>
                <Breakdown rows={Object.entries(data.sources).map(([k, v]) => ({ label: SOURCE_LABEL[k] ?? k, value: v }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="How customers pay" description="Orders in this period" />
              <CardBody>
                <Breakdown rows={Object.entries(data.paymentMix).map(([k, v]) => ({ label: PAYMENT_LABEL[k] ?? k, value: v }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top cities" description="Where orders are going" />
              <CardBody>
                <Breakdown rows={data.topCities.map((c) => ({ label: `${c.city}, ${c.state}`, value: c.orders }))} />
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Item status" description={`Cancelled: ${t.cancelRate.value}% of items · Wishlisted ${formatNumber(t.wishlisted.value)} times`} />
              <CardBody>
                <Breakdown rows={Object.entries(data.itemStatus).map(([k, v]) => ({ label: STATUS_LABEL[k] ?? k, value: v }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Viewed but not sold" description="Popular pages with no orders yet: check the price, photos and description" />
              <CardBody>
                {data.mostViewedUnsold.length ? (
                  <ul className="divide-y divide-slate-100">
                    {data.mostViewedUnsold.map((p) => (
                      <li key={p._id} className="flex items-center gap-3 py-2.5 text-sm">
                        <Thumb src={p.image} className="size-9 shrink-0 rounded border border-slate-200" />
                        <span className="min-w-0 flex-1 truncate text-slate-900">{p.name}</span>
                        <span className="tabular text-slate-600">{formatNumber(p.views)} views</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-slate-500">Every viewed product sold at least once. Nice.</p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
