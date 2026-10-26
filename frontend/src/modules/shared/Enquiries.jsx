import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatPhone, formatRelative } from '@/core/lib/format'
import { Badge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination, pageSize } from '@/ui/DataTable'
import { PageHeader } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'
import { whatsappLink, WhatsAppIcon } from './whatsapp'

const TABS = [
  { value: 'open', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'closed', label: 'Closed' },
  { value: '', label: 'All' },
]
const TONE = { open: 'warning', contacted: 'info', closed: 'neutral' }

/**
 * Buyers asking about out-of-stock products. `client`: { root, list(params), setStatus(id, status) }.
 * Admins see every seller's (`showVendor`); sellers and the store see their own.
 */
export function EnquiriesPage({ client, showVendor = false, from }) {
  const qc = useQueryClient()
  const [filters, setFilters] = useSearchParamsState({ status: 'open' })
  const params = { page: Number(filters.page ?? 1), limit: pageSize(filters.limit), status: filters.status || undefined, q: filters.q || undefined }
  const { data, isLoading } = useQuery({ queryKey: [...client.root, 'enquiries', params], queryFn: () => client.list(params), placeholderData: keepPreviousData })
  const setStatus = useMutation({
    mutationFn: ({ id, status }) => client.setStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...client.root, 'enquiries'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const message = (e) =>
    `Hi ${e.name.split(' ')[0]}, this is ${from ?? 'the seller'} about ${e.product.name}${e.variant ? ` (${e.variant})` : ''} you asked for. ${
      e.product.inStock ? `Good news: it's back in stock! https://${window.location.host}/p/${e.product.slug}` : ''
    }`.trim()

  return (
    <>
      <PageHeader title="Enquiries" description="Buyers who asked about a product while it was out of stock. Contact them on WhatsApp, especially once it's back." />
      <Card>
        <div className="px-4 pt-2">
          <FilterTabs value={filters.status ?? ''} onChange={(status) => setFilters({ status })} options={TABS} counts={data?.meta?.counts} />
        </div>
        <div className="border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Name, mobile or product" />
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          empty={{ title: 'No enquiries here', description: 'They appear when a buyer asks about an out-of-stock product.' }}
          columns={[
            {
              key: 'product',
              header: 'Product',
              cell: (e) => (
                <div className="flex items-center gap-3">
                  <Thumb src={e.product.image} className="size-10 shrink-0 rounded border border-slate-200" />
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-medium text-slate-900">{e.product.name}</p>
                    <p className="text-xs text-slate-500">
                      {[e.variant, showVendor && e.vendor?.name].filter(Boolean).join(' · ')}
                      {e.product.inStock && <span className="ml-1 font-semibold text-emerald-700">Back in stock</span>}
                    </p>
                  </div>
                </div>
              ),
            },
            {
              key: 'buyer',
              header: 'Buyer',
              cell: (e) => (
                <div>
                  <p className="font-medium text-slate-900">{e.name}</p>
                  <p className="text-xs text-slate-500">{formatPhone(e.phone)}</p>
                </div>
              ),
            },
            {
              key: 'need',
              header: 'Needs',
              cell: (e) => (
                <div className="max-w-64">
                  <p className="tabular text-slate-800">{e.quantity} unit{e.quantity === 1 ? '' : 's'}</p>
                  {e.message && <p className="line-clamp-2 text-xs text-slate-500">{e.message}</p>}
                </div>
              ),
            },
            { key: 'when', header: 'Asked', cell: (e) => <span className="text-slate-600">{formatRelative(e.createdAt)}</span> },
            { key: 'status', header: 'Status', cell: (e) => <Badge tone={TONE[e.status]}>{TABS.find((t) => t.value === e.status)?.label}</Badge> },
            {
              key: 'actions',
              header: '',
              className: 'w-px whitespace-nowrap',
              cell: (e) => (
                <div className="flex items-center gap-1">
                  <Button asChild size="sm" variant="outline" className="text-[#128c4b]">
                    <a
                      href={whatsappLink(e.phone, message(e))}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => e.status === 'open' && setStatus.mutate({ id: e._id, status: 'contacted' })}
                    >
                      <WhatsAppIcon /> WhatsApp
                    </a>
                  </Button>
                  {e.status !== 'closed' ? (
                    <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close enquiry" onClick={() => setStatus.mutate({ id: e._id, status: 'closed' })}>
                      <X />
                    </Button>
                  ) : (
                    <Button size="icon-sm" variant="ghost" title="Reopen" aria-label="Reopen enquiry" onClick={() => setStatus.mutate({ id: e._id, status: 'open' })}>
                      <Check />
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} onLimitChange={(limit) => setFilters({ limit })} />
      </Card>
    </>
  )
}

