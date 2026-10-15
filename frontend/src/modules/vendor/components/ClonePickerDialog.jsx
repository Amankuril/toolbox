import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { useState } from 'react'
import { formatINR } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Skeleton } from '@/ui/Card'
import { Dialog } from '@/ui/Dialog'
import { SearchField } from '@/ui/SearchField'
import { useSeller } from '../seller'

/** Search the seller's own products and pick one to start a new listing from. */
export function ClonePickerDialog({ open, onOpenChange, onPick, excludeId }) {
  const seller = useSeller()
  const [q, setQ] = useState('')
  const params = { page: 1, limit: 12, q: q || undefined }
  const { data, isLoading } = useQuery({
    queryKey: seller.keys.products({ ...params, picker: true }),
    queryFn: () => seller.api.products(params),
    enabled: open,
    placeholderData: keepPreviousData,
  })
  const rows = (data?.items ?? []).filter((p) => p._id !== excludeId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Clone a product" description="The form fills in with its details. Nothing changes on the original." size="lg">
      <SearchField value={q} onChange={setQ} placeholder="Search by name, SKU, brand or model" className="sm:max-w-none" />
      <ul className="mt-3 flex flex-col divide-y divide-slate-100">
        {isLoading
          ? Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="py-2.5">
                <Skeleton className="h-11 w-full" />
              </li>
            ))
          : rows.map((p) => (
              <li key={p._id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false)
                    onPick(p)
                  }}
                  className="group flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-slate-50"
                >
                  <Thumb src={p.images?.[0]?.url} className="size-11 shrink-0 rounded-md border border-slate-200" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[p.sku && `SKU ${p.sku}`, p.category?.name, formatINR(p.pricing.price)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <StatusBadge status={p.status} />
                  <Copy className="size-4 shrink-0 text-slate-400 group-hover:text-primary" aria-hidden />
                </button>
              </li>
            ))}
      </ul>
      {!isLoading && !rows.length && <p className="py-8 text-center text-sm text-slate-500">{q ? 'No products match.' : 'You have no products to copy yet.'}</p>}
    </Dialog>
  )
}
