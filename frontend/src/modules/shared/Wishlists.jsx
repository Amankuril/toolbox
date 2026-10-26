import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Heart } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatINR, formatPhone, formatRelative } from '@/core/lib/format'
import { openContact } from '@/modules/vendor/leads'
import { Badge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { DataTable, Pagination, pageSize } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Select } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'
import { whatsappLink, WhatsAppIcon } from './whatsapp'

const PERIODS = { '': 'Any time', 7: 'Saved in the last 7 days', 30: 'Last 30 days', 90: 'Last 90 days' }

/**
 * Products customers saved to their wishlist, with who saved them, and WhatsApp reminders.
 * `client`: { root, list(params), remind(body) }. Admins see every seller's (`showSeller`).
 */
export function WishlistsPage({ client, showSeller = false }) {
  const qc = useQueryClient()
  const [filters, setFilters] = useSearchParamsState()
  const [recipients, setRecipients] = useState(null)
  const query = {
    q: filters.q || undefined,
    product: filters.product || undefined,
    days: filters.days ? Number(filters.days) : undefined,
  }
  const params = { ...query, page: Number(filters.page ?? 1), limit: pageSize(filters.limit) }
  const { data, isLoading } = useQuery({ queryKey: [...client.root, 'wishlists', params], queryFn: () => client.list(params), placeholderData: keepPreviousData })
  const refresh = () => qc.invalidateQueries({ queryKey: [...client.root, 'wishlists'] })

  const remindOne = useMutation({
    mutationFn: (row) =>
      openContact('whatsapp', async () => {
        const [r] = await client.remind({ ids: [row._id] })
        if (!r) throw new Error('This customer has no mobile number, or the product is no longer live')
        return { url: whatsappLink(r.customer.phone, r.message) }
      }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remindAll = useMutation({
    mutationFn: () => client.remind(query),
    onSuccess: (rows) => {
      refresh()
      if (!rows.length) toast.info('Nobody to remind: no live products with a customer mobile number')
      else setRecipients(rows)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const top = data?.meta?.top ?? []

  return (
    <>
      <PageHeader
        title="Wishlists"
        description="Products customers saved for later, and who saved them. Remind them on WhatsApp to turn saves into orders."
        actions={
          <Button loading={remindAll.isPending} disabled={!data?.meta?.total} onClick={() => remindAll.mutate()}>
            <BellRing /> Remind all{data?.meta?.total ? ` (${Math.min(data.meta.total, 500)})` : ''}
          </Button>
        }
      />
      {top.length > 0 && (
        <div className="mb-4 flex gap-3 overflow-x-auto pb-1">
          {top.map((t) => (
            <button
              key={t._id}
              type="button"
              onClick={() => setFilters({ product: filters.product === t._id ? undefined : t._id })}
              className={`flex min-w-56 items-center gap-3 rounded-lg border bg-white p-3 text-left ${filters.product === t._id ? 'border-primary ring-1 ring-primary' : 'border-slate-200 hover:border-slate-400'}`}
            >
              <Thumb src={t.image} className="size-10 shrink-0 rounded border border-slate-200" />
              <span className="min-w-0">
                <span className="line-clamp-1 text-sm font-medium text-slate-900">{t.name}</span>
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Heart className="size-3 fill-rose-500 text-rose-500" /> {t.saves} save{t.saves === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Product name" />
          <Select value={filters.days ?? ''} onChange={(e) => setFilters({ days: e.target.value })} className="w-auto">
            {Object.entries(PERIODS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
          {filters.product && (
            <Button variant="ghost" size="sm" onClick={() => setFilters({ product: undefined })}>
              Show all products
            </Button>
          )}
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          empty={{ title: 'No saved products here', description: 'When customers tap the heart on a product, they show up here.' }}
          columns={[
            {
              key: 'product',
              header: 'Product',
              cell: (r) => (
                <div className="flex items-center gap-3">
                  <Thumb src={r.product.image} className="size-10 shrink-0 rounded border border-slate-200" />
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-medium text-slate-900">{r.product.name}</p>
                    <p className="text-xs text-slate-500">
                      {[formatINR(r.product.price), r.product.stock === 0 ? 'Out of stock' : r.product.stock != null ? `${r.product.stock} in stock` : null, showSeller && r.product.seller]
                        .filter(Boolean)
                        .join(' · ')}
                      {!r.product.live && (
                        <Badge tone="warning" className="ml-1">
                          Not live
                        </Badge>
                      )}
                    </p>
                  </div>
                </div>
              ),
            },
            {
              key: 'customer',
              header: 'Customer',
              cell: (r) => (
                <div>
                  <p className="font-medium text-slate-900">{r.customer.name}</p>
                  <p className="text-xs text-slate-500">{r.customer.phone ? formatPhone(r.customer.phone) : (r.customer.email ?? '—')}</p>
                </div>
              ),
            },
            { key: 'saved', header: 'Saved', cell: (r) => <span className="text-slate-600">{formatRelative(r.savedAt)}</span> },
            {
              key: 'reminded',
              header: 'Reminded',
              cell: (r) => <span className="text-slate-600">{r.remindedAt ? formatRelative(r.remindedAt) : '—'}</span>,
            },
            {
              key: 'actions',
              header: '',
              className: 'w-px whitespace-nowrap',
              cell: (r) =>
                r.customer.phone && r.product.live ? (
                  <Button size="sm" variant="outline" className="text-[#128c4b]" loading={remindOne.isPending && remindOne.variables?._id === r._id} onClick={() => remindOne.mutate(r)}>
                    <WhatsAppIcon /> Remind
                  </Button>
                ) : null,
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} onLimitChange={(limit) => setFilters({ limit })} />
      </Card>
      <RemindAllDialog recipients={recipients} onClose={() => setRecipients(null)} />
    </>
  )
}

/** A browser can't send WhatsApp messages in bulk: one tap per customer, each with their own message. */
function RemindAllDialog({ recipients, onClose }) {
  const [opened, setOpened] = useState(() => new Set())
  return (
    <Dialog open={Boolean(recipients)} onOpenChange={(o) => !o && onClose()} size="lg" title="Send reminders" description="Tap each customer to open WhatsApp with their reminder typed in.">
      <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
        {recipients?.map((r) => (
          <li key={r._id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium text-slate-900">{r.customer.name}</span>
              <span className="block truncate text-xs text-slate-500">{r.product.name}</span>
            </span>
            <Button asChild size="sm" variant={opened.has(r._id) ? 'ghost' : 'outline'} className="text-[#128c4b]">
              <a href={whatsappLink(r.customer.phone, r.message)} target="_blank" rel="noopener noreferrer" onClick={() => setOpened((s) => new Set(s).add(r._id))}>
                <WhatsAppIcon /> {opened.has(r._id) ? 'Opened' : 'Send'}
              </a>
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
