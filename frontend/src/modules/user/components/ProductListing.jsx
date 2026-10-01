import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, LayoutGrid, List, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { PRODUCT_CONDITIONS, PRODUCT_TYPES } from '@/core/lib/constants'
import { cn } from '@/core/lib/cn'
import { formatINR, formatNumber, fromPaise, toPaise } from '@/core/lib/format'
import { safeStorage } from '@/core/lib/storage'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/Card'
import { Sheet } from '@/ui/Dialog'
import { Checkbox, Input, Select } from '@/ui/Field'
import { storeApi, storeKeys } from '../api'
import { ProductGrid } from './ProductCard'

const SORTS = [
  { value: '', label: 'Best match' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'discount', label: 'Biggest discount' },
]

const PAGE_SIZE = 24
const FILTER_KEYS = ['type', 'brand', 'condition', 'minPrice', 'maxPrice', 'inStock', 'bulk', 'featured']
const VIEW_KEY = 'tb:listing-view'

/**
 * Product listing with URL-driven filters. `base` holds fixed filters (category / vendor / q).
 * Grid or list view; the choice is remembered on this device.
 */
export function ProductListing({ base = {}, heading }) {
  const [f, setF] = useSearchParamsState()
  const [sheet, setSheet] = useState(false)
  const [view, setView] = useState(() => safeStorage.get(VIEW_KEY, 'grid'))
  const params = {
    ...base,
    page: Number(f.page ?? 1),
    limit: PAGE_SIZE,
    sort: f.sort || undefined,
    type: f.type || undefined,
    brand: f.brand || undefined,
    condition: f.condition || undefined,
    minPrice: f.minPrice || undefined,
    maxPrice: f.maxPrice || undefined,
    inStock: f.inStock || undefined,
    bulk: f.bulk || undefined,
    featured: f.featured || undefined,
    q: base.q ?? (f.q || undefined),
  }
  const { data, isLoading, isFetching } = useQuery({
    queryKey: storeKeys.products(params),
    queryFn: () => storeApi.products(params),
    placeholderData: keepPreviousData,
  })
  const meta = data?.meta
  const facets = meta?.facets
  const active = FILTER_KEYS.filter((k) => f[k])
  const clearAll = () => setF(Object.fromEntries(active.map((k) => [k, ''])))
  const pick = (v) => {
    setView(v)
    safeStorage.set(VIEW_KEY, v)
  }

  const from = meta ? (meta.page - 1) * meta.limit + 1 : 0
  const to = meta ? Math.min(meta.page * meta.limit, meta.total) : 0

  return (
    <div>
      {heading}
      <div className="mt-6 flex gap-10">
        <aside className="hidden w-60 shrink-0 lg:block" aria-label="Filters">
          <Filters f={f} setF={setF} facets={facets} />
        </aside>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <p className="text-sm text-slate-600" aria-live="polite">
              {meta ? (
                meta.total ? (
                  <>
                    <span className="tabular font-semibold text-slate-900">
                      {formatNumber(from)}–{formatNumber(to)}
                    </span>{' '}
                    of <span className="tabular font-semibold text-slate-900">{formatNumber(meta.total)}</span> products
                  </>
                ) : (
                  'No products'
                )
              ) : (
                ' '
              )}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSheet(true)}>
                <SlidersHorizontal /> Filter {active.length > 0 && `(${active.length})`}
              </Button>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <span className="hidden sm:inline">Sort</span>
                <Select value={f.sort ?? ''} onChange={(e) => setF({ sort: e.target.value })} aria-label="Sort by" className="h-9 w-auto font-medium text-slate-900">
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="hidden overflow-hidden rounded-md border border-slate-300 sm:flex" role="group" aria-label="View">
                {[
                  ['grid', LayoutGrid, 'Grid view'],
                  ['list', List, 'List view'],
                ].map(([v, Icon, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-label={label}
                    aria-pressed={view === v}
                    onClick={() => pick(v)}
                    className={cn('grid size-9 place-items-center', view === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:text-slate-900')}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {active.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {active.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setF({ [k]: '' })}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
                >
                  {chipLabel(k, f[k])} <X className="size-3" />
                </button>
              ))}
              <button type="button" onClick={clearAll} className="text-xs font-semibold text-slate-900 underline underline-offset-2">
                Clear all
              </button>
            </div>
          )}

          <div className={cn('mt-6 transition-opacity', isFetching && !isLoading && 'opacity-60')}>
            {!isLoading && !data?.items.length ? (
              <EmptyState
                icon={SearchX}
                title="No products match"
                description={active.length ? 'Try removing a filter or two.' : 'Nothing is listed here yet. Check back soon.'}
                action={
                  active.length > 0 && (
                    <Button variant="outline" onClick={clearAll}>
                      Clear filters
                    </Button>
                  )
                }
              />
            ) : (
              <ProductGrid products={data?.items ?? []} loading={isLoading} count={10} view={view} />
            )}
          </div>

          {meta && meta.totalPages > 1 && <Pager meta={meta} onPage={(page) => (setF({ page }), window.scrollTo({ top: 0 }))} />}
        </div>
      </div>

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Filter"
        side="right"
        footer={
          <Button className="w-full" onClick={() => setSheet(false)}>
            Show {meta ? formatNumber(meta.total) : ''} results
          </Button>
        }
      >
        <div className="p-4">
          <Filters f={f} setF={setF} facets={facets} />
        </div>
      </Sheet>
    </div>
  )
}

/** Numbered pager with ellipses: 1 … 4 5 6 … 12 */
function Pager({ meta, onPage }) {
  const { page, totalPages } = meta
  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-1">
      <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft />
      </Button>
      {pages.map((p, i) => (
        <span key={p} className="flex items-center">
          {i > 0 && p - pages[i - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
          <button
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn('tabular size-9 rounded-md text-sm font-semibold', p === page ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100')}
          >
            {p}
          </button>
        </span>
      ))}
      <Button variant="ghost" size="icon" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight />
      </Button>
    </nav>
  )
}

function chipLabel(key, value) {
  switch (key) {
    case 'type':
      return PRODUCT_TYPES.find((t) => t.value === value)?.label ?? value
    case 'brand':
      return value.split(',').join(', ')
    case 'condition':
      return PRODUCT_CONDITIONS.find((c) => c.value === value)?.label ?? value
    case 'minPrice':
      return `From ${formatINR(Number(value))}`
    case 'maxPrice':
      return `Up to ${formatINR(Number(value))}`
    case 'inStock':
      return 'In stock'
    case 'bulk':
      return 'Bulk pricing'
    case 'featured':
      return 'Featured'
    default:
      return value
  }
}

function FilterSection({ title, children }) {
  return (
    <section className="border-b border-slate-200 py-5 first:pt-0">
      <h3 className="mb-3 font-display text-[13px] font-semibold tracking-[0.12em] text-slate-900 uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Filters({ f, setF, facets }) {
  const brands = f.brand ? f.brand.split(',') : []
  const toggleBrand = (b) => setF({ brand: (brands.includes(b) ? brands.filter((x) => x !== b) : [...brands, b]).join(',') })
  const typeCounts = Object.fromEntries((facets?.types ?? []).map((t) => [t.value, t.count]))

  return (
    <div>
      <FilterSection title="Buying options">
        <div className="flex flex-col gap-2.5">
          <Checkbox label="Bulk pricing available" checked={Boolean(f.bulk)} onChange={(e) => setF({ bulk: e.target.checked ? 'true' : '' })} />
          <Checkbox label="In stock only" checked={Boolean(f.inStock)} onChange={(e) => setF({ inStock: e.target.checked ? 'true' : '' })} />
        </div>
      </FilterSection>

      <FilterSection title="Product type">
        <div className="flex flex-col gap-2.5">
          {PRODUCT_TYPES.map((t) => (
            <label key={t.value} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input type="radio" name="type" checked={f.type === t.value} onChange={() => setF({ type: t.value })} className="size-4 accent-[var(--tb-primary)]" />
              <span className="flex-1 text-slate-800">{t.label}</span>
              {typeCounts[t.value] != null && <span className="tabular text-xs text-slate-400">{typeCounts[t.value]}</span>}
            </label>
          ))}
          {f.type && (
            <button type="button" onClick={() => setF({ type: '' })} className="self-start text-xs font-semibold text-slate-900 underline underline-offset-2">
              Any type
            </button>
          )}
        </div>
      </FilterSection>

      <FilterSection title="Price">
        <PriceRange key={`${f.minPrice}-${f.maxPrice}`} min={f.minPrice} max={f.maxPrice} bounds={facets?.price} onApply={(minPrice, maxPrice) => setF({ minPrice, maxPrice })} />
      </FilterSection>

      {facets?.brands?.length > 0 && (
        <FilterSection title="Brand">
          <div className="flex max-h-64 flex-col gap-2.5 overflow-y-auto">
            {facets.brands.map((b) => (
              <label key={b.value} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input type="checkbox" checked={brands.includes(b.value)} onChange={() => toggleBrand(b.value)} className="size-4 rounded accent-[var(--tb-primary)]" />
                <span className="flex-1 text-slate-800">{b.value}</span>
                <span className="tabular text-xs text-slate-400">{b.count}</span>
              </label>
            ))}
          </div>
        </FilterSection>
      )}

      <FilterSection title="Condition">
        <Select value={f.condition ?? ''} onChange={(e) => setF({ condition: e.target.value })} aria-label="Condition">
          <option value="">Any condition</option>
          {PRODUCT_CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </FilterSection>
    </div>
  )
}

function PriceRange({ min, max, bounds, onApply }) {
  const [lo, setLo] = useState(min ? String(fromPaise(min)) : '')
  const [hi, setHi] = useState(max ? String(fromPaise(max)) : '')
  const apply = (e) => {
    e.preventDefault()
    onApply(lo ? toPaise(lo) : '', hi ? toPaise(hi) : '')
  }
  return (
    <form onSubmit={apply} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          prefix="₹"
          inputMode="numeric"
          value={lo}
          onChange={(e) => setLo(e.target.value.replace(/\D/g, ''))}
          placeholder={bounds ? String(Math.floor(fromPaise(bounds.min))) : 'Min'}
          aria-label="Minimum price"
        />
        <span className="text-slate-400">–</span>
        <Input
          prefix="₹"
          inputMode="numeric"
          value={hi}
          onChange={(e) => setHi(e.target.value.replace(/\D/g, ''))}
          placeholder={bounds ? String(Math.ceil(fromPaise(bounds.max))) : 'Max'}
          aria-label="Maximum price"
        />
      </div>
      <Button type="submit" variant="outline" size="sm">
        Apply
      </Button>
    </form>
  )
}
