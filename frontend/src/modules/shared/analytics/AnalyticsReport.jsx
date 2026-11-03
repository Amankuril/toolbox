import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, Download, Eye, IndianRupee, Percent, RotateCcw, ShoppingBag, TicketPercent, Undo2, Users } from 'lucide-react'
import { useState } from 'react'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { cn } from '@/core/lib/cn'
import { PRODUCT_TYPES } from '@/core/lib/constants'
import { formatCompactINR, formatINR, formatNumber } from '@/core/lib/format'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { Heatmap, TrendChart } from '@/ui/charts'
import { SegmentedControl } from '@/ui/Controls'
import { Select } from '@/ui/Field'
import { CategoryFilter, DateRangeFilter } from '@/ui/Filters'
import { PageHeader, StatCard } from '@/ui/PageHeader'

const PERIODS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '12 months' },
  { value: 'custom', label: 'Custom' },
]
const SOURCE_LABEL = { direct: 'Direct / typed', whatsapp: 'WhatsApp', google: 'Google', facebook: 'Facebook', instagram: 'Instagram', other: 'Other sites' }
const PAYMENT_LABEL = { razorpay: 'Paid online', cod: 'Cash on delivery', partial: 'Part payment', offline: 'Paid offline', wallet: 'Wallet' }
const STATUS_LABEL = { pending: 'New', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', returned: 'Returned' }
const METRICS = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'orders', label: 'Orders' },
  { value: 'units', label: 'Units' },
  { value: 'views', label: 'Page views' },
  { value: 'visitors', label: 'Visitors' },
]
const PRODUCT_SORTS = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'units', label: 'Units' },
  { value: 'orders', label: 'Orders' },
  { value: 'views', label: 'Views' },
]

const short = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' })
const longDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const ymdDate = (d) => new Date(`${d}T00:00:00`)
function bucketLabel(key, unit) {
  if (unit === 'month') return monthFmt.format(new Date(`${key}-01T00:00:00`))
  if (unit === 'week') return `Wk of ${short.format(ymdDate(key))}`
  return short.format(ymdDate(key))
}
const rangeText = (from, to) => (from === to ? longDate.format(ymdDate(from)) : `${short.format(ymdDate(from))} – ${longDate.format(ymdDate(to))}`)

/** "+12.5% vs previous period", coloured by direction (with an arrow, never colour alone). */
function Change({ change, invert = false }) {
  if (change == null) return <span className="text-slate-500">No earlier data to compare</span>
  const up = change >= 0
  const good = invert ? !up : up
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-semibold', good ? 'text-emerald-700' : 'text-red-700')}>
      <Icon className="size-3.5" /> {Math.abs(change)}% <span className="font-normal text-slate-500">vs previous period</span>
    </span>
  )
}

/** Share bars for a small breakdown, largest first: one hue, the label and value in text ink. */
export function Breakdown({ rows, format = formatNumber, limit = 8 }) {
  const total = rows.reduce((s, r) => s + r.value, 0)
  if (!total) return <p className="py-6 text-center text-sm text-slate-500">Nothing yet in this period.</p>
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value)
  // Past the limit the tail folds into "Other", so the bars stay readable.
  const shown = sorted.length > limit ? [...sorted.slice(0, limit - 1), { label: 'Other', value: sorted.slice(limit - 1).reduce((s, r) => s + r.value, 0) }] : sorted
  return (
    <ul className="flex flex-col gap-3">
      {shown.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-3">
            <span className="min-w-0 truncate text-slate-700">{r.label}</span>
            <span className="tabular shrink-0 text-slate-900">
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

function downloadCsv(data) {
  const rows = [
    ['Period', 'Revenue (₹)', 'Orders', 'Units', 'Page views', 'Visitors', 'Previous revenue (₹)', 'Previous orders'],
    ...data.series.map((p) => [p.key, p.revenue / 100, p.orders, p.units, p.views, p.visitors, p.prevRevenue / 100, p.prevOrders]),
  ]
  const csv = rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff), csv], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `analytics-${data.range.from}-to-${data.range.to}.csv` })
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Sales, customers and storefront visits with filters, for a seller, the house store or the whole
 * marketplace. Filters live in the URL so a view can be bookmarked or shared.
 *
 * @param {{ title: string, description: string, queryKey: any[], fetch: (params) => Promise<any>, categories: any[],
 *   vendors?: { value: string, label: string }[] }} props  `vendors`: marketplace view (seller filter + top sellers)
 */
export function AnalyticsReport({ title, description, queryKey, fetch, categories, vendors }) {
  const [f, setF] = useSearchParamsState()
  const [metric, setMetric] = useState('revenue')
  const [productSort, setProductSort] = useState('revenue')
  const period = f.from && f.to ? 'custom' : (f.period ?? '30')
  const [custom, setCustom] = useState({ from: f.from ?? '', to: f.to ?? '' })
  const params = {
    ...(period === 'custom' ? (f.from && f.to ? { from: f.from, to: f.to } : { days: 30 }) : { days: Number(period) }),
    category: f.category || undefined,
    type: f.type || undefined,
    payment: f.payment || undefined,
    vendor: f.vendor || undefined,
  }
  const { data, isLoading, isFetching } = useQuery({ queryKey: [...queryKey, params], queryFn: () => fetch(params), placeholderData: keepPreviousData })
  const filtered = Boolean(f.category || f.type || f.payment || f.vendor)
  const t = data?.totals

  const setPeriod = (value) => {
    if (value === 'custom') {
      setF({ period: 'custom' })
      return
    }
    setCustom({ from: '', to: '' })
    setF({ period: value === '30' ? '' : value, from: '', to: '' })
  }

  const metricFormat = metric === 'revenue' ? (v) => formatINR(v, { whole: true }) : formatNumber
  const trend =
    data?.series.map((p) => ({
      label: bucketLabel(p.key, data.range.unit),
      value: p[metric],
      previous: metric === 'visitors' ? undefined : p[`prev${metric[0].toUpperCase()}${metric.slice(1)}`],
    })) ?? []
  const products = [...(data?.topProducts ?? [])].sort((a, b) => b[productSort] - a[productSort]).slice(0, 10)

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          data && (
            <Button variant="outline" onClick={() => downloadCsv(data)}>
              <Download /> Export CSV
            </Button>
          )
        }
      />

      {/* Filters: one row, above every chart; each control changes everything below. */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <SegmentedControl value={period} onChange={setPeriod} options={PERIODS} size="sm" />
          {period === 'custom' && (
            <DateRangeFilter
              label="Dates"
              from={custom.from}
              to={custom.to}
              onChange={(v) => {
                setCustom(v)
                if (v.from && v.to) setF({ period: '', from: v.from, to: v.to })
              }}
            />
          )}
          <CategoryFilter options={categories} value={f.category} onChange={(category) => setF({ category })} />
          <Select value={f.type ?? ''} onChange={(e) => setF({ type: e.target.value })} className="w-auto" aria-label="Product type">
            <option value="">All types</option>
            {PRODUCT_TYPES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
          <Select value={f.payment ?? ''} onChange={(e) => setF({ payment: e.target.value })} className="w-auto" aria-label="Payment method">
            <option value="">All payments</option>
            {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          {vendors && (
            <Select value={f.vendor ?? ''} onChange={(e) => setF({ vendor: e.target.value })} className="w-auto max-w-56" aria-label="Seller">
              <option value="">All sellers</option>
              {vendors.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => setF({ category: '', type: '', payment: '', vendor: '' })}>
              <RotateCcw /> Clear filters
            </Button>
          )}
        </div>
        {data && (
          <p className={cn('border-t border-slate-100 px-4 py-2 text-xs text-slate-500 transition-opacity', isFetching && 'opacity-60')}>
            {rangeText(data.range.from, data.range.to)}, compared with {rangeText(data.range.prevFrom, data.range.prevTo)}
            {data.range.unit !== 'day' && ` · shown by ${data.range.unit}`}
            {t?.visitors.value == null && ' · visitors aren’t counted per category or type, so page views are shown instead'}
          </p>
        )}
      </Card>

      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className={cn('flex flex-col gap-6 transition-opacity', isFetching && 'opacity-70')}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Revenue" icon={IndianRupee} value={formatCompactINR(t.revenue.value)} hint={<Change change={t.revenue.change} />} />
            <StatCard label="Orders" icon={ShoppingBag} value={formatNumber(t.orders.value)} hint={<Change change={t.orders.change} />} />
            <StatCard label="Avg. order value" icon={IndianRupee} value={formatINR(t.avgOrderValue.value, { whole: true })} hint={<Change change={t.avgOrderValue.change} />} />
            <StatCard label="Units sold" icon={ShoppingBag} value={formatNumber(t.units.value)} hint={<Change change={t.units.change} />} />
            <StatCard
              label="Customers"
              icon={Users}
              value={formatNumber(t.customers.value)}
              hint={`${formatNumber(t.customers.returning)} returning · ${formatNumber(t.customers.value - t.customers.returning)} new`}
            />
            <StatCard
              label="Visitors"
              icon={Users}
              value={t.visitors.value == null ? '—' : formatNumber(t.visitors.value)}
              hint={t.visitors.value == null ? 'Not split by category or type' : <Change change={t.visitors.change} />}
            />
            <StatCard label="Page views" icon={Eye} value={formatNumber(t.views.value)} hint={<Change change={t.views.change} />} />
            <StatCard
              label="Conversion rate"
              icon={Percent}
              value={t.conversionRate.value == null ? '—' : `${t.conversionRate.value}%`}
              hint={t.conversionRate.value == null ? 'Orders per visitor, once there are visitors' : <Change change={t.conversionRate.change} />}
            />
            <StatCard label="Coupon discounts" icon={TicketPercent} value={formatCompactINR(t.discount.value)} hint={<Change change={t.discount.change} invert />} />
            <StatCard
              label="Cancelled items"
              icon={Undo2}
              value={`${t.cancelRate.value}%`}
              hint={t.cancelRate.previous != null ? `${t.cancelRate.previous}% the period before · wishlisted ${formatNumber(t.wishlisted.value)}×` : undefined}
            />
          </div>

          <Card>
            <CardHeader
              title="Trend"
              description={`Per ${data.range.unit}, cancelled items excluded. The dashed line is the same stretch of time just before.`}
              action={<SegmentedControl value={metric} onChange={setMetric} options={METRICS} size="sm" />}
            />
            <CardBody>
              <TrendChart
                title={`${METRICS.find((m) => m.value === metric).label} per ${data.range.unit}`}
                data={trend}
                formatValue={metricFormat}
                formatTick={metric === 'revenue' ? formatCompactINR : formatNumber}
                currentLabel={rangeText(data.range.from, data.range.to)}
                previousLabel={rangeText(data.range.prevFrom, data.range.prevTo)}
                empty={metric === 'visitors' && t.visitors.value == null ? 'Visitors aren’t split by category or type' : 'Nothing in this period yet'}
              />
            </CardBody>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title={data.filters.category ? `Inside ${data.filters.category.name}` : 'Sales by department'} description="Revenue by category, cancelled items excluded" />
              <CardBody>
                <Breakdown rows={data.byCategory.map((c) => ({ label: c.name, value: c.revenue }))} format={(v) => formatINR(v, { whole: true })} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="When orders come in" description="Orders by day of the week and hour (IST): plan offers and staffing around the busy times" />
              <CardBody>
                <Heatmap cells={data.heatmap} title="Orders by weekday and hour" />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Top products"
              description="Best sellers in this period, with how often their page was viewed"
              action={<SegmentedControl value={productSort} onChange={setProductSort} options={PRODUCT_SORTS} size="sm" />}
            />
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
                  {products.length ? (
                    products.map((p) => (
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

          {vendors && !f.vendor && (
            <Card>
              <CardHeader title="Top sellers" description="Revenue by store in this period. Pick one in the seller filter to see only their numbers." />
              <CardBody>
                <Breakdown rows={data.topVendors.map((v) => ({ label: v.isPlatform ? `${v.name} (our store)` : v.name, value: v.revenue }))} format={(v) => formatINR(v, { whole: true })} limit={10} />
              </CardBody>
            </Card>
          )}

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
              <CardHeader title="Top states" description="Revenue by delivery state" />
              <CardBody>
                <Breakdown rows={data.topStates.map((s) => ({ label: s.state, value: s.revenue }))} format={(v) => formatINR(v, { whole: true })} />
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Item status" description="Where this period’s order lines are now" />
              <CardBody>
                <Breakdown rows={Object.entries(data.itemStatus).map(([k, v]) => ({ label: STATUS_LABEL[k] ?? k, value: v }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top cities" description="Orders by delivery city" />
              <CardBody>
                <Breakdown rows={data.topCities.map((c) => ({ label: `${c.city}, ${c.state}`, value: c.orders }))} />
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
