import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { PRODUCT_CONDITIONS, PRODUCT_TYPES } from '@/core/lib/constants'
import { cn } from '@/core/lib/cn'
import { formatINR, formatNumber, fromPaise, toPaise } from '@/core/lib/format'
import { Button } from '@/ui/Button'
import { Checkbox, Input, Select } from '@/ui/Field'
import { EmptyState } from '@/ui/Card'
import { Sheet } from '@/ui/Dialog'
import { storeApi, storeKeys } from '../api'
import { ProductGrid } from './ProductCard'

const SORTS = [
  { value: '', label: 'Relevance' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'discount', label: 'Biggest discount' },
]

const PAGE_SIZE = 24

/**
 * Product grid with URL-driven filters. `base` holds fixed filters (category / vendor / q).
 */
export function ProductListing({ base = {}, heading }) {
  const [f, setF] = useSearchParamsState()
  const [sheet, setSheet] = useState(false)
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
  const activeFilters = ['type', 'brand', 'condition', 'minPrice', 'maxPrice', 'inStock', 'featured'].filter((k) => f[k])

  const filters = <Filters f={f} setF={setF} facets={facets} />

  return (
    <div className="flex gap-8">
      <aside className="hidden w-60 shrink-0 lg:block" aria-label="Filters">
        {filters}
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            {heading}
            <p className="text-sm text-slate-500" aria-live="polite">
              {meta ? `${formatNumber(meta.total)} product${meta.total === 1 ? '' : 's'}` : ' '}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="lg:hidden" onClick={() => setSheet(true)}>
              <SlidersHorizontal /> Filters {activeFilters.length > 0 && `(${activeFilters.length})`}
            </Button>
            <Select value={f.sort ?? ''} onChange={(e) => setF({ sort: e.target.value })} aria-label="Sort by" className="w-auto">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {activeFilters.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {activeFilters.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setF({ [k]: '' })}
                className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-400"
              >
                {chipLabel(k, f[k])} <X className="size-3" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setF(Object.fromEntries(activeFilters.map((k) => [k, ''])))}
              className="text-xs font-medium text-primary hover:underline"
            >
              Clear all
            </button>
          </div>
        )}

        <div className={cn('transition-opacity', isFetching && !isLoading && 'opacity-60')}>
          {!isLoading && !data?.items.length ? (
            <EmptyState
              icon={SearchX}
              title="No products found"
              description={activeFilters.length ? 'Try removing some filters.' : 'Nothing is listed here yet. Check back soon.'}
              action={
                activeFilters.length > 0 && (
                  <Button variant="outline" onClick={() => setF(Object.fromEntries(activeFilters.map((k) => [k, ''])))}>
                    Clear filters
                  </Button>
                )
              }
            />
          ) : (
            <ProductGrid products={data?.items ?? []} loading={isLoading} count={10} />
          )}
        </div>

        {meta && meta.totalPages > 1 && (
          <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={meta.page <= 1}
              onClick={() => (setF({ page: meta.page - 1 }), window.scrollTo({ top: 0 }))}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <span className="tabular px-3 text-sm text-slate-600">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={meta.page >= meta.totalPages}
              onClick={() => (setF({ page: meta.page + 1 }), window.scrollTo({ top: 0 }))}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
          </nav>
        )}
      </div>

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Filters"
        side="right"
        footer={
          <Button className="w-full" onClick={() => setSheet(false)}>
            Show {meta ? formatNumber(meta.total) : ''} results
          </Button>
        }
      >
        <div className="p-4">{filters}</div>
      </Sheet>
    </div>
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
    case 'featured':
      return 'Featured'
    default:
      return value
  }
}

function FilterSection({ title, children }) {
  return (
    <section className="border-b border-slate-200 py-4 first:pt-0">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
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
      <FilterSection title="Type">
        <div className="flex flex-col gap-2">
          {PRODUCT_TYPES.map((t) => (
            <label key={t.value} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="radio"
                name="type"
                checked={f.type === t.value}
                onChange={() => setF({ type: t.value })}
                className="size-4 accent-[var(--tb-primary)]"
              />
              <span className="flex-1 text-slate-800">{t.label}</span>
              {typeCounts[t.value] != null && <span className="tabular text-xs text-slate-400">{typeCounts[t.value]}</span>}
            </label>
          ))}
          {f.type && (
            <button type="button" onClick={() => setF({ type: '' })} className="self-start text-xs font-medium text-primary hover:underline">
              Any type
            </button>
          )}
        </div>
      </FilterSection>

      <FilterSection title="Price">
        <PriceRange
          key={`${f.minPrice}-${f.maxPrice}`}
          min={f.minPrice}
          max={f.maxPrice}
          bounds={facets?.price}
          onApply={(minPrice, maxPrice) => setF({ minPrice, maxPrice })}
        />
      </FilterSection>

      {facets?.brands?.length > 0 && (
        <FilterSection title="Brand">
          <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
            {facets.brands.map((b) => (
              <Checkbox key={b.value} label={`${b.value} (${b.count})`} checked={brands.includes(b.value)} onChange={() => toggleBrand(b.value)} />
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

      <FilterSection title="Availability">
        <Checkbox label="In stock only" checked={Boolean(f.inStock)} onChange={(e) => setF({ inStock: e.target.checked ? 'true' : '' })} />
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
