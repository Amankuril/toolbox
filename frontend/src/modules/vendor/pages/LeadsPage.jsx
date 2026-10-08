import { useQuery } from '@tanstack/react-query'
import { MessageCircle, ShoppingCart } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatINR, formatPhone, formatRelative, pluralize } from '@/core/lib/format'
import { Card, EmptyState } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { Select } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'
import { formatActivity } from '../leads'
import { useSeller } from '../seller'

const TABS = [
  { value: 'abandoned', label: 'Abandoned cart' },
  { value: 'active', label: 'Active cart' },
  { value: 'whatsapp', label: 'WhatsApp leads' },
]
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]
const PERIODS = [
  { value: '', label: 'Any time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
]

function Contact({ lead }) {
  const { customer, lastContact } = lead
  return (
    <div>
      <p className="font-semibold text-slate-900">
        {customer?.phone ? formatPhone(customer.phone) : (customer?.email ?? 'Customer')}
        {customer?.name && <span className="font-medium text-slate-700"> | {customer.name}</span>}
      </p>
      {lastContact && (
        <p className="mt-0.5 text-xs text-slate-500">
          {lastContact.channel === 'sms' ? 'SMS' : 'WhatsApp'} sent {formatRelative(lastContact.at)}
        </p>
      )}
    </div>
  )
}

export default function LeadsPage() {
  const seller = useSeller()
  const navigate = useNavigate()
  const [filters, setFilters] = useSearchParamsState({ tab: 'abandoned', sort: 'newest' })
  const tab = TABS.some((t) => t.value === filters.tab) ? filters.tab : 'abandoned'
  const isCart = tab !== 'whatsapp'
  const params = {
    page: Number(filters.page ?? 1),
    limit: 20,
    q: filters.q || undefined,
    sort: filters.sort || 'newest',
    // Active carts are by definition from the last hour.
    period: tab === 'active' ? undefined : filters.period || undefined,
    ...(isCart ? { tab } : {}),
  }
  const { data: counts } = useQuery({ queryKey: seller.keys.leadCounts, queryFn: seller.api.leadCounts, refetchInterval: 60_000 })
  const { data, isLoading } = useQuery({
    queryKey: seller.keys.leads(tab, params),
    queryFn: () => (isCart ? seller.api.cartLeads(params) : seller.api.whatsappLeads(params)),
    // Keep rows on screen while paging or searching, but never across tabs: their rows have different shapes.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey.includes(tab) ? previous : undefined),
  })
  const open = (lead) => navigate(`${seller.base}/leads/${lead.userId}`)

  const cartColumns = [
    { key: 'contact', header: 'Contact | Customer name', cell: (l) => <Contact lead={l} /> },
    { key: 'updated', header: 'Last updated cart on', cell: (l) => <span className="text-slate-600">{formatActivity(l.updatedAt)}</span> },
    {
      key: 'value',
      header: 'Order value',
      className: 'text-right',
      cell: (l) => (
        <div>
          <p className="tabular font-semibold text-slate-900">{formatINR(l.value)}</p>
          <p className="text-xs text-slate-500">{pluralize(l.itemCount, 'item')}</p>
        </div>
      ),
    },
  ]
  const whatsappColumns = [
    { key: 'contact', header: 'Contact | Customer name', cell: (l) => <Contact lead={l} /> },
    {
      key: 'products',
      header: 'Asked about',
      cell: (l) => <p className="max-w-72 truncate text-slate-700">{l.products.map((p) => p.name).join(', ')}</p>,
    },
    { key: 'last', header: 'Last chat tap', cell: (l) => <span className="text-slate-600">{formatActivity(l.lastAt)}</span> },
    { key: 'clicks', header: 'Taps', className: 'text-right', cell: (l) => <span className="tabular text-slate-700">{l.clicks}</span> },
  ]

  return (
    <>
      <PageHeader
        title="Leads"
        description="Customers with your products in their cart, and customers who tapped “Chat on WhatsApp”. Open one to send a reminder or an offer."
      />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-x-4 px-4 pt-2">
          <FilterTabs value={tab} onChange={(next) => setFilters({ tab: next, page: undefined })} options={TABS} counts={counts} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchField className="min-w-56 flex-1" value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Search by name or mobile number" />
          {tab !== 'active' && (
            <Select aria-label="Period" className="w-40" value={filters.period ?? ''} onChange={(e) => setFilters({ period: e.target.value || undefined })}>
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
          <Select aria-label="Sort" className="w-48" value={filters.sort ?? 'newest'} onChange={(e) => setFilters({ sort: e.target.value })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </Select>
        </div>
        {!isLoading && data?.meta?.total === 0 && !filters.q && !filters.period ? (
          <EmptyState
            icon={isCart ? ShoppingCart : MessageCircle}
            title={{ abandoned: 'No abandoned carts', active: 'Nobody is shopping right now', whatsapp: 'No WhatsApp leads yet' }[tab]}
            description={
              {
                abandoned: 'When a signed-in customer leaves your products in their cart for over an hour, they show up here.',
                active: 'Customers who added your products in the last hour show up here.',
                whatsapp: 'Customers who tap “Chat on WhatsApp” on your product pages show up here. Set your WhatsApp number in your store profile.',
              }[tab]
            }
          />
        ) : (
          <DataTable
            loading={isLoading}
            rows={data?.items}
            rowKey={(l) => l.userId}
            onRowClick={open}
            empty={{ title: 'No matches', description: 'Try another search or period.' }}
            columns={isCart ? cartColumns : whatsappColumns}
          />
        )}
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
      </Card>
    </>
  )
}
