import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { formatINR } from '@/core/lib/format'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Card'
import { Dialog } from '@/ui/Dialog'
import { SearchField } from '@/ui/SearchField'
import { storeApi, storeKeys } from '../api'
import { COMPARE_MAX, useCompare } from './useCompare'

const LIMIT = 12

/**
 * Pick a product to compare without leaving the page. Typing searches the whole catalogue; with no
 * search text it suggests the first compared product's category, then other products to fill the list.
 * Products already being compared are left out.
 */
export function ComparePicker({ open, onOpenChange, onPick }) {
  const items = useCompare((s) => s.items)
  const toggle = useCompare((s) => s.toggle)
  const [q, setQ] = useState('')
  const first = items[0]?._id ?? ''

  // The category comes with the comparison data (usually already cached by the compare page).
  const { data: firstFull, isLoading: firstLoading } = useQuery({
    queryKey: storeKeys.compare(first),
    queryFn: () => storeApi.compare(first),
    enabled: open && Boolean(first),
    staleTime: 60_000,
  })
  const category = firstFull?.[0]?.category
  const list = (params, enabled) => ({
    queryKey: storeKeys.products({ ...params, picker: true }),
    queryFn: () => storeApi.products(params),
    enabled: open && enabled,
    placeholderData: keepPreviousData,
  })
  const search = useQuery(list({ q, limit: LIMIT }, Boolean(q)))
  const similar = useQuery(list({ category: category?.slug, limit: LIMIT }, !q && Boolean(category)))
  const popular = useQuery(list({ limit: LIMIT }, !q))

  const added = new Set(items.map((i) => i._id))
  const fresh = (rows = []) => rows.filter((p) => !added.has(p._id))
  const similarRows = category ? fresh(similar.data?.items) : []
  const sections = q
    ? [{ title: `Results for “${q}”`, rows: fresh(search.data?.items) }]
    : [
        { title: `More in ${category?.name}`, rows: similarRows },
        {
          title: similarRows.length ? 'Other products' : 'Products',
          rows: fresh(popular.data?.items).filter((p) => !similarRows.some((s) => s._id === p._id)),
        },
      ]
  const visible = sections.filter((s) => s.rows.length)
  const loading = q ? search.isLoading : firstLoading || (category && similar.isLoading) || popular.isLoading
  const full = items.length >= COMPARE_MAX

  const setOpen = (v) => {
    onOpenChange(v)
    if (!v) setQ('')
  }
  const pick = (p) => {
    toggle(p)
    onPick?.(p)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen} size="md" title="Add a product to compare" description={`${items.length} of ${COMPARE_MAX} selected`}>
      <SearchField value={q} onChange={setQ} placeholder="Search products, brands or models" className="sm:max-w-none" />
      {loading ? (
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : visible.length ? (
        visible.map((section) => (
          <section key={section.title} className="mt-4">
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{section.title}</h3>
            <ul className="divide-y divide-slate-100">
              {section.rows.map((p) => (
                <li key={p._id} className="flex items-center gap-3 py-2.5">
                  <Thumb src={p.image?.url} alt="" className="size-14 shrink-0 rounded bg-slate-100 p-1 mix-blend-multiply" />
                  <div className="min-w-0 flex-1">
                    {p.brand && <p className="text-[11px] font-bold tracking-[0.08em] text-slate-500 uppercase">{p.brand}</p>}
                    <p className="line-clamp-2 text-sm leading-snug font-medium text-slate-900">{p.name}</p>
                    <p className="price mt-0.5 text-sm text-slate-900">{formatINR(p.price)}</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={full} onClick={() => pick(p)} aria-label={`Add ${p.name} to compare`}>
                    <Plus /> Add
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">No products found. Try another search.</p>
      )}
    </Dialog>
  )
}
