import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, GitCompareArrows, Plus, Search, X } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { track } from '@/core/analytics/ga'
import { PRODUCT_CONDITIONS, PRODUCT_TYPE_LABEL } from '@/core/lib/constants'
import { cn } from '@/core/lib/cn'
import { formatINR, formatNumber } from '@/core/lib/format'
import { unitPlural, unitShort } from '@/core/lib/units'
import { useBranding } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { Sticker } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { EmptyState, Skeleton } from '@/ui/Card'
import { Switch } from '@/ui/Controls'
import { ShareButton } from '@/modules/shared/share'
import { storeApi, storeKeys } from '../api'
import { ComparePicker } from '../compare/ComparePicker'
import { COMPARE_MAX, compareHref, useCompare } from '../compare/useCompare'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Availability, BulkHint, useAddToCart } from '../components/ProductCard'
import { RatingInline } from '../components/Stars'

const CONDITION_LABEL = Object.fromEntries(PRODUCT_CONDITIONS.map((c) => [c.value, c.label]))
const norm = (v) =>
  String(v ?? '')
    .trim()
    .toLowerCase()
const dispatchText = (d) => (d == null ? null : d === 0 ? 'Within 24 hours' : `${d} day${d === 1 ? '' : 's'}`)

/**
 * What the table shows, in groups. `value(p)` is plain text: it is what "show only differences" compares,
 * and what is printed unless the row has its own `render`.
 */
function buildGroups(products) {
  // Every spec label any product has, first-seen order, matched case-insensitively ("Voltage" = "voltage ").
  const specLabels = new Map()
  for (const p of products) for (const s of p.specifications) if (!specLabels.has(norm(s.label))) specLabels.set(norm(s.label), s.label.trim())

  return [
    {
      title: 'Price & availability',
      rows: [
        { key: 'mrp', label: 'MRP', value: (p) => (p.mrp > p.price ? formatINR(p.mrp) : null) },
        { key: 'discount', label: 'Discount', value: (p) => (p.discountPercent > 0 ? `${p.discountPercent}% off` : null) },
        {
          key: 'bulk',
          label: 'Bulk pricing',
          value: (p) => (p.bulk ? `${p.bulk.fromPrice}:${p.bulk.tiers.at(-1).minQty}` : null),
          render: (p) => <BulkHint bulk={p.bulk} unit={p.unit} />,
        },
        {
          key: 'stock',
          label: 'Availability',
          value: (p) => (p.inStock ? 'in' : 'out'),
          render: (p) => <Availability product={{ ...p, dispatchDays: null }} />,
        },
        { key: 'dispatch', label: 'Dispatch', value: (p) => dispatchText(p.dispatchDays) },
        { key: 'moq', label: 'Minimum order', value: (p) => `${formatNumber(p.moq)} ${unitPlural(p.unit, p.moq)}` },
        { key: 'gst', label: 'GST', value: (p) => (p.gstRate != null ? `${p.gstRate}%` : null) },
        {
          key: 'rating',
          label: 'Rating',
          value: (p) => (p.rating ? `${p.rating.average}:${p.rating.count}` : null),
          render: (p) => (p.rating ? <RatingInline rating={p.rating} /> : null),
        },
      ],
    },
    {
      title: 'Product details',
      rows: [
        { key: 'brand', label: 'Brand', value: (p) => p.brand },
        { key: 'model', label: 'Model', value: (p) => p.modelNumber },
        { key: 'type', label: 'Type', value: (p) => PRODUCT_TYPE_LABEL[p.type] },
        { key: 'condition', label: 'Condition', value: (p) => CONDITION_LABEL[p.condition] ?? p.condition },
        {
          key: 'category',
          label: 'Category',
          value: (p) => p.category?.name,
          render: (p) =>
            p.category && (
              <Link to={`/c/${p.category.slug}`} className="hover:underline">
                {p.category.name}
              </Link>
            ),
        },
        {
          key: 'warranty',
          label: 'Warranty',
          value: (p) => [p.warranty?.months && `${p.warranty.months} months`, p.warranty?.details].filter(Boolean).join(' · ') || null,
        },
        { key: 'options', label: 'Options', value: (p) => p.variantOptions.map((o) => `${o.name}: ${o.values.join(', ')}`).join(' · ') || null },
        { key: 'hsn', label: 'HSN code', value: (p) => p.hsnCode },
      ],
    },
    {
      title: 'Specifications',
      rows: [
        ...[...specLabels].map(([k, label]) => ({
          key: `spec:${k}`,
          label,
          value: (p) => p.specifications.find((s) => norm(s.label) === k)?.value ?? null,
        })),
        { key: 'weight', label: 'Shipping weight', value: (p) => (p.shipping?.weightKg != null ? `${p.shipping.weightKg} kg` : null) },
      ],
    },
    {
      title: 'Seller',
      rows: [
        {
          key: 'seller',
          label: 'Sold by',
          value: (p) => p.vendor?.store?.name,
          render: (p) =>
            p.vendor && (
              <Link to={`/store/${p.vendor.store.slug}`} className="inline-flex items-center gap-1 font-semibold hover:underline">
                {p.vendor.store.name}
                {p.vendor.official && <BadgeCheck className="size-3.5 text-primary" aria-label="Official store" />}
              </Link>
            ),
        },
        { key: 'from', label: 'Ships from', value: (p) => [p.vendor?.city, p.vendor?.state].filter(Boolean).join(', ') || null },
      ],
    },
  ]
}

const differs = (row, products) => new Set(products.map((p) => norm(row.value(p)))).size > 1

export default function ComparePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const stored = useCompare((s) => s.items)
  const replace = useCompare((s) => s.replace)
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [picking, setPicking] = useState(false)
  const { siteName } = useBranding()

  const fromUrl = [...new Set((params.get('ids') ?? '').split(',').filter((id) => /^[a-f\d]{24}$/i.test(id)))].slice(0, COMPARE_MAX)
  // Opened without ids (e.g. a bookmark of /compare): the saved list, put into the URL so it can be shared.
  const ids = fromUrl.length || params.has('ids') ? fromUrl : stored.map((i) => i._id)
  const key = ids.join(',')

  useEffect(() => {
    if (!params.has('ids') && ids.length) navigate(compareHref(ids), { replace: true })
    // Only on arrival; later changes go through the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: storeKeys.compare(key),
    queryFn: () => storeApi.compare(key),
    enabled: ids.length > 0,
    placeholderData: (prev) => prev,
  })

  // The tray follows what's on screen (a shared link becomes this browser's list; delisted products drop out).
  useEffect(() => {
    if (data && !isPlaceholderData) replace(data)
  }, [data, isPlaceholderData, replace])

  const products = (data ?? []).filter((p) => ids.includes(p._id))
  const setIds = (next) => {
    // navigate() keeps the commas readable in a shared link (search params would encode them).
    navigate(compareHref(next), { replace: true })
    if (!next.length) replace([])
  }

  const title = `Compare products | ${siteName}`
  if (!ids.length) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <title>{title}</title>
        <EmptyState
          icon={GitCompareArrows}
          title="Nothing to compare yet"
          description={`Tick "Compare" on up to ${COMPARE_MAX} products to see their prices, specifications and sellers side by side.`}
          action={
            <Button asChild>
              <Link to="/search">Browse products</Link>
            </Button>
          }
        />
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {ids.map((id) => (
            <Skeleton key={id} className="h-72" />
          ))}
        </div>
      </div>
    )
  }
  if (!products.length) {
    return (
      <EmptyState
        title="These products are no longer available"
        description="They may have been taken out of the catalogue."
        action={
          <Button asChild>
            <Link to="/search">Browse products</Link>
          </Button>
        }
      />
    )
  }

  const groups = buildGroups(products)
    .map((g) => ({
      ...g,
      // A row nobody fills says nothing; with "only differences", neither does a row everyone fills the same.
      rows: g.rows.filter((r) => products.some((p) => r.value(p) != null) && (!onlyDiff || products.length < 2 || differs(r, products))),
    }))
    .filter((g) => g.rows.length)
  const slot = products.length < COMPARE_MAX
  const cols = products.length + (slot ? 1 : 0)
  const mixed = new Set(products.map((p) => p.category?._id)).size > 1

  const cell = 'border-b border-slate-200 px-3 py-2.5 align-top text-sm text-slate-900 sm:px-4'
  const labelCell =
    'sticky left-0 z-[1] hidden w-44 min-w-44 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left align-top text-sm font-medium text-slate-600 sm:table-cell'

  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4">
      <title>{title}</title>
      <meta name="robots" content="noindex" />
      <Breadcrumbs items={[{ label: 'Compare products' }]} />

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-[2rem]">Compare products</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            {products.length} of {COMPARE_MAX} products
            {mixed && ' · from different categories, so some specifications won’t line up'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {products.length > 1 && (
            <div className="w-56">
              <Switch checked={onlyDiff} onCheckedChange={setOnlyDiff} label="Show only differences" />
            </div>
          )}
          {slot && (
            <Button size="sm" variant="outline" className="sm:hidden" onClick={() => setPicking(true)}>
              <Plus /> Add product
            </Button>
          )}
          <ShareButton
            size="sm"
            item={{
              title: products.map((p) => p.name).join(' vs '),
              text: `Compare ${products.map((p) => p.name).join(' vs ')} on ${siteName}`,
              url: `${window.location.origin}${compareHref(products.map((p) => p._id))}`,
            }}
            onShare={(method) => track('share', { method, content_type: 'comparison', item_id: key })}
          />
        </div>
      </div>

      <div className="-mx-4 mt-5 overflow-x-auto sm:mx-0">
        <table className="w-full border-separate border-spacing-0" style={{ minWidth: `${products.length * 10}rem` }}>
          <thead>
            <tr>
              <th className={cn(labelCell, 'bg-white')}>
                <span className="sr-only">Product</span>
              </th>
              {products.map((p) => (
                <ProductHead key={p._id} product={p} onRemove={() => setIds(ids.filter((id) => id !== p._id))} />
              ))}
              {slot && (
                <td className="hidden border-b border-slate-200 p-4 align-top sm:table-cell">
                  <div className="flex h-full min-h-56 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-slate-300 p-4 text-center">
                    <Plus className="size-6 text-slate-400" />
                    <p className="text-sm font-semibold text-slate-700">Add a product</p>
                    <p className="text-xs text-slate-500">Search the catalogue or pick a similar product</p>
                    <Button size="sm" variant="outline" className="mt-1" onClick={() => setPicking(true)}>
                      <Search /> Choose a product
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.title}>
                <tr>
                  <th colSpan={cols + 1} className="border-b-2 border-slate-900 pt-6 pb-2 text-left">
                    <span className="sticky left-4 px-0 font-display text-sm font-bold tracking-wide text-slate-900 uppercase sm:left-0">{g.title}</span>
                  </th>
                </tr>
                {g.rows.map((r) => {
                  const diff = products.length > 1 && differs(r, products)
                  return (
                    <Fragment key={r.key}>
                      {/* Phones: the label gets its own line above the values. */}
                      <tr className="sm:hidden">
                        <th colSpan={cols} className="px-3 pt-2.5 text-left text-xs font-medium text-slate-500">
                          <span className="sticky left-3">{r.label}</span>
                        </th>
                      </tr>
                      <tr className={cn(diff && 'bg-amber-50/40')}>
                        <th scope="row" className={labelCell}>
                          {r.label}
                        </th>
                        {products.map((p) => {
                          const shown = r.render ? r.render(p) : r.value(p)
                          return (
                            <td key={p._id} className={cn(cell, 'sm:border-l sm:border-l-slate-100')}>
                              {shown ?? <span className="text-slate-400">—</span>}
                            </td>
                          )
                        })}
                        {slot && <td className={cn(cell, 'hidden sm:table-cell sm:border-l sm:border-l-slate-100')} />}
                      </tr>
                    </Fragment>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <ComparePicker open={picking} onOpenChange={setPicking} onPick={(p) => navigate(compareHref([...ids, p._id]), { replace: true })} />
      {onlyDiff && !groups.length && <p className="py-10 text-center text-sm text-slate-600">These products are listed with the same details.</p>}
    </div>
  )
}

/** Column head: photo, name, price and the buy button for one product. */
function ProductHead({ product: p, onRemove }) {
  const { add, busy, inCart } = useAddToCart(p)
  return (
    <td className="relative w-1/4 border-b border-slate-200 p-3 align-top sm:border-l sm:border-l-slate-100 sm:p-4">
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${p.name} from comparison`}
        title="Remove"
        className="absolute top-2 right-2 z-10 grid size-8 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 hover:text-slate-900"
      >
        <X className="size-4" />
      </button>
      <Link to={`/p/${p.slug}`} className="group block">
        <div className="relative aspect-square overflow-hidden rounded-md bg-slate-100 p-3">
          <Thumb src={p.image?.url} alt={p.image?.alt ?? p.name} className="size-full bg-transparent mix-blend-multiply" />
          {p.discountPercent >= 5 && <Sticker className="absolute top-2 left-2">Save {p.discountPercent}%</Sticker>}
        </div>
        {p.brand && <p className="mt-2.5 text-[11px] font-bold tracking-[0.08em] text-slate-600 uppercase">{p.brand}</p>}
        <p className="mt-0.5 line-clamp-3 text-sm leading-snug font-semibold text-slate-900 group-hover:underline">{p.name}</p>
      </Link>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="price text-xl leading-none text-slate-900">
          {p.hasVariants && <span className="mr-1 text-xs font-normal text-slate-500">From</span>}
          {formatINR(p.price)}
        </span>
        <span className="text-xs text-slate-500">/ {unitShort(p.unit)}</span>
      </p>
      <Button size="sm" variant={inCart ? 'soft' : 'primary'} className="mt-3 w-full" disabled={!p.inStock} loading={busy} onClick={add}>
        {!p.inStock ? 'Out of stock' : p.hasVariants ? 'Choose options' : inCart ? `In cart · ${inCart}` : 'Add to cart'}
      </Button>
    </td>
  )
}
